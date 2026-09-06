-- =============================================================================
-- 206_social_signup_profile_completion.sql  (2026-09-06 · DB-5 묶음 B+C — 가입 트리거 소셜 대응 + 프로필 완성 RPC)
--
-- 왜(B): `handle_new_auth_user`(001 → 122/20260717044250 라이브 본문 md5 297616fe…)는 `auth.signUp` 메타의 `app_role` 로 역할을 정하고
--   `users`(+ 멘토면 `mentor_profiles`·`verification_logs`) 행을 만든다. **소셜(OAuth) 가입은 앱 메타(`app_role` 등 20키)가 없고 provider 메타(name·avatar·email)만 온다.**
--   현재 동작(실측): `app_role` 없음 → `r := 'student'` 폴백 → **약관 동의 시각·생년월일·닉네임 없는 학생 행을 조용히 만든다**(실패도 스킵도 아님).
--   운영 실측 2026-09-06: 소셜 identity 0(email 83) · `app_role` 없는 auth 행 2건(2026-05-01 대시보드 생성 관리자 — 같은 폴백으로 student 생성 후 수동 승격).
--   분기 기준은 "메타 없음"이 아니라 **`raw_user_meta_data ? 'app_role'` 유무**다(정정 B).
--
-- 설계:
--   소셜 가입(app_role 없음) → users 행: role NULL · profile_completed_at NULL · email = auth.users(없으면 NULL) · full_name/nickname = provider 이름 · 나머지 NULL
--                            → student_profiles 는 없다(테이블 자체가 없음 — DB-4 §2-E) · mentor_profiles 는 만들지 않는다(역할 모름)
--   이메일 가입(app_role 있음) → 지금 그대로(122 정규화 동일) + profile_completed_at = now()
--   · `users.profile_completed_at timestamptz null` 추가 — "완성 전" 판정 컬럼. 기존 가입자 전원 created_at 으로 백필(운영 83명 = admin 3 · mentor 76 · student 4).
--   · `users.role` NOT NULL 은 **완화**(DROP NOT NULL) + CHECK `users_role_required_when_completed (role is not null or profile_completed_at is null)`
--     — 임시 역할값('pending')은 두지 않는다(다른 CHECK·RLS·is_admin()·ugc_write_allowed() 에 걸린다 — "하지 말 것" 3). `users_role_check` 는 그대로(NULL 허용).
--   · 트리거 로직을 `core_private.user_signup_provision_impl(...)` 로 빼서 트리거(이메일·소셜)와 C 의 `complete_profile` 이 **한 벌**을 공유한다.
--   · 119 `enforce_users_role_guard`: 완성 전(role NULL · profile_completed_at NULL) 행에 student/mentor 를 처음 채우는 전이만 추가 허용
--     (그 외 분기 원문 그대로). 완성 전 행은 이 배치 이후에만 생기며, users 테이블 UPDATE 권한은 authenticated 에 없고(20260803162257 A)
--     `users_protected_columns_guard` 가 클라이언트 역할의 role 변경을 거부하므로 이 전이는 SECURITY DEFINER 경로(complete_profile)로만 도달한다.
--
-- 왜(C): api_app_v1.complete_profile(p_role, p_display_name, p_birthdate, p_terms_agreed, p_marketing_agreed, p_grade_level, p_university_name, p_department_name) returns jsonb
--   · auth.uid() 의 users.profile_completed_at IS NULL 일 때만 · 이미 완성이면 ALREADY_COMPLETED · 필수 약관(이용약관+개인정보) 미동의 TERMS_REQUIRED ·
--     학생인데 학년 없음 GRADE_REQUIRED · 멘토인데 대학 없음 UNIVERSITY_REQUIRED · 그 외 AUTH_REQUIRED · ROLE_INVALID · DISPLAY_NAME_REQUIRED/TOO_LONG(30자) ·
--     BIRTHDATE_REQUIRED/INVALID(미래·1900 이전) · GRADE_LEVEL_TOO_LONG(20자) · 계정 게이트 ACCOUNT_BANNED/SUSPENDED/NOT_ACTIVE/DELETION_IN_PROGRESS · USER_NOT_FOUND
--   · 수행 = 이메일 가입 트리거와 같은 결과(공유 impl): users 갱신(role · nickname=표시명 · birth_date · grade_level · terms/privacy_agreed_at=now() · marketing_agreed ·
--     profile_completed_at=now()) · 멘토면 mentor_profiles(pending · 대학·학과 · 나머지 '(미입력)') + verification_logs. full_name 은 provider 이름 유지.
--     약관 동의 기록은 users 컬럼(정정 C — user_consent_records 는 쓰지 않는다).
--   · 만 14세 판정: KST 달력 오늘 < 생년월일+14년(187 과 같은 식) → is_minor true · next 'guardian_consent'(기존 보호자 인증 WebView 흐름) ·
--     아니면 멘토 → 'identity_verification' · 그 외 'home'. 반환 {ok, contract_version, role, is_minor, next, nickname, profile_completed_at}.
--   · SECURITY DEFINER · search_path '' · authenticated 만.
--
-- 완성 전 사용자의 접근(B): RLS 점검(pack 118본 · 정책 283행 · authenticated 실행 가능 SECDEF 함수 124종) 결과 —
--   역할 검사가 있는 정책·RPC(is_admin · ugc_write_allowed · 승인 멘토 · 방/주문 당사자 · ROLE_NOT_STUDENT …)는 role NULL 을 거부한다.
--   **auth.uid() 만 보는(또는 `OR is_admin()` 만 덧붙은) 쓰기 정책 18종**(favorites · user_blocks · content_reports · free_question_usage · payments intent · verification_logs ·
--   device_tokens · notification_settings · ai_drafts · withdrawals · custom_request_posts crp_insert · custom_request_applications cra_insert · custom_request_orders cro_insert ·
--   레거시 `to public` 5종: custom_request_posts/applications · custom_order_messages/deliverables · admin_action_logs)은 완성 전 사용자가 통과한다(테이블 INSERT 권한 authenticated 있음 — 실측).
--   → 각 정책에 `public.user_profile_completed()` 조건을 추가한다(이름·명령·역할 불변 · 원문 + AND). 정책 96행 전수 수동 검토 · 스크래치 실측(scripts/verify/fixtures/db5_batch_post_fixture.sql B-4).
--   RPC 쪽: `core_private.user_profile_update_self_impl`(20260803162257 D — 앱 v1/v2·웹 self 프로필 RPC 의 정본)의 `v_role not in (...)` 은 role NULL 을 통과시킨다(NULL not in → NULL)
--   → `v_role is null or …` 한 줄만 보강(B-7 · 그 외 원문 그대로 · 시그니처·ACL 불변). 다른 authenticated SECDEF 함수는 역할 검사(ROLE_NOT_STUDENT 등)·관계 검사·ugc_write_allowed() 가 NULL 을 거부한다(실측).
--   자기 users 행 읽기(users_select_own)는 그대로 · complete_profile 은 이 파일이 연다. SELECT 정책은 바꾸지 않는다(공개 데이터는 anon 도 읽고, 본인 데이터는 없다).
--
-- Apply: 저장소 표준 경로(db-apply-pending). pack 등재: supabase/baseline/post_ledger_backfills/20260906100200_social_signup_profile_completion.sql
-- Rollback: supabase/rollback/20260906100200_social_signup_profile_completion_rollback.sql (트리거·가드 원문 복원 · 정책 15종 원문 복원 · 컬럼/CHECK 제거 ·
--   NOT NULL 복원 · impl 원문 복원 — role NULL 행(소셜 미완성)이 있으면 롤백 게이트가 중단한다)
-- =============================================================================

