-- =============================================================================
-- 121: 가입(INSERT) 경로 admin 자가 provisioning 차단 (XV-01 잔여 / P0)
-- =============================================================================
-- 배경(XV-01 잔여): 119 는 users 의 BEFORE UPDATE 만 가드한다. 그러나 가입 트리거
--   handle_new_auth_user()(001, SECURITY DEFINER, AFTER INSERT ON auth.users)가
--   클라이언트 가입 메타데이터 app_role 을 그대로 읽고, 허용목록이
--     if r not in ('student','mentor','admin') then r := 'student'
--   로 'admin' 을 명시적으로 포함한다. GoTrue /signup 은 임의 options.data 로 공개
--   호출 가능하므로(TS Exclude 타입은 서버 통제가 아님), 미인증 사용자가
--     signUp({ options:{ data:{ app_role:'admin' } } })
--   만으로 public.users.role='admin' 계정을 만들 수 있다(재현 확인). role 은
--   is_admin()·requireRole()·다수 RLS 의 근거라 즉시 전체 권한으로 번지는 P0.
--   ※ 119 UPDATE 가드는 INSERT/upsert 시점엔 발화하지 않아 이 벡터를 못 막는다.
--
-- 조치(2단):
--   A) handle_new_auth_user() 를 재정의해 role 허용목록에서 'admin' 제거
--      (→ 'student','mentor' 외 전부 'student'). admin 은 서버 전용 경로로만 승격.
--      001 본문과 A 라인 외 100% 동일(idempotent create or replace).
--   B) users 에 BEFORE INSERT role 가드(119 의 UPDATE 판정과 동일 규약) 추가 —
--      users_insert_own(id=auth.uid() 만 검사) 등 다른 직접 INSERT 경로에 role='admin'
--      이 실려도 차단하는 심층방어. 허용: service_role / JWT 없는 직접 DB 세션 /
--      호출자가 이미 admin. (최초 admin 시드·SQL Editor 복구 경로 보존.)
--
-- 성격: 재실행 안전(create or replace + drop trigger if exists). 파괴적 변경 없음.
--   정상 학생/멘토 가입은 A 후 role='student'/'mentor' 라 B 가드에 안 걸린다.
-- 사전 조건: 001(handle_new_auth_user, users), 119(role UPDATE 가드). 번호 120 은
--   미머지 #31(reviews) 예약이라 121 사용.
-- 검증 쿼리: 파일 하단 §V.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A. handle_new_auth_user() 재정의 — role 허용목록에서 'admin' 제거
--    (001 본문과 동일, ONLY the role allowlist line changed)
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
begin
  m := coalesce(NEW.raw_user_meta_data, '{}'::jsonb);
  r := lower(trim(m->>'app_role'));
  if r is null or r = '' then
    r := 'student';
  end if;
  -- XV-01: 'admin' 은 가입 메타데이터로 부여 불가 (서버 전용 경로로만 승격)
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

  return NEW;
end;
$$;

-- -----------------------------------------------------------------------------
-- B. users BEFORE INSERT role 가드 (심층방어) — 119 UPDATE 가드와 동일 판정
-- -----------------------------------------------------------------------------
create or replace function public.enforce_users_role_insert_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_jwt_role text;
begin
  -- role='admin' 신규 INSERT 만 심사(그 외는 통과 — 정상 가입 비용 0)
  if NEW.role is distinct from 'admin' then
    return NEW;
  end if;

  -- 판정 규약은 119(enforce_users_role_guard)와 동일: auth.jwt()->>'role'
  v_jwt_role := auth.jwt() ->> 'role';

  -- 1) service_role (서버 admin API)
  if v_jwt_role = 'service_role' then
    return NEW;
  end if;

  -- 2) JWT 없는 직접 DB 세션(SQL Editor(postgres)·마이그레이션·최초 admin 시드)
  if v_jwt_role is null then
    return NEW;
  end if;

  -- 3) 호출자가 이미 admin (관리자 콘솔이 다른 admin 을 만드는 경우)
  if exists (
    select 1 from public.users u
    where u.id = (select auth.uid()) and u.role = 'admin'
  ) then
    return NEW;
  end if;

  raise exception 'ROLE_INSERT_FORBIDDEN'
    using errcode = '42501', -- insufficient_privilege
          detail = format('users.id=%s role=admin INSERT', NEW.id),
          hint = 'admin 계정은 service_role 또는 직접 DB 세션으로만 생성할 수 있습니다.';
end;
$$;

revoke all on function public.enforce_users_role_insert_guard() from public, anon, authenticated;

drop trigger if exists trg_users_role_insert_guard on public.users;
create trigger trg_users_role_insert_guard
  before insert on public.users
  for each row execute function public.enforce_users_role_insert_guard();

comment on function public.handle_new_auth_user() is
  'XV-01: 가입 메타 app_role 로 admin 부여 불가(student/mentor 만). admin 은 서버 전용.';
comment on function public.enforce_users_role_insert_guard() is
  'XV-01 심층방어: users INSERT role=admin 을 service_role/직접세션/admin 외 차단.';

-- =============================================================================
-- §V. 검증 (적용 후 수동 실행 — 데이터 미변경, 전부 rollback)
-- =============================================================================
-- §V-0 설치 확인:
--   select tgname from pg_trigger where tgrelid='public.users'::regclass and not tgisinternal;
--     → trg_users_set_updated, trg_users_role_guard(119), trg_users_role_insert_guard(본 파일)
--
-- §V-a 가입 메타 app_role=admin 주입 → student 로 강등되어야 함:
--   begin;
--   insert into auth.users(id,email,raw_user_meta_data)
--     values (gen_random_uuid(),'atk@t.local','{"app_role":"admin"}'::jsonb) returning id \gset
--   select role from public.users where id = :'id';   -- 기대: student
--   rollback;
--
-- §V-b 정상 멘토 가입 → mentor 유지:
--   begin;
--   insert into auth.users(id,email,raw_user_meta_data)
--     values (gen_random_uuid(),'m@t.local','{"app_role":"mentor"}'::jsonb) returning id \gset
--   select role from public.users where id = :'id';   -- 기대: mentor
--   rollback;
--
-- §V-c authenticated 직접 INSERT role=admin → ROLE_INSERT_FORBIDDEN:
--   begin;
--   select set_config('request.jwt.claim.role','authenticated', true);
--   select set_config('request.jwt.claims','{"sub":"...","role":"authenticated"}', true);
--   set local role authenticated;
--   insert into public.users(id,role,status) values (auth.uid(),'admin','active');  -- 기대: 예외
--   reset role; rollback;
--
-- §V-d service_role / 직접세션 admin INSERT → 통과(시드 경로 보존):
--   begin; set local role service_role;
--   insert into public.users(id,role,status,email) values (gen_random_uuid(),'admin','active','a@t.local');  -- 기대: 통과
--   reset role; rollback;
-- =============================================================================
