-- =============================================================================
-- scripts/verify/s2_2_batch_d_verify.sql
-- S2-2 Batch D (M17 api_app_v1_surface · M8 api_web_v1_mentor_rpc ·
--               M14 api_web_v1_payout_account_rpc) 반복 검증 스크립트
-- =============================================================================
-- 실행 전제:
--   * 격리 로컬 스택(PG17)에 clean-install 183(= 175 + Batch A·B·C) 적용 상태.
--   * 러너 선행: set s2_verify.allow_local = 'on';
--   * phase: set s2_verify.phase = 'forward' | 'post_rollback'
--   * fixture(s2d-vf-*)는 단일 트랜잭션 + 말미 rollback. auth.users > 50행 중단.
-- 판정: FAIL ≥1 → S2_BATCH_D_VERIFY_FAILED.
-- 근거: 앱 계약 §3.1~§3.4·§10 Gate 4 / 웹 계약 §7 F7·F8·F13 · §9.5 · §10.3 ·
--   §20.3 「M17 이전/적용 직후」 · §21.1 T-CON-07·08 · §21.11(M17 앱 표면 재검증).
-- =============================================================================

begin;

do $$
declare
  v_allow text := current_setting('s2_verify.allow_local', true);
  v_phase text := coalesce(nullif(current_setting('s2_verify.phase', true), ''), 'forward');
  v_users bigint;
begin
  if v_allow is distinct from 'on' then
    raise exception 'S2_VERIFY_LOCAL_GUARD: s2_verify.allow_local=on 필요 — 격리 로컬 전용' using errcode = '42501';
  end if;
  if v_phase not in ('forward', 'post_rollback') then
    raise exception 'S2_VERIFY_PHASE: forward|post_rollback (현재 %)', v_phase;
  end if;
  select count(*) into v_users from auth.users;
  if v_users > 50 then
    raise exception 'S2_VERIFY_LOCAL_GUARD: auth.users % 행 — 실사용 규모 감지', v_users using errcode = '42501';
  end if;
end $$;

create temporary table s2_results (
  seq serial primary key, grp text not null, test text not null,
  pass boolean not null, detail text
);
create temporary table s2_fx (k text primary key, v uuid not null);

-- =============================================================================
-- 1. [forward] 카탈로그 — M17 (§20.3 적용 직후 7항 + T-CON-07·08 라이브 대조)
-- =============================================================================
do $$
declare
  v_phase text := coalesce(nullif(current_setting('s2_verify.phase', true), ''), 'forward');
  v_cnt int;
  v_web text; v_app text;
