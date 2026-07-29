-- =============================================================================
-- scripts/verify/s2_2_batch_a_verify.sql
-- S2-2 Batch A (M0 mentor_profile_privileged_column_guard ·
--               M15 weekly_usage_pair_party_guard) 반복 검증 스크립트
-- =============================================================================
-- 실행 전제:
--   * 격리 로컬 Supabase 스택(PG17)에 baseline 175 + M0 + M15 forward 가 적용된 상태.
--   * 운영·staging DB 오실행 방지 — 아래 local-only 가드를 통과해야만 fixture DML 시작.
--     러너가 같은 세션에서 먼저 다음을 실행해야 한다:
--       set s2_verify.allow_local = 'on';
--     (예: psql -c "set s2_verify.allow_local='on'" -f scripts/verify/s2_2_batch_a_verify.sql)
--   * 모든 fixture DML 은 단일 트랜잭션 안에서 수행하고 마지막에 rollback 한다.
--     실사용 데이터 규모(auth.users > 50행)가 감지되면 허용 변수가 있어도 중단한다.
-- 판정:
--   * 각 테스트는 s2_results 임시 테이블에 PASS/FAIL 로 기록되고 말미에 표로 출력된다.
--   * FAIL 이 1건이라도 있으면 S2_BATCH_A_VERIFY_FAILED 예외로 종료(트랜잭션 abort —
--     fixture 는 어느 경로로든 남지 않는다).
-- 근거 계약: api_web_v1_contract_v1_1.md §20.5(M0) · §7 F1(M15) · §21 T-PERM/T-SEC 상당.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 0. local-only 가드 (fixture DML 시작 전 — 명시적 허용 변수 + 데이터 규모 방어)
-- -----------------------------------------------------------------------------
do $$
declare
  v_allow text := current_setting('s2_verify.allow_local', true);
  v_users bigint;
begin
  if v_allow is distinct from 'on' then
    raise exception 'S2_VERIFY_LOCAL_GUARD: s2_verify.allow_local=on 이 설정되지 않았다. 이 스크립트는 격리 로컬 스택 전용이며 운영·staging 에서 실행을 금지한다.'
      using errcode = '42501';
  end if;
  select count(*) into v_users from auth.users;
  if v_users > 50 then
    raise exception 'S2_VERIFY_LOCAL_GUARD: auth.users % 행 — 실사용 규모 데이터가 감지되어 중단한다(로컬 clean-install 이 아님).', v_users
      using errcode = '42501';
  end if;
end $$;

create temporary table s2_results (
  seq     serial primary key,
  grp     text not null,
  test    text not null,
  pass    boolean not null,
  detail  text
);

create temporary table s2_fx (k text primary key, v uuid not null);

-- -----------------------------------------------------------------------------
-- 1. 카탈로그 assertion — M0 객체·속성 / M15 함수 identity·ACL
-- -----------------------------------------------------------------------------
do $$
declare
  v_cnt int;
  v_def text;
  v_acl text;
  v_row record;
