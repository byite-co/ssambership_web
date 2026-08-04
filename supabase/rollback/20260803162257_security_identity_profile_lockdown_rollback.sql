-- =============================================================================
-- 20260803162257_security_identity_profile_lockdown_rollback.sql
-- =============================================================================
-- forward(수렴 M1)의 소유 객체를 정확히 역순으로 되돌린다.
-- 데이터 변화 없음 — forward 도 데이터를 변경하지 않았다.
-- 주의: 이 rollback 은 P0 보안 결함(사용자 self status 변조)을 재개방한다.
--       로컬 왕복 검증·비상 복구 전용이며 운영 적용은 금지.
-- =============================================================================

begin;

-- G. 마케팅 동의 RPC 제거 (원장에 이미 append 된 행은 계약상 보존 — append-only)
drop function if exists api_web_v1.user_marketing_consent_set_self(boolean);

-- F/E/D. 프로필 RPC 제거
drop function if exists api_web_v1.user_profile_update_self(text, text);
drop function if exists api_app_v1.user_profile_update_self(text, text);
drop function if exists core_private.user_profile_update_self_impl(uuid, text, text);

-- C. status CHECK 제거
alter table public.users drop constraint if exists users_status_allowed;

-- B. protected-column trigger 제거
drop trigger if exists trg_users_protected_columns on public.users;
drop function if exists public.users_protected_columns_guard();

-- A. 권한 원복 (forward 이전 실측: anon/authenticated 모두
--    DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE 보유)
grant insert, update, delete, truncate, references, trigger on table public.users to anon;
grant update, delete, truncate, references, trigger on table public.users to authenticated;

-- 자가 검증
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants
                  WHERE table_schema='public' AND table_name='users'
                    AND grantee='authenticated' AND privilege_type='UPDATE') THEN
    RAISE EXCEPTION 'M1_ROLLBACK_SELFCHECK: users UPDATE grant not restored';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.users'::regclass AND tgname='trg_users_protected_columns') THEN
    RAISE EXCEPTION 'M1_ROLLBACK_SELFCHECK: protected trigger still present';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.users'::regclass AND conname='users_status_allowed') THEN
    RAISE EXCEPTION 'M1_ROLLBACK_SELFCHECK: status CHECK still present';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE (n.nspname,p.proname) IN (('api_app_v1','user_profile_update_self'),
                                              ('api_web_v1','user_profile_update_self'),
                                              ('api_web_v1','user_marketing_consent_set_self'),
                                              ('core_private','user_profile_update_self_impl'))) THEN
    RAISE EXCEPTION 'M1_ROLLBACK_SELFCHECK: profile RPC still present';
  END IF;
END $$;

commit;