begin
  if v_phase <> 'forward' then return; end if;

  -- D-01: schema + view(invoker) + wrapper 5종 identity(§3.3 원문) + census
  select count(*) into v_cnt
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'api_app_v1'
     and p.prosecdef and p.proconfig::text like '%search_path=%'
     and (p.proname, pg_get_function_identity_arguments(p.oid)) in
         (('ensure_free_question_room', 'p_mentor_id uuid'),
          ('qna_create_question_thread', 'p_room_id uuid, p_title text, p_subject text, p_topic text, p_first_message_body text'),
          ('community_post_create', 'p_title text, p_body text, p_category text, p_idempotency_key uuid, p_image_refs text[], p_status text'),
          ('community_post_update', 'p_post_id uuid, p_title text, p_body text, p_category text, p_expected_updated_at timestamp with time zone, p_image_refs text[], p_status text'),
          ('community_post_soft_delete', 'p_post_id uuid'));
  insert into s2_results(grp,test,pass,detail) values
    ('M17','01 schema+view(invoker)+wrapper 5종 identity(§3.3)',
     exists (select 1 from pg_namespace where nspname = 'api_app_v1')
     and v_cnt = 5
     and (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='api_app_v1') = 5
     and exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                  where n.nspname='api_app_v1' and c.relname='community_posts_v1'
                    and c.relkind='v' and c.reloptions::text like '%security_invoker=true%')
     and (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
           where n.nspname='api_app_v1') = 1,
     'wrappers='||v_cnt);

  -- D-02: 권한 — PUBLIC·anon 0 · authenticated 최소 · service_role 미부여(의도적 차이)
  insert into s2_results(grp,test,pass,detail) values
    ('M17','02 권한 매트릭스(authenticated 만 — service_role 미부여)',
     not has_schema_privilege('anon', 'api_app_v1', 'USAGE')
     and not has_schema_privilege('service_role', 'api_app_v1', 'USAGE')
     and has_schema_privilege('authenticated', 'api_app_v1', 'USAGE')
     and not has_table_privilege('anon', 'api_app_v1.community_posts_v1', 'SELECT')
     and has_table_privilege('authenticated', 'api_app_v1.community_posts_v1', 'SELECT')
     and not has_table_privilege('authenticated', 'api_app_v1.community_posts_v1', 'INSERT')
     and not has_table_privilege('authenticated', 'api_app_v1.community_posts_v1', 'UPDATE')
     and not has_table_privilege('authenticated', 'api_app_v1.community_posts_v1', 'DELETE')
     and (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='api_app_v1'
             and not has_function_privilege('anon', p.oid, 'EXECUTE')
             and has_function_privilege('authenticated', p.oid, 'EXECUTE')
             and not has_function_privilege('service_role', p.oid, 'EXECUTE')
             and (p.proacl is null or (p.proacl::text not like '{=%' and p.proacl::text not like '%,=%'))) = 5,
     null);

  -- D-03: core_private 복제 0 + T-CON-07(웹 V1 = 앱 view 컬럼 집합 — 라이브 대조)
  select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ', ' order by a.attnum)
    into v_web from pg_attribute a
   where a.attrelid = 'api_web_v1.community_posts_v1'::regclass and a.attnum > 0 and not a.attisdropped;
  select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ', ' order by a.attnum)
    into v_app from pg_attribute a
   where a.attrelid = 'api_app_v1.community_posts_v1'::regclass and a.attnum > 0 and not a.attisdropped;
  insert into s2_results(grp,test,pass,detail) values
    ('T-CON','03 core_private 복제 0 + T-CON-07 웹·앱 View 컬럼 동일(라이브)',
     (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='core_private') = 5
     and (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
           where n.nspname='core_private') = 0
     and v_web = v_app,
     case when v_web = v_app then 'columns identical' else 'DIFF: '||left(v_app,120) end);

  -- D-04: T-CON-08 — 웹·앱 동명 함수 identity argument 완전 동일(라이브 대조)
  insert into s2_results(grp,test,pass,detail) values
    ('T-CON','04 T-CON-08 웹·앱 동명 wrapper 시그니처 동일(라이브)',
     (select count(*) from pg_proc pw
        join pg_namespace nw on nw.oid = pw.pronamespace
        join pg_proc pa on pa.proname = pw.proname
        join pg_namespace na on na.oid = pa.pronamespace
       where nw.nspname = 'api_web_v1' and na.nspname = 'api_app_v1'
         and pw.proname in ('ensure_free_question_room','qna_create_question_thread',
                            'community_post_create','community_post_update','community_post_soft_delete')
         and pg_get_function_identity_arguments(pw.oid) = pg_get_function_identity_arguments(pa.oid)) = 5,
     null);

  -- D-05: 앱 F3-상당 wrapper 매핑 전수(14종 + 수렴 4쌍 + 사전 밖 RAISE — 웹 F3 동일)
  select p.prosrc into v_app
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'api_app_v1' and p.proname = 'qna_create_question_thread';
  insert into s2_results(grp,test,pass,detail) values
    ('M17','05 앱 qna wrapper 매핑 전수 + 사전 밖 RAISE 전파',
     v_app like '%FREE_QUESTION_EXPIRED%' and v_app like '%FREE_QUESTION_TOTAL_LIMIT%'
     and v_app like '%FREE_QUESTION_PER_MENTOR_LIMIT%' and v_app like '%FREE_QUESTION_STUDENT_NOT_FOUND%'
     and v_app like '%SUBSCRIPTION_REFUND_PENDING%' and v_app like '%WEEKLY_LIMIT_EXHAUSTED%'
     and v_app like '%MENTOR_CANNOT_CREATE_THREAD%' and v_app ~ 'IF v_code IS NULL THEN\s+--[^\n]*\n\s+RAISE;', null);
end $$;

