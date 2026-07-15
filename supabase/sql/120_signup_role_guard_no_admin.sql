-- 120_signup_role_guard_no_admin.sql
-- 가입 트리거 수직 권한 상승 차단 — raw_user_meta_data.app_role='admin' 자가 승격 봉쇄.
--
-- 배경: 001_initial_auth_profile.sql 의 handle_new_auth_user() 는 클라이언트가 넘긴
--   raw_user_meta_data.app_role 을 그대로 public.users.role 에 기록하며, 허용 집합에
--   'admin' 이 포함돼 있었다. 공개 anon 키로
--     supabase.auth.signUp({ ..., options: { data: { app_role: 'admin' } } })
--   를 호출하면 role='admin' 프로필이 INSERT 되어 관리자 콘솔·모든 admin server action 에
--   접근 가능했다. 119_users_role_guard 의 트리거는 BEFORE UPDATE 라 이 INSERT 경로를
--   막지 못한다.
--
-- 조치: 트리거 함수를 001 본문 그대로 create or replace 하되, 메타데이터 유래 role 허용
--   집합에서 'admin' 을 제거한다(유일한 실질 변경). 'admin' 또는 기타 미허용 값이 들어오면
--   'student' 로 강등한다. mentor_profiles / verification_logs 프로비저닝 등 나머지 로직은
--   001 과 완전히 동일하다.
--
-- admin 프로비저닝: 가입 메타데이터가 아니라 service_role / SQL 콘솔 등 대역외 경로로만
--   수행한다(예: update public.users set role='admin' where id=... 를 운영자가 직접 실행).
--
-- 실행: 검토 후 Supabase SQL Editor 에서 전체 실행. (idempotent: create or replace)

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
  -- ★ 가입 경로에서는 'admin' 을 허용하지 않는다(001 대비 유일한 변경).
  --    student/mentor 외 모든 값(‘admin’ 포함)은 student 로 강등.
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

comment on function public.handle_new_auth_user() is
  'Signup profile provisioning. Metadata app_role is clamped to student/mentor only — admin must be granted out-of-band (120, replaces 001 body).';
