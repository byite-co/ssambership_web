-- =============================================================================
-- 20260906100500_marketing_consent_idempotency_key_rollback.sql  (DB-5 후속 d 롤백)
-- =============================================================================
-- forward: supabase/sql/209_marketing_consent_idempotency_key.sql
-- 되돌리는 것: api_web_v1.user_marketing_consent_set_self(boolean) 을 20260803162257 G 원문(md5 9a84375f…)으로 복원 — 원문은 idempotency_key 를 넣지 않아
--   다시 NOT NULL 로 실패한다(회귀 · 오너 승인 후에만). forward 기간에 쌓인 self_rpc 원장 행·users.marketing_agreed 값은 그대로 남는다.
-- =============================================================================

begin;

create or replace function api_web_v1.user_marketing_consent_set_self(p_agreed boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := (select auth.uid());
  v_status text;
  v_susp timestamptz;
  v_norm text;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if p_agreed is null then
    raise exception 'CONSENT_VALUE_REQUIRED' using errcode = '22023';
  end if;

  select u.status, u.suspended_until into v_status, v_susp
    from public.users u where u.id = v_uid for update;
  if not found then
    raise exception 'ACCOUNT_NOT_ACTIVE';
  end if;
  v_norm := lower(btrim(coalesce(v_status,'')));
  if v_norm = 'banned' then raise exception 'ACCOUNT_BANNED'; end if;
  if v_norm = 'suspended' and (v_susp is null or v_susp > now()) then raise exception 'ACCOUNT_SUSPENDED'; end if;
  if v_norm not in ('active','suspended') then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
  if public.account_deletion_write_blocked(v_uid) then raise exception 'ACCOUNT_DELETION_IN_PROGRESS'; end if;

  -- append-only 원장: 기존 행 UPDATE/DELETE 없음 (§18.2)
  insert into public.user_consent_records
    (user_id, consent_type, consent_actor, consent_version, agreed_at, source, metadata)
  values
    (v_uid, 'marketing', 'user', 'v1', now(), 'self_rpc', jsonb_build_object('agreed', p_agreed));

  update public.users set marketing_agreed = p_agreed, updated_at = now() where id = v_uid;

  return jsonb_build_object('ok', true, 'contract_version', 1, 'marketing_agreed', p_agreed);
end
$fn$;

comment on function api_web_v1.user_marketing_consent_set_self(boolean) is null;

do $$
begin
  if md5(pg_get_functiondef('api_web_v1.user_marketing_consent_set_self(boolean)'::regprocedure)) <> '9a84375f8ae7662f0f20f5ac76a4d2c4' then
    raise exception '209_ROLLBACK_SELFCHECK: 원문 불일치 — 현재 %', md5(pg_get_functiondef('api_web_v1.user_marketing_consent_set_self(boolean)'::regprocedure));
  end if;
end $$;

commit;
