-- --------------------------------------------------------------------------
-- 124_iq_refund_state_gate.sql   (P0-5 · 개별질문 답변후 셀프환불 차단 — 경쟁조건 제거)
-- [적용됨 — ssambership-staging 에 2026-07-19 단일 트랜잭션(lock_timeout 3s) 적용·검증 통과
--   (구조 assertion 5 + 시나리오 A~D PASS · 동시성 E는 독립 2세션 필요로 PENDING). core 정의 해시 불변 확인.
--   원장 미기재 — 적용 이력: docs/audit/sql_apply_manifest.md]
-- 목적: 학생 셀프환불 래퍼 refund_individual_question(p_question_id) 에 상태 게이트를 추가해,
--   답변받은(answered) 개별질문의 셀프환불을 차단하고 경쟁조건(claimed↔answer 전이)을 제거한다.
--   현재 래퍼(091)는 "본인 여부"만 확인하고 core(refund_individual_question_hold, 070)는
--   refunded/released/payout-ledger/hold-missing 만 차단해 'answered'(및 expired/canceled 등)를
--   막지 않는다 → 학생이 답변을 받은 뒤에도 셀프환불이 가능(자금 결함).
--   래퍼에서 대상 행을 FOR UPDATE 로 잠근 뒤 소유자·상태를 판정해 경쟁조건(claimed↔answer 전이)을 제거한다.
-- 선행: 070, 091  (070 = core refund_individual_question_hold · 091 = wrapper refund_individual_question)
-- ⚠️ core 는 변경하지 않는다(향후 감사가능 관리자 환불 여지 유지). 웹 만료 배치
--    (individualQuestionExpiryBatch.ts)는 core 를 service_role 로 직접 호출하므로 본 변경과 무관.
-- 허용 환불 상태(정본): escrowed / open / assigned / claimed
--   (앱 individual_question_models.dart 및 individual_questions_status_check 기준).
--   그 외(answered/released/expired/canceled)는 거부, refunded 는 core 위임으로 멱등 처리.
-- --------------------------------------------------------------------------

create or replace function public.refund_individual_question(p_question_id uuid)
returns public.individual_question_escrow_result
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := (select auth.uid());
  v_owner uuid;
  v_status text;
  v_refund_ledger uuid;
  v_res public.individual_question_escrow_result;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  if p_question_id is null then
    raise exception 'INVALID_INPUT: question_id is required' using errcode = '22023';
  end if;

  -- 경쟁조건 제거: 대상 행을 잠근 뒤 소유자·상태를 판정한다(별표 없이 필요한 컬럼만).
  select q.student_id, q.status, q.refund_ledger_id
    into v_owner, v_status, v_refund_ledger
  from public.individual_questions q
  where q.id = p_question_id
  for update;

  -- 존재하지 않거나 소유자가 아니면 거부(비존재도 소유권 오류로 비노출 — 기존 동작 유지).
  if not found or v_owner is distinct from v_uid then
    raise exception 'NOT_QUESTION_OWNER' using errcode = '42501';
  end if;

  -- 이미 환불된 경우: 거부가 아니라 core 로 위임해 멱등(already_refunded) 결과를 반환한다.
  if v_status = 'refunded' or v_refund_ledger is not null then
    return public.refund_individual_question_hold(p_question_id);
  end if;

  -- 허용 상태 외에는 환불 불가(특히 'answered' 차단).
  if v_status not in ('escrowed', 'open', 'assigned', 'claimed') then
    raise exception 'REFUND_NOT_ALLOWED: status=%', v_status using errcode = 'P0001';
  end if;

  -- 허용 상태 → core 호출(core 는 유지). 잠금은 같은 트랜잭션에서 재진입 가능.
  v_res := public.refund_individual_question_hold(p_question_id);

  if not v_res.ok then
    raise exception 'INDIVIDUAL_QUESTION_REFUND_FAILED:%:%', v_res.code, v_res.message
      using errcode = 'P0001';
  end if;

  return v_res;
end;
$$;

comment on function public.refund_individual_question(uuid) is
  'P0-5 상태 게이트 래퍼: FOR UPDATE 로 대상 개별질문을 잠근 뒤 소유자를 확인하고, '
  '허용 상태(escrowed/open/assigned/claimed)만 core(refund_individual_question_hold) 로 위임한다. '
  'answered 등 그 외 상태는 REFUND_NOT_ALLOWED 로 거부하고, 이미 refunded 인 건은 core 위임으로 '
  'already_refunded(ok=true) 멱등 반환한다. core 정의·권한은 변경하지 않는다.';