begin
  -- M0-C1: 가드 함수 존재 + SECURITY DEFINER + 고정 search_path=''
  select count(*) into v_cnt
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'enforce_mentor_profile_privileged_guard'
     and p.prosecdef and p.proconfig::text like '%search_path=%';
  insert into s2_results(grp,test,pass,detail) values
    ('M0','C1 guard fn exists + SECDEF + pinned search_path', v_cnt = 1, 'matched='||v_cnt);

  -- M0-C2: 트리거 2종 존재 + WHEN 조건이 IS DISTINCT FROM 기반(계약 §20.5)
  select count(*) into v_cnt from pg_trigger
   where tgrelid = 'public.mentor_profiles'::regclass
     and tgname in ('trg_mentor_profile_privileged_guard_upd','trg_mentor_profile_privileged_guard_ins');
  insert into s2_results(grp,test,pass,detail) values
    ('M0','C2 triggers upd+ins exist', v_cnt = 2, 'count='||v_cnt);

  select pg_get_triggerdef(oid) into v_def from pg_trigger
   where tgrelid = 'public.mentor_profiles'::regclass and tgname = 'trg_mentor_profile_privileged_guard_upd';
  insert into s2_results(grp,test,pass,detail) values
    ('M0','C3 upd trigger BEFORE UPDATE + IS DISTINCT FROM WHEN',
     v_def like '%BEFORE UPDATE%' and v_def like '%IS DISTINCT FROM%' and v_def not like '%<>%',
     left(v_def, 160));

  select pg_get_triggerdef(oid) into v_def from pg_trigger
   where tgrelid = 'public.mentor_profiles'::regclass and tgname = 'trg_mentor_profile_privileged_guard_ins';
  insert into s2_results(grp,test,pass,detail) values
    ('M0','C4 ins trigger BEFORE INSERT + pending/28 default-compare WHEN',
     v_def like '%BEFORE INSERT%' and v_def like '%IS DISTINCT FROM%'
       and v_def like '%pending%' and v_def like '%28%' and v_def not like '%IS NOT NULL%',
     left(v_def, 160));

  -- M0-10: 트리거 함수 PUBLIC/anon/authenticated EXECUTE 부재
  select p.proacl::text into v_acl
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'enforce_mentor_profile_privileged_guard';
  insert into s2_results(grp,test,pass,detail) values
    ('M0','T10 guard fn PUBLIC EXECUTE absent',
     not has_function_privilege('anon','public.enforce_mentor_profile_privileged_guard()','EXECUTE')
     and not has_function_privilege('authenticated','public.enforce_mentor_profile_privileged_guard()','EXECUTE')
     and (v_acl is null or v_acl not like '%{=X%' and v_acl not like '%,=X%'),
     'proacl='||coalesce(v_acl,'(null)'));

  -- M0-C5: mentor_profiles 기존 트리거 3종 보존(기준선과 동일 집합 + M0 2종)
  select count(*) into v_cnt from pg_trigger
   where tgrelid = 'public.mentor_profiles'::regclass and not tgisinternal;
  insert into s2_results(grp,test,pass,detail) values
    ('M0','C5 mentor_profiles trigger set = 기존3 + M0 2', v_cnt = 5, 'count='||v_cnt);

  -- M15-C1: 함수 identity 불변(signature/return/volatility/SECDEF/search_path/owner)
  select p.oid::regprocedure::text as ident,
         pg_get_function_result(p.oid) as res,
         p.provolatile, p.prosecdef, p.proconfig::text as cfg,
         pg_get_userbyid(p.proowner) as owner,
         p.proacl::text as acl,
         p.prosrc as src
    into v_row
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'get_weekly_question_usage';
  insert into s2_results(grp,test,pass,detail) values
    ('M15','C1 identity: signature/json/volatile/SECDEF/search_path=public/owner postgres',
     v_row.ident = 'get_weekly_question_usage(uuid,uuid)'
       and v_row.res = 'json' and v_row.provolatile = 'v' and v_row.prosecdef
       and v_row.cfg = '{search_path=public}' and v_row.owner = 'postgres',
     v_row.ident||' / '||v_row.res||' / '||v_row.provolatile::text||' / secdef='||v_row.prosecdef||' / '||v_row.cfg||' / '||v_row.owner);

  -- M15-T9: ACL 이 forward 전 기준선과 완전 동일 (baseline 실측값 고정 대조)
  insert into s2_results(grp,test,pass,detail) values
    ('M15','T9 ACL identical to pre-M15 baseline',
     v_row.acl = '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}',
     'proacl='||coalesce(v_row.acl,'(null)'));

  -- M15-T10: anon EXECUTE 상태 완전 동일(기준선 false — M15 미회수·미부여)
  insert into s2_results(grp,test,pass,detail) values
    ('M15','T10 anon EXECUTE unchanged (baseline=false)',
     not has_function_privilege('anon','public.get_weekly_question_usage(uuid,uuid)','EXECUTE')
     and has_function_privilege('authenticated','public.get_weekly_question_usage(uuid,uuid)','EXECUTE')
     and has_function_privilege('service_role','public.get_weekly_question_usage(uuid,uuid)','EXECUTE'),
     'anon=false auth=true service=true 기대');

  -- M15-C2: 가드 존재 + IS DISTINCT FROM 만 사용(IN/NOT IN/<> 대체 금지)
  insert into s2_results(grp,test,pass,detail) values
    ('M15','C2 guard present, IS DISTINCT FROM only',
     v_row.src like '%NOT_PAIR_PARTY%' and v_row.src like '%IS DISTINCT FROM%'
       and v_row.src not like '%NOT IN (%' and v_row.src not like '%<>%',
     'prosrc guard scan');
