-- =============================================================================
-- 20260906100200_social_signup_profile_completion_rollback.sql  (DB-5 묶음 B+C 롤백)
-- =============================================================================
-- forward: supabase/sql/206_social_signup_profile_completion.sql
-- 되돌리는 것(역순):
--   ① 정책 18종을 pack 118본 원문(pg_policies 원문 그대로)으로 복원 → ② public.user_profile_completed() DROP
--   ③ api_app_v1.complete_profile DROP → ④ public.enforce_users_role_guard() 를 119 운영 원문(CRLF 그대로 · md5 b0fe6f75… — pack LF 재생값 702ddc29… 가 아니다)으로 복원
--   ⑤ public.handle_new_auth_user() 를 122/20260717044250 라이브 원문(md5 297616fe…)으로 복원 → ⑥ core_private.user_signup_provision_impl DROP
--   ⑥b core_private.user_profile_update_self_impl 을 20260803162257 D 라이브 원문(md5 a0cb1b7f…)으로 복원
--   ⑥c public.handle_new_auth_user_consent_records() 를 187 라이브 원문(md5 abc7c96e…)으로 복원 → core_private.user_consent_signup_impl DROP(후속 a)
--   ⑦ CHECK users_role_required_when_completed DROP → users.role NOT NULL 복원 → users.profile_completed_at DROP
-- 전제(게이트): **role NULL 행(소셜 가입 후 미완성 사용자)이 0 이어야 한다.** 있으면 NOT NULL 복원이 불가능하므로 중단한다 — 오너가 그 사용자를
--   complete_profile 로 완성시키거나 탈퇴 처리한 뒤 다시 실행한다(자동 삭제·임의 역할 부여는 하지 않는다).
-- 데이터: forward 기간에 이메일 가입한 사용자의 행·프로필은 그대로(트리거 결과는 122 와 동일 형태). profile_completed_at 값은 컬럼과 함께 사라진다.
-- =============================================================================

begin;

do $$
begin
  if exists (select 1 from public.users where role is null) then
    raise exception '206_ROLLBACK_GATE: role NULL 행(소셜 가입 미완성) % 건 — NOT NULL 을 복원할 수 없다. complete_profile 로 완성시키거나 탈퇴 처리 후 재실행',
      (select count(*) from public.users where role is null);
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'users' and column_name = 'profile_completed_at') then
    raise exception '206_ROLLBACK_GATE: profile_completed_at 부재 — forward 미적용 상태';
  end if;
end $$;

-- ① 정책 18종 원문 복원 (pack 118본 pg_policies 원문)
-- admin_action_logs.관리자만 로그 기록 (INSERT · public)
drop policy if exists "관리자만 로그 기록" on public.admin_action_logs;
create policy "관리자만 로그 기록" on public.admin_action_logs
  as permissive for insert to public
  with check ((auth.uid() = admin_id));

-- ai_drafts.ai_drafts_insert_own (INSERT · authenticated)
drop policy if exists ai_drafts_insert_own on public.ai_drafts;
create policy ai_drafts_insert_own on public.ai_drafts
  as permissive for insert to authenticated
  with check ((mentor_id = ( SELECT auth.uid() AS uid)));

-- content_reports.content_reports_insert_reporter (INSERT · authenticated)
drop policy if exists content_reports_insert_reporter on public.content_reports;
create policy content_reports_insert_reporter on public.content_reports
  as permissive for insert to authenticated
  with check (((reporter_id = ( SELECT auth.uid() AS uid)) AND (status = 'pending'::text) AND (admin_note IS NULL) AND (resolved_by IS NULL) AND (resolved_at IS NULL) AND (target_type = ANY (ARRAY['community_post'::text, 'shortform_post'::text, 'community_comment'::text, 'board_comment'::text, 'user'::text])) AND
CASE
    WHEN (target_type = 'user'::text) THEN report_target_user_valid(target_id)
    ELSE rls_private.report_target_content_valid(target_type, target_id)
END));

