-- =============================================================================
-- 109_individual_question_release_split.sql   ★★★ DRAFT — DB 미적용 / 실행 금지 ★★★
-- =============================================================================
-- 목적(②단계): 개별질문(IQ)의 "완료 확정"과 "실제 지급"을 분리한다.
--   현행(096)은 학생 확정 시 release_individual_question_payout 가 status=released +
--   released_at + release_ledger_id + 멘토 wallet 크레딧을 '한 번에' 처리 = 즉시지급.
--   후불 모델에선 확정=완료사실만 기록(돈 X), 지급은 23일 배치(108)에서.
--
-- 변경(초안, 2개):
--   (a) NEW: mark_individual_question_released(uuid) — status='released' + released_at 만.
--       release_ledger_id 는 NULL 유지 → due_payouts(107)에 "미지급 완료건"으로 노출.
--       (앱: individualQuestionActions.ts:588 가 이 함수를 호출하도록 교체 — 별도 패치, 본 파일 아님)
--   (b) MODIFY: release_individual_question_payout(uuid) — 가드를 'released & 미지급' 허용으로.
--       096 본문 동일(멘토 85% floor(price*0.85), 멱등 iq_payout:{id}) — 가드 2줄만 완화.
--
-- ⚠️ 미적용 초안. 적용 시 108·110 과 함께 검토. release 함수 '동작 변경'이므로 오너 승인 필수.
-- 근거: 096(현행 payout), 070(스키마/상태), individualQuestionActions.ts:577-594(확정 액션).
-- =============================================================================

-- (a) 완료 확정만(돈 X) — answered → released, release_ledger_id 는 NULL 유지.
create or replace function public.mark_individual_question_released(
  p_question_id uuid
)
returns public.individual_question_escrow_result
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_q public.individual_questions%rowtype;
  v_mentor_id uuid;
begin
  if p_question_id is null then
    return (false, 'invalid_question', 'question_id is required', null, null, null, null)::public.individual_question_escrow_result;
  end if;

  select * into v_q from public.individual_questions where id = p_question_id for update;
  if not found then
    return (false, 'not_found', 'individual question not found', p_question_id, null, null, null)::public.individual_question_escrow_result;
  end if;

  -- 이미 지급됨(레거시 즉시지급분 포함) — 멱등 통과.
  if v_q.release_ledger_id is not null then
    return (true, 'already_released', 'already released/paid', v_q.id, v_q.status, v_q.release_ledger_id, null)::public.individual_question_escrow_result;
  end if;
  -- 이미 확정(미지급) — 멱등 통과.
  if v_q.status = 'released' then
    return (true, 'already_released', 'already marked released (unpaid)', v_q.id, v_q.status, null, null)::public.individual_question_escrow_result;
  end if;
  if v_q.refund_ledger_id is not null or v_q.status = 'refunded' then
    return (false, 'already_refunded', 'already refunded', v_q.id, v_q.status, v_q.refund_ledger_id, null)::public.individual_question_escrow_result;
  end if;
  if v_q.status <> 'answered' then
    return (false, 'not_answered', 'question must be answered before release', v_q.id, v_q.status, null, null)::public.individual_question_escrow_result;
  end if;

  v_mentor_id := coalesce(v_q.claimed_mentor_id, v_q.designated_mentor_id);
  if v_mentor_id is null then
    return (false, 'mentor_missing', 'mentor is missing', v_q.id, v_q.status, null, null)::public.individual_question_escrow_result;
  end if;

  -- 완료 사실만 기록 — 돈 이동·release_ledger_id 설정 없음(지급은 108 배치).
  update public.individual_questions
  set status = 'released', released_at = coalesce(released_at, now())
  where id = v_q.id
  returning * into v_q;

  return (true, 'released', 'marked released (payout deferred to batch)', v_q.id, v_q.status, null, null)::public.individual_question_escrow_result;
end;
$function$;

comment on function public.mark_individual_question_released(uuid) is
  '109[DRAFT]: IQ 완료 확정만(status=released, 돈 X). 지급은 108 배치. service_role only.';
revoke all on function public.mark_individual_question_released(uuid) from public, anon, authenticated;
grant execute on function public.mark_individual_question_released(uuid) to service_role;


-- (b) 지급 primitive — 가드만 'released & 미지급' 허용으로 완화(096 본문과 금액 동일).
--     변경점은 딱 2곳:
--       · 096:48  release_ledger_id 있으면 already → 유지(이미 지급)
--                 BUT status='released' 단독은 더 이상 already 로 막지 않음(미지급일 수 있음).
--       · 096:56  status <> 'answered' 거부 → status in ('answered','released') 허용.
create or replace function public.release_individual_question_payout(
  p_question_id uuid
)
returns public.individual_question_escrow_result
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_question public.individual_questions%rowtype;
  v_mentor_id uuid;
  v_ledger_id uuid;
  v_wallet_balance bigint;
  v_new_ledger boolean := false;
  v_mentor_cents bigint;
begin
  if p_question_id is null then
    return (false, 'invalid_question', 'question_id is required', null, null, null, null)::public.individual_question_escrow_result;
  end if;

  select * into v_question from public.individual_questions where id = p_question_id for update;
  if not found then
    return (false, 'not_found', 'individual question not found', p_question_id, null, null, null)::public.individual_question_escrow_result;
  end if;

  -- [109 변경] 이미 '지급'된 경우만 멱등 통과(release_ledger_id 기준). status='released'
  --   단독은 미지급 상태일 수 있으므로 더 이상 차단하지 않는다.
  if v_question.release_ledger_id is not null then
    return (true, 'already_released', 'individual question already paid', v_question.id, v_question.status, v_question.release_ledger_id, null)::public.individual_question_escrow_result;
  end if;

  if v_question.refund_ledger_id is not null or v_question.status = 'refunded' then
    return (false, 'already_refunded', 'individual question already refunded', v_question.id, v_question.status, v_question.refund_ledger_id, null)::public.individual_question_escrow_result;
  end if;

  -- [109 변경] answered(레거시 즉시지급) 또는 released(후불 확정) 둘 다 지급 가능.
  if v_question.status not in ('answered', 'released') then
    return (false, 'not_answered', 'question must be answered/released before payout', v_question.id, v_question.status, null, null)::public.individual_question_escrow_result;
  end if;

  if v_question.hold_ledger_id is null then
    return (false, 'hold_missing', 'escrow hold ledger is missing', v_question.id, v_question.status, null, null)::public.individual_question_escrow_result;
  end if;

  v_mentor_id := coalesce(v_question.claimed_mentor_id, v_question.designated_mentor_id);
  if v_mentor_id is null then
    return (false, 'mentor_missing', 'mentor is missing', v_question.id, v_question.status, null, null)::public.individual_question_escrow_result;
  end if;

  if exists (
    select 1 from public.cash_ledger l
    where l.idempotency_key = 'iq_refund:' || v_question.id::text
      and l.reason = 'individual_question_refund'
  ) then
    return (false, 'already_refunded', 'refund ledger already exists', v_question.id, v_question.status, null, null)::public.individual_question_escrow_result;
  end if;

  v_mentor_cents := floor(v_question.price_cents::numeric * 0.85)::bigint;  -- 096: 멘토 85%
  if v_mentor_cents <= 0 then
    return (false, 'invalid_payout', 'mentor payout amount must be positive', v_question.id, v_question.status, null, null)::public.individual_question_escrow_result;
  end if;

  insert into public.cash_ledger (user_id, delta_cents, reason, ref_type, ref_id, idempotency_key)
  values (v_mentor_id, v_mentor_cents, 'individual_question_payout', 'individual_questions',
          v_question.id, 'iq_payout:' || v_question.id::text)
  on conflict (idempotency_key) do nothing
  returning id into v_ledger_id;

  if v_ledger_id is not null then
    v_new_ledger := true;
  else
    select id into v_ledger_id from public.cash_ledger
    where idempotency_key = 'iq_payout:' || v_question.id::text
      and reason = 'individual_question_payout';
  end if;

  if v_ledger_id is null then
    raise exception 'INDIVIDUAL_QUESTION_PAYOUT_LEDGER_MISSING';
  end if;

  if v_new_ledger then
    insert into public.cash_wallets (user_id, balance_cents) values (v_mentor_id, 0)
    on conflict (user_id) do nothing;
    update public.cash_wallets set balance_cents = balance_cents + v_mentor_cents
    where user_id = v_mentor_id returning balance_cents into v_wallet_balance;
    if not found then
      raise exception 'INDIVIDUAL_QUESTION_MENTOR_WALLET_CREDIT_FAILED';
    end if;
  end if;

  update public.individual_questions
  set status = 'released', released_at = coalesce(released_at, now()), release_ledger_id = v_ledger_id
  where id = v_question.id
  returning * into v_question;

  return (true, 'released', 'individual question payout released', v_question.id, v_question.status, v_ledger_id, v_wallet_balance)::public.individual_question_escrow_result;
end;
$function$;

comment on function public.release_individual_question_payout(uuid) is
  '109[DRAFT]: 096(85%) 베이스 + 가드 완화(answered/released & 미지급 지급 가능). 108 배치가 호출. 멱등. service_role only.';
revoke all on function public.release_individual_question_payout(uuid) from public, anon, authenticated;
grant execute on function public.release_individual_question_payout(uuid) to service_role;

-- =============================================================================
-- ※ 앱 코드 패치(별도, 본 SQL 파일에서 미적용):
--   lib/individualQuestion/individualQuestionActions.ts:588
--     - 현행: admin.rpc("release_individual_question_payout", { p_question_id })  ← 즉시지급
--     - 변경: admin.rpc("mark_individual_question_released", { p_question_id })   ← 확정만, 지급은 23일
--   (해당 TS 변경은 이 작업 범위에서 '작성 설명'만. 실제 코드 수정·적용은 오너 승인 후.)
-- =============================================================================