-- =============================================================================
-- 2. [forward] 카탈로그 — M8·M14
-- =============================================================================
do $$
declare
  v_phase text := coalesce(nullif(current_setting('s2_verify.phase', true), ''), 'forward');
  v_cnt int;
begin
  if v_phase <> 'forward' then return; end if;

  -- D-06: F7·F8·F13 identity + SECDEF·search_path + grant 매트릭스 + census(api_web_v1 fn 12)
  select count(*) into v_cnt
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'api_web_v1'
     and p.prosecdef and p.proconfig::text like '%search_path=%'
     and not has_function_privilege('anon', p.oid, 'EXECUTE')
     and has_function_privilege('authenticated', p.oid, 'EXECUTE')
     and has_function_privilege('service_role', p.oid, 'EXECUTE')
     and (p.proacl is null or (p.proacl::text not like '{=%' and p.proacl::text not like '%,=%'))
     and (p.proname, pg_get_function_identity_arguments(p.oid)) in
         (('mentor_profile_update_self', 'p_university_name text, p_department_name text, p_high_school_name text, p_teaching_subjects text[], p_intro_line text, p_bio text, p_answer_style text, p_profile_image_url text, p_is_open_for_subscriptions boolean'),
          ('mentor_plan_prices_set_self', 'p_limited_cash_krw integer, p_standard_cash_krw integer, p_premium_cash_krw integer'),
          ('mentor_payout_account_update_self', 'p_bank_name text, p_account_number text'));
  insert into s2_results(grp,test,pass,detail) values
    ('M8/M14','06 F7·F8·F13 identity+hardening+grant + census 12fn',
     v_cnt = 3 and (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                     where n.nspname='api_web_v1') = 12,
     'matched='||v_cnt);

  -- D-07: F7 allowlist 방어 — 특권·분리 컬럼 참조 0 / F13 계좌 원문 비반환(마스킹만)
  insert into s2_results(grp,test,pass,detail) values
    ('M8/M14','07 F7 특권 컬럼 참조 0 + F13 밴드·마스킹 소스 확인',
     not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                  where n.nspname='api_web_v1' and p.proname='mentor_profile_update_self'
                    and p.prosrc ~* '(verification_status|cap_limit|payout_bank_name|payout_account_number|activity_status|student_id_image_url)')
     and exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                  where n.nspname='api_web_v1' and p.proname='mentor_plan_prices_set_self'
                    and p.prosrc like '%29900%' and p.prosrc like '%69900%' and p.prosrc like '%84900%'
                    and p.prosrc like '%149900%' and p.prosrc like '%174900%' and p.prosrc like '%329900%')
     and exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                  where n.nspname='api_web_v1' and p.proname='mentor_payout_account_update_self'
                    and p.prosrc like '%account_masked%' and p.prosrc not like '%''account_number''%'), null);
end $$;

-- =============================================================================
-- 3. [forward] 기능 — 앱 표면(M17) + F7·F8·F13 (fixture: s2d-vf-*)
-- =============================================================================
do $$
declare
  v_phase text := coalesce(nullif(current_setting('s2_verify.phase', true), ''), 'forward');
  v_student uuid := gen_random_uuid();
  v_mentor  uuid := gen_random_uuid();
  v_mpend   uuid := gen_random_uuid();
  v_key     uuid := gen_random_uuid();
  v_res jsonb; v_res2 jsonb; v_post uuid; v_cnt int;
  v_ok boolean; v_det text;
  v_vs text; v_cap numeric; v_bank text; v_acct text;