-- custom_order_deliverables.멘토만 납품 업로드 (INSERT · public)
drop policy if exists "멘토만 납품 업로드" on public.custom_order_deliverables;
create policy "멘토만 납품 업로드" on public.custom_order_deliverables
  as permissive for insert to public
  with check ((auth.uid() = mentor_id));

-- custom_order_messages.당사자만 메시지 전송 (INSERT · public)
drop policy if exists "당사자만 메시지 전송" on public.custom_order_messages;
create policy "당사자만 메시지 전송" on public.custom_order_messages
  as permissive for insert to public
  with check ((auth.uid() = author_id));

-- custom_request_applications.cra_insert (INSERT · authenticated)
drop policy if exists cra_insert on public.custom_request_applications;
create policy cra_insert on public.custom_request_applications
  as permissive for insert to authenticated
  with check (((mentor_id = ( SELECT auth.uid() AS uid)) OR (( SELECT is_admin() AS is_admin) = true)));

-- custom_request_applications.멘토만 지원 (INSERT · public)
drop policy if exists "멘토만 지원" on public.custom_request_applications;
create policy "멘토만 지원" on public.custom_request_applications
  as permissive for insert to public
  with check ((auth.uid() = mentor_id));

-- custom_request_orders.cro_insert (INSERT · authenticated)
drop policy if exists cro_insert on public.custom_request_orders;
create policy cro_insert on public.custom_request_orders
  as permissive for insert to authenticated
  with check (((student_id = ( SELECT auth.uid() AS uid)) OR (buyer_id = ( SELECT auth.uid() AS uid)) OR (client_id = ( SELECT auth.uid() AS uid)) OR (user_id = ( SELECT auth.uid() AS uid)) OR (author_id = ( SELECT auth.uid() AS uid)) OR (requester_id = ( SELECT auth.uid() AS uid)) OR (( SELECT is_admin() AS is_admin) = true)));

-- custom_request_posts.crp_insert (INSERT · authenticated)
drop policy if exists crp_insert on public.custom_request_posts;
create policy crp_insert on public.custom_request_posts
  as permissive for insert to authenticated
  with check (((author_id = ( SELECT auth.uid() AS uid)) OR (user_id = ( SELECT auth.uid() AS uid)) OR (student_id = ( SELECT auth.uid() AS uid)) OR (requester_id = ( SELECT auth.uid() AS uid)) OR (client_id = ( SELECT auth.uid() AS uid)) OR (( SELECT is_admin() AS is_admin) = true)));

-- custom_request_posts.학생만 의뢰 등록 (INSERT · public)
drop policy if exists "학생만 의뢰 등록" on public.custom_request_posts;
create policy "학생만 의뢰 등록" on public.custom_request_posts
  as permissive for insert to public
  with check ((auth.uid() = author_id));

-- device_tokens.device_tokens_modify_own (ALL · authenticated)
drop policy if exists device_tokens_modify_own on public.device_tokens;
create policy device_tokens_modify_own on public.device_tokens
  as permissive for all to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)))
  with check ((user_id = ( SELECT auth.uid() AS uid)));

-- favorites.favorites_insert_own (INSERT · public)
drop policy if exists favorites_insert_own on public.favorites;
create policy favorites_insert_own on public.favorites
  as permissive for insert to public
  with check ((auth.uid() = user_id));

-- free_question_usage.fqu_insert_own (INSERT · authenticated)
drop policy if exists fqu_insert_own on public.free_question_usage;
create policy fqu_insert_own on public.free_question_usage
  as permissive for insert to authenticated
  with check ((student_id = ( SELECT auth.uid() AS uid)));

-- notification_settings.notif_settings_modify_own (ALL · authenticated)
drop policy if exists notif_settings_modify_own on public.notification_settings;
create policy notif_settings_modify_own on public.notification_settings
  as permissive for all to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)))
  with check ((user_id = ( SELECT auth.uid() AS uid)));