begin;

do $$
declare v_md5 text; r record;
begin
  if not exists (select 1 from pg_namespace where nspname = 'api_app_v1') or not exists (select 1 from pg_namespace where nspname = 'core_private') then
    raise exception '206_GATE: api_app_v1/core_private 스키마 부재';
  end if;
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'users'
       and column_name in ('id','role','status','full_name','nickname','email','grade_level','student_status','birth_date','terms_agreed_at','privacy_agreed_at','marketing_agreed','suspended_until','created_at','updated_at')) <> 15 then
    raise exception '206_GATE: users 컬럼 불일치(001·102)';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'users' and column_name = 'profile_completed_at') then
    raise exception '206_GATE: users.profile_completed_at 이 이미 있다';
  end if;
  if (select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'users' and column_name = 'role') <> 'NO' then
    raise exception '206_GATE: users.role 이 이미 NULL 허용이다 — 전제(001 NOT NULL) 불일치';
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.users'::regclass and conname = 'users_role_check') then
    raise exception '206_GATE: users_role_check 부재(001)';
  end if;
  if exists (select 1 from pg_constraint where conrelid = 'public.users'::regclass and conname = 'users_role_required_when_completed') then
    raise exception '206_GATE: users_role_required_when_completed 가 이미 있다';
  end if;
  if exists (select 1 from public.users where role is null) then
    raise exception '206_GATE: role NULL 행이 이미 있다';
  end if;
  -- 정책 수 스냅샷(자가 검증에서 불변 확인)
  create temp table db5_206_pre on commit drop as select count(*)::int as policies from pg_policies where schemaname = 'public';
  -- 트리거·가드 본문 전제(라이브 = pack · 2026-09-06 실측 md5)
  select md5(pg_get_functiondef('public.handle_new_auth_user()'::regprocedure)) into v_md5;
  if v_md5 <> '297616fe4e28f0dbda3b24244763a917' then
    raise exception '206_GATE: handle_new_auth_user 본문 md5 불일치(122/20260717044250) — 현재 %', v_md5;
  end if;
  select md5(pg_get_functiondef('public.enforce_users_role_guard()'::regprocedure)) into v_md5;
  if v_md5 <> '702ddc298e6892306e796cae22f60201' then
    raise exception '206_GATE: enforce_users_role_guard 본문 md5 불일치(119) — 현재 %', v_md5;
  end if;
  select md5(pg_get_functiondef('core_private.user_profile_update_self_impl(uuid,text,text)'::regprocedure)) into v_md5;
  if v_md5 <> 'a0cb1b7f37b8195cc9ca370bfb5e90e7' then
    raise exception '206_GATE: user_profile_update_self_impl 본문 md5 불일치(20260803162257 D) — 현재 %', v_md5;
  end if;
  if not exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'auth' and c.relname = 'users' and t.tgname = 'on_auth_user_created' and t.tgfoid = 'public.handle_new_auth_user'::regproc) then
    raise exception '206_GATE: on_auth_user_created 트리거 부재';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.users'::regclass and tgname = 'trg_users_role_guard')
     or not exists (select 1 from pg_trigger where tgrelid = 'public.users'::regclass and tgname = 'trg_users_protected_columns')
     or not exists (select 1 from pg_trigger where tgrelid = 'public.users'::regclass and tgname = 'trg_users_set_updated') then
    raise exception '206_GATE: users 트리거(role guard · protected columns · set_updated) 부재';
  end if;
  if has_table_privilege('authenticated', 'public.users', 'UPDATE') then
    raise exception '206_GATE: authenticated 가 users UPDATE 권한을 가진다(20260803162257 A 전제 불일치) — 완성 전 role 전이 허용을 열 수 없다';
  end if;
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'mentor_profiles')
     or not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'verification_logs') then
    raise exception '206_GATE: mentor_profiles/verification_logs 부재(001)';
  end if;
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'student_profiles') then
    raise exception '206_GATE: student_profiles 테이블이 존재한다 — 이 파일은 없음을 전제한다(DB-4 §2-E)';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'account_deletion_write_blocked') then
    raise exception '206_GATE: account_deletion_write_blocked 부재(151)';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where (n.nspname, p.proname) in (('api_app_v1', 'complete_profile'), ('core_private', 'user_signup_provision_impl'), ('public', 'user_profile_completed'))) then
    raise exception '206_GATE: 대상 함수가 이미 있다';
  end if;
  -- 정책 18종 원문 전제(cmd|roles|qual|with_check md5 · pack 118본 실측) — 다르면 원문 보존 복제가 어긋나므로 중단
  for r in select * from (values
    ('admin_action_logs', '관리자만 로그 기록', '61730a1a972b0a133083c6758b9100a5'),
    ('ai_drafts', 'ai_drafts_insert_own', '22786adbfea6dc265e7de4d6666a70c1'),
    ('content_reports', 'content_reports_insert_reporter', '3483c8d184a65671dce25208ce154412'),
    ('custom_order_deliverables', '멘토만 납품 업로드', '512176700a7778900fb2a81691a1eb90'),
    ('custom_order_messages', '당사자만 메시지 전송', 'c1b3a9b4ccdcccda3dfa7cbdbbc4203f'),
    ('custom_request_applications', 'cra_insert', 'a51a1a0859a59ea2f5426bc4483655b2'),
    ('custom_request_applications', '멘토만 지원', '512176700a7778900fb2a81691a1eb90'),
    ('custom_request_orders', 'cro_insert', 'a8eb37e64992df6f7e975d8d8c720964'),
    ('custom_request_posts', 'crp_insert', '42111e025e26fa48c5ae622048150c77'),
    ('custom_request_posts', '학생만 의뢰 등록', 'c1b3a9b4ccdcccda3dfa7cbdbbc4203f'),
    ('device_tokens', 'device_tokens_modify_own', 'cd792c6be978266a76dd2ce37b454e21'),
    ('favorites', 'favorites_insert_own', '120bed7de2110c2a51917b1457fa7410'),
    ('free_question_usage', 'fqu_insert_own', '55c6e4a73e924acc92b6d9245cdefcc9'),
    ('notification_settings', 'notif_settings_modify_own', 'cd792c6be978266a76dd2ce37b454e21'),
    ('payments', 'payments_insert_intent', 'cea1288300e0aa57260f803e4b272ae5'),
    ('user_blocks', 'ub_insert_own', 'ab4f2df30ce645b81654385e71159798'),
    ('verification_logs', 'ver_logs_insert_own', 'cc88f9f4a4c7f44b5d1035d68cf326f5'),
    ('withdrawals', 'withdrawals_insert_self_requested', '9a869556a18b5708819f6f46f997113d')
  ) v(t, p, h) loop
    if not exists (select 1 from pg_policies pp where pp.schemaname = 'public' and pp.tablename = r.t and pp.policyname = r.p
                     and md5(pp.cmd || '|' || array_to_string(pp.roles, ',') || '|' || coalesce(pp.qual, '') || '|' || coalesce(pp.with_check, '')) = r.h) then
      raise exception '206_GATE: 정책 %.% 원문 불일치(또는 부재)', r.t, r.p;
    end if;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- B-1. users.profile_completed_at + 백필 + role NOT NULL 완화