begin
  if v_phase <> 'forward' then return; end if;

  -- 로컬 auto-expose 보정: invoker view 검증용 최소 grant (트랜잭션 한정 — rollback 소멸)
  grant select on public.community_posts to authenticated;

  insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data, aud, role, created_at, updated_at)
  values
    (v_student, 's2d-vf-s1@example.invalid', '{"app_role":"student","nickname":"디검증학생"}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated', now(), now()),
    (v_mentor,  's2d-vf-m1@example.invalid', '{"app_role":"mentor","nickname":"디검증멘토"}'::jsonb,  '{}'::jsonb, 'authenticated', 'authenticated', now(), now()),
    (v_mpend,   's2d-vf-m2@example.invalid', '{"app_role":"mentor","nickname":"디미승인"}'::jsonb,   '{}'::jsonb, 'authenticated', 'authenticated', now(), now());
  update public.mentor_profiles set verification_status = 'approved' where user_id = v_mentor;
  insert into s2_fx values ('student', v_student), ('mentor', v_mentor), ('mpend', v_mpend);

  -- D-20: 앱 F2(방 확보)·F4(생성·마스킹)·replay-first(§10 Gate 4 앱 표면 재검증) + 앱 view
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_student, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_res := api_app_v1.ensure_free_question_room(v_mentor);
    execute 'reset role';
    v_ok := (v_res->>'ok')::boolean and (v_res->>'created')::boolean and v_res->>'entitlement' = 'free'
            and (v_res->>'contract_version')::int = 1;
    v_det := 'F2 ' || coalesce(v_res->>'entitlement','?');
    if v_ok then
      perform set_config('request.jwt.claims', json_build_object('sub', v_mentor, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      v_res := api_app_v1.community_post_create(p_title=>'s2d-vf 글 010-1234-5678', p_body=>'앱 본문입니다 열자를 넘긴다', p_category=>'free', p_idempotency_key=>v_key);
      v_post := (v_res->>'post_id')::uuid;
      -- 응답 유실 모사 → 동일 멱등키 재호출(재호출 전 Storage DELETE 0 — 구조 보증은 C-08)
      v_res2 := api_app_v1.community_post_create(p_title=>'다른 제목', p_body=>'다른 본문 열자를 넘긴다', p_category=>'free', p_idempotency_key=>v_key);
      v_cnt := (select count(*) from api_app_v1.community_posts_v1 where title = 's2d-vf 글 [연락처 비공개]');
      execute 'reset role';
      v_ok := (v_res->>'idempotent_replay')::boolean = false
              and (v_res2->>'idempotent_replay')::boolean and v_res2->>'post_id' = v_post::text
              and (select count(*) from public.community_posts where create_idempotency_key = v_key) = 1
              and v_cnt = 1;
      v_det := v_det || ' | F4 replay+마스킹 view=' || v_cnt;
      insert into s2_fx values ('post', v_post);
    end if;
  exception when others then
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true);
  insert into s2_results(grp,test,pass,detail) values
    ('APP','20 앱 F2·F4 replay-first·마스킹·view 열람(Gate 4 상당)', coalesce(v_ok,false), left(v_det,200));

  -- D-21: 앱 wrapper 오류 경로 — 학생 F4 → ROLE_NOT_MENTOR · qna wrapper envelope · F5/F6 앱 경유
  begin
    select v into v_post from s2_fx where k = 'post';
    perform set_config('request.jwt.claims', json_build_object('sub', v_student, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_res := api_app_v1.community_post_create(p_title=>'t', p_body=>'본문입니다 열자를 넘긴다', p_category=>'free', p_idempotency_key=>gen_random_uuid());
    v_res2 := api_app_v1.qna_create_question_thread(gen_random_uuid(), '제목');
    execute 'reset role';
    v_ok := v_res->>'code' = 'ROLE_NOT_MENTOR' and v_res2->>'code' = 'ROOM_NOT_FOUND'
            and (v_res2->>'contract_version')::int = 1;
    v_det := coalesce(v_res->>'code','?') || '/' || coalesce(v_res2->>'code','?');
    if v_ok then
      perform set_config('request.jwt.claims', json_build_object('sub', v_mentor, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      v_res := api_app_v1.community_post_update(p_post_id=>v_post, p_title=>'수정', p_body=>'수정본문 열자를 넘긴다', p_category=>'study', p_expected_updated_at=>now() - interval '1 hour');
      v_res2 := api_app_v1.community_post_soft_delete(v_post);
      execute 'reset role';
      v_ok := v_res->>'code' = 'UPDATE_CONFLICT' and (v_res2->>'ok')::boolean and (v_res2->>'deleted_at') is not null;
      v_det := v_det || ' | ' || coalesce(v_res->>'code','?') || '/del ok';
    end if;
  exception when others then
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true);
  insert into s2_results(grp,test,pass,detail) values
    ('APP','21 앱 wrapper 오류·수정충돌·soft delete(웹과 동일 코드)', coalesce(v_ok,false), left(v_det,200));

  -- D-22: F7 — happy·subjects 필터·avatar 3경로·필수 2종·특권 컬럼 불변
  begin
    select mp.verification_status, mp.cap_limit into v_vs, v_cap
      from public.mentor_profiles mp where mp.user_id = v_mentor;
    perform set_config('request.jwt.claims', json_build_object('sub', v_mentor, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_res := api_web_v1.mentor_profile_update_self(
      p_university_name=>'디검증대', p_department_name=>'디검증과', p_high_school_name=>'디검증고',
      p_teaching_subjects=>array['math','english','없는과목'], p_intro_line=>'소개', p_bio=>'소개글',
      p_answer_style=>'차분함',
      p_profile_image_url=>('https://x.supabase.co/storage/v1/object/public/profile-avatars/' || v_mentor || '/a.png'),
      p_is_open_for_subscriptions=>true);
    v_res2 := api_web_v1.mentor_profile_update_self(
      p_university_name=>'디검증대', p_department_name=>'디검증과', p_high_school_name=>null,
      p_teaching_subjects=>'{}', p_intro_line=>null, p_bio=>null, p_answer_style=>null,
      p_profile_image_url=>(v_student || '/b.png'), p_is_open_for_subscriptions=>true);
    execute 'reset role';
    v_ok := (v_res->>'ok')::boolean and (v_res->>'updated_at') is not null
            and v_res2->>'code' = 'PROFILE_IMAGE_REF_INVALID'
            and (select teaching_subjects from public.mentor_profiles where user_id = v_mentor) = array['math','english']
            and (select profile_image_url from public.mentor_profiles where user_id = v_mentor) like '%' || v_mentor || '%';
    v_det := 'happy+타인경로거부';
    if v_ok then
      perform set_config('request.jwt.claims', json_build_object('sub', v_mentor, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      v_res  := api_web_v1.mentor_profile_update_self(p_university_name=>'  ', p_department_name=>'과', p_high_school_name=>null, p_teaching_subjects=>'{}', p_intro_line=>null, p_bio=>null, p_answer_style=>null, p_profile_image_url=>null, p_is_open_for_subscriptions=>true);
      v_res2 := api_web_v1.mentor_profile_update_self(p_university_name=>'대', p_department_name=>' ', p_high_school_name=>null, p_teaching_subjects=>'{}', p_intro_line=>null, p_bio=>null, p_answer_style=>null, p_profile_image_url=>null, p_is_open_for_subscriptions=>true);
      execute 'reset role';
      v_ok := v_res->>'code' = 'UNIVERSITY_NAME_REQUIRED' and v_res2->>'code' = 'DEPARTMENT_NAME_REQUIRED'
              and (select mp.verification_status from public.mentor_profiles mp where mp.user_id = v_mentor) is not distinct from v_vs
              and (select mp.cap_limit from public.mentor_profiles mp where mp.user_id = v_mentor) is not distinct from v_cap;
      v_det := v_det || ' | 필수 2종 + 특권 컬럼 불변';
    end if;
  exception when others then
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true);
  insert into s2_results(grp,test,pass,detail) values
    ('F7','22 프로필 갱신(allowlist·subjects 필터·avatar·특권 불변)', coalesce(v_ok,false), left(v_det,200));

  -- D-23: F8 — updated/unchanged·밴드 밖 3-tier·INVALID·cap 강제·학생 거부
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_mentor, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_res := api_web_v1.mentor_plan_prices_set_self(35000, 99000, 200000);
    v_res2 := api_web_v1.mentor_plan_prices_set_self(35000, 99000, 200000);
    v_ok := jsonb_array_length(v_res->'updated') = 3 and jsonb_array_length(v_res2->'unchanged') = 3
            and jsonb_array_length(v_res2->'updated') = 0;
    v_det := 'upd3→unch3';
    if v_ok then
      v_res := api_web_v1.mentor_plan_prices_set_self(29899, 99000, 200000);
      v_res2 := api_web_v1.mentor_plan_prices_set_self(35000, 150000, 200000);
      v_ok := v_res->>'code' = 'PLAN_PRICE_OUT_OF_BAND' and v_res->>'tier' = 'limited'
              and (v_res->>'min_cash_krw')::int = 29900
              and v_res2->>'code' = 'PLAN_PRICE_OUT_OF_BAND' and v_res2->>'tier' = 'standard';
      v_det := v_det || ' | 밴드 밖 limited/standard';
    end if;
    if v_ok then
      v_res := api_web_v1.mentor_plan_prices_set_self(35000, 99000, 330000);
      v_res2 := api_web_v1.mentor_plan_prices_set_self(0, 99000, 200000);
      v_ok := v_res->>'code' = 'PLAN_PRICE_OUT_OF_BAND' and v_res->>'tier' = 'premium'
              and v_res2->>'code' = 'PLAN_PRICE_INVALID' and v_res2->>'tier' = 'limited';
      v_det := v_det || ' | premium 밖 + INVALID';
    end if;
    execute 'reset role';
    if v_ok then
      v_ok := (select count(*) from public.mentor_plans mp
                where mp.mentor_id = v_mentor
                  and ((mp.plan_tier='limited' and mp.amount_cents=3500000 and mp.cap_weight=1.0)
                       or (mp.plan_tier='standard' and mp.amount_cents=9900000 and mp.cap_weight=2.5)
                       or (mp.plan_tier='premium' and mp.amount_cents=20000000 and mp.cap_weight=4.5))) = 3;
      v_det := v_det || ' | ×100 저장 + cap 강제';
      perform set_config('request.jwt.claims', json_build_object('sub', v_student, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      v_res := api_web_v1.mentor_plan_prices_set_self(35000, 99000, 200000);
      execute 'reset role';
      v_ok := v_ok and v_res->>'code' = 'ROLE_NOT_MENTOR';
    end if;
  exception when others then
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true);
  insert into s2_results(grp,test,pass,detail) values
    ('F8','23 밴드 강제(거부·클램프 없음)·cap 고정·멱등 unchanged', coalesce(v_ok,false), left(v_det,200));

  -- D-24: F13 — happy(마스킹·저장)·allowlist·계좌 형식·미승인·학생
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_mentor, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_res := api_web_v1.mentor_payout_account_update_self('카카오뱅크', '12345678901234');
    v_ok := (v_res->>'ok')::boolean and v_res->>'account_masked' = '**********1234'
            and (v_res ? 'updated_at') and not (v_res ? 'account_number');
    v_det := 'masked=' || coalesce(v_res->>'account_masked','?');
    if v_ok then
      v_res  := api_web_v1.mentor_payout_account_update_self('없는은행', '12345678901234');
      v_res2 := api_web_v1.mentor_payout_account_update_self('카카오뱅크', '1234-5678');
      v_ok := v_res->>'code' = 'PAYOUT_BANK_NAME_INVALID' and v_res2->>'code' = 'PAYOUT_ACCOUNT_NUMBER_INVALID';
      v_res2 := api_web_v1.mentor_payout_account_update_self('카카오뱅크', '1234567');
      v_ok := v_ok and v_res2->>'code' = 'PAYOUT_ACCOUNT_NUMBER_INVALID';
      v_det := v_det || ' | allowlist+형식 거부';
    end if;
    execute 'reset role';
    if v_ok then
      select mp.payout_bank_name, mp.payout_account_number into v_bank, v_acct
        from public.mentor_profiles mp where mp.user_id = v_mentor;
      v_ok := v_bank = '카카오뱅크' and v_acct = '12345678901234';
      perform set_config('request.jwt.claims', json_build_object('sub', v_mpend, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      v_res := api_web_v1.mentor_payout_account_update_self('카카오뱅크', '12345678901234');
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub', v_student, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      v_res2 := api_web_v1.mentor_payout_account_update_self('카카오뱅크', '12345678901234');
      execute 'reset role';
      v_ok := v_ok and v_res->>'code' = 'MENTOR_NOT_APPROVED' and v_res2->>'code' = 'ROLE_NOT_MENTOR';
      v_det := v_det || ' | 저장확인 + 미승인/학생 거부';
    end if;
  exception when others then
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true);
  insert into s2_results(grp,test,pass,detail) values
    ('F13','24 정산계좌(마스킹·allowlist·형식·자격)', coalesce(v_ok,false), left(v_det,200));

  -- D-25: 앱 view 필터 — 타인 draft 비노출·deleted 숨김·anon 스키마 도달 불가
  begin
    select v into v_post from s2_fx where k = 'post';   -- D-21 에서 soft delete 됨
    perform set_config('request.jwt.claims', json_build_object('sub', v_student, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_cnt := (select count(*) from api_app_v1.community_posts_v1 where id = v_post);
    execute 'reset role';
    v_ok := (v_cnt = 0);
    v_det := 'deleted 숨김=' || v_cnt;
    if v_ok then
      v_ok := false;
      begin
        execute 'set local role anon';
        execute 'select count(*) from api_app_v1.community_posts_v1';
        execute 'reset role';
      exception when insufficient_privilege then
        v_ok := true; v_det := v_det || ' | anon 42501';
      end;
    end if;
  exception when others then
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  insert into s2_results(grp,test,pass,detail) values
    ('APP','25 앱 view 필터(deleted 숨김) + anon 도달 불가', coalesce(v_ok,false), left(v_det,160));
end $$;

-- =============================================================================
-- 4. [post_rollback] — Batch D 8객체 0 + Batch A·B·C 불변
-- =============================================================================
do $$
declare
  v_phase text := coalesce(nullif(current_setting('s2_verify.phase', true), ''), 'forward');
begin
  if v_phase <> 'post_rollback' then return; end if;

  insert into s2_results(grp,test,pass,detail) values
    ('ROLLBACK','01 Batch D 객체 부재(api_app_v1 schema 0 · F7/F8/F13 0)',
     not exists (select 1 from pg_namespace where nspname = 'api_app_v1')
     and not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                      where n.nspname='api_web_v1'
                        and p.proname in ('mentor_profile_update_self','mentor_plan_prices_set_self',
                                          'mentor_payout_account_update_self')), null);
  insert into s2_results(grp,test,pass,detail) values
    ('ROLLBACK','02 Batch B·C 상태 불변(웹 view 5 · fn 9 · core_private 5)',
     (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
       where n.nspname='api_web_v1' and c.relkind='v') = 5
     and (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='api_web_v1') = 9
     and (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='core_private') = 5, null);
  insert into s2_results(grp,test,pass,detail) values
    ('ROLLBACK','03 정본 public·Batch A 잔존',
     exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
              where n.nspname='public' and p.proname='qna_create_question_thread')
     and exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
              where n.nspname='public' and p.proname='enforce_mentor_profile_privileged_guard'), null);
end $$;

-- -----------------------------------------------------------------------------
-- 5. 결과 보고 + 게이트
-- -----------------------------------------------------------------------------
select grp, test, case when pass then 'PASS' else 'FAIL' end as result, detail
  from s2_results order by seq;
select count(*) filter (where pass) || '/' || count(*) as passed from s2_results;

do $$
declare v_fail int; v_list text;
begin
  select count(*), string_agg(grp || ':' || test, ' | ') filter (where not pass)
    into v_fail, v_list from s2_results where not pass;
  if v_fail > 0 then
    raise exception 'S2_BATCH_D_VERIFY_FAILED: % failing test(s) — %', v_fail, v_list;
  end if;
  raise notice 'S2_BATCH_D_VERIFY: ALL PASS (phase=%)',
    coalesce(nullif(current_setting('s2_verify.phase', true), ''), 'forward');
end $$;

rollback;

-- -----------------------------------------------------------------------------
-- 6. fixture 잔여 0
-- -----------------------------------------------------------------------------
do $$
declare v_cnt bigint;
begin
  select count(*) into v_cnt from auth.users where email like 's2d-vf-%@example.invalid';
  if v_cnt > 0 then raise exception 'S2_FIXTURE_RESIDUE: auth.users % rows remain', v_cnt; end if;
  select count(*) into v_cnt from public.community_posts where title like 's2d-vf%';
  if v_cnt > 0 then raise exception 'S2_FIXTURE_RESIDUE: community_posts % rows remain', v_cnt; end if;
  raise notice 'S2_BATCH_D_VERIFY: fixture residue 0';
end $$;
