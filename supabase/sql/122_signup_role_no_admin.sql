-- --------------------------------------------------------------------------
-- 122_signup_role_no_admin.sql
-- 목적(P0-1): 가입 메타데이터(app_role)로 admin 권한 자가 획득 차단.
--   handle_new_auth_user() 의 role 화이트리스트에서 'admin' 을 제거한다.
--   001_initial_auth_profile.sql 본문과 완전히 동일하며, 단 한 줄
--   (role 분기 화이트리스트)만 'admin' 미허용으로 교정한다.
-- 선행: 001_initial_auth_profile.sql
-- 참고: 운영/스테이징 DB에는 동등 교정이 이미 적용되어 있음
--   (supabase_migrations 원장: 20260717044250 fix_xv01_signup_admin_provisioning).
--   본 파일은 저장소 클린 설치 정본(001)과의 정합용 — 클린 설치 시에도
--   가입 경로로 admin 승격이 불가능하도록 닫는다. (서버 방어는 DB가 정본;
--   UI/TS 메타 정규화는 보조일 뿐이다.)
-- --------------------------------------------------------------------------

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
begin
  m := coalesce(NEW.raw_user_meta_data, '{}'::jsonb);
  r := lower(trim(m->>'app_role'));
  if r is null or r = '' then
    r := 'student';
  end if;
  -- P0-1: 'admin' 제거 — 가입 메타로는 student/mentor 만 허용, 그 외 전부 student.
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
$$;