-- -----------------------------------------------------------------------------
alter table public.users add column profile_completed_at timestamptz null;
comment on column public.users.profile_completed_at is
  '206(DB-5 B): 프로필 완성 시각. NULL = 소셜 가입 후 역할·약관·생년월일 미입력(완성 전 — role NULL). 이메일 가입은 트리거가 now() 로 채우고, 소셜 가입은 api_app_v1.complete_profile 이 채운다. 기존 가입자는 created_at 으로 백필.';

-- 백필: updated_at 은 건드리지 않는다(190 의 mentor_plans 백필과 같은 방식으로 touch 트리거를 잠시 끈다)
alter table public.users disable trigger trg_users_set_updated;
update public.users set profile_completed_at = created_at where profile_completed_at is null;
alter table public.users enable trigger trg_users_set_updated;

alter table public.users alter column role drop not null;
alter table public.users
  add constraint users_role_required_when_completed
  check (role is not null or profile_completed_at is null);
comment on constraint users_role_required_when_completed on public.users is
  '206(DB-5 B): role NULL 은 완성 전(profile_completed_at NULL)에만 허용. 완성된 행은 반드시 역할을 가진다.';

-- -----------------------------------------------------------------------------
-- B-2. 완성 여부 판정 헬퍼 (RLS 정책용 · anon/authenticated)
-- -----------------------------------------------------------------------------
create function public.user_profile_completed()
returns boolean
language sql
stable
security definer
set search_path to ''
as $fn$
  select exists (
    select 1 from public.users u
     where u.id = (select auth.uid())
       and u.profile_completed_at is not null
  );
$fn$;
comment on function public.user_profile_completed() is
  '206(DB-5 B): 호출자(auth.uid()) 의 프로필이 완성됐는가(users.profile_completed_at IS NOT NULL). auth.uid() 만 보는 쓰기 정책 15종의 추가 조건.';
revoke all on function public.user_profile_completed() from public;
grant execute on function public.user_profile_completed() to anon, authenticated;