-- payments.payments_insert_intent (INSERT · authenticated)
drop policy if exists payments_insert_intent on public.payments;
create policy payments_insert_intent on public.payments
  as permissive for insert to authenticated
  with check (((( SELECT auth.uid() AS uid) = user_id) AND (status = ANY (ARRAY['pending'::text, 'processing'::text]))));

-- user_blocks.ub_insert_own (INSERT · authenticated)
drop policy if exists ub_insert_own on public.user_blocks;
create policy ub_insert_own on public.user_blocks
  as permissive for insert to authenticated
  with check ((blocker_id = ( SELECT auth.uid() AS uid)));

-- verification_logs.ver_logs_insert_own (INSERT · authenticated)
drop policy if exists ver_logs_insert_own on public.verification_logs;
create policy ver_logs_insert_own on public.verification_logs
  as permissive for insert to authenticated
  with check ((user_id = ( SELECT auth.uid() AS uid)));

-- withdrawals.withdrawals_insert_self_requested (INSERT · authenticated)
drop policy if exists withdrawals_insert_self_requested on public.withdrawals;
create policy withdrawals_insert_self_requested on public.withdrawals
  as permissive for insert to authenticated
  with check (((( SELECT auth.uid() AS uid) = mentor_id) AND (status = 'requested'::text)));

-- ② 헬퍼 DROP (정책이 더 이상 참조하지 않는다)
drop function if exists public.user_profile_completed();

-- ③ 프로필 완성 RPC DROP
drop function if exists api_app_v1.complete_profile(text, text, date, boolean, boolean, text, text, text);

-- ④ 119 role 가드 원문 복원 (운영 pg_get_functiondef 원문 · prosrc 줄바꿈 CRLF 그대로 · md5 b0fe6f758260c82ab3c342951cba6dc0 — 2026-09-06 운영 실측 · 편집기 자동 변환 금지)
CREATE OR REPLACE FUNCTION public.enforce_users_role_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_jwt_role text;
begin
  -- 트리거를 WHEN 절 없이 재생성해도 안전하도록 함수 안에서도 재확인
  if new.role is distinct from old.role then
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
$function$;

-- ⑤ 가입 트리거 원문 복원 (라이브 pg_get_functiondef 원문 · md5 297616fe4e28f0dbda3b24244763a917)
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  m jsonb;
  r text;
  subj text[];
  subj_str text;
  bdate date;
