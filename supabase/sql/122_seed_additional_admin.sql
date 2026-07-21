-- 122_seed_additional_admin.sql
-- 추가 관리자 계정 시드 (운영자 계정 1개 증설). 전 구간 멱등(재실행 안전).
--
-- 배경: 운영 인력 증원으로 기존 오너 관리자(byite1226@gmail.com) 외에
--   운영자 로그인 계정을 1개 더 둔다. 대상 이메일: hello@byite.co.kr
--
-- 관리자 로그인 성립 조건 3가지(lib/auth/adminLoginActions.ts 기준):
--   1) auth.users 비밀번호 로그인 성공(encrypted_password 일치)
--   2) email_confirmed_at IS NOT NULL (이메일 인증 완료 계정만 통과)
--   3) public.users.role = 'admin'  (requireRole("admin"))
--
-- ★ e2e/GoTrue 주의 (Supabase 에서 직접 INSERT 로 만든 계정의 공통 증상):
--   auth.users 의 토큰 컬럼(confirmation_token · recovery_token ·
--   email_change_token_new · email_change 등)은 DB 기본값이 없어, SQL 로 직접
--   INSERT 하면 NULL 로 남는다. GoTrue(Go)는 이 컬럼들을 string 으로 스캔하므로
--   NULL 이면 signInWithPassword 가 'converting NULL to string is unsupported'
--   로 실패한다 → 로그인·세션 갱신 불가 → **e2e 검증에 사용 불가**.
--   (Dashboard "Add user"/GoTrue API 로 만든 계정은 이 값들이 '' 라 정상.)
--   → §A 는 생성 시 이 컬럼들을 '' 로 명시하고, §C 는 이미 만들어진 계정을
--     NULL → '' 로 보정한다(멱등).
--
-- ⚠️ 보안 원칙: **비밀번호 평문을 이 파일(=git)에 절대 기록하지 않는다.**
--   - auth 사용자 생성(비밀번호 지정)은 리포지토리 밖에서 처리한다:
--       (a) Supabase Dashboard → Authentication → Add user
--           (email = hello@byite.co.kr, "Auto Confirm User" 체크), 또는
--       (b) 아래 §A 템플릿을 SQL Editor 에서 <<PASSWORD>> 를 실제 값으로
--           **직접 치환**해 1회 실행(붙여넣은 SQL 은 저장·커밋하지 않는다).
--   - 그 뒤 §B(멱등 승격)를 실행하면 해당 이메일 계정이 admin 이 된다.
--   본 배포 대상 스테이징에는 이미 (b) 경로로 계정을 프로비저닝했고,
--   이 파일의 §B 는 DB 재구축·타 환경 복제 시 role=admin 을 보장하는 안전망이다.
--
-- 119(users.role 권한상승 가드)와의 관계:
--   §B 의 UPDATE 는 Supabase SQL Editor(=JWT 없는 직접 DB 세션)에서 실행하므로
--   가드의 허용 분기(2) 에 해당해 통과한다. API/authenticated 세션에서는 차단된다.
-- 사전 조건: 001(public.users, handle_new_auth_user 트리거), 119(role 가드).
-- 검증 쿼리: 파일 하단 §V.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- §A. (참고·선택) auth 사용자 신규 생성 템플릿 — SQL Editor 에서만, 수동 실행
-- -----------------------------------------------------------------------------
-- ※ 이 블록은 기본 주석 처리. 사용할 때만 주석을 풀고 <<PASSWORD>> 를 실제
--   비밀번호로 바꾼 뒤 실행한다. 실행 후에는 붙여넣은 내용을 저장하지 말 것.
--   Dashboard "Add user" 로 만들었다면 이 블록은 건너뛴다.
-- pgcrypto 는 extensions 스키마에 설치되어 있다(extensions.crypt / gen_salt).
/*
do $$
declare
  v_id       uuid := gen_random_uuid();
  v_email    text := 'hello@byite.co.kr';
  v_password text := '<<PASSWORD>>';   -- ← 실행 직전 치환. 커밋 금지.
begin
  if exists (select 1 from auth.users where lower(email) = lower(v_email)) then
    raise notice 'auth user already exists for %, skip create', v_email;
    return;
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, is_sso_user, is_anonymous,
    -- ★ 아래 토큰 컬럼은 DB 기본값이 없어 미지정 시 NULL → GoTrue 로그인 실패.
    --   실제 GoTrue 생성 계정과 동일하게 '' 로 명시한다(헤더 ★ 참고).
    confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated',
    v_email, extensions.crypt(v_password, extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('app_role', 'admin', 'email_verified', true, 'full_name', '쌤버십 운영자'),
    now(), now(), false, false,
    '', '', '', '',
    '', '', '', ''
  );

  -- 이메일/비밀번호 provider identity (GoTrue 로그인에 필요)
  insert into auth.identities (
    provider_id, user_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  ) values (
    v_id::text, v_id,
    jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true),
    'email', now(), now(), now()
  );
  -- handle_new_auth_user 트리거가 app_role='admin' 으로 public.users 를 생성한다.
end $$;
*/