-- -----------------------------------------------------------------------------
-- B-3. 가입 프로비저닝 공용 정본 (core_private — 트리거 두 경로 + complete_profile 이 공유 · 외부 EXECUTE 0)
--      본문은 122 트리거의 users upsert · mentor_profiles upsert · verification_logs 를 인자화한 것(의미 동일).
-- -----------------------------------------------------------------------------
create function core_private.user_signup_provision_impl(
  p_user_id             uuid,
  p_role                text,          -- 'student' | 'mentor' | NULL(소셜 · 완성 전)
  p_email               text,
  p_full_name           text,
  p_nickname            text,
  p_grade_level         text,
  p_student_status      text,
  p_birth_date          date,
  p_terms_agreed        boolean,
  p_privacy_agreed      boolean,
  p_marketing_agreed    boolean,
  p_university_name     text,
  p_department_name     text,
  p_teaching_subjects   text[],
  p_high_school_name    text,
  p_intro_line          text,
  p_profile_completed_at timestamptz
)
returns void
language plpgsql
security invoker
set search_path to ''
as $fn$
begin
  if p_user_id is null then
    raise exception 'USER_ID_REQUIRED' using errcode = '22023';
  end if;
  if p_role is not null and p_role not in ('student', 'mentor') then
    raise exception 'ROLE_INVALID' using errcode = '22023';
  end if;

  insert into public.users (
    id, role, status, full_name, nickname, email,
    grade_level, student_status, birth_date,
    terms_agreed_at, privacy_agreed_at, marketing_agreed, profile_completed_at, updated_at
  ) values (
    p_user_id, p_role, 'active',
    nullif(btrim(p_full_name), ''),
    nullif(btrim(p_nickname), ''),
    p_email,
    nullif(btrim(p_grade_level), ''),
    nullif(btrim(p_student_status), ''),
    p_birth_date,
    case when coalesce(p_terms_agreed, false) then now() else null end,
    case when coalesce(p_privacy_agreed, false) then now() else null end,
    coalesce(p_marketing_agreed, false),
    p_profile_completed_at,
    now()
  )
  on conflict (id) do update set
    role = coalesce(excluded.role, public.users.role),
    full_name = coalesce(excluded.full_name, public.users.full_name),
    nickname = coalesce(excluded.nickname, public.users.nickname),
    email = coalesce(excluded.email, public.users.email),
    grade_level = coalesce(excluded.grade_level, public.users.grade_level),
    student_status = coalesce(excluded.student_status, public.users.student_status),
    birth_date = coalesce(excluded.birth_date, public.users.birth_date),
    terms_agreed_at = coalesce(excluded.terms_agreed_at, public.users.terms_agreed_at),
    privacy_agreed_at = coalesce(excluded.privacy_agreed_at, public.users.privacy_agreed_at),
    marketing_agreed = excluded.marketing_agreed,
    profile_completed_at = coalesce(excluded.profile_completed_at, public.users.profile_completed_at),
    updated_at = now();

  if p_role = 'mentor' then
    insert into public.mentor_profiles (
      user_id, university_name, department_name, teaching_subjects, high_school_name, intro_line,
      verification_status, student_id_image_url, updated_at
    ) values (
      p_user_id,
      coalesce(nullif(btrim(p_university_name), ''), '(미입력)'),
      coalesce(nullif(btrim(p_department_name), ''), '(미입력)'),
      coalesce(p_teaching_subjects, '{}'),
      coalesce(nullif(btrim(p_high_school_name), ''), '(미입력)'),
      nullif(btrim(p_intro_line), ''),
      'pending',
      null,
      now()
    )
    on conflict (user_id) do update set
      university_name = excluded.university_name,
      department_name = excluded.department_name,
      teaching_subjects = excluded.teaching_subjects,
      high_school_name = excluded.high_school_name,
      intro_line = coalesce(excluded.intro_line, public.mentor_profiles.intro_line),
      updated_at = now();

    insert into public.verification_logs (user_id, log_type, status, memo) values
      (p_user_id, 'mentor_verification', 'pending', 'sign-up');
  end if;
end
$fn$;
comment on function core_private.user_signup_provision_impl(uuid, text, text, text, text, text, text, date, boolean, boolean, boolean, text, text, text[], text, text, timestamptz) is
  '206(DB-5 B-3): 가입 프로비저닝 정본 — users upsert(+ 멘토면 mentor_profiles pending + verification_logs). handle_new_auth_user(이메일·소셜) 와 api_app_v1.complete_profile 이 공유. 외부 EXECUTE 0.';
revoke all on function core_private.user_signup_provision_impl(uuid, text, text, text, text, text, text, date, boolean, boolean, boolean, text, text, text[], text, text, timestamptz) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- B-4. 가입 트리거 — app_role 유무로 분기 (헤더·속성은 122 와 동일: SECURITY DEFINER · search_path public)
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  m jsonb;
  r text;
  subj text[];
  subj_str text;
  bdate date;
  v_name text;
begin
  m := coalesce(NEW.raw_user_meta_data, '{}'::jsonb);

  -- ── 소셜(OAuth) 가입: app_role 키 없음 → 역할 미정 · 완성 전. 프로필 행(mentor_profiles)은 만들지 않는다(정정 B) ──
  if not (m ? 'app_role') then
    v_name := coalesce(
      nullif(trim(m->>'full_name'), ''),
      nullif(trim(m->>'name'), ''),
      nullif(trim(m->>'preferred_username'), ''),
      nullif(trim(m->>'nickname'), ''),
      nullif(trim(m->>'user_name'), '')
    );
    perform core_private.user_signup_provision_impl(
      NEW.id, null, nullif(NEW.email, ''), v_name, v_name,
      null, null, null,
      false, false, false,
      null, null, null, null, null,
      null);
    return NEW;
  end if;

  -- ── 이메일 가입(app_role 있음): 122 정규화 그대로 ──
  r := lower(trim(m->>'app_role'));
  if r is null or r = '' then
    r := 'student';
  end if;
  -- ★ XV-01: 'admin' 제거 — 가입 메타로는 student/mentor 만 가능. 그 외 전부 student.
  if r not in ('student', 'mentor') then
    r := 'student';
  end if;

  subj_str := nullif(trim(m->>'teaching_subjects_csv'), '');
  if subj_str is not null then
    subj := array(
      select trim(both ' ' from x)
      from unnest(string_to_array(subj_str, ',')) as x
      where length(trim(both ' ' from x)) > 0
    );
  else
    subj := '{}';
  end if;

  begin
    bdate := (m->>'birth_date')::date;
  exception when others then
    bdate := null;
  end;

  perform core_private.user_signup_provision_impl(
    NEW.id, r, coalesce(NEW.email, ''),
    m->>'full_name', m->>'nickname',
    m->>'grade_level', m->>'student_status', bdate,
    (m->>'terms_agreed') = 'true', (m->>'privacy_agreed') = 'true', (m->>'marketing_agreed') = 'true',
    m->>'university_name', m->>'department_name', coalesce(subj, '{}'), m->>'high_school_name', m->>'intro_line',
    now());

  return NEW;