begin
  m := coalesce(NEW.raw_user_meta_data, '{}'::jsonb);
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

  insert into public.users (
    id, role, status, full_name, nickname, email,
    grade_level, student_status, birth_date,
    terms_agreed_at, privacy_agreed_at, marketing_agreed, updated_at
  ) values (
    NEW.id, r, 'active',
    nullif(trim(m->>'full_name'), ''),
    nullif(trim(m->>'nickname'), ''),
    coalesce(NEW.email, ''),
    nullif(trim(m->>'grade_level'), ''),
    nullif(trim(m->>'student_status'), ''),
    bdate,
    case when (m->>'terms_agreed') = 'true' then now() else null end,
    case when (m->>'privacy_agreed') = 'true' then now() else null end,
    case when (m->>'marketing_agreed') = 'true' then true else false end,
    now()
  )
  on conflict (id) do update set
    role = excluded.role,
    full_name = coalesce(excluded.full_name, public.users.full_name),
    nickname = coalesce(excluded.nickname, public.users.nickname),
    email = excluded.email,
    grade_level = coalesce(excluded.grade_level, public.users.grade_level),
    student_status = coalesce(excluded.student_status, public.users.student_status),
    birth_date = coalesce(excluded.birth_date, public.users.birth_date),
    terms_agreed_at = coalesce(excluded.terms_agreed_at, public.users.terms_agreed_at),
    privacy_agreed_at = coalesce(excluded.privacy_agreed_at, public.users.privacy_agreed_at),
    marketing_agreed = excluded.marketing_agreed,
    updated_at = now();

  if r = 'mentor' then
    insert into public.mentor_profiles (
      user_id, university_name, department_name, teaching_subjects, high_school_name, intro_line,
      verification_status, student_id_image_url, updated_at
    ) values (
      NEW.id,
      coalesce(nullif(trim(m->>'university_name'), ''), '(미입력)'),
      coalesce(nullif(trim(m->>'department_name'), ''), '(미입력)'),
      coalesce(subj, '{}'),
      coalesce(nullif(trim(m->>'high_school_name'), ''), '(미입력)'),
      nullif(trim(m->>'intro_line'), ''),
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
      (NEW.id, 'mentor_verification', 'pending', 'sign-up');
  end if;

  return NEW;
end;
$function$;

-- ⑥ 공용 impl DROP (트리거·RPC 가 더 이상 참조하지 않는다)
drop function if exists core_private.user_signup_provision_impl(uuid, text, text, text, text, text, text, date, boolean, boolean, boolean, text, text, text[], text, text, timestamptz, jsonb);

-- ⑥c 187 동의 트리거 원문 복원 (라이브 pg_get_functiondef 원문 · md5 abc7c96e8d5707a6d8324a75d4b14815) → 동의 원장 impl DROP
CREATE OR REPLACE FUNCTION public.handle_new_auth_user_consent_records()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  m jsonb;
  v_role text;
  v_birth_date date;
  v_is_minor boolean := false;
  v_version text;
  v_agreed_at timestamptz := now();
  v_metadata jsonb;
begin
  m := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_role := lower(coalesce(nullif(trim(m->>'app_role'), ''), 'student'));
  v_version := coalesce(nullif(trim(m->>'consent_version'), ''), 'legal-placeholder-2026-06-20');

  begin
    v_birth_date := nullif(trim(m->>'birth_date'), '')::date;
  exception when others then
    v_birth_date := null;
  end;

  v_is_minor := coalesce(
    nullif(trim(m->>'is_minor'), '')::boolean,
    case when v_birth_date is not null
         then ((now() at time zone 'Asia/Seoul')::date < (v_birth_date + interval '14 years')::date)
         else false end
  );

  v_metadata := jsonb_build_object(
    'role', v_role,
    'birth_date', case when v_birth_date is not null then v_birth_date::text else null end,
    'age_gate_checked_at', nullif(trim(m->>'age_gate_checked_at'), ''),
    'verification_method', coalesce(nullif(trim(m->>'guardian_verification_method'), ''), 'legal_review_pending')
  );

  if (m->>'terms_agreed') = 'true' then
    insert into public.user_consent_records (
      user_id, consent_type, consent_actor, is_minor, guardian_consent,
      consent_version, agreed_at, source, metadata, idempotency_key
    ) values (
      new.id, 'terms', 'user', v_is_minor, false,
      v_version, v_agreed_at, 'signup', v_metadata, 'signup:' || new.id::text || ':terms:' || v_version
    ) on conflict (idempotency_key) do nothing;
  end if;

  if (m->>'privacy_agreed') = 'true' then
    insert into public.user_consent_records (
      user_id, consent_type, consent_actor, is_minor, guardian_consent,
      consent_version, agreed_at, source, metadata, idempotency_key
    ) values (
      new.id, 'privacy', 'user', v_is_minor, false,
      v_version, v_agreed_at, 'signup', v_metadata, 'signup:' || new.id::text || ':privacy:' || v_version
    ) on conflict (idempotency_key) do nothing;
  end if;

  if (m->>'marketing_agreed') = 'true' then
    insert into public.user_consent_records (
      user_id, consent_type, consent_actor, is_minor, guardian_consent,
      consent_version, agreed_at, source, metadata, idempotency_key
    ) values (
      new.id, 'marketing', 'user', v_is_minor, false,
      v_version, v_agreed_at, 'signup', v_metadata, 'signup:' || new.id::text || ':marketing:' || v_version
    ) on conflict (idempotency_key) do nothing;
  end if;

  if v_is_minor and (m->>'guardian_consent') = 'true' then
    insert into public.user_consent_records (
      user_id, consent_type, consent_actor, is_minor, guardian_consent,
      consent_version, guardian_ref, agreed_at, source, metadata, idempotency_key
    ) values (
      new.id, 'minor_guardian_consent', 'guardian', true, true,
      v_version, nullif(trim(m->>'guardian_ref'), ''), v_agreed_at, 'signup', v_metadata,
      'signup:' || new.id::text || ':minor_guardian_consent:' || v_version
    ) on conflict (idempotency_key) do nothing;
  end if;

  return new;
end;
$function$;
comment on function public.handle_new_auth_user_consent_records() is
  'Signup consent ledger trigger. Stores terms/privacy/marketing and under-14 guardian consent skeleton from auth metadata.';
drop function if exists core_private.user_consent_signup_impl(uuid, jsonb, text);

-- ⑥b self 프로필 impl 원문 복원 (라이브 pg_get_functiondef 원문 · md5 a0cb1b7f37b8195cc9ca370bfb5e90e7)
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
$function$;

-- ⑦ 제약·컬럼 복원
alter table public.users drop constraint if exists users_role_required_when_completed;
alter table public.users alter column role set not null;
alter table public.users drop column if exists profile_completed_at;

do $$
declare r record; v_bad int := 0;
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'users' and column_name = 'profile_completed_at') then
    raise exception '206_ROLLBACK_SELFCHECK: profile_completed_at 잔존';
  end if;
  if (select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'users' and column_name = 'role') <> 'NO' then
    raise exception '206_ROLLBACK_SELFCHECK: role NOT NULL 미복원';
  end if;
  if exists (select 1 from pg_constraint where conrelid = 'public.users'::regclass and conname = 'users_role_required_when_completed') then
    raise exception '206_ROLLBACK_SELFCHECK: CHECK 잔존';
  end if;
  if md5(pg_get_functiondef('public.handle_new_auth_user()'::regprocedure)) <> '297616fe4e28f0dbda3b24244763a917' then
    raise exception '206_ROLLBACK_SELFCHECK: handle_new_auth_user 원문 불일치';
  end if;
  if md5(pg_get_functiondef('public.enforce_users_role_guard()'::regprocedure)) <> 'b0fe6f758260c82ab3c342951cba6dc0' then
    raise exception '206_ROLLBACK_SELFCHECK: enforce_users_role_guard 원문 불일치';
  end if;
  if md5(pg_get_functiondef('core_private.user_profile_update_self_impl(uuid,text,text)'::regprocedure)) <> 'a0cb1b7f37b8195cc9ca370bfb5e90e7' then
    raise exception '206_ROLLBACK_SELFCHECK: user_profile_update_self_impl 원문 불일치';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where (n.nspname, p.proname) in (('api_app_v1', 'complete_profile'), ('core_private', 'user_signup_provision_impl'), ('core_private', 'user_consent_signup_impl'), ('public', 'user_profile_completed'))) then
    raise exception '206_ROLLBACK_SELFCHECK: 함수 잔존';
  end if;
  if md5(pg_get_functiondef('public.handle_new_auth_user_consent_records()'::regprocedure)) <> 'abc7c96e8d5707a6d8324a75d4b14815' then
    raise exception '206_ROLLBACK_SELFCHECK: handle_new_auth_user_consent_records 원문 불일치';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and (coalesce(qual, '') || coalesce(with_check, '')) like '%user_profile_completed()%') then
    raise exception '206_ROLLBACK_SELFCHECK: 완성 조건이 남은 정책 존재';
  end if;
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
      v_bad := v_bad + 1;
      raise warning '206_ROLLBACK_SELFCHECK: 정책 %.% 원문 복원 불일치', r.t, r.p;
    end if;
  end loop;
  if v_bad <> 0 then
    raise exception '206_ROLLBACK_SELFCHECK: 정책 원문 복원 불일치 % 건', v_bad;
  end if;
end $$;

commit;
