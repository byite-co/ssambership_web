-- [S-B 2026-08-20] m7 — 탈퇴 파기 RPC `account_deletion_purge_identity_payment_artifacts`.
--
-- 용도: 회원탈퇴 사가의 DB 파기 스텝(웹 워커 storage_purged 단계에서 호출 — 익명화 직전).
--   현행 사가는 users/mentor_profiles 익명화 + Storage 파기뿐이라 신규 테이블
--   identity_verifications(실명·CI/DI 암호문)·billing_keys(결제수단)의 행을 어떤 스텝도
--   건드리지 않는다(IMPACT W1 부수 판정) — 이 RPC 가 그 공백을 메운다.
--
-- 동작: 해당 유저의 identity_verifications 전행 DELETE + billing_keys 전행 DELETE.
--   삭제 전 active 빌링키 개수를 반환값에 포함한다 — S-D 이전에는 해지 클라이언트가
--   없으므로, active 키가 미해지 상태로 파기되는 사실을 워커 로그로 남기기 위함.
--
-- 파기 게이트(fail-closed): `account_deletion_write_blocked(p_user_id)` = true
--   (= 취소 불가 시점 locked 이상 진행 중 job 존재)일 때만 파기한다. 탈퇴 진행 중이
--   아닌 유저를 향한 오호출은 NO_ACTIVE_DELETION 으로 거부 — 과삭제는 미삭제보다 나쁘다.
--   워커 호출 지점(storage_purged 단계)은 항상 이 게이트를 통과한다.
--
-- 멱등: 전행 DELETE 는 재호출 시 0행 삭제로 수렴한다(워커 backoff 재시도 안전).
-- nice_auth_tokens 는 파기 대상이 아니다 — 유저 귀속 데이터가 아니며(user FK 없음)
--   수명은 m1 스윕이 관리한다.
--
-- ★ S-D TODO: 포트원 빌링키 해지 API 호출을 이 RPC 의 DB 삭제 **앞에**(워커 스텝에서)
--   삽입할 것 — 지금은 해지 클라이언트가 없어 DB 파기만 수행한다.
--
-- 롤백 노트 (실행 금지 — 참고용):
--   -- drop function if exists public.account_deletion_purge_identity_payment_artifacts(uuid);

create or replace function public.account_deletion_purge_identity_payment_artifacts(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_active_billing_keys bigint := 0;
  v_iv_deleted bigint := 0;
  v_bk_deleted bigint := 0;
begin
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'USER_ID_REQUIRED');
  end if;

  -- 파기 게이트: 취소 불가 시점(locked 이상) 진행 중 탈퇴 job 이 있을 때만.
  if not public.account_deletion_write_blocked(p_user_id) then
    return jsonb_build_object('ok', false, 'code', 'NO_ACTIVE_DELETION');
  end if;

  select count(*) into v_active_billing_keys
    from public.billing_keys
   where user_id = p_user_id and status = 'active';

  delete from public.identity_verifications where user_id = p_user_id;
  get diagnostics v_iv_deleted = row_count;

  delete from public.billing_keys where user_id = p_user_id;
  get diagnostics v_bk_deleted = row_count;

  return jsonb_build_object(
    'ok', true,
    'identity_verifications_deleted', v_iv_deleted,
    'billing_keys_deleted', v_bk_deleted,
    'billing_keys_active_at_delete', v_active_billing_keys
  );
end $function$;

comment on function public.account_deletion_purge_identity_payment_artifacts(uuid) is
  'S-B m7: 탈퇴 사가 DB 파기 스텝 — identity_verifications·billing_keys 전행 DELETE(멱등). write_blocked 게이트 통과 시에만. active 빌링키 개수 반환(S-D: 포트원 해지 API 를 DB 삭제 앞에 삽입 예정).';

revoke all on function public.account_deletion_purge_identity_payment_artifacts(uuid) from public, anon, authenticated;
grant execute on function public.account_deletion_purge_identity_payment_artifacts(uuid) to service_role;