end $$;

-- -----------------------------------------------------------------------------
-- 2. fixture 생성 (JWT 없는 postgres 세션 — 전부 이 트랜잭션 안, 말미 rollback)
--    사용자 4: 멘토 M1·M2(가입 트리거로 mentor_profiles 자동 생성) / 학생 S1 / 제3자 T1
--    관리자 A1: 학생 가입 후 JWT-less UPDATE 로 role='admin' (trg_users_role_guard 2분기)
-- -----------------------------------------------------------------------------
-- 라이브(AS-IS) client role DML 권한 재현 — XW-02 실측: authenticated 의
-- mentor_profiles 전 컬럼 UPDATE·INSERT GRANT 실재(계약 §3.6). 로컬 clean-install
-- (CLI 2.110.0)은 신규 auto-expose 기본값으로 client role DML grant 가 없어 라이브와
-- 다르므로, 트리거 가드 행위 검증에 필요한 최소 grant 를 이 트랜잭션 안에서만 재현한다
-- (말미 rollback 으로 전부 소멸 — 영구 GRANT 변경 0).
grant select, insert, update on public.mentor_profiles to authenticated;
grant select, insert, update, delete on public.mentor_profiles to service_role;
grant select, insert, update on public.question_threads to authenticated;
grant select on public.mentor_student_rooms to authenticated;
grant select on public.subscriptions to authenticated;
grant select, insert, update on public.free_question_usage to authenticated;
grant select on public.refunds to authenticated;
grant select on public.users to authenticated;

do $$
declare
  v_m1 uuid := gen_random_uuid();
  v_m2 uuid := gen_random_uuid();
  v_s1 uuid := gen_random_uuid();
  v_t1 uuid := gen_random_uuid();
  v_a1 uuid := gen_random_uuid();
  v_sub uuid;
  v_room uuid;
begin
  insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data, aud, role, created_at, updated_at)
  values
    (v_m1, 's2a-m1@example.invalid', '{"app_role":"mentor","nickname":"s2a-m1"}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated', now(), now()),
    (v_m2, 's2a-m2@example.invalid', '{"app_role":"mentor","nickname":"s2a-m2"}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated', now(), now()),
    (v_s1, 's2a-s1@example.invalid', '{"app_role":"student","nickname":"s2a-s1"}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated', now(), now()),
    (v_t1, 's2a-t1@example.invalid', '{"app_role":"student","nickname":"s2a-t1"}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated', now(), now()),
    (v_a1, 's2a-a1@example.invalid', '{"app_role":"student","nickname":"s2a-a1"}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated', now(), now());

  -- 가입 트리거 산출 확인: 멘토 2명은 mentor_profiles(pending·cap 28) 자동 생성돼야 한다
  if (select count(*) from public.mentor_profiles
       where user_id in (v_m1, v_m2) and verification_status = 'pending' and cap_limit = 28) <> 2 then
    raise exception 'S2_FIXTURE_SETUP_FAILED: signup trigger did not create pending/28 mentor_profiles';
  end if;

  -- 관리자 승격(JWT 없는 세션 — users role 가드 2분기 통과 = 기존 계약 동작 재확인)
  update public.users set role = 'admin' where id = v_a1;

  -- 구독(S1-M1, standard, 3일 경과 anchor) + 질문방 + pending 스레드 2건
  insert into public.subscriptions (student_id, mentor_id, plan_tier, status, started_at)
  values (v_s1, v_m1, 'standard', 'active', now() - interval '3 days')
  returning id into v_sub;

  insert into public.mentor_student_rooms (student_id, mentor_id, subscription_id)
  values (v_s1, v_m1, v_sub)
  returning id into v_room;

  insert into public.question_threads (mentor_student_room_id, title, status)
  values (v_room, 's2a fixture thread 1', 'pending'),
         (v_room, 's2a fixture thread 2', 'pending');

  insert into s2_fx values
    ('m1', v_m1), ('m2', v_m2), ('s1', v_s1), ('t1', v_t1), ('a1', v_a1),
    ('sub', v_sub), ('room', v_room);