-- -----------------------------------------------------------------------------
-- §B. 대상 이메일을 admin 으로 승격 (멱등·존재 가드). 비밀번호와 무관 → 커밋 안전.
-- -----------------------------------------------------------------------------
-- auth 사용자는 존재하지만(§A 또는 Dashboard) public.users.role 이 아직 admin
-- 이 아닌 경우(예: Dashboard 생성 시 트리거 기본값 'student')를 보정한다.
do $$
declare
  v_email text := 'hello@byite.co.kr';
  v_id    uuid;
  v_role  text;
begin
  select u.id, pu.role
    into v_id, v_role
    from auth.users u
    left join public.users pu on pu.id = u.id
   where lower(u.email) = lower(v_email);

  if v_id is null then
    raise notice 'SKIP: auth user 가 아직 없음(%). 먼저 §A 또는 Dashboard 로 생성하라.', v_email;
    return;
  end if;

  -- public.users 행이 없으면(트리거 미발동 등) 최소 행을 생성
  if v_role is null then
    insert into public.users (id, role, status, full_name, email, updated_at)
    values (v_id, 'admin', 'active', '쌤버십 운영자', v_email, now())
    on conflict (id) do update set role = 'admin', updated_at = now();
    raise notice 'public.users 생성+admin 승격 %', v_id;
  elsif v_role is distinct from 'admin' then
    update public.users set role = 'admin', updated_at = now() where id = v_id;
    raise notice 'admin 승격(% -> admin) %', v_role, v_id;
  else
    raise notice '이미 admin, 변경 없음 %', v_id;
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- §C. auth 토큰 컬럼 NULL → '' 정규화 (직접 생성 계정 e2e 로그인 복구). 멱등.
-- -----------------------------------------------------------------------------
-- §A 이전에 SQL 로 직접 INSERT 한 계정(예: e2e 관리자)은 토큰 컬럼이 NULL 이라
-- GoTrue signInWithPassword 가 실패한다(헤더 ★). 아래는 NULL 을 '' 로 보정한다.
--   · 값이 이미 ''/정상인 계정은 WHERE 절에서 걸러져 영향 없음(비용 0 수렴).
--   · auth.users 에는 AFTER INSERT 트리거만 있어 UPDATE 부작용 없음.
--   · 비밀번호·이메일·인증상태·identity 는 건드리지 않는다(토큰 컬럼만).
update auth.users
set confirmation_token         = coalesce(confirmation_token, ''),
    recovery_token             = coalesce(recovery_token, ''),
    email_change_token_new     = coalesce(email_change_token_new, ''),
    email_change               = coalesce(email_change, ''),
    email_change_token_current = coalesce(email_change_token_current, ''),
    phone_change               = coalesce(phone_change, ''),
    phone_change_token         = coalesce(phone_change_token, ''),
    reauthentication_token     = coalesce(reauthentication_token, ''),
    updated_at                 = now()
where confirmation_token is null
   or recovery_token is null
   or email_change_token_new is null
   or email_change is null
   or email_change_token_current is null
   or phone_change is null
   or phone_change_token is null
   or reauthentication_token is null;


-- =============================================================================
-- §V. 적용 직후 검증 (Supabase SQL Editor 에서 수동 실행)
-- =============================================================================
-- 기대: 1행, email_confirmed=t, pw 확인은 §V-b, public_role='admin', identity_rows=1
--
-- §V-a. 계정 상태:
--   select u.id, u.email,
--          (u.email_confirmed_at is not null) as email_confirmed,
--          pu.role as public_role, pu.status,
--          (select count(*) from auth.identities i where i.user_id = u.id) as identity_rows
--     from auth.users u
--     left join public.users pu on pu.id = u.id
--    where lower(u.email) = lower('hello@byite.co.kr');
--
-- §V-b. (선택) 비밀번호 검증 — <<PASSWORD>> 를 실제 값으로 치환해 t 확인:
--   select (encrypted_password = extensions.crypt('<<PASSWORD>>', encrypted_password)) as pw_valid
--     from auth.users where lower(email) = lower('hello@byite.co.kr');
--
-- §V-c. 전체 관리자 목록:
--   select id, email, role, status, created_at
--     from public.users where role = 'admin' order by created_at;
--
-- §V-d. 토큰 정규화 확인 — NULL 토큰 계정 0건 기대(전 계정 e2e 로그인 가능):
--   select count(*) as remaining_null_token_accounts
--     from auth.users
--    where confirmation_token is null or recovery_token is null
--       or email_change_token_new is null or email_change is null
--       or email_change_token_current is null or phone_change is null
--       or phone_change_token is null or reauthentication_token is null;
-- =============================================================================