end;
$$;
comment on function public.handle_new_auth_user() is
  '206(DB-5 B-4): auth.users INSERT → raw_user_meta_data ? ''app_role'' 이면 이메일 가입(122 정규화 · profile_completed_at now()), 아니면 소셜 가입(role NULL · profile_completed_at NULL · provider 이름 · 프로필 행 없음). 본문은 core_private.user_signup_provision_impl 공유.';

-- -----------------------------------------------------------------------------
-- B-5. 119 role 가드 — 완성 전 행의 최초 역할 부여 전이만 추가 허용(그 외 원문 그대로)
-- -----------------------------------------------------------------------------
create or replace function public.enforce_users_role_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_jwt_role text;
begin
  -- 트리거를 WHEN 절 없이 재생성해도 안전하도록 함수 안에서도 재확인
  if new.role is distinct from old.role then
    -- 206(DB-5 B): 소셜 가입 완성 — 역할이 없는(완성 전) 행에 student/mentor 를 처음 채우는 전이는 허용.
    --   (authenticated 는 users UPDATE 권한이 없고 users_protected_columns_guard 가 클라이언트 역할의 role 변경을 거부하므로
    --    이 전이는 SECURITY DEFINER 경로 api_app_v1.complete_profile 로만 도달한다.)
    if old.role is null and old.profile_completed_at is null and new.role in ('student', 'mentor') then
      return new;
    end if;

    v_jwt_role := auth.jwt() ->> 'role';

    if v_jwt_role = 'service_role' then
      return new; -- 1) 서버(service key) 경유
    end if;

    if v_jwt_role is null then
      return new; -- 2) JWT 없는 직접 DB 세션(SQL Editor·마이그레이션)
    end if;

    if exists (
      select 1
        from public.users u
       where u.id = (select auth.uid())
         and u.role = 'admin'
    ) then
      return new; -- 3) 관리자
    end if;

    raise exception 'ROLE_CHANGE_FORBIDDEN'
      using errcode = '42501', -- insufficient_privilege
            detail  = format('users.id=%s role %L -> %L', old.id, old.role, new.role),
            hint    = 'role 변경은 service_role 또는 admin 만 가능합니다.';
  end if;

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- B-7. core_private.user_profile_update_self_impl — role NULL 명시 거부(한 줄 보강 · 그 외 20260803162257 D 원문 그대로 · 시그니처·ACL 불변)
--      앱 api_app_v1.user_profile_update_self(v1)/_v2 · 웹 api_web_v1.user_profile_update_self 가 위임하는 정본. 완성 전 사용자의 닉네임·학년 변경 통과(실측)를 닫는다.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION core_private.user_profile_update_self_impl(p_user_id uuid, p_nickname text, p_grade_level text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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

  -- 206(DB-5 B): role NULL(소셜 가입 · 완성 전)은 `not in` 을 NULL 로 통과하므로 명시적으로 거부한다(그 외 원문 그대로).
  if v_role is null or v_role not in ('student','mentor') then
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
$function$;

-- -----------------------------------------------------------------------------
-- C-1. 프로필 완성 RPC (api_app_v1 · authenticated 만)
-- -----------------------------------------------------------------------------
create function api_app_v1.complete_profile(
  p_role             text,
  p_display_name     text,
  p_birthdate        date,
  p_terms_agreed     boolean,
  p_marketing_agreed boolean default false,
  p_grade_level      text default null,
  p_university_name  text default null,
  p_department_name  text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_uid uuid := (select auth.uid());
  v_role text := lower(btrim(coalesce(p_role, '')));
  v_name text := btrim(coalesce(p_display_name, ''));
  v_grade text := nullif(btrim(coalesce(p_grade_level, '')), '');
  v_univ text := nullif(btrim(coalesce(p_university_name, '')), '');
  v_dept text := nullif(btrim(coalesce(p_department_name, '')), '');
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_row public.users%rowtype;
  v_norm text;
  v_minor boolean;
  v_next text;
  v_completed_at timestamptz;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'AUTH_REQUIRED');
  end if;

  select * into v_row from public.users u where u.id = v_uid for update;
  if not found then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'USER_NOT_FOUND');
  end if;
  if v_row.profile_completed_at is not null then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'ALREADY_COMPLETED', 'role', v_row.role, 'profile_completed_at', v_row.profile_completed_at);
  end if;

  -- 계정 게이트(core_private.user_profile_update_self_impl 과 같은 판정)
  v_norm := lower(btrim(coalesce(v_row.status, '')));
  if v_norm = 'banned' then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'ACCOUNT_BANNED');
  end if;
  if v_norm = 'suspended' and (v_row.suspended_until is null or v_row.suspended_until > now()) then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'ACCOUNT_SUSPENDED');
  end if;
  if v_norm not in ('active', 'suspended') then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'ACCOUNT_NOT_ACTIVE');
  end if;
  if public.account_deletion_write_blocked(v_uid) then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'ACCOUNT_DELETION_IN_PROGRESS');
  end if;

  -- 입력 검증
  if v_role not in ('student', 'mentor') then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'ROLE_INVALID');
  end if;
  if v_name = '' then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'DISPLAY_NAME_REQUIRED');
  end if;
  if char_length(v_name) > 30 then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'DISPLAY_NAME_TOO_LONG', 'max_length', 30);
  end if;
  if p_birthdate is null then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'BIRTHDATE_REQUIRED');
  end if;
  if p_birthdate > v_today or p_birthdate < date '1900-01-01' then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'BIRTHDATE_INVALID');
  end if;
  if not coalesce(p_terms_agreed, false) then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'TERMS_REQUIRED');
  end if;
  if v_role = 'student' then
    if v_grade is null then
      return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'GRADE_REQUIRED');
    end if;
    if char_length(v_grade) > 20 then
      return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'GRADE_LEVEL_TOO_LONG', 'max_length', 20);
    end if;
  else
    if v_univ is null then
      return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'UNIVERSITY_REQUIRED');
    end if;
  end if;

  -- 만 14세 판정(187 과 같은 식 · KST 달력)
  v_minor := v_today < (p_birthdate + interval '14 years')::date;
  v_completed_at := now();

  -- 이메일 가입 트리거와 같은 결과(공유 impl): 역할·표시명(nickname)·생년월일·학년·약관(users 컬럼)·완성 시각 · 멘토면 프로필 행 + 로그
  perform core_private.user_signup_provision_impl(
    v_uid, v_role, v_row.email,
    null, v_name,
    case when v_role = 'student' then v_grade else null end, null, p_birthdate,
    true, true, coalesce(p_marketing_agreed, false),
    case when v_role = 'mentor' then v_univ else null end,
    case when v_role = 'mentor' then v_dept else null end,
    null, null, null,
    v_completed_at);

  v_next := case when v_minor then 'guardian_consent'
                 when v_role = 'mentor' then 'identity_verification'
                 else 'home' end;

  return jsonb_build_object(
    'ok', true, 'contract_version', 1,
    'role', v_role, 'is_minor', v_minor, 'next', v_next,
    'nickname', v_name, 'profile_completed_at', v_completed_at
  );