end $$;

-- -----------------------------------------------------------------------------
-- 3. M0 동작 테스트 (필수 12종 중 행위 테스트 — 카탈로그분은 §1)
-- -----------------------------------------------------------------------------
do $$
declare
  v_m1  uuid := (select v from s2_fx where k = 'm1');
  v_m2  uuid := (select v from s2_fx where k = 'm2');
  v_s1  uuid := (select v from s2_fx where k = 's1');
  v_a1  uuid := (select v from s2_fx where k = 'a1');
  v_ok  boolean;
  v_det text;
  v_cnt int;
  v_msv uuid;
begin
  -- T2: 멘토 본인 비민감 필드 UPDATE 성공(가드 미발화)
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_m1, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    update public.mentor_profiles set intro_line = 's2a non-sensitive edit' where user_id = v_m1;
    execute 'reset role';
    v_ok := found; v_det := 'updated=' || found;
  exception when others then
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true);
  insert into s2_results(grp,test,pass,detail) values ('M0','T2 mentor self non-sensitive UPDATE ok', v_ok, v_det);

  -- T3: 멘토 본인 verification_status 변경 → 42501 MENTOR_PROFILE_PRIVILEGED_COLUMN_FORBIDDEN
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_m1, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    update public.mentor_profiles set verification_status = 'approved' where user_id = v_m1;
    execute 'reset role';
    v_ok := false; v_det := 'no exception (blocked expected)';
  exception when others then
    v_ok := (sqlstate = '42501' and sqlerrm = 'MENTOR_PROFILE_PRIVILEGED_COLUMN_FORBIDDEN');
    v_det := sqlstate || ' ' || sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true);
  insert into s2_results(grp,test,pass,detail) values ('M0','T3 mentor self verification_status -> 42501', v_ok, v_det);

  -- T4: 멘토 본인 cap_limit 변경 → 42501
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_m1, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    update public.mentor_profiles set cap_limit = 999 where user_id = v_m1;
    execute 'reset role';
    v_ok := false; v_det := 'no exception (blocked expected)';
  exception when others then
    v_ok := (sqlstate = '42501' and sqlerrm = 'MENTOR_PROFILE_PRIVILEGED_COLUMN_FORBIDDEN');
    v_det := sqlstate || ' ' || sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true);
  insert into s2_results(grp,test,pass,detail) values ('M0','T4 mentor self cap_limit -> 42501', v_ok, v_det);

  -- T5: 학생(비관리자) 세션의 approved INSERT → 42501 (XW-02 (나) 경로)
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_s1, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    insert into public.mentor_profiles (user_id, university_name, department_name, teaching_subjects, high_school_name, verification_status)
    values (v_s1, 'x', 'x', '{}', 'x', 'approved');
    execute 'reset role';
    v_ok := false; v_det := 'no exception (blocked expected)';
  exception when others then
    v_ok := (sqlstate = '42501' and sqlerrm = 'MENTOR_PROFILE_PRIVILEGED_COLUMN_FORBIDDEN');
    v_det := sqlstate || ' ' || sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true);
  insert into s2_results(grp,test,pass,detail) values ('M0','T5 student approved INSERT -> 42501', v_ok, v_det);

  -- T6: 학생(비관리자) 세션의 비기본 cap INSERT → 42501
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_s1, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    insert into public.mentor_profiles (user_id, university_name, department_name, teaching_subjects, high_school_name, cap_limit)
    values (v_s1, 'x', 'x', '{}', 'x', 999);
    execute 'reset role';
    v_ok := false; v_det := 'no exception (blocked expected)';
  exception when others then
    v_ok := (sqlstate = '42501' and sqlerrm = 'MENTOR_PROFILE_PRIVILEGED_COLUMN_FORBIDDEN');
    v_det := sqlstate || ' ' || sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true);
  insert into s2_results(grp,test,pass,detail) values ('M0','T6 student non-default cap INSERT -> 42501', v_ok, v_det);

  -- T1: 기본 pending·cap 28 INSERT 성공(가드 미발화 — 학생 본인 행, RLS mentor_insert_own)
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_s1, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    insert into public.mentor_profiles (user_id, university_name, department_name, teaching_subjects, high_school_name)
    values (v_s1, 'x', 'x', '{}', 'x');
    execute 'reset role';
    v_ok := true; v_det := 'inserted with defaults';
  exception when others then
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true);
  insert into s2_results(grp,test,pass,detail) values ('M0','T1 default pending/28 INSERT ok', v_ok, v_det);

  -- T7: admin authenticated 세션 변경 성공(3분기 — 트리거 관점 직접 검증)
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_a1, 'role', 'authenticated')::text, true);
    update public.mentor_profiles set cap_limit = 30 where user_id = v_m1;
    v_ok := found; v_det := 'admin-claims cap change applied=' || found;
  exception when others then
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true);
  insert into s2_results(grp,test,pass,detail) values ('M0','T7 admin(authenticated) change ok', v_ok, v_det);

  -- T8: service_role 변경 성공 + trg_mp_seed_default_plans 정상 발화(T12a)
  begin
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    execute 'set local role service_role';
    update public.mentor_profiles set verification_status = 'approved' where user_id = v_m1;
    execute 'reset role';
    v_ok := found; v_det := 'service_role approve applied=' || found;
  exception when others then
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true);
  insert into s2_results(grp,test,pass,detail) values ('M0','T8 service_role change ok', v_ok, v_det);

  select count(*) into v_cnt from public.mentor_plans where mentor_id = v_m1;
  insert into s2_results(grp,test,pass,detail) values
    ('M0','T12a trg_mp_seed_default_plans fired on approval (3 plans)', v_cnt = 3, 'plans=' || v_cnt);

  -- T9: JWT 없는 migration/SQL 세션 변경 성공(2분기)
  begin
    perform set_config('request.jwt.claims', '', true);
    update public.mentor_profiles set cap_limit = 42 where user_id = v_m1;
    v_ok := found; v_det := 'jwt-less cap change applied=' || found;
  exception when others then
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  insert into s2_results(grp,test,pass,detail) values ('M0','T9 JWT-less session change ok', v_ok, v_det);

  -- T11: 기존 관리자 승인 RPC(approve_mentor_school_verification_admin) 경로 회귀 없음
  --      (이 RPC 는 mentor_school_verifications 만 갱신한다 — 실측 본문 기준.
  --       M0 트리거 대상 테이블이 아니므로 "RPC 가 여전히 정상 승인되는가"로 판정)
  begin
    insert into storage.objects (bucket_id, name, owner_id)
    values ('student-id-images', v_m2 || '/s2a-doc.png', v_m2::text);
    insert into public.mentor_school_verifications (mentor_id, status, document_storage_ref)
    values (v_m2, 'pending', v_m2 || '/s2a-doc.png')
    returning id into v_msv;

    perform set_config('request.jwt.claims', json_build_object('sub', v_a1, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    perform public.approve_mentor_school_verification_admin(v_msv, 's2a대학', 's2a-univ-id', 's2a학과', '기타', '미분류');
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);

    select count(*) into v_cnt from public.mentor_school_verifications
     where id = v_msv and status = 'approved';
    v_ok := (v_cnt = 1); v_det := 'msv approved rows=' || v_cnt;
  exception when others then
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true);
  insert into s2_results(grp,test,pass,detail) values ('M0','T11 admin approval RPC path intact', v_ok, v_det);

  -- T12b: admin 분기(3분기)로 mentor_profiles 승인 → trg_mp_seed_default_plans 발화
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_a1, 'role', 'authenticated')::text, true);
    update public.mentor_profiles set verification_status = 'approved' where user_id = v_m2;
    v_ok := found; v_det := 'admin-claims approve applied=' || found;
  exception when others then
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true);
  insert into s2_results(grp,test,pass,detail) values ('M0','T12b admin(3분기) mentor approval ok', v_ok, v_det);

  select count(*) into v_cnt from public.mentor_plans where mentor_id = v_m2;
  insert into s2_results(grp,test,pass,detail) values
    ('M0','T12c seed plans after admin approval (3 plans)', v_cnt = 3, 'plans=' || v_cnt);
