-- =============================================================================
-- scripts/verify/s2_2_batch_c_verify.sql
-- S2-2 Batch C (M5 core_private_room_ensure · M6 api_web_v1_self_rpc ·
--               M7 api_web_v1_community_rpc) 반복 검증 스크립트
-- =============================================================================
-- 실행 전제:
--   * 격리 로컬 Supabase 스택(PG17)에 baseline 175 + Batch A(M0·M15) +
--     Batch B(M1·M13·M4) 적용 상태(= clean-install 180) 위에서 사용한다.
--   * 운영·staging 오실행 방지 — 러너가 같은 세션에서 먼저 실행해야 한다:
--       set s2_verify.allow_local = 'on';
--   * phase 스위치:
--       set s2_verify.phase = 'forward'        -- M5→M6→M7 적용 직후 (기본값)
--       set s2_verify.phase = 'post_rollback'  -- M7→M6→M5 rollback 직후
--   * 동시성(T-CONC-01·T-CONC-06)은 단일 세션 스크립트로 검증 불가 — 별도
--     2세션 러너가 수행하고 결과를 audit 문서에 기록한다(§21.10). 이 스크립트는
--     그 외 전 항목(카탈로그·기능·오류 경로·T-CON-01~03·05~08·T-CONC-10 의
--     DB 측 replay-first 분기·T-PERM-01/02/06/07 상당)을 소유한다.
--   * 모든 fixture DML(s2c-vf-*) 은 단일 트랜잭션에서 수행하고 마지막에 rollback.
--     실사용 규모(auth.users > 50행) 감지 시 중단.
-- 판정: s2_results 에 PASS/FAIL 기록 → FAIL ≥1 이면 S2_BATCH_C_VERIFY_FAILED.
-- 근거 계약: api_web_v1_contract_v1_1.md §6 V6·V7 · §7 F1~F10·B-1~B-4 · §8 · §9 ·
--   §10.3 · §13 · §14.3~14.4 · §21.1 T-CON · §21.3 T-CONC / 앱 계약 §3.3·§4·§6.
-- =============================================================================

begin;

do $$
declare
  v_allow text := current_setting('s2_verify.allow_local', true);
  v_phase text := coalesce(nullif(current_setting('s2_verify.phase', true), ''), 'forward');
  v_users bigint;
begin
  if v_allow is distinct from 'on' then
    raise exception 'S2_VERIFY_LOCAL_GUARD: s2_verify.allow_local=on 이 설정되지 않았다. 격리 로컬 스택 전용.'
      using errcode = '42501';
  end if;
  if v_phase not in ('forward', 'post_rollback') then
    raise exception 'S2_VERIFY_PHASE: s2_verify.phase 는 forward|post_rollback 이어야 한다 (현재 %)', v_phase;
  end if;
  select count(*) into v_users from auth.users;
  if v_users > 50 then
    raise exception 'S2_VERIFY_LOCAL_GUARD: auth.users % 행 — 실사용 규모 감지, 중단.', v_users
      using errcode = '42501';
  end if;
end $$;

create temporary table s2_results (
  seq serial primary key, grp text not null, test text not null,
  pass boolean not null, detail text
);
create temporary table s2_fx (k text primary key, v uuid not null);

-- =============================================================================
-- 1. [forward] 카탈로그 — M5·M6·M7 객체·속성·GRANT (T-PERM-01/02/06/07 상당)
-- =============================================================================
do $$
declare
  v_phase text := coalesce(nullif(current_setting('s2_verify.phase', true), ''), 'forward');
  v_cnt int;
  v_sig text;