end
$fn$;
comment on function api_app_v1.complete_profile(text, text, date, boolean, boolean, text, text, text) is
  '206(DB-5 C-1): 소셜 가입 후 프로필 완성 — profile_completed_at NULL 인 본인 행만(ALREADY_COMPLETED). 이메일 가입 트리거와 같은 결과(core_private.user_signup_provision_impl 공유). 만 14세 미만 → next guardian_consent · 멘토 → identity_verification · 그 외 home. TERMS_REQUIRED · GRADE_REQUIRED · UNIVERSITY_REQUIRED. authenticated 만.';
revoke all on function api_app_v1.complete_profile(text, text, date, boolean, boolean, text, text, text) from public, anon;
grant execute on function api_app_v1.complete_profile(text, text, date, boolean, boolean, text, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- B-6. auth.uid() 만 보는(또는 OR is_admin() 만 덧붙은) 쓰기 정책 18종 — 원문 + AND public.user_profile_completed() (이름·명령·역할·permissive 불변)
--      원문은 pack 118본 pg_policies 에서 그대로 옮겼다(rollback 이 같은 원문을 복원한다).
-- -----------------------------------------------------------------------------
-- admin_action_logs.관리자만 로그 기록 (INSERT · public)
drop policy if exists "관리자만 로그 기록" on public.admin_action_logs;
create policy "관리자만 로그 기록" on public.admin_action_logs
  as permissive for insert to public
  with check ((auth.uid() = admin_id) and public.user_profile_completed());

-- ai_drafts.ai_drafts_insert_own (INSERT · authenticated)
drop policy if exists ai_drafts_insert_own on public.ai_drafts;
create policy ai_drafts_insert_own on public.ai_drafts
  as permissive for insert to authenticated
  with check ((mentor_id = ( SELECT auth.uid() AS uid)) and public.user_profile_completed());

-- content_reports.content_reports_insert_reporter (INSERT · authenticated)
drop policy if exists content_reports_insert_reporter on public.content_reports;
create policy content_reports_insert_reporter on public.content_reports
  as permissive for insert to authenticated
  with check (((reporter_id = ( SELECT auth.uid() AS uid)) AND (status = 'pending'::text) AND (admin_note IS NULL) AND (resolved_by IS NULL) AND (resolved_at IS NULL) AND (target_type = ANY (ARRAY['community_post'::text, 'shortform_post'::text, 'community_comment'::text, 'board_comment'::text, 'user'::text])) AND
CASE
    WHEN (target_type = 'user'::text) THEN report_target_user_valid(target_id)
    ELSE rls_private.report_target_content_valid(target_type, target_id)
END) and public.user_profile_completed());

-- custom_order_deliverables.멘토만 납품 업로드 (INSERT · public)
drop policy if exists "멘토만 납품 업로드" on public.custom_order_deliverables;
create policy "멘토만 납품 업로드" on public.custom_order_deliverables
  as permissive for insert to public
  with check ((auth.uid() = mentor_id) and public.user_profile_completed());

-- custom_order_messages.당사자만 메시지 전송 (INSERT · public)
drop policy if exists "당사자만 메시지 전송" on public.custom_order_messages;
create policy "당사자만 메시지 전송" on public.custom_order_messages
  as permissive for insert to public
  with check ((auth.uid() = author_id) and public.user_profile_completed());

-- custom_request_applications.cra_insert (INSERT · authenticated)
drop policy if exists cra_insert on public.custom_request_applications;
create policy cra_insert on public.custom_request_applications
  as permissive for insert to authenticated
  with check (((mentor_id = ( SELECT auth.uid() AS uid)) OR (( SELECT is_admin() AS is_admin) = true)) and public.user_profile_completed());

-- custom_request_applications.멘토만 지원 (INSERT · public)
drop policy if exists "멘토만 지원" on public.custom_request_applications;
create policy "멘토만 지원" on public.custom_request_applications
  as permissive for insert to public
  with check ((auth.uid() = mentor_id) and public.user_profile_completed());

-- custom_request_orders.cro_insert (INSERT · authenticated)
drop policy if exists cro_insert on public.custom_request_orders;
create policy cro_insert on public.custom_request_orders
  as permissive for insert to authenticated
  with check (((student_id = ( SELECT auth.uid() AS uid)) OR (buyer_id = ( SELECT auth.uid() AS uid)) OR (client_id = ( SELECT auth.uid() AS uid)) OR (user_id = ( SELECT auth.uid() AS uid)) OR (author_id = ( SELECT auth.uid() AS uid)) OR (requester_id = ( SELECT auth.uid() AS uid)) OR (( SELECT is_admin() AS is_admin) = true)) and public.user_profile_completed());

-- custom_request_posts.crp_insert (INSERT · authenticated)
drop policy if exists crp_insert on public.custom_request_posts;
create policy crp_insert on public.custom_request_posts
  as permissive for insert to authenticated
  with check (((author_id = ( SELECT auth.uid() AS uid)) OR (user_id = ( SELECT auth.uid() AS uid)) OR (student_id = ( SELECT auth.uid() AS uid)) OR (requester_id = ( SELECT auth.uid() AS uid)) OR (client_id = ( SELECT auth.uid() AS uid)) OR (( SELECT is_admin() AS is_admin) = true)) and public.user_profile_completed());

-- custom_request_posts.학생만 의뢰 등록 (INSERT · public)
drop policy if exists "학생만 의뢰 등록" on public.custom_request_posts;
create policy "학생만 의뢰 등록" on public.custom_request_posts
  as permissive for insert to public
  with check ((auth.uid() = author_id) and public.user_profile_completed());

-- device_tokens.device_tokens_modify_own (ALL · authenticated)
drop policy if exists device_tokens_modify_own on public.device_tokens;
create policy device_tokens_modify_own on public.device_tokens
  as permissive for all to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)) and public.user_profile_completed())
  with check ((user_id = ( SELECT auth.uid() AS uid)) and public.user_profile_completed());