end $$;

-- -----------------------------------------------------------------------------
-- 4. M15 동작 테스트 (필수 10종 중 행위 테스트 — 카탈로그분은 §1)
-- -----------------------------------------------------------------------------
do $$
declare
  v_m1  uuid := (select v from s2_fx where k = 'm1');
  v_m2  uuid := (select v from s2_fx where k = 'm2');
  v_s1  uuid := (select v from s2_fx where k = 's1');
  v_t1  uuid := (select v from s2_fx where k = 't1');
  v_room uuid := (select v from s2_fx where k = 'room');
  v_sub  uuid := (select v from s2_fx where k = 'sub');
  v_anchor timestamptz := (select started_at from public.subscriptions where id = (select v from s2_fx where k='sub'));
  v_ok  boolean;
  v_det text;
  v_json json;
  v_keys text;
  v_cnt int;
begin
  -- T1: 학생 본인 호출 성공 + T7 의미 불변(used/limit/rolling window)
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_s1, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select public.get_weekly_question_usage(v_s1, v_m1) into v_json;
    execute 'reset role';
    v_ok := true; v_det := v_json::text;
  exception when others then
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true);
  insert into s2_results(grp,test,pass,detail) values ('M15','T1 student self call ok', v_ok, left(v_det,200));

  if v_ok then
    select string_agg(k, ',' order by k) into v_keys from json_object_keys(v_json) k;
    insert into s2_results(grp,test,pass,detail) values
      ('M15','T7a return keys unchanged',
       v_keys = 'can_ask,limit,plan_tier,remaining,used,week_end,week_start', v_keys);
    insert into s2_results(grp,test,pass,detail) values
      ('M15','T7b standard limit 9 / used 2 / remaining 7 / can_ask true',
       (v_json->>'limit')::int = 9 and (v_json->>'used')::int = 2
         and (v_json->>'remaining')::int = 7 and (v_json->>'can_ask')::boolean
         and v_json->>'plan_tier' = 'standard',
       v_det);
    insert into s2_results(grp,test,pass,detail) values
      ('M15','T7c 7-day rolling window anchored to started_at',
       (v_json->>'week_start')::timestamptz = v_anchor
         and (v_json->>'week_end')::timestamptz = v_anchor + interval '7 days',
       'anchor='||v_anchor);
  end if;

  -- T2: 멘토 당사자 호출 성공(웹 멘토 질문방 경로)
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_m1, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select public.get_weekly_question_usage(v_s1, v_m1) into v_json;
    execute 'reset role';
    v_ok := ((v_json->>'used')::int = 2); v_det := v_json::text;
  exception when others then
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true);
  insert into s2_results(grp,test,pass,detail) values ('M15','T2 mentor party call ok', v_ok, left(v_det,200));

  -- T3: service_role 호출 성공(서버 경로)
  begin
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    execute 'set local role service_role';
    select public.get_weekly_question_usage(v_s1, v_m1) into v_json;
    execute 'reset role';
    v_ok := ((v_json->>'used')::int = 2); v_det := v_json::text;
  exception when others then
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true);
  insert into s2_results(grp,test,pass,detail) values ('M15','T3 service_role call ok', v_ok, left(v_det,200));

  -- T4: authenticated 제3자 → NOT_PAIR_PARTY 42501
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_t1, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select public.get_weekly_question_usage(v_s1, v_m1) into v_json;
    execute 'reset role';
    v_ok := false; v_det := 'no exception (rejected expected): ' || v_json::text;
  exception when others then
    v_ok := (sqlstate = '42501' and sqlerrm = 'NOT_PAIR_PARTY');
    v_det := sqlstate || ' ' || sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true);
  insert into s2_results(grp,test,pass,detail) values ('M15','T4 third party -> NOT_PAIR_PARTY 42501', v_ok, v_det);

  -- T5: anon 상당(JWT role=anon·sub 없음) → NOT_PAIR_PARTY 42501 (가드 의미 검증)
  --     ※ 로컬 baseline 은 anon EXECUTE=false(기준선 실측·불변 — T10)라 직접 role 전환
  --       호출이 불가하므로 anon claims 로 가드 분기를 검증한다. 라이브의 anon EXECUTE
  --       허용 상태에서도 동일 분기로 거부된다.
  begin
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    select public.get_weekly_question_usage(v_s1, v_m1) into v_json;
    v_ok := false; v_det := 'no exception (rejected expected)';
  exception when others then
    v_ok := (sqlstate = '42501' and sqlerrm = 'NOT_PAIR_PARTY');
    v_det := sqlstate || ' ' || sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true);
  insert into s2_results(grp,test,pass,detail) values ('M15','T5 anon claims -> NOT_PAIR_PARTY 42501', v_ok, v_det);

  -- T6: NULL 조합 우회 0건
  --  (a) anon + (NULL,NULL): 가드 비발화(NULL IS DISTINCT FROM NULL = false)
  --      → 기존 required 예외(P0001)로 종결. 데이터 반환 없음 = 우회 아님(기존 의미 보존).
  begin
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    select public.get_weekly_question_usage(null, null) into v_json;
    v_ok := false; v_det := 'no exception (data returned = bypass!)';
  exception when others then
    v_ok := (sqlerrm = 'p_student_id and p_mentor_id are required');
    v_det := sqlstate || ' ' || sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true);
  insert into s2_results(grp,test,pass,detail) values ('M15','T6a anon+(NULL,NULL) -> legacy required (no data)', v_ok, v_det);

  --  (b) 제3자 + (NULL, mentor): NOT_PAIR_PARTY
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_t1, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select public.get_weekly_question_usage(null, v_m1) into v_json;
    execute 'reset role';
    v_ok := false; v_det := 'no exception (rejected expected)';
  exception when others then
    v_ok := (sqlstate = '42501' and sqlerrm = 'NOT_PAIR_PARTY');
    v_det := sqlstate || ' ' || sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true);
  insert into s2_results(grp,test,pass,detail) values ('M15','T6b third+(NULL,mentor) -> NOT_PAIR_PARTY', v_ok, v_det);

  --  (c) 학생 본인 + (본인,NULL): 가드 통과(당사자) 후 기존 required 예외 — 의미 불변
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_s1, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select public.get_weekly_question_usage(v_s1, null) into v_json;
    execute 'reset role';
    v_ok := false; v_det := 'no exception (data returned = bypass!)';
  exception when others then
    v_ok := (sqlerrm = 'p_student_id and p_mentor_id are required');
    v_det := sqlstate || ' ' || sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true);
  insert into s2_results(grp,test,pass,detail) values ('M15','T6c party+(self,NULL) -> legacy required (no data)', v_ok, v_det);

  -- T7d: 무구독 pair 의미 불변(limit 0·used 0·can_ask false)
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_s1, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select public.get_weekly_question_usage(v_s1, v_m2) into v_json;
    execute 'reset role';
    v_ok := ((v_json->>'limit')::int = 0 and (v_json->>'used')::int = 0
             and not (v_json->>'can_ask')::boolean and (v_json->>'plan_tier') is null);
    v_det := v_json::text;
  exception when others then
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true);
  insert into s2_results(grp,test,pass,detail) values ('M15','T7d no-subscription pair semantics unchanged', v_ok, left(v_det,200));

  -- T8a: 기존 호출 경로 — qna_create_question_thread(학생 본인, 구독 경로) 유지
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_s1, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select public.qna_create_question_thread(v_room, 's2a rpc thread', null, null, 's2a first message') into v_json;
    execute 'reset role';
    v_ok := coalesce((v_json->>'ok')::boolean, false);
    v_det := left(v_json::text, 200);
  exception when others then
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true);
  insert into s2_results(grp,test,pass,detail) values ('M15','T8a qna_create_question_thread path intact', v_ok, v_det);

  -- T8b: 기존 호출 경로 — qt_direct_write_guard(학생 본인 직접 INSERT) 유지
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_s1, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    insert into public.question_threads (mentor_student_room_id, title, status)
    values (v_room, 's2a direct thread', 'pending');
    execute 'reset role';
    v_ok := true; v_det := 'direct insert ok';
  exception when others then
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true);
  insert into s2_results(grp,test,pass,detail) values ('M15','T8b qt_direct_write_guard path intact', v_ok, v_det);

  -- T8c: 경로 정합 — 위 2건 생성 후 used 가 4 로 집계(계산부 불변 재확인)
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_s1, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select public.get_weekly_question_usage(v_s1, v_m1) into v_json;
    execute 'reset role';
    v_ok := ((v_json->>'used')::int = 4); v_det := v_json::text;
  exception when others then
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true);
  insert into s2_results(grp,test,pass,detail) values ('M15','T8c usage counts new threads (used=4)', v_ok, left(v_det,200));
