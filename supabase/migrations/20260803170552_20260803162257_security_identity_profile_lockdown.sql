-- =============================================================================
-- 20260803162257_security_identity_profile_lockdown.sql (수렴 M1)
-- =============================================================================
-- 목적: 계정·프로필 보안 수렴 (지시서 §5 — 전체 작업의 최우선 P0).
--   현재 결함: users_update_own 정책이 본인 행 **전체** UPDATE 를 허용하고,
--   anon/authenticated 가 public.users 테이블 레벨 UPDATE 권한을 가진다.
--   역할 변경 트리거(trg_users_role_guard)는 role 만 방어 → status/suspended_until/
--   status_reason/status_changed_*/동의 시각을 사용자가 직접 Data API 로 변조 가능.
--
-- 이 migration 의 소유 객체 (§23.1):
--   A. public.users 테이블 권한 회수 (anon: INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER,
--      authenticated: UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER — SELECT 및
--      authenticated INSERT(가입 self-insert 정책 경로)는 유지)
--   B. protected-column trigger: public.users_protected_columns_guard() +
--      trg_users_protected_columns (defense-in-depth — 권한 회수와 독립적으로
--      클라이언트 역할의 보호 컬럼 변경을 거부)
--   C. users.status CHECK (active/suspended/banned/deleted — 사전 게이트에서
--      위반 행 0 확인. 'deleted' 는 anonymize_user_for_deletion 이 기록하는 정본값)
--   D. core_private.user_profile_update_self_impl — self 프로필 수정 공용 정본
--   E. api_app_v1.user_profile_update_self(p_nickname, p_grade_level) — 앱 self RPC
--   F. api_web_v1.user_profile_update_self(p_nickname, p_grade_level) — 웹 self RPC
--   G. api_web_v1.user_marketing_consent_set_self(p_agreed) — 마케팅 동의는 일반
--      프로필 RPC 에 섞지 않는다(§5.6). 동의 원장(user_consent_records) append +
--      users.marketing_agreed 반영을 단일 트랜잭션으로 수행.
--
-- null 의미 규약 (§5.4 "null 구분"):
--   p_nickname:    null=기존값 유지 · ''(trim 후 빈 값)=오류(NICKNAME_REQUIRED)
--   p_grade_level: null=기존값 유지 · ''(trim 후 빈 값)=값 제거(NULL 저장, 학생만)
--
-- grade_level 어휘: 제품 전체(웹 가입·앱 편집 "예: 고2, 재수생")에서 자유 텍스트다.
--   폐쇄 어휘가 존재하지 않으므로 서버 검증은 trim + 최대 20자 + 학생 한정으로 강제
--   (실측 근거: app profile_edit_screen.dart hint, users.grade_level 기존 자유값).
--
-- RLS 는 유지한다(defense-in-depth). 관리자 status 변경(service_role)·정본
-- SECURITY DEFINER RPC 경로는 영향 없음 — 트리거는 클라이언트 역할(anon/
-- authenticated, 비관리자)에서만 보호 컬럼 변경을 거부한다.
--
-- rollback 정본: supabase/rollback/20260803162257_security_identity_profile_lockdown_rollback.sql
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 사전 게이트 — 불일치 시 수정 0건 중단
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  -- ① users 필수 컬럼 존재
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema='public' AND table_name='users'
         AND column_name IN ('id','role','status','suspended_until','status_reason',
                             'status_changed_at','status_changed_by','terms_agreed_at',
                             'privacy_agreed_at','marketing_agreed','created_at',
                             'nickname','grade_level','updated_at')) <> 14 THEN
    RAISE EXCEPTION 'M1_BASELINE_MISMATCH: users columns';
  END IF;
  -- ② status CHECK 대상 외 값 0 (unknown status 허용 채 CHECK 금지 — §5.7)
  IF EXISTS (SELECT 1 FROM public.users
              WHERE lower(btrim(coalesce(status,''))) NOT IN ('active','suspended','banned','deleted')) THEN
    RAISE EXCEPTION 'M1_BASELINE_MISMATCH: users.status outside allowlist — CHECK 추가 불가';
  END IF;
  -- ③ 대상 스키마 존재 (M17/api_web_v1 시리즈 선행)
  IF (SELECT count(*) FROM pg_namespace WHERE nspname IN ('api_app_v1','api_web_v1','core_private')) <> 3 THEN
    RAISE EXCEPTION 'M1_BASELINE_MISMATCH: api schemas missing';
  END IF;
  -- ④ 신규 객체 선점 없음
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE (n.nspname,p.proname) IN (('api_app_v1','user_profile_update_self'),
                                              ('api_web_v1','user_profile_update_self'),
                                              ('api_web_v1','user_marketing_consent_set_self'),
                                              ('core_private','user_profile_update_self_impl'),
                                              ('public','users_protected_columns_guard'))) THEN
    RAISE EXCEPTION 'M1_BASELINE_MISMATCH: target function already exists';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.users'::regclass AND conname='users_status_allowed') THEN
    RAISE EXCEPTION 'M1_BASELINE_MISMATCH: users_status_allowed already exists';
  END IF;
  -- ⑤ consent 원장 계약 (marketing 허용 + actor 'user')
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid='public.user_consent_records'::regclass
                    AND conname='user_consent_records_consent_type_check'
                    AND pg_get_constraintdef(oid) LIKE '%marketing%') THEN
    RAISE EXCEPTION 'M1_BASELINE_MISMATCH: user_consent_records marketing consent type';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- A. users 테이블 권한 회수