begin
  if v_phase <> 'forward' then return; end if;

  -- C-01: F10 — identity·SECDEF·pinned search_path·외부(EXECUTE service_role 포함) 0
  select count(*) into v_cnt
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'core_private' and p.proname = 'ensure_student_mentor_room'
     and pg_get_function_identity_arguments(p.oid)
         = 'p_student_id uuid, p_mentor_id uuid, p_payment_id uuid, p_subscription_id uuid, p_require_entitlement boolean'
     and p.prosecdef and p.proconfig::text like '%search_path=%'
     and not has_function_privilege('anon', p.oid, 'EXECUTE')
     and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
     and not has_function_privilege('service_role', p.oid, 'EXECUTE')
     and (p.proacl is null or (p.proacl::text not like '{=%' and p.proacl::text not like '%,=%'));
  insert into s2_results(grp,test,pass,detail) values
    ('M5','01 F10 identity+SECDEF+search_path+외부 EXECUTE 0', v_cnt = 1, 'matched='||v_cnt);

  -- C-02: M6 6종 — SECDEF·search_path·GRANT(authenticated/service_role, anon 0, PUBLIC 0)
  select count(*) into v_cnt
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'api_web_v1'
     and p.prosecdef and p.proconfig::text like '%search_path=%'
     and not has_function_privilege('anon', p.oid, 'EXECUTE')
     and has_function_privilege('authenticated', p.oid, 'EXECUTE')
     and has_function_privilege('service_role', p.oid, 'EXECUTE')
     and (p.proacl is null or (p.proacl::text not like '{=%' and p.proacl::text not like '%,=%'))
     and (p.proname, pg_get_function_identity_arguments(p.oid)) in
         (('weekly_question_usage_self', 'p_mentor_id uuid'),
          ('ensure_free_question_room', 'p_mentor_id uuid'),
          ('qna_create_question_thread', 'p_room_id uuid, p_title text, p_subject text, p_topic text, p_first_message_body text'),
          ('account_deletion_status_self', ''),
          ('my_subscriptions_self', ''),
          ('mentor_settlement_self', ''));
  insert into s2_results(grp,test,pass,detail) values
    ('M6','02 self RPC 6종 identity+hardening+grant 매트릭스', v_cnt = 6, 'matched='||v_cnt);

  -- C-03: M7 — 구현부 4종(INVOKER·외부 0) + wrapper 3종(SECDEF·grant) + census
  select count(*) into v_cnt
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'core_private'
     and p.proname in ('community_image_refs_validate','community_post_create_impl',
                       'community_post_update_impl','community_post_soft_delete_impl')
     and not p.prosecdef and p.proconfig::text like '%search_path=%'
     and not has_function_privilege('anon', p.oid, 'EXECUTE')
     and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
     and not has_function_privilege('service_role', p.oid, 'EXECUTE');
  insert into s2_results(grp,test,pass,detail) values
    ('M7','03a impl 4종 INVOKER+외부 EXECUTE 0 (T-PERM-06)', v_cnt = 4, 'matched='||v_cnt);
  select count(*) into v_cnt
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'api_web_v1'
     and p.proname in ('community_post_create','community_post_update','community_post_soft_delete')
     and p.prosecdef and p.proconfig::text like '%search_path=%'
     and not has_function_privilege('anon', p.oid, 'EXECUTE')
     and has_function_privilege('authenticated', p.oid, 'EXECUTE')
     and has_function_privilege('service_role', p.oid, 'EXECUTE');
  insert into s2_results(grp,test,pass,detail) values
    ('M7','03b wrapper 3종 SECDEF+grant', v_cnt = 3, 'matched='||v_cnt);
  insert into s2_results(grp,test,pass,detail) values
    ('M7','03c census api_web_v1=5뷰/9fn · core_private=5fn/0rel',
     (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
       where n.nspname='api_web_v1' and c.relkind='v') = 5
     and (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='api_web_v1') = 9
     and (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='core_private') = 5
     and (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
           where n.nspname='core_private') = 0, null);

  -- C-04: core_private 외부 USAGE 0 (T-PERM-01) + api_web_v1 함수 PUBLIC EXECUTE 0 (T-PERM-02)
  insert into s2_results(grp,test,pass,detail) values
    ('PERM','04 core_private USAGE 0 + api_web_v1 fn PUBLIC EXECUTE 0',
     not has_schema_privilege('anon','core_private','USAGE')
     and not has_schema_privilege('authenticated','core_private','USAGE')
     and not has_schema_privilege('service_role','core_private','USAGE')
     and not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                      where n.nspname in ('api_web_v1','core_private')
                        and (p.proacl::text like '{=%' or p.proacl::text like '%,=%')), null);

  -- C-05: T-CON-03(V6·V7) — 반환 필드 이름·타입·순서 = §6 원문
  select pg_get_function_result(p.oid) into v_sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'api_web_v1' and p.proname = 'my_subscriptions_self';
  insert into s2_results(grp,test,pass,detail) values
    ('T-CON','05a V6 반환 시그니처(§6 — current_plan_amount_cents 포함)',
     v_sig = 'TABLE(subscription_id uuid, mentor_id uuid, mentor_label text, plan_id uuid, plan_tier text, current_plan_amount_cents integer, status text, started_at timestamp with time zone, current_period_start timestamp with time zone, current_period_end timestamp with time zone, next_billing_at timestamp with time zone, cancel_at_period_end boolean, grace_until timestamp with time zone, created_at timestamp with time zone)',
     left(v_sig, 200));
  select pg_get_function_result(p.oid) into v_sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'api_web_v1' and p.proname = 'mentor_settlement_self';
  insert into s2_results(grp,test,pass,detail) values
    ('T-CON','05b V7 반환 시그니처(§6 — idempotency_key/ledger_id/payment_id 비노출)',
     v_sig = 'TABLE(item_id uuid, subscription_id uuid, student_label text, event_type text, billing_at timestamp with time zone, period_start timestamp with time zone, period_end timestamp with time zone, gross_cents bigint, platform_fee_cents bigint, mentor_amount_cents bigint, fee_rate numeric, status text, hold_reason text, paid_at timestamp with time zone, created_at timestamp with time zone)'
     and v_sig !~* '(idempotency_key|ledger_id|payment_id)',
     left(v_sig, 200));

  -- C-06: T-CON-05·06 — F3 매핑 전수(정본 raise 14종 + 트리거 수렴 4쌍) + 사전 밖 예외 전파(RAISE)
  select p.prosrc into v_sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'api_web_v1' and p.proname = 'qna_create_question_thread';
  insert into s2_results(grp,test,pass,detail) values
    ('T-CON','06 F3 raise 14종 매핑 + FREE_QUESTION_* 수렴 4쌍 + 사전 밖 RAISE 전파',
     v_sig like '%FREE_QUESTION_EXPIRED%' and v_sig like '%FREE_QUESTION_TOTAL_LIMIT%'
     and v_sig like '%FREE_QUESTION_PER_MENTOR_LIMIT%' and v_sig like '%FREE_QUESTION_STUDENT_NOT_FOUND%'
     and v_sig like '%AUTH_REQUIRED%' and v_sig like '%TITLE_REQUIRED%'
     and v_sig like '%ROOM_NOT_FOUND%' and v_sig like '%NOT_ROOM_PARTY%'
     and v_sig like '%MENTOR_CANNOT_CREATE_THREAD%' and v_sig like '%ACCOUNT_BANNED%'
     and v_sig like '%ACCOUNT_SUSPENDED%' and v_sig like '%ACCOUNT_DELETION_IN_PROGRESS%'
     and v_sig like '%BLOCKED%' and v_sig like '%MENTOR_NOT_APPROVED%'
     and v_sig like '%SUBSCRIPTION_REFUND_PENDING%' and v_sig like '%WEEKLY_LIMIT_EXHAUSTED%'
     and v_sig like '%FREE_QUOTA_EXPIRED%' and v_sig like '%FREE_QUOTA_TOTAL_EXHAUSTED%'
     and v_sig like '%FREE_QUOTA_MENTOR_EXHAUSTED%'
     and v_sig ~ 'IF v_code IS NULL THEN\s+--[^\n]*\n\s+RAISE;', null);

  -- C-07: T-CON-07·08 — 앱 계약 리터럴 대조(§3.2 필드 집합 / §3.3 identity argument).
  --   api_app_v1 객체는 M17(Batch D) 소유로 아직 없다 — 계약 원문 스냅샷과 대조한다.
  select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ', ' order by a.attnum)
    into v_sig from pg_attribute a
   where a.attrelid = 'api_web_v1.community_posts_v1'::regclass and a.attnum > 0 and not a.attisdropped;
  insert into s2_results(grp,test,pass,detail) values
    ('T-CON','07 V1 필드 집합 = 앱 계약 §3.2 원문(공용 View 계약)',
     v_sig = 'id:uuid, author_id:uuid, title:text, body:text, category:text, image_refs:text[], author_label:text, author_role:text, like_count:integer, comment_count:integer, view_count:integer, status:text, created_at:timestamp with time zone, updated_at:timestamp with time zone',
     left(v_sig, 160));
  insert into s2_results(grp,test,pass,detail) values
    ('T-CON','08 F4/F5/F6 identity argument = 앱 계약 §3.3 원문',
     exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
              where n.nspname='api_web_v1' and p.proname='community_post_create'
                and pg_get_function_identity_arguments(p.oid)
                    = 'p_title text, p_body text, p_category text, p_idempotency_key uuid, p_image_refs text[], p_status text')
     and exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
              where n.nspname='api_web_v1' and p.proname='community_post_update'
                and pg_get_function_identity_arguments(p.oid)
                    = 'p_post_id uuid, p_title text, p_body text, p_category text, p_expected_updated_at timestamp with time zone, p_image_refs text[], p_status text')
     and exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
              where n.nspname='api_web_v1' and p.proname='community_post_soft_delete'
                and pg_get_function_identity_arguments(p.oid) = 'p_post_id uuid'), null);

  -- C-08: B-1·B-2·B-3 에 storage 삭제 경로 0 (T-CONC-10 — 보상 삭제는 클라이언트 소유)
  insert into s2_results(grp,test,pass,detail) values
    ('T-CONC','08 impl 에 storage.objects DELETE 0 (재호출 선행·보상 삭제 후행)',
     not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                  where n.nspname='core_private'
                    and p.proname in ('community_post_create_impl','community_post_update_impl',
                                      'community_post_soft_delete_impl','community_image_refs_validate')
                    and p.prosrc ~* 'delete\s+from\s+storage'), null);
end $$;

-- =============================================================================
-- 2. [forward] 기능 — F2/F10 · F1 · F3 (fixture: s2c-vf-*)
-- =============================================================================
do $$
declare
  v_phase text := coalesce(nullif(current_setting('s2_verify.phase', true), ''), 'forward');
  v_student uuid := gen_random_uuid();
  v_student2 uuid := gen_random_uuid();
  v_blockst uuid := gen_random_uuid();
  v_suspst  uuid := gen_random_uuid();
  v_mentor  uuid := gen_random_uuid();
  v_mpend   uuid := gen_random_uuid();
  v_res  jsonb;
  v_res2 jsonb;
  v_room uuid;
  v_ok boolean; v_det text;
begin
  if v_phase <> 'forward' then return; end if;

  insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data, aud, role, created_at, updated_at)
  values
    (v_student,  's2c-vf-s1@example.invalid', '{"app_role":"student","nickname":"검증학생일"}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated', now(), now()),
    (v_student2, 's2c-vf-s2@example.invalid', '{"app_role":"student","nickname":"검증학생이"}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated', now(), now()),
    (v_blockst,  's2c-vf-s3@example.invalid', '{"app_role":"student","nickname":"차단학생"}'::jsonb,   '{}'::jsonb, 'authenticated', 'authenticated', now(), now()),
    (v_suspst,   's2c-vf-s4@example.invalid', '{"app_role":"student","nickname":"정지학생"}'::jsonb,   '{}'::jsonb, 'authenticated', 'authenticated', now(), now()),
    (v_mentor,   's2c-vf-m1@example.invalid', '{"app_role":"mentor","nickname":"검증멘토일"}'::jsonb,  '{}'::jsonb, 'authenticated', 'authenticated', now(), now()),
    (v_mpend,    's2c-vf-m2@example.invalid', '{"app_role":"mentor","nickname":"미승인멘토"}'::jsonb,  '{}'::jsonb, 'authenticated', 'authenticated', now(), now());
  update public.mentor_profiles set verification_status = 'approved' where user_id = v_mentor;
  update public.users set status = 'suspended', suspended_until = now() + interval '1 day' where id = v_suspst;
  insert into public.user_blocks (blocker_id, blocked_id) values (v_blockst, v_mentor);
  insert into s2_fx values ('student', v_student), ('student2', v_student2), ('mentor', v_mentor), ('mpend', v_mpend);

  -- C-20: F2 — 방 확보(free) + 재호출 created:false + 방 정확히 1개 (T-CONC-01 단일세션 상당)
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_student, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_res := api_web_v1.ensure_free_question_room(v_mentor);
    v_res2 := api_web_v1.ensure_free_question_room(v_mentor);
    execute 'reset role';
    v_room := (v_res ->> 'room_id')::uuid;
    v_ok := (v_res ->> 'ok')::boolean and (v_res ->> 'created')::boolean
            and v_res ->> 'entitlement' = 'free' and (v_res ->> 'contract_version')::int = 1
            and (v_res2 ->> 'created')::boolean = false
            and v_res2 ->> 'room_id' = v_room::text
            and (select count(*) from public.mentor_student_rooms
                  where student_id = v_student and mentor_id = v_mentor) = 1;
    v_det := v_res::text;
    insert into s2_fx values ('room', v_room);
  exception when others then
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true);
  insert into s2_results(grp,test,pass,detail) values
    ('F2','20 방 확보 free + 멱등 재사용 + 방 1개', coalesce(v_ok,false), left(v_det,160));

  -- C-21: F2 오류 경로 — 미승인/정지/차단/학생 아님 (T-CON-02: §9 사전 코드)
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_student, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_res := api_web_v1.ensure_free_question_room(v_mpend);      -- 미승인 멘토
    execute 'reset role';
    perform set_config('request.jwt.claims', json_build_object('sub', v_suspst, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_res2 := api_web_v1.ensure_free_question_room(v_mentor);    -- 정지 학생
    execute 'reset role';
    v_ok := v_res ->> 'code' = 'MENTOR_NOT_APPROVED' and v_res2 ->> 'code' = 'ACCOUNT_SUSPENDED';
    v_det := coalesce(v_res->>'code','?') || '/' || coalesce(v_res2->>'code','?');
    if v_ok then
      perform set_config('request.jwt.claims', json_build_object('sub', v_blockst, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      v_res := api_web_v1.ensure_free_question_room(v_mentor);   -- 상호 차단
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub', v_mentor, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      v_res2 := api_web_v1.ensure_free_question_room(v_mentor);  -- 학생 아님
      execute 'reset role';
      v_ok := v_res ->> 'code' = 'BLOCKED' and v_res2 ->> 'code' = 'ROLE_NOT_STUDENT';
      v_det := v_det || '/' || coalesce(v_res->>'code','?') || '/' || coalesce(v_res2->>'code','?');
    end if;
  exception when others then
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true);
  insert into s2_results(grp,test,pass,detail) values
    ('F2','21 오류 경로 4종(§9 사전 코드)', coalesce(v_ok,false), left(v_det,160));

  -- C-22: F3 — free 소비 + F1 반영 + 대표 오류 envelope (T-CON-01·02·05 라이브 부분)
  begin
    select v into v_room from s2_fx where k = 'room';
    perform set_config('request.jwt.claims', json_build_object('sub', v_student, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_res := api_web_v1.qna_create_question_thread(v_room, '검증 질문 1', null, null, '첫 메시지');
    v_ok := (v_res->>'ok')::boolean and v_res->>'path' = 'free' and (v_res->>'used_free_quota')::boolean
            and (v_res->>'contract_version')::int = 1 and (v_res->>'thread_id') is not null;
    v_det := 'create=' || coalesce(v_res->>'path','?');
    if v_ok then
      v_res := api_web_v1.qna_create_question_thread(gen_random_uuid(), '제목');   -- 없는 방
      v_res2 := api_web_v1.qna_create_question_thread(v_room, '   ');              -- 제목 없음
      v_ok := v_res->>'code' = 'ROOM_NOT_FOUND' and v_res2->>'code' = 'TITLE_REQUIRED';
      v_det := v_det || ' | ' || coalesce(v_res->>'code','?') || '/' || coalesce(v_res2->>'code','?');
    end if;
    execute 'reset role';
    if v_ok then
      -- 멘토가 스레드 생성 시도 / 제3자 방 접근
      perform set_config('request.jwt.claims', json_build_object('sub', v_mentor, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      v_res := api_web_v1.qna_create_question_thread(v_room, '멘토 생성 시도');
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub', v_student2, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      v_res2 := api_web_v1.qna_create_question_thread(v_room, '제3자 시도');
      execute 'reset role';
      v_ok := v_res->>'code' = 'MENTOR_CANNOT_CREATE_THREAD' and v_res2->>'code' = 'NOT_ROOM_PARTY';
      v_det := v_det || ' | ' || coalesce(v_res->>'code','?') || '/' || coalesce(v_res2->>'code','?');
    end if;
    if v_ok then
      -- F1 사용량 — free pair 는 limit 0 / can_ask false (정본 수치 그대로 — §7 F1)
      perform set_config('request.jwt.claims', json_build_object('sub', v_student, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      v_res := api_web_v1.weekly_question_usage_self(v_mentor);
      v_res2 := api_web_v1.weekly_question_usage_self(null);
      execute 'reset role';
      v_ok := (v_res->>'ok')::boolean and (v_res->>'contract_version')::int = 1
              and v_res2->>'code' = 'MENTOR_ID_REQUIRED';
      v_det := v_det || ' | F1 ok+' || coalesce(v_res2->>'code','?');
    end if;
  exception when others then
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true);
  insert into s2_results(grp,test,pass,detail) values
    ('F3','22 free 소비 + 대표 오류 4종 + F1 envelope', coalesce(v_ok,false), left(v_det,200));

  -- C-23: F2 멘토별 무료 한도 소진 — usage 3행 시딩 후 FREE_QUOTA_MENTOR_EXHAUSTED
  begin
    -- 이미 1건 소비(C-22). 2건 추가 시딩 = 3/3 (브리지·트리거 정본 경로 — 직접 INSERT 는
    -- check_free_question_usage_limits 트리거를 통과한다)
    insert into public.free_question_usage (student_id, mentor_id) values
      (v_student, v_mentor), (v_student, v_mentor);
    perform set_config('request.jwt.claims', json_build_object('sub', v_student, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_res := api_web_v1.ensure_free_question_room(v_mentor);  -- 기존 방 있어도 자격 검사 선행? — 방 재사용 경로
    execute 'reset role';
    -- 주의: F10 은 자격 검사가 방 조회보다 먼저다(앱 §4.2 순서) — 소진 시 거부가 정본
    v_ok := v_res ->> 'code' = 'FREE_QUOTA_MENTOR_EXHAUSTED';
    v_det := coalesce(v_res->>'code', v_res::text);
  exception when others then
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true);
  insert into s2_results(grp,test,pass,detail) values
    ('F2','23 멘토별 3회 소진 → FREE_QUOTA_MENTOR_EXHAUSTED', coalesce(v_ok,false), left(v_det,160));
end $$;

-- =============================================================================
-- 3. [forward] 기능 — F4/F5/F6 · B-4 · T-CONC-10 replay-first (fixture 계속)
-- =============================================================================
do $$
declare
  v_phase text := coalesce(nullif(current_setting('s2_verify.phase', true), ''), 'forward');
  v_student uuid; v_mentor uuid; v_mpend uuid;
  v_key  uuid := gen_random_uuid();
  v_key2 uuid := gen_random_uuid();
  v_res jsonb; v_res2 jsonb; v_post uuid; v_upd timestamptz;
  v_ok boolean; v_det text; v_cnt int;
  v_okref  text; v_badmime text; v_bigref text; v_otherref text;
begin
  if v_phase <> 'forward' then return; end if;
  select v into v_student from s2_fx where k = 'student';
  select v into v_mentor  from s2_fx where k = 'mentor';
  select v into v_mpend   from s2_fx where k = 'mpend';

  -- 라이브(legacy default privilege)와 달리 로컬 clean-install 은 client role 테이블
  -- grant 가 없다(Batch B 검증기와 동일 실측). 검증 보조 직접 SELECT 용 최소 grant 를
  -- 이 트랜잭션 안에서만 재현한다(말미 rollback 으로 소멸 — 영구 GRANT 변경 0).
  grant select on public.community_posts to authenticated;

  -- storage fixture (버킷은 037 실재 — 객체 행만 시딩, 말미 rollback)
  v_okref    := 'community-post-images/' || v_mentor || '/s2c-vf-ok.png';
  v_badmime  := 'community-post-images/' || v_mentor || '/s2c-vf-bad.pdf';
  v_bigref   := 'community-post-images/' || v_mentor || '/s2c-vf-big.png';
  v_otherref := 'community-post-images/' || v_student || '/s2c-vf-other.png';
  insert into storage.objects (bucket_id, name, owner_id, metadata) values
    ('community-post-images', v_mentor || '/s2c-vf-ok.png',  v_mentor::text, '{"mimetype":"image/png","size":1024}'::jsonb),
    ('community-post-images', v_mentor || '/s2c-vf-bad.pdf', v_mentor::text, '{"mimetype":"application/pdf","size":1024}'::jsonb),
    ('community-post-images', v_mentor || '/s2c-vf-big.png', v_mentor::text, '{"mimetype":"image/png","size":6291456}'::jsonb),
    ('community-post-images', v_student || '/s2c-vf-other.png', v_student::text, '{"mimetype":"image/png","size":1024}'::jsonb);

  -- C-24: F4 생성(마스킹·이미지 ref 저장) + T-CONC-10 replay-first(응답 유실 복구)
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_mentor, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_res := api_web_v1.community_post_create(
      p_title => 's2c-vf 글 연락 010-1234-5678',
      p_body  => 's2c-vf 본문입니다 카톡 abcd1234 메일 a@b.com',
      p_category => 'study', p_idempotency_key => v_key,
      p_image_refs => array[v_okref]);
    execute 'reset role';
    v_post := (v_res ->> 'post_id')::uuid;
    v_ok := (v_res->>'ok')::boolean and (v_res->>'idempotent_replay')::boolean = false
            and (select title from public.community_posts where id = v_post) = 's2c-vf 글 연락 [연락처 비공개]'
            and (select body from public.community_posts where id = v_post) = 's2c-vf 본문입니다 [연락처 비공개] 메일 [연락처 비공개]'
            and (select content from public.community_posts where id = v_post)
                = (select body from public.community_posts where id = v_post)
            and (select image_urls from public.community_posts where id = v_post) = array[v_okref]
            and (select author_label from public.community_posts where id = v_post) = '검증멘토일'
            and (select author_role from public.community_posts where id = v_post) = 'mentor';
    v_det := 'created=' || coalesce(v_res->>'post_id', '?');
    if v_ok then
      -- [T-CONC-10] 응답 유실 모사: 재호출 전 Storage DELETE 0(구조 보증 — C-08) →
      -- 동일 멱등키 재호출 → 동일 post_id + replay:true / image_refs 불변 / 객체 잔존
      perform set_config('request.jwt.claims', json_build_object('sub', v_mentor, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      v_res2 := api_web_v1.community_post_create(
        p_title => '다른 제목', p_body => '다른 본문 열자를 넘긴다', p_category => 'free',
        p_idempotency_key => v_key);
      execute 'reset role';
      v_ok := (v_res2->>'ok')::boolean and (v_res2->>'idempotent_replay')::boolean
              and v_res2->>'post_id' = v_post::text
              and (select count(*) from public.community_posts where create_idempotency_key = v_key) = 1
              and (select image_urls from public.community_posts where id = v_post) = array[v_okref]
              and exists (select 1 from storage.objects where bucket_id='community-post-images'
                           and name = v_mentor || '/s2c-vf-ok.png');
      v_det := v_det || ' replay=' || coalesce(v_res2->>'idempotent_replay','?');
    end if;
    if v_ok then
      -- 확정 실패(도메인 거부) 분기: 새 키 + BODY_TOO_SHORT → 행 0 · 객체 잔존(보상 삭제는 클라이언트)
      perform set_config('request.jwt.claims', json_build_object('sub', v_mentor, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      v_res2 := api_web_v1.community_post_create(
        p_title => 't', p_body => '짧다', p_category => 'free',
        p_idempotency_key => v_key2, p_image_refs => array[v_okref]);
      execute 'reset role';
      v_ok := v_res2->>'code' = 'BODY_TOO_SHORT'
              and not exists (select 1 from public.community_posts where create_idempotency_key = v_key2)
              and exists (select 1 from storage.objects where bucket_id='community-post-images'
                           and name = v_mentor || '/s2c-vf-ok.png');
      v_det := v_det || ' | 확정실패=' || coalesce(v_res2->>'code','?') || '+행0+객체잔존';
    end if;
    insert into s2_fx values ('post', v_post);
  exception when others then
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true);
  insert into s2_results(grp,test,pass,detail) values
    ('F4','24 생성+마스킹+라벨 + T-CONC-10 replay-first(유실 복구·확정실패 분기)', coalesce(v_ok,false), left(v_det,200));

  -- C-25: F4 자격·검증 오류 경로 (§9.4 — T-CON-02)
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_student, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_res := api_web_v1.community_post_create(p_title=>'t', p_body=>'본문입니다 열자를 넘긴다', p_category=>'free', p_idempotency_key=>gen_random_uuid());
    execute 'reset role';
    perform set_config('request.jwt.claims', json_build_object('sub', v_mpend, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_res2 := api_web_v1.community_post_create(p_title=>'t', p_body=>'본문입니다 열자를 넘긴다', p_category=>'free', p_idempotency_key=>gen_random_uuid());
    execute 'reset role';
    v_ok := v_res->>'code' = 'ROLE_NOT_MENTOR' and v_res2->>'code' = 'MENTOR_NOT_APPROVED';
    v_det := coalesce(v_res->>'code','?') || '/' || coalesce(v_res2->>'code','?');
    if v_ok then
      perform set_config('request.jwt.claims', json_build_object('sub', v_mentor, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      v_res  := api_web_v1.community_post_create(p_title=>'  ', p_body=>'본문입니다 열자를 넘긴다', p_category=>'free', p_idempotency_key=>gen_random_uuid());
      v_res2 := api_web_v1.community_post_create(p_title=>'t', p_body=>'짧다', p_category=>'free', p_idempotency_key=>gen_random_uuid());
      v_ok := v_res->>'code' = 'TITLE_REQUIRED' and v_res2->>'code' = 'BODY_TOO_SHORT';
      v_det := v_det || '/' || coalesce(v_res->>'code','?') || '/' || coalesce(v_res2->>'code','?');
      if v_ok then
        v_res  := api_web_v1.community_post_create(p_title=>'t', p_body=>'본문입니다 열자를 넘긴다', p_category=>'bad', p_idempotency_key=>gen_random_uuid());
        v_res2 := api_web_v1.community_post_create(p_title=>'t', p_body=>'짧다', p_category=>'free', p_idempotency_key=>gen_random_uuid(), p_status=>'draft');
        v_ok := v_res->>'code' = 'CATEGORY_INVALID' and (v_res2->>'ok')::boolean;  -- draft 는 10자 미만 허용
        v_det := v_det || '/' || coalesce(v_res->>'code','?') || '/draft=' || coalesce(v_res2->>'ok','?');
      end if;
      execute 'reset role';
    end if;
  exception when others then
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true);
  insert into s2_results(grp,test,pass,detail) values
    ('F4','25 자격·검증 오류 6종(§9.4)', coalesce(v_ok,false), left(v_det,200));

  -- C-26: B-4 이미지 검증 5종 (T-SEC-11 포함)
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_mentor, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_ok := true; v_det := '';
    v_res := api_web_v1.community_post_create(p_title=>'t', p_body=>'본문입니다 열자를 넘긴다', p_category=>'free', p_idempotency_key=>gen_random_uuid(), p_image_refs=>array['other-bucket/x/y.png']);
    v_ok := v_ok and v_res->>'code' = 'IMAGE_REF_INVALID'; v_det := v_det || coalesce(v_res->>'code','?');
    v_res := api_web_v1.community_post_create(p_title=>'t', p_body=>'본문입니다 열자를 넘긴다', p_category=>'free', p_idempotency_key=>gen_random_uuid(), p_image_refs=>array[v_otherref]);
    v_ok := v_ok and v_res->>'code' = 'IMAGE_NOT_OWNED'; v_det := v_det || '/' || coalesce(v_res->>'code','?');
    v_res := api_web_v1.community_post_create(p_title=>'t', p_body=>'본문입니다 열자를 넘긴다', p_category=>'free', p_idempotency_key=>gen_random_uuid(), p_image_refs=>array['community-post-images/' || v_mentor || '/none.png']);
    v_ok := v_ok and v_res->>'code' = 'IMAGE_OBJECT_NOT_FOUND'; v_det := v_det || '/' || coalesce(v_res->>'code','?');
    v_res := api_web_v1.community_post_create(p_title=>'t', p_body=>'본문입니다 열자를 넘긴다', p_category=>'free', p_idempotency_key=>gen_random_uuid(), p_image_refs=>array[v_badmime]);
    v_ok := v_ok and v_res->>'code' = 'IMAGE_MIME_NOT_ALLOWED'; v_det := v_det || '/' || coalesce(v_res->>'code','?');
    v_res := api_web_v1.community_post_create(p_title=>'t', p_body=>'본문입니다 열자를 넘긴다', p_category=>'free', p_idempotency_key=>gen_random_uuid(), p_image_refs=>array[v_bigref]);
    v_ok := v_ok and v_res->>'code' = 'IMAGE_SIZE_EXCEEDED'; v_det := v_det || '/' || coalesce(v_res->>'code','?');
    v_res := api_web_v1.community_post_create(p_title=>'t', p_body=>'본문입니다 열자를 넘긴다', p_category=>'free', p_idempotency_key=>gen_random_uuid(),
      p_image_refs=>array[v_okref, v_okref, v_okref, v_okref, v_okref, v_okref]);
    v_ok := v_ok and v_res->>'code' = 'IMAGE_COUNT_EXCEEDED'; v_det := v_det || '/' || coalesce(v_res->>'code','?');
    execute 'reset role';
  exception when others then
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true);
  insert into s2_results(grp,test,pass,detail) values
    ('B-4','26 이미지 ref 검증 6경로(§14.3)', coalesce(v_ok,false), left(v_det,200));

  -- C-27: F5·F6 — 낙관 충돌·수정·removed_image_refs·soft delete·already_deleted
  begin
    select v into v_post from s2_fx where k = 'post';
    select updated_at into v_upd from public.community_posts where id = v_post;
    perform set_config('request.jwt.claims', json_build_object('sub', v_mentor, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_res := api_web_v1.community_post_update(p_post_id=>v_post, p_title=>'수정', p_body=>'수정본문 열자를 넘긴다', p_category=>'free', p_expected_updated_at=>now() - interval '1 hour');
    v_ok := v_res->>'code' = 'UPDATE_CONFLICT'; v_det := coalesce(v_res->>'code','?');
    if v_ok then
      v_res := api_web_v1.community_post_update(p_post_id=>v_post, p_title=>'수정제목', p_body=>'수정본문 열자를 넘긴다', p_category=>'career', p_expected_updated_at=>v_upd, p_image_refs=>'{}');
      v_ok := (v_res->>'ok')::boolean and v_res->'removed_image_refs' = to_jsonb(array[v_okref])
              and (v_res->>'updated_at') is not null;
      v_det := v_det || ' | removed=' || coalesce((v_res->'removed_image_refs')::text,'?');
    end if;
    if v_ok then
      v_res := api_web_v1.community_post_soft_delete(v_post);
      v_res2 := api_web_v1.community_post_soft_delete(v_post);
      v_ok := (v_res->>'ok')::boolean and (v_res->>'deleted_at') is not null
              and (v_res2->>'ok')::boolean and (v_res2->>'already_deleted')::boolean
              and exists (select 1 from public.community_posts where id = v_post and deleted_at is not null);
      v_det := v_det || ' | del ok+already';
      -- 삭제 글 수정 → POST_NOT_FOUND_OR_NOT_OWNED / 타인 글 삭제 동일 코드
      v_res := api_web_v1.community_post_update(p_post_id=>v_post, p_title=>'x', p_body=>'본문입니다 열자를 넘긴다', p_category=>'free', p_expected_updated_at=>now());
      v_ok := v_ok and v_res->>'code' = 'POST_NOT_FOUND_OR_NOT_OWNED';
      execute 'reset role';
      perform set_config('request.jwt.claims', json_build_object('sub', v_student, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      v_res2 := api_web_v1.community_post_soft_delete(v_post);
      execute 'reset role';
      v_ok := v_ok and v_res2->>'code' = 'POST_NOT_FOUND_OR_NOT_OWNED';
      v_det := v_det || ' | ' || coalesce(v_res->>'code','?') || '/' || coalesce(v_res2->>'code','?');
    else
      execute 'reset role';
    end if;
  exception when others then
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true);
  insert into s2_results(grp,test,pass,detail) values
    ('F5/F6','27 낙관 충돌·removed_refs·soft delete·소유 코드', coalesce(v_ok,false), left(v_det,200));
end $$;

-- =============================================================================
-- 4. [forward] 기능 — F9 · V6/V7 (구독·정산 fixture) + 거부 경로
-- =============================================================================
do $$
declare
  v_phase text := coalesce(nullif(current_setting('s2_verify.phase', true), ''), 'forward');
  v_student uuid; v_student2 uuid; v_mentor uuid;
  v_plan uuid; v_sub uuid := gen_random_uuid(); v_sbe uuid := gen_random_uuid();
  v_res jsonb; v_cnt int; v_ok boolean; v_det text;
  v_label text; v_amount int;
begin
  if v_phase <> 'forward' then return; end if;
  select v into v_student  from s2_fx where k = 'student';
  select v into v_student2 from s2_fx where k = 'student2';
  select v into v_mentor   from s2_fx where k = 'mentor';

  -- fixture: 승인 시딩된 mentor_plans(standard) 사용 → active 구독 + billing event + 정산 항목
  select id, amount_cents into v_plan, v_amount from public.mentor_plans
   where mentor_id = v_mentor and plan_tier = 'standard' limit 1;
  insert into public.subscriptions (id, student_id, mentor_id, plan_id, plan_tier, status, started_at,
                                    current_period_start, current_period_end, next_billing_at, cancel_at_period_end)
  values (v_sub, v_student, v_mentor, v_plan, 'standard', 'active', now(), now(), now() + interval '30 days',
          now() + interval '30 days', false);
  insert into public.subscription_billing_events (id, subscription_id, student_id, mentor_id, event_type, status,
                                                  billing_at, amount_cents, plan_tier, plan_id)
  values (v_sbe, v_sub, v_student, v_mentor, 'initial', 'succeeded', now(), v_amount, 'standard', v_plan);
  insert into public.subscription_settlement_items (billing_event_id, subscription_id, mentor_id, student_id,
                                                    event_type, billing_at, period_start, period_end,
                                                    gross_cents, platform_fee_cents, mentor_amount_cents,
                                                    fee_rate, status, idempotency_key)
  values (v_sbe, v_sub, v_mentor, v_student, 'initial', now(), now(), now() + interval '30 days',
          8490000, 1273500, 7216500, 0.15, 'pending', 's2c_vf_ssi_1');

  -- C-28: V6 — 학생 1행(라벨·현재 플랜가) · 멘토 1행(당사자) · 제3자 0행 · F9 필드
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_student, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select count(*) into v_cnt from api_web_v1.my_subscriptions_self();
    select mentor_label into v_label from api_web_v1.my_subscriptions_self() where subscription_id = v_sub;
    v_ok := v_cnt = 1 and v_label = '검증멘토일'
            and (select current_plan_amount_cents from api_web_v1.my_subscriptions_self()
                  where subscription_id = v_sub) = v_amount;
    v_det := 'student rows=' || v_cnt || ' label=' || coalesce(v_label,'?');
    v_res := api_web_v1.account_deletion_status_self();
    v_ok := v_ok and (v_res->>'ok')::boolean and (v_res->>'contract_version')::int = 1
            and (v_res ? 'state') and (v_res ? 'cancelable_until') and (v_res ? 'job_id');
    execute 'reset role';
    if v_ok then
      perform set_config('request.jwt.claims', json_build_object('sub', v_mentor, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      select count(*) into v_cnt from api_web_v1.my_subscriptions_self();
      execute 'reset role';
      v_ok := v_cnt = 1;
      perform set_config('request.jwt.claims', json_build_object('sub', v_student2, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      select count(*) into v_cnt from api_web_v1.my_subscriptions_self();
      execute 'reset role';
      v_ok := v_ok and v_cnt = 0;
      v_det := v_det || ' | mentor=1 third=0 F9필드';
    end if;
  exception when others then
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true);
  insert into s2_results(grp,test,pass,detail) values
    ('V6','28 당사자 판정·라벨·current_plan_amount_cents·F9 필드', coalesce(v_ok,false), left(v_det,200));

  -- C-29: V7 — 멘토 1행(student_label) · 학생 0행 · PII 필드 부재
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_mentor, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select count(*) into v_cnt from api_web_v1.mentor_settlement_self();
    select student_label into v_label from api_web_v1.mentor_settlement_self() limit 1;
    execute 'reset role';
    v_ok := v_cnt = 1 and v_label = '검증학생일';
    v_det := 'mentor rows=' || v_cnt || ' label=' || coalesce(v_label,'?');
    if v_ok then
      perform set_config('request.jwt.claims', json_build_object('sub', v_student, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      select count(*) into v_cnt from api_web_v1.mentor_settlement_self();
      execute 'reset role';
      v_ok := v_cnt = 0;
      v_det := v_det || ' | student=0';
    end if;
  exception when others then
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true);
  insert into s2_results(grp,test,pass,detail) values
    ('V7','29 멘토 자기 정산·student_label·비당사자 0', coalesce(v_ok,false), left(v_det,160));

  -- C-30: 거부 경로 — anon EXECUTE 거부(T-PERM-07) + 무세션 V6/V7 = AUTH_REQUIRED 42501(T-PERM-13 상당)
  begin
    v_ok := false; v_det := 'no error raised';
    begin
      execute 'set local role anon';
      execute 'select count(*) from api_web_v1.my_subscriptions_self()';
      execute 'reset role';
    exception when insufficient_privilege then
      v_ok := true; v_det := 'anon V6 42501';
    end;
    if v_ok then
      v_ok := false;
      begin
        perform set_config('request.jwt.claims', '', true);
        perform * from api_web_v1.my_subscriptions_self();  -- 무세션(auth.uid() NULL)
      exception when others then
        v_ok := (sqlstate = '42501' and sqlerrm like '%AUTH_REQUIRED%');
        v_det := v_det || ' | 무세션 ' || sqlstate || ' ' || sqlerrm;
      end;
    end if;
    if v_ok then
      v_ok := false;
      begin
        perform * from api_web_v1.mentor_settlement_self();
      exception when others then
        v_ok := (sqlstate = '42501' and sqlerrm like '%AUTH_REQUIRED%');
        v_det := v_det || ' | V7 동일';
      end;
    end if;
  end;
  insert into s2_results(grp,test,pass,detail) values
    ('PERM','30 anon EXECUTE 거부 + 무세션 AUTH_REQUIRED(42501)', coalesce(v_ok,false), left(v_det,200));
end $$;

-- =============================================================================
-- 5. [post_rollback] — Batch C 객체 0 + Batch A·B 불변
-- =============================================================================
do $$
declare
  v_phase text := coalesce(nullif(current_setting('s2_verify.phase', true), ''), 'forward');
begin
  if v_phase <> 'post_rollback' then return; end if;

  insert into s2_results(grp,test,pass,detail) values
    ('ROLLBACK','01 Batch C 13객체 부재(api_web_v1 fn 0 · core_private fn 0)',
     (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname in ('api_web_v1','core_private')) = 0, null);
  insert into s2_results(grp,test,pass,detail) values
    ('ROLLBACK','02 Batch B 상태 불변(스키마 2·view 5·M13 트리거 4)',
     (select count(*) from pg_namespace where nspname in ('api_web_v1','core_private')) = 2
     and (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
           where n.nspname='api_web_v1' and c.relkind='v') = 5
     and (select count(*) from pg_trigger where not tgisinternal
           and tgname in ('trg_comments_set_author_label_ins','trg_comments_set_author_label_upd',
                          'trg_community_comments_set_author_label_ins','trg_community_comments_set_author_label_upd')) = 4, null);
  insert into s2_results(grp,test,pass,detail) values
    ('ROLLBACK','03 정본 public 함수·Batch A 객체 잔존',
     exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
              where n.nspname='public' and p.proname='qna_create_question_thread')
     and exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
              where n.nspname='public' and p.proname='get_weekly_question_usage')
     and exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
              where n.nspname='public' and p.proname='enforce_mentor_profile_privileged_guard'), null);
end $$;

-- -----------------------------------------------------------------------------
-- 6. 결과 보고 + 게이트 (FAIL ≥1 → 예외로 전체 rollback)
-- -----------------------------------------------------------------------------
select grp, test, case when pass then 'PASS' else 'FAIL' end as result, detail
  from s2_results order by seq;

select count(*) filter (where pass) || '/' || count(*) as passed from s2_results;

do $$
declare
  v_fail int; v_list text;
begin
  select count(*), string_agg(grp || ':' || test, ' | ') filter (where not pass)
    into v_fail, v_list from s2_results where not pass;
  if v_fail > 0 then
    raise exception 'S2_BATCH_C_VERIFY_FAILED: % failing test(s) — %', v_fail, v_list;
  end if;
  raise notice 'S2_BATCH_C_VERIFY: ALL PASS (phase=%)',
    coalesce(nullif(current_setting('s2_verify.phase', true), ''), 'forward');
end $$;

-- 모든 fixture DML(s2c-vf-*) 은 여기서 파기된다(잔여 0 보증).
rollback;

-- -----------------------------------------------------------------------------
-- 7. rollback 후 fixture 잔여 0 확인
-- -----------------------------------------------------------------------------
do $$
declare
  v_cnt bigint;
begin
  select count(*) into v_cnt from auth.users where email like 's2c-vf-%@example.invalid';
  if v_cnt > 0 then raise exception 'S2_FIXTURE_RESIDUE: auth.users % rows remain', v_cnt; end if;
  select count(*) into v_cnt from public.community_posts where title like 's2c-vf%' or title like '수정제목';
  if v_cnt > 0 then raise exception 'S2_FIXTURE_RESIDUE: community_posts % rows remain', v_cnt; end if;
  select count(*) into v_cnt from storage.objects where name like '%s2c-vf-%';
  if v_cnt > 0 then raise exception 'S2_FIXTURE_RESIDUE: storage.objects % rows remain', v_cnt; end if;
  select count(*) into v_cnt from public.subscription_settlement_items where idempotency_key = 's2c_vf_ssi_1';
  if v_cnt > 0 then raise exception 'S2_FIXTURE_RESIDUE: settlement items remain'; end if;
  raise notice 'S2_BATCH_C_VERIFY: fixture residue 0';
end $$;
