-- 183_p1_10_account_deletion_verify_object_owners.sql
-- ⚠️ 기능 플래그 OFF 기본 · worker kill switch OFF 고정. 실제 사용자·객체 삭제 없음.
--    기존 SQL 167~182 파일은 **수정하지 않는다** — 신규 함수 1개만 추가한다(W5-f F1).
--
-- W5-f F1: OWNERSHIP_CONFLICT 감지 복원 — 익명 owner verdict RPC.
--
-- ── 문제(W5-e E2 의 의미 후퇴 — 지시서 스펙 결함으로 판정) ──────────────────
--   181 `account_deletion_storage_owner_refs` 는 **대상 uid 소유 객체만** 반환한다
--   (least-exposure 는 옳았으나 owner 축이 그것뿐이면 관측이 부족하다).
--   그 결과 owners 맵에 타인-owner 값이 실리지 않아, DB 조인 ref 의 타인-owner
--   이상치가 OWNERSHIP_CONFLICT 차단 대신 "owner 미기록 레거시"와 구분되지 않고
--   정상 삭제 대상으로 수렴했다(과삭제 위험 — 미삭제보다 나쁘다).
--
-- ── 채택 ──────────────────────────────────────────────────────────────────────
--   177/180/181 동일 패턴의 SECURITY DEFINER RPC 를 하나 더 둔다. 워커가 수집한
--   ref 목록(jsonb)을 받아 객체별 소유 상태를 **3값의 사실로만** 알린다:
--     'target' — owner_id = 대상 uid           → 정상 삭제 대상
--     'other'  — owner_id 존재·대상 아님        → OWNERSHIP_CONFLICT (차단)
--     'none'   — 행 부재 또는 owner_id 미기록   → 현행 정상 삭제 경로 유지
--   'other' 는 사실만 알린다 — **타인 owner 의 uid·값은 어떤 형태로도 반환·로그하지
--   않는다**(반환 컬럼에 owner 계열 없음 · 예외 메시지에도 싣지 않는다).
--
-- ── 캐스팅 근거(181 §2-1 information_schema 실측과 동일) ─────────────────────
--   storage.objects.owner_id 의 실제 타입은 **text** 다(구 `owner` 컬럼이 uuid).
--   따라서 비교는 `o.owner_id = p_user_id::text` 로 한다 — 181 과 동일.
--
-- ── 방어 상한 ────────────────────────────────────────────────────────────────
--   p_refs 배열 5,000 초과 시 예외. 호출측(어댑터)은 500 단위로 배치한다
--   (DB_PAGE_SIZE 와 동일 — staging 전체 객체 84 로 현행 1배치).
--
-- 선행: 175, 176, 177, 178, 179, 180, 181, 182. (172 는 영구 결번)

begin;
set local lock_timeout='5s';

create or replace function public.account_deletion_verify_object_owners(p_user_id uuid, p_refs jsonb)
returns table(bucket_id text, name text, owner_state text)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if p_user_id is null then
    raise exception 'account_deletion_verify_object_owners: p_user_id is required';
  end if;
  if p_refs is null or jsonb_typeof(p_refs) <> 'array' then
    raise exception 'account_deletion_verify_object_owners: p_refs must be a jsonb array';
  end if;
  if jsonb_array_length(p_refs) > 5000 then
    raise exception 'account_deletion_verify_object_owners: p_refs exceeds 5000 (got %)',
      jsonb_array_length(p_refs);
  end if;

  return query
    select r.bucket_id,
           r.name,
           case
             when o.name is null or o.owner_id is null then 'none'
             when o.owner_id = p_user_id::text then 'target'
             else 'other'
           end as owner_state
      from jsonb_to_recordset(p_refs) as r(bucket_id text, name text)
      left join storage.objects o
        on o.bucket_id = r.bucket_id and o.name = r.name
     where r.bucket_id is not null and r.name is not null;
end;
$$;

comment on function public.account_deletion_verify_object_owners(uuid, jsonb) is
  '183: OWNERSHIP_CONFLICT 감지 복원 — 181 최소반환의 의미 후퇴 정정. 수집 ref 의 '
  'storage.objects 소유 상태를 target/other/none 3값의 사실로만 반환한다 — 타인 owner '
  'uid·값은 어떤 형태로도 반환·로그하지 않는다. owner_id 는 text 라 ::text 비교(181 동일). '
  '배열 상한 5,000. service_role 전용.';

revoke all on function public.account_deletion_verify_object_owners(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.account_deletion_verify_object_owners(uuid, jsonb) to service_role;

commit;

-- ── §V 검증(적용 후 실행 — T40~T43, 공격 테스트는 별도 begin; … rollback; 배치) ──
-- T40 ACL: has_function_privilege PUBLIC·anon·authenticated false · service_role true.
--     proacl 에 '=X'(PUBLIC) 엔트리 없음.
-- T41 실데이터 배치(read-only): 최다 소유자(61객체) 소유 ref → 'target' ·
--     null-owner ref(individual-question-attachments) → 'none'.
-- T42 rollback 배치에서 타 uid 소유 fixture 객체 1행을 storage.objects 에 심고 검증
--     → 'other' (uid 값은 결과에 없음) · TS 분류 계약 테스트로 워커 차단 고정.
-- T43 상한 초과(5,001행) → 예외.
--
-- ── ROLLBACK ────────────────────────────────────────────────────────────────
--   drop function if exists public.account_deletion_verify_object_owners(uuid, jsonb);
--   (추가형 단일 함수 — 되돌림 무손실. storage 스키마 객체는 일절 변경하지 않았다.)