--    (SELECT 는 RLS(users_select_own/users_admin_select_all) 게이트로 유지,
--     authenticated INSERT 는 users_insert_own 가입 경로로 유지)
-- -----------------------------------------------------------------------------
revoke insert, update, delete, truncate, references, trigger on table public.users from anon;
revoke update, delete, truncate, references, trigger on table public.users from authenticated;

-- -----------------------------------------------------------------------------
-- B. protected-column trigger (defense-in-depth)
--    클라이언트 역할(anon/authenticated)에서 비관리자가 보호 컬럼을 변경하면 거부.
--    service_role·SECURITY DEFINER(owner 실행)·관리자 세션은 통과.
-- -----------------------------------------------------------------------------
create function public.users_protected_columns_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $fn$
begin
  -- SECURITY INVOKER 필수: current_user 가 실제 DML 수행 역할이어야 한다
  -- (DEFINER 면 owner 로 바뀌어 아래 게이트가 항상 우회된다 — cc_write_guard 와 동일 패턴).
  -- service_role / definer(owner) / 내부 role 실행 경로는 정본 서버 경로다.
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  -- 관리자 세션의 직접 수정은 관리자 경로로 허용 (RLS 가 행 범위를 계속 제한한다).
  if coalesce((select public.is_admin()), false) then
    return new;
  end if;
  if new.id                is distinct from old.id
     or new.role              is distinct from old.role
     or new.status            is distinct from old.status
     or new.suspended_until   is distinct from old.suspended_until
     or new.status_reason     is distinct from old.status_reason
     or new.status_changed_at is distinct from old.status_changed_at
     or new.status_changed_by is distinct from old.status_changed_by
     or new.terms_agreed_at   is distinct from old.terms_agreed_at
     or new.privacy_agreed_at is distinct from old.privacy_agreed_at
     or new.marketing_agreed  is distinct from old.marketing_agreed
     or new.created_at        is distinct from old.created_at then
    raise exception 'USERS_PROTECTED_COLUMNS' using errcode = '42501';
  end if;
  return new;
end
$fn$;

revoke execute on function public.users_protected_columns_guard() from public, anon, authenticated;

create trigger trg_users_protected_columns
  before update on public.users
  for each row execute function public.users_protected_columns_guard();

-- -----------------------------------------------------------------------------
-- C. users.status CHECK (사전 게이트 ②에서 위반 0 확인)
-- -----------------------------------------------------------------------------
alter table public.users
  add constraint users_status_allowed
  check (status in ('active','suspended','banned','deleted')) not valid;
alter table public.users validate constraint users_status_allowed;

