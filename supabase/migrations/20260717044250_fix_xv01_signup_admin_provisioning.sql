-- XV-01 픽스: 미인증 사용자의 가입(INSERT) 경로 admin 자가 provisioning 차단.
-- 2단 방어:
--   (1) handle_new_auth_user(): 가입 메타 app_role='admin' 을 허용목록에서 제거
--       (→ 'student' 폴백). 이것이 실제 공격 벡터의 정본 차단.
--   (2) public.users BEFORE INSERT 가드: RLS users_insert_own(id=auth.uid()) 를 통한
--       클라이언트 직접 INSERT(role='admin') 2차 벡터 차단. 기존 UPDATE 가드
--       (enforce_users_role_guard)와 동일한 예외 모델(service_role / JWT 없는 직접
--       DB 세션 / 기존 admin)만 admin INSERT 허용.
-- 불변: 테이블·기존 RLS·다른 트리거·시그니처 무변경. 멱등(재적용 안전).

-- ── (1) 가입 트리거: admin 허용 제거 ─────────────────────────────
create or replace function public.handle_new_auth_user()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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

-- ── (2) INSERT 가드: 클라이언트 직접 admin INSERT 차단 ────────────
create or replace function public.enforce_users_role_insert_guard()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_jwt_role text;
begin
  if new.role = 'admin' then
    v_jwt_role := auth.jwt() ->> 'role';

    if v_jwt_role = 'service_role' then
      return new; -- 1) 서버(service key) 경유 — admin 프로비저닝 정상 경로
    end if;

    if v_jwt_role is null then
      return new; -- 2) JWT 없는 직접 DB 세션(SQL Editor·마이그레이션·SECURITY DEFINER)
    end if;

    if exists (
      select 1
        from public.users u
       where u.id = (select auth.uid())
         and u.role = 'admin'
    ) then
      return new; -- 3) 기존 관리자
    end if;

    raise exception 'ADMIN_INSERT_FORBIDDEN'
      using errcode = '42501', -- insufficient_privilege
            detail  = format('users.id=%s attempted role INSERT %L', new.id, new.role),
            hint    = 'admin 계정 생성은 service_role 또는 admin 만 가능합니다(가입 경로 불가).';
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_users_role_insert_guard on public.users;
create trigger trg_users_role_insert_guard
  before insert on public.users
  for each row
  when (new.role = 'admin')
  execute function public.enforce_users_role_insert_guard();