-- favorites.favorites_insert_own (INSERT · public)
drop policy if exists favorites_insert_own on public.favorites;
create policy favorites_insert_own on public.favorites
  as permissive for insert to public
  with check ((auth.uid() = user_id) and public.user_profile_completed());

-- free_question_usage.fqu_insert_own (INSERT · authenticated)
drop policy if exists fqu_insert_own on public.free_question_usage;
create policy fqu_insert_own on public.free_question_usage
  as permissive for insert to authenticated
  with check ((student_id = ( SELECT auth.uid() AS uid)) and public.user_profile_completed());

-- notification_settings.notif_settings_modify_own (ALL · authenticated)
drop policy if exists notif_settings_modify_own on public.notification_settings;
create policy notif_settings_modify_own on public.notification_settings
  as permissive for all to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)) and public.user_profile_completed())
  with check ((user_id = ( SELECT auth.uid() AS uid)) and public.user_profile_completed());

-- payments.payments_insert_intent (INSERT · authenticated)
drop policy if exists payments_insert_intent on public.payments;
create policy payments_insert_intent on public.payments
  as permissive for insert to authenticated
  with check (((( SELECT auth.uid() AS uid) = user_id) AND (status = ANY (ARRAY['pending'::text, 'processing'::text]))) and public.user_profile_completed());

-- user_blocks.ub_insert_own (INSERT · authenticated)
drop policy if exists ub_insert_own on public.user_blocks;
create policy ub_insert_own on public.user_blocks
  as permissive for insert to authenticated
  with check ((blocker_id = ( SELECT auth.uid() AS uid)) and public.user_profile_completed());

-- verification_logs.ver_logs_insert_own (INSERT · authenticated)
drop policy if exists ver_logs_insert_own on public.verification_logs;
create policy ver_logs_insert_own on public.verification_logs
  as permissive for insert to authenticated
  with check ((user_id = ( SELECT auth.uid() AS uid)) and public.user_profile_completed());

-- withdrawals.withdrawals_insert_self_requested (INSERT · authenticated)
drop policy if exists withdrawals_insert_self_requested on public.withdrawals;
create policy withdrawals_insert_self_requested on public.withdrawals
  as permissive for insert to authenticated
  with check (((( SELECT auth.uid() AS uid) = mentor_id) AND (status = 'requested'::text)) and public.user_profile_completed());