end $$;

-- -----------------------------------------------------------------------------
-- 5. 결과 보고 + 게이트 (FAIL ≥1 → 예외로 전체 rollback)
-- -----------------------------------------------------------------------------
select grp, test, case when pass then 'PASS' else 'FAIL' end as result, detail
  from s2_results order by seq;

select count(*) filter (where pass) || '/' || count(*) as passed from s2_results;

do $$
declare
  v_fail int;
  v_list text;
begin
  select count(*), string_agg(grp || ':' || test, ' | ') filter (where not pass)
    into v_fail, v_list
    from s2_results where not pass;
  if v_fail > 0 then
    raise exception 'S2_BATCH_A_VERIFY_FAILED: % failing test(s) — %', v_fail, v_list;
  end if;
  raise notice 'S2_BATCH_A_VERIFY: ALL PASS';
end $$;

-- 모든 fixture DML 은 여기서 파기된다(잔여 0 보증).
rollback;

-- -----------------------------------------------------------------------------
-- 6. rollback 후 fixture 잔여 0 확인 (새 트랜잭션 밖 일반 조회)
-- -----------------------------------------------------------------------------
do $$
declare
  v_cnt bigint;
begin
  select count(*) into v_cnt from auth.users where email like 's2a-%@example.invalid';
  if v_cnt > 0 then
    raise exception 'S2_FIXTURE_RESIDUE: auth.users % rows remain', v_cnt;
  end if;
  select count(*) into v_cnt from public.users u where u.email like 's2a-%@example.invalid';
  if v_cnt > 0 then
    raise exception 'S2_FIXTURE_RESIDUE: public.users % rows remain', v_cnt;
  end if;
  raise notice 'S2_BATCH_A_VERIFY: fixture residue 0';
end $$;
