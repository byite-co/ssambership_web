-- =============================================================================
-- 209_marketing_consent_idempotency_key.sql  (2026-09-06 · DB-5 후속 d — 마케팅 동의 RPC NOT NULL 결함)
--
-- 왜: `api_web_v1.user_marketing_consent_set_self(p_agreed boolean)`(20260803162257 G)의 `user_consent_records` INSERT 가 **`idempotency_key`(NOT NULL · UNIQUE · 기본값 없음)를
--   넣지 않아 모든 사용자에게 `null value in column "idempotency_key"` 로 실패**한다(DB-5 보고서 §2-2 관찰 ② · 스크래치 실측). 운영 실측 2026-09-06: `source = 'self_rpc'` 행 0 ·
--   웹·앱 호출자 0(grep) — 즉 이 RPC 는 한 번도 성공한 적이 없다.
--
-- 원인 컬럼 판단(실측 후): 원장의 다른 두 작성자(가입 트리거 187 `signup:<uid>:<type>:<version>` · 본인인증 서비스 guardian 행 `idempotency_key = verification id`)는 모두
--   호출자가 키를 명시한다. 컬럼 DEFAULT(예: gen_random_uuid())로 고치면 이 결함은 사라지지만 키를 빠뜨린 다른 작성자까지 조용히 통과시키고 "멱등 키" 의미가 사라진다.
--   → **RPC 가 키를 명시**하는 쪽으로 고친다(COALESCE 형). 키 = `self_rpc:<uid>:marketing:<uuid>` — 토글 원장은 append-only(on/off 이력)라 호출마다 새 행이어야 하므로
--   호출 단위 무작위 접미(같은 값 재시도는 중복 행 · 무해). 그 외 본문(게이트·컬럼·값·반환)은 원문 그대로 · 시그니처·ACL(authenticated · service_role) 불변.
--
-- Apply: 저장소 표준 경로(db-apply-pending). pack 등재: supabase/baseline/post_ledger_backfills/20260906100500_marketing_consent_idempotency_key.sql
-- Rollback: supabase/rollback/20260906100500_marketing_consent_idempotency_key_rollback.sql (20260803162257 G 원문 복원)
-- =============================================================================

begin;

do $$
declare v_md5 text;
begin
  select md5(pg_get_functiondef(p.oid)) into v_md5 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'api_web_v1' and p.proname = 'user_marketing_consent_set_self' and pg_get_function_identity_arguments(p.oid) = 'p_agreed boolean';
  if v_md5 is null then
    raise exception '209_GATE: api_web_v1.user_marketing_consent_set_self(boolean) 부재';
  end if;
  if v_md5 <> '9a84375f8ae7662f0f20f5ac76a4d2c4' then
    raise exception '209_GATE: user_marketing_consent_set_self 본문 md5 불일치(20260803162257 G · 2026-09-06 운영 실측 9a84375f…) — 현재 %', v_md5;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'user_consent_records'
                   and column_name = 'idempotency_key' and is_nullable = 'NO' and column_default is null) then
    raise exception '209_GATE: user_consent_records.idempotency_key 전제(NOT NULL · 기본값 없음) 불일치';
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.user_consent_records'::regclass and contype = 'u'
                   and pg_get_constraintdef(oid) like '%idempotency_key%') then
    raise exception '209_GATE: idempotency_key UNIQUE 부재';
  end if;
end $$;

-- 20260803162257 G 원문 + idempotency_key 한 열 (그 외 동일)
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
  -- 209(DB-5 후속 d): idempotency_key(NOT NULL · UNIQUE) 명시 — 토글 이력은 호출마다 새 행(무작위 접미)
  insert into public.user_consent_records
    (user_id, consent_type, consent_actor, consent_version, agreed_at, source, metadata, idempotency_key)
  values
    (v_uid, 'marketing', 'user', 'v1', now(), 'self_rpc', jsonb_build_object('agreed', p_agreed),
     format('self_rpc:%s:marketing:%s', v_uid, gen_random_uuid()));

  update public.users set marketing_agreed = p_agreed, updated_at = now() where id = v_uid;

  return jsonb_build_object('ok', true, 'contract_version', 1, 'marketing_agreed', p_agreed);
end
$fn$;

comment on function api_web_v1.user_marketing_consent_set_self(boolean) is
  '20260803162257 G + 209(DB-5 후속 d): 마케팅 동의 원장 append(idempotency_key self_rpc:<uid>:marketing:<uuid>) + users.marketing_agreed 반영. 시그니처·ACL 불변.';

do $$
declare v_oid oid;
begin
  select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'api_web_v1' and p.proname = 'user_marketing_consent_set_self' and pg_get_function_identity_arguments(p.oid) = 'p_agreed boolean'
     and p.prosecdef and coalesce(p.proconfig::text, '') like '%search_path=%' and p.prorettype = 'jsonb'::regtype;
  if v_oid is null then
    raise exception '209_SELFCHECK: identity/attributes 불일치';
  end if;
  if md5(pg_get_functiondef(v_oid)) = '9a84375f8ae7662f0f20f5ac76a4d2c4' then
    raise exception '209_SELFCHECK: 본문이 바뀌지 않았다';
  end if;
  if (select prosrc from pg_proc where oid = v_oid) not like '%idempotency_key)%'
     or (select prosrc from pg_proc where oid = v_oid) not like '%format(''self_rpc:%' then
    raise exception '209_SELFCHECK: idempotency_key 명시 누락';
  end if;
  if has_function_privilege('anon', v_oid, 'EXECUTE') or not has_function_privilege('authenticated', v_oid, 'EXECUTE')
     or not has_function_privilege('service_role', v_oid, 'EXECUTE') then
    raise exception '209_SELFCHECK: ACL 변경됨(authenticated · service_role)';
  end if;
end $$;

commit;