-- -----------------------------------------------------------------------------
-- 자가 검증
-- -----------------------------------------------------------------------------
do $$
declare v_oid oid; v_n int; r record;
begin
  -- 컬럼·백필·제약
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'users' and column_name = 'profile_completed_at') then
    raise exception '206_SELFCHECK: profile_completed_at 부재';
  end if;
  if exists (select 1 from public.users where profile_completed_at is null) then
    raise exception '206_SELFCHECK: 백필 누락 행 존재';
  end if;
  if exists (select 1 from public.users where profile_completed_at is distinct from created_at) then
    raise exception '206_SELFCHECK: 백필 값 불일치(created_at)';
  end if;
  if (select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'users' and column_name = 'role') <> 'YES' then
    raise exception '206_SELFCHECK: role NOT NULL 완화 실패';
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.users'::regclass and conname = 'users_role_required_when_completed')
     or not exists (select 1 from pg_constraint where conrelid = 'public.users'::regclass and conname = 'users_role_check') then
    raise exception '206_SELFCHECK: CHECK 제약 불일치';
  end if;
  if (select tgenabled from pg_trigger where tgrelid = 'public.users'::regclass and tgname = 'trg_users_set_updated') = 'D' then
    raise exception '206_SELFCHECK: trg_users_set_updated 가 꺼진 채 남았다';
  end if;
  -- 트리거 본문·부착
  if md5(pg_get_functiondef('public.handle_new_auth_user()'::regprocedure)) = '297616fe4e28f0dbda3b24244763a917'
     or (select prosrc from pg_proc where oid = 'public.handle_new_auth_user()'::regprocedure) not like '%m ? ''app_role''%'
     or (select prosrc from pg_proc where oid = 'public.handle_new_auth_user()'::regprocedure) not like '%core_private.user_signup_provision_impl(%' then
    raise exception '206_SELFCHECK: handle_new_auth_user 교체 실패';
  end if;
  if not exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'auth' and c.relname = 'users' and t.tgname = 'on_auth_user_created' and t.tgfoid = 'public.handle_new_auth_user'::regproc and t.tgenabled <> 'D') then
    raise exception '206_SELFCHECK: on_auth_user_created 부착 상태 변경됨';
  end if;
  if (select prosrc from pg_proc where oid = 'public.enforce_users_role_guard()'::regprocedure) not like '%old.role is null and old.profile_completed_at is null%'
     or (select prosrc from pg_proc where oid = 'public.enforce_users_role_guard()'::regprocedure) not like '%ROLE_CHANGE_FORBIDDEN%' then
    raise exception '206_SELFCHECK: enforce_users_role_guard 교체 실패';
  end if;
  -- impl(NULL 거부 보강) · 공용 impl · helper · RPC ACL
  if md5(pg_get_functiondef('core_private.user_profile_update_self_impl(uuid,text,text)'::regprocedure)) = 'a0cb1b7f37b8195cc9ca370bfb5e90e7'
     or (select prosrc from pg_proc where oid = 'core_private.user_profile_update_self_impl(uuid,text,text)'::regprocedure) not like '%v_role is null or v_role not in%' then
    raise exception '206_SELFCHECK: user_profile_update_self_impl 보강 실패';
  end if;
  if has_function_privilege('anon', 'core_private.user_profile_update_self_impl(uuid,text,text)'::regprocedure, 'EXECUTE')
     or has_function_privilege('authenticated', 'core_private.user_profile_update_self_impl(uuid,text,text)'::regprocedure, 'EXECUTE') then
    raise exception '206_SELFCHECK: user_profile_update_self_impl ACL 변경됨';
  end if;
  select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'core_private' and p.proname = 'user_signup_provision_impl';
  if v_oid is null or has_function_privilege('anon', v_oid, 'EXECUTE') or has_function_privilege('authenticated', v_oid, 'EXECUTE') or has_function_privilege('service_role', v_oid, 'EXECUTE') then
    raise exception '206_SELFCHECK: impl 부재 또는 외부 EXECUTE 잔존';
  end if;
  select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'user_profile_completed' and p.prosecdef and p.provolatile = 's';
  if v_oid is null or not has_function_privilege('anon', v_oid, 'EXECUTE') or not has_function_privilege('authenticated', v_oid, 'EXECUTE') then
    raise exception '206_SELFCHECK: user_profile_completed 부재 또는 ACL 불일치';
  end if;
  select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'api_app_v1' and p.proname = 'complete_profile'
     and pg_get_function_identity_arguments(p.oid) = 'p_role text, p_display_name text, p_birthdate date, p_terms_agreed boolean, p_marketing_agreed boolean, p_grade_level text, p_university_name text, p_department_name text'
     and p.prosecdef and coalesce(p.proconfig::text, '') like '%search_path=%';
  if v_oid is null or has_function_privilege('anon', v_oid, 'EXECUTE') or not has_function_privilege('authenticated', v_oid, 'EXECUTE') or has_function_privilege('service_role', v_oid, 'EXECUTE') then
    raise exception '206_SELFCHECK: complete_profile identity/ACL 불일치(authenticated 만)';
  end if;
  if (select prosrc from pg_proc where oid = v_oid) not like '%core_private.user_signup_provision_impl(%' or (select prosrc from pg_proc where oid = v_oid) like '%user_consent_records%' then
    raise exception '206_SELFCHECK: complete_profile 이 impl 을 공유하지 않거나 consent 원장을 쓴다';
  end if;
  -- 정책 18종: 이름·명령·역할 유지 + 완성 조건
  select count(*) into v_n from pg_policies pp
   where pp.schemaname = 'public'
     and (pp.tablename, pp.policyname) in (('admin_action_logs','관리자만 로그 기록'),('ai_drafts','ai_drafts_insert_own'),('content_reports','content_reports_insert_reporter'),('custom_order_deliverables','멘토만 납품 업로드'),('custom_order_messages','당사자만 메시지 전송'),('custom_request_applications','cra_insert'),('custom_request_applications','멘토만 지원'),('custom_request_orders','cro_insert'),('custom_request_posts','crp_insert'),('custom_request_posts','학생만 의뢰 등록'),('device_tokens','device_tokens_modify_own'),('favorites','favorites_insert_own'),('free_question_usage','fqu_insert_own'),('notification_settings','notif_settings_modify_own'),('payments','payments_insert_intent'),('user_blocks','ub_insert_own'),('verification_logs','ver_logs_insert_own'),('withdrawals','withdrawals_insert_self_requested'))
     and coalesce(pp.with_check, '') || coalesce(pp.qual, '') like '%user_profile_completed()%'
     and (pp.cmd <> 'ALL' or (pp.qual like '%user_profile_completed()%' and pp.with_check like '%user_profile_completed()%'));
  if v_n <> 18 then
    raise exception '206_SELFCHECK: 완성 조건이 붙은 정책 % (18 기대)', v_n;
  end if;
  if (select count(*) from pg_policies where schemaname = 'public') <> (select policies from db5_206_pre) then
    raise exception '206_SELFCHECK: public 정책 수 변동(% ≠ 적용 전 %)', (select count(*) from pg_policies where schemaname = 'public'), (select policies from db5_206_pre);
  end if;
  -- users_select_own 은 그대로(완성 전 사용자의 자기 행 읽기)
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'users' and policyname = 'users_select_own' and cmd = 'SELECT') then
    raise exception '206_SELFCHECK: users_select_own 부재';
  end if;
end $$;

commit;