-- -----------------------------------------------------------------------------
-- D. self 프로필 수정 공용 정본 (core_private — 판정·검증 단일화, 복제 금지)
-- -----------------------------------------------------------------------------
create function core_private.user_profile_update_self_impl(
  p_user_id     uuid,
  p_nickname    text,
  p_grade_level text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_role text;
  v_status text;
  v_susp timestamptz;
  v_norm text;
  v_nick text;
  v_grade text;
  v_set_grade boolean := false;
  v_updated_at timestamptz;
  v_out_nick text;
  v_out_grade text;
begin
  if p_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  select u.role, u.status, u.suspended_until
    into v_role, v_status, v_susp
    from public.users u where u.id = p_user_id
    for update;
  if not found then
    raise exception 'ACCOUNT_NOT_ACTIVE';
  end if;

  if v_role not in ('student','mentor') then
    raise exception 'ROLE_NOT_ALLOWED';
  end if;

  -- 계정 상태 게이트 (Build 13 UGC 게이트와 동일 판정: banned 차단 · 유효 suspended
  -- 차단 · 만료 suspended 허용 · unknown/deleted/빈 status 차단)
  v_norm := lower(btrim(coalesce(v_status, '')));
  if v_norm = 'banned' then
    raise exception 'ACCOUNT_BANNED';
  end if;
  if v_norm = 'suspended' and (v_susp is null or v_susp > now()) then
    raise exception 'ACCOUNT_SUSPENDED';
  end if;
  if v_norm not in ('active','suspended') then
    raise exception 'ACCOUNT_NOT_ACTIVE';
  end if;
  if public.account_deletion_write_blocked(p_user_id) then
    raise exception 'ACCOUNT_DELETION_IN_PROGRESS';
  end if;

  -- nickname: null=유지 · trim 후 빈 값=오류 · 최대 30자
  if p_nickname is not null then
    v_nick := btrim(p_nickname);
    if v_nick = '' then
      raise exception 'NICKNAME_REQUIRED' using errcode = '22023';
    end if;
    if char_length(v_nick) > 30 then
      raise exception 'NICKNAME_TOO_LONG' using errcode = '22023';
    end if;
  end if;

  -- grade_level: null=유지 · ''=값 제거 · 학생만 · 자유 텍스트 최대 20자
  if p_grade_level is not null then
    if v_role <> 'student' then
      raise exception 'GRADE_LEVEL_NOT_ALLOWED' using errcode = '22023';
    end if;
    v_grade := nullif(btrim(p_grade_level), '');
    if v_grade is not null and char_length(v_grade) > 20 then
      raise exception 'GRADE_LEVEL_TOO_LONG' using errcode = '22023';
    end if;
    v_set_grade := true;
  end if;

  update public.users u
     set nickname    = coalesce(v_nick, u.nickname),
         grade_level = case when v_set_grade then v_grade else u.grade_level end,
         updated_at  = now()
   where u.id = p_user_id
   returning u.updated_at, u.nickname, u.grade_level
     into v_updated_at, v_out_nick, v_out_grade;

  return jsonb_build_object(
    'ok', true,
    'contract_version', 1,
    'nickname', v_out_nick,
    'grade_level', v_out_grade,
    'updated_at', v_updated_at
  );
end
$fn$;

revoke execute on function core_private.user_profile_update_self_impl(uuid, text, text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- E. 앱 self RPC (api_app_v1 — authenticated 만, M17 노출 계약과 동일)
-- -----------------------------------------------------------------------------
create function api_app_v1.user_profile_update_self(
  p_nickname    text default null,
  p_grade_level text default null
)
returns jsonb
language sql
security definer
set search_path = ''
as $fn$
  select core_private.user_profile_update_self_impl((select auth.uid()), p_nickname, p_grade_level);
$fn$;

revoke execute on function api_app_v1.user_profile_update_self(text, text) from public, anon;
grant execute on function api_app_v1.user_profile_update_self(text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- F. 웹 self RPC (api_web_v1 — authenticated + service_role, 기존 표면 계약과 동일)
-- -----------------------------------------------------------------------------
create function api_web_v1.user_profile_update_self(
  p_nickname    text default null,
  p_grade_level text default null
)
returns jsonb
language sql
security definer
set search_path = ''
as $fn$
  select core_private.user_profile_update_self_impl((select auth.uid()), p_nickname, p_grade_level);
$fn$;

revoke execute on function api_web_v1.user_profile_update_self(text, text) from public, anon;
grant execute on function api_web_v1.user_profile_update_self(text, text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- G. 마케팅 동의 — 동의 원장 append + users 반영 (일반 프로필 RPC 와 분리, §5.6)
-- -----------------------------------------------------------------------------
create function api_web_v1.user_marketing_consent_set_self(p_agreed boolean)
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

revoke execute on function api_web_v1.user_marketing_consent_set_self(boolean) from public, anon;
grant execute on function api_web_v1.user_marketing_consent_set_self(boolean) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 자가 검증 — 실패 시 트랜잭션 전체 rollback
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  -- users 테이블 레벨 UPDATE 회수 확인
  IF EXISTS (SELECT 1 FROM information_schema.role_table_grants
              WHERE table_schema='public' AND table_name='users'
                AND grantee IN ('anon','authenticated') AND privilege_type='UPDATE') THEN
    RAISE EXCEPTION 'M1_SELFCHECK: users UPDATE grant still present';
  END IF;
  -- authenticated INSERT/SELECT 유지 확인 (가입·본인 조회 경로 보존)
  IF (SELECT count(*) FROM information_schema.role_table_grants
       WHERE table_schema='public' AND table_name='users'
         AND grantee='authenticated' AND privilege_type IN ('INSERT','SELECT')) <> 2 THEN
    RAISE EXCEPTION 'M1_SELFCHECK: users INSERT/SELECT for authenticated lost';
  END IF;
  -- 트리거·CHECK·RPC 존재 확인
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.users'::regclass AND tgname='trg_users_protected_columns') THEN
    RAISE EXCEPTION 'M1_SELFCHECK: protected trigger missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.users'::regclass
                  AND conname='users_status_allowed' AND convalidated) THEN
    RAISE EXCEPTION 'M1_SELFCHECK: status CHECK missing/not validated';
  END IF;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE (n.nspname,p.proname) IN (('api_app_v1','user_profile_update_self'),
                                       ('api_web_v1','user_profile_update_self'),
                                       ('api_web_v1','user_marketing_consent_set_self'),
                                       ('core_private','user_profile_update_self_impl'))) <> 4 THEN
    RAISE EXCEPTION 'M1_SELFCHECK: profile RPC set incomplete';
  END IF;
  -- 앱 RPC 는 anon EXECUTE 금지
  IF has_function_privilege('anon', 'api_app_v1.user_profile_update_self(text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'M1_SELFCHECK: anon can execute app profile RPC';
  END IF;
END $$;

commit;