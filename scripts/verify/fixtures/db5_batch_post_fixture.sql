-- db5_batch_post_fixture.sql — DB-5(205~208) 적용 후 실구동 assertion (오프라인 스크래치 PG 전용).
-- 전체가 단일 트랜잭션이며 마지막 ROLLBACK 으로 검증 쓰기를 전부 지운다(적용 상태는 그대로 남는다).
-- JWT 에뮬레이션: platform_stub 의 auth.uid()/auth.jwt() 는 request.jwt.claim.sub / request.jwt.claims 를 읽는다. `set local role anon|authenticated` 로 실제 클라이언트 역할을 재현한다.
-- 재실행 안전: [4b] 의 forward 커밋 데이터(D1·D2)가 있어도 통과하도록 사용자 수·정책 수는 스냅샷 대비 상대값으로 본다.
-- 규칙: 상태를 바꾸는 호출과 그 결과를 읽는 스칼라 서브쿼리를 한 문장에 섞지 않는다(변경은 한 문장, 확인은 다음 문장).
begin;
set local search_path to public;

create or replace function pg_temp.ok(p_cond boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_cond, false) then raise notice 'POST ok   %', p_label;
  else raise exception 'POST FAIL %', p_label; end if;
end $$;
create or replace function pg_temp.as_user(p_uid uuid, p_role text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  perform set_config('request.jwt.claims', case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', p_role)::text end, true);
end $$;
create or replace function pg_temp.try(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql; return 'OK';
exception when others then return left(sqlerrm, 100);
end $$;
-- 오류 메시지|PG_EXCEPTION_DETAIL (ACCOUNT_BLOCKED 의 상태값 확인용)
create or replace function pg_temp.try_detail(p_sql text) returns text language plpgsql as $$
declare d text;
begin
  execute p_sql; return 'OK';
exception when others then
  get stacked diagnostics d = pg_exception_detail;
  return left(sqlerrm, 60) || '|' || coalesce(d, '');
end $$;
create or replace function pg_temp.snap(p_key text) returns text language sql as $$ select val from db5_check.snapshot where key = p_key $$;
create temp table db5_res (key text primary key, val jsonb) on commit drop;
grant select, insert, update on db5_res to authenticated;
create or replace function pg_temp.res(p_key text) returns jsonb language sql as $$ select val from db5_res where key = p_key $$;
-- envelope 호출 + 기대 코드('OK' = ok:true) 대조. 결과는 db5_res 에 보존.
create or replace function pg_temp.expect(p_key text, p_sql text, p_code text, p_label text) returns void language plpgsql as $$
declare r jsonb;
begin
  execute p_sql into r;
  insert into db5_res values (p_key, r) on conflict (key) do update set val = excluded.val;
  if p_code = 'OK' then
    if coalesce((r ->> 'ok')::boolean, false) then raise notice 'POST ok   %', p_label;
    else raise exception 'POST FAIL % — got %', p_label, r; end if;
  else
    if not coalesce((r ->> 'ok')::boolean, false) and (r ->> 'code') = p_code then raise notice 'POST ok   % [%]', p_label, p_code;
    else raise exception 'POST FAIL % — expected % got %', p_label, p_code, r; end if;
  end if;
end $$;
-- setof individual_questions 호출을 jsonb 로 보존
create or replace function pg_temp.iq(p_key text, p_sql text) returns void language plpgsql as $$
declare r jsonb;
begin
  execute 'select to_jsonb(q) from (' || p_sql || ') q' into r;
  insert into db5_res values (p_key, r) on conflict (key) do update set val = excluded.val;
end $$;

-- 고정 ID
\set admin '''9bf48819-1dd2-40dd-96a3-d64bcca2e60c'''
\set m1 '''00000000-0000-4000-8000-00000000d5a1'''
\set m2 '''00000000-0000-4000-8000-00000000d5a2'''
\set m7 '''00000000-0000-4000-8000-00000000d5a7'''
\set s1 '''00000000-0000-4000-8000-00000000d5b1'''
\set s2 '''00000000-0000-4000-8000-00000000d5b2'''
\set s3 '''00000000-0000-4000-8000-00000000d5b3'''
\set s4 '''00000000-0000-4000-8000-00000000d5b4'''
\set s5 '''00000000-0000-4000-8000-00000000d5b5'''
\set s6 '''00000000-0000-4000-8000-00000000d5b6'''
\set c1 '''00000000-0000-4000-8000-00000000d5c1'''
\set c2 '''00000000-0000-4000-8000-00000000d5c2'''
\set c3 '''00000000-0000-4000-8000-00000000d5c3'''
\set c4 '''00000000-0000-4000-8000-00000000d5c4'''
\set c5 '''00000000-0000-4000-8000-00000000d5c5'''
\set c6 '''00000000-0000-4000-8000-00000000d5c6'''
\set rev6 '''00000000-0000-4000-8000-00000000d5f9'''

-- ═══ 0. 적용 상태 · ACL ═══
select pg_temp.ok((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api_app_v1') = 19, '0 api_app_v1 함수 19(16 + complete_profile · v3 · review_eligibility_self)');
select pg_temp.ok((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'core_private') = 12, '0 core_private 함수 12(8 + signup provision impl · consent impl · review impl · account gate)');
select pg_temp.ok((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public') = pg_temp.snap('fn_public_count')::int + 2, '0 public 함수 +2(plan_price_stats · user_profile_completed)');
select pg_temp.ok((select count(*) from pg_policies where schemaname = 'public')::text = pg_temp.snap('policies_count'), '0 public 정책 수 불변(이름 유지 재생성)');
select pg_temp.ok((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api_app_v1'
                    and p.proname in ('complete_profile', 'create_individual_question_as_student_v3', 'review_eligibility_self')
                    and p.prosecdef and not has_function_privilege('anon', p.oid, 'EXECUTE') and has_function_privilege('authenticated', p.oid, 'EXECUTE')
                    and not has_function_privilege('service_role', p.oid, 'EXECUTE')) = 3, '0 api_app_v1 신규 3종 SECDEF · authenticated 만 · anon/service_role 0');
select pg_temp.ok((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'core_private'
                    and p.proname in ('user_signup_provision_impl', 'user_consent_signup_impl', 'review_eligibility_impl', 'account_blocked_state')
                    and not has_function_privilege('anon', p.oid, 'EXECUTE') and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
                    and not has_function_privilege('service_role', p.oid, 'EXECUTE')) = 4, '0 core_private 신규 4종 외부 EXECUTE 0');

-- ═══ A. 요금제 평균가 (205) — 승인 6 · 활성 필터 · 100원 반올림 · 표본 5 경계 · 4 fallback ═══
select pg_temp.ok((select row(sample_count, avg_won, min_won, max_won, fallback)::text from public.plan_price_stats() where plan_tier = 'limited') = '(6,32600,29900,40000,f)',
                  'A-1 limited: 표본 6 · 평균 32,633.33 → 32,600 · 최소 29,900 · 최대 40,000(미승인 M7 69,000 제외) · fallback false');
select pg_temp.ok((select row(sample_count, avg_won, min_won, max_won, fallback)::text from public.plan_price_stats() where plan_tier = 'standard') = '(5,84900,84900,84900,f)',
                  'A-1 standard: 표본 5(경계 · M6 비활성 제외) · 84,900 · fallback false');
select pg_temp.ok((select row(sample_count, avg_won, min_won, max_won, fallback)::text from public.plan_price_stats() where plan_tier = 'premium') = '(4,174900,174900,200000,t)',
                  'A-1 premium: 표본 4 → fallback true · avg_won = 최소 174,900 · 최대 200,000');
select pg_temp.ok((select string_agg(plan_tier, ',' order by plan_tier) from public.plan_price_stats()) = 'limited,premium,standard' and (select count(*) from public.plan_price_stats()) = 3, 'A-1 항상 3행');
-- 반올림 검산: 운영 실측식(2026-09-06 limited 30,036 → 30,000 · standard 85,302.67 → 85,300 · premium 175,569.33 → 175,600)과 같은 식
select pg_temp.ok((round(3003600 / 10000.0) * 100)::int = 30000 and (round(8530267 / 10000.0) * 100)::int = 85300 and (round(17556933 / 10000.0) * 100)::int = 175600, 'A-1 반올림식 운영 실측 3값 재현(30,000 · 85,300 · 175,600)');
set local role anon;
select pg_temp.ok((select count(*) from public.plan_price_stats()) = 3 and (select avg_won from public.plan_price_stats() where plan_tier = 'limited') = 32600, 'A-2 anon(비로그인 메인) 호출 가능 · 같은 값');
select pg_temp.ok(pg_temp.try($q$ select amount_cents from public.mentor_plans limit 1 $q$) = 'OK', 'A-2 (참고) mentor_plans 는 anon 도 읽는다 — 함수는 집계 6열만 노출');
reset role;
-- 표본 0 → 금액 NULL · fallback true (standard 전부 비활성 · 트랜잭션 끝에 되돌아간다)
update public.mentor_plans set is_active = false where plan_tier = 'standard';
select pg_temp.ok((select row(sample_count, avg_won, min_won, max_won, fallback)::text from public.plan_price_stats() where plan_tier = 'standard') = '(0,,,,t)', 'A-3 표본 0 → sample 0 · 금액 NULL · fallback true(웹은 카탈로그 표시가 폴백)');
update public.mentor_plans set is_active = true where plan_tier = 'standard' and mentor_id not in (:m2, '00000000-0000-4000-8000-00000000d5a6');   -- M2·M6 standard 만 꺼 두고 승인 4명 → fallback
select pg_temp.ok((select row(sample_count, avg_won, fallback)::text from public.plan_price_stats() where plan_tier = 'standard') = '(4,84900,t)', 'A-3 표본 4 → fallback true · 최소값');
update public.mentor_plans set is_active = true where plan_tier = 'standard' and mentor_id <> '00000000-0000-4000-8000-00000000d5a6';

-- ═══ B. 가입 트리거 소셜 대응 (206) ═══
select pg_temp.ok((select count(*) from public.users where profile_completed_at is null) = 0
                  and (select count(*) from public.users where profile_completed_at is distinct from created_at and id not in ('00000000-0000-4000-8000-00000000d5d1','00000000-0000-4000-8000-00000000d5d2')) = 0,
                  'B-0 기존 가입자 전원 profile_completed_at = created_at 백필');
select pg_temp.ok((select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'users' and column_name = 'role') = 'YES'
                  and exists (select 1 from pg_constraint where conrelid = 'public.users'::regclass and conname = 'users_role_required_when_completed')
                  and exists (select 1 from pg_constraint where conrelid = 'public.users'::regclass and conname = 'users_role_check'), 'B-0 role NOT NULL 완화 + CHECK(완성 시 role 필수) · users_role_check 유지');
-- 소셜 가입 3종 + 이메일 가입 1종
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', :c1, 'authenticated', 'authenticated', 'c1@test.local',
   '{"iss":"https://kauth.kakao.com","sub":"k1","name":"카카오유저","avatar_url":"https://x/y.png","email":"c1@test.local","email_verified":true,"provider_id":"k1"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', :c2, 'authenticated', 'authenticated', null,
   '{"iss":"https://kauth.kakao.com","sub":"k2","full_name":"이메일없음","provider_id":"k2"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', :c3, 'authenticated', 'authenticated', 'c3@test.local',
   '{"app_role":"mentor","full_name":"이메일멘토","nickname":"멘토닉","university_name":"서울대학교","department_name":"수학과","teaching_subjects_csv":"수학, 물리","high_school_name":"검증고","terms_agreed":"true","privacy_agreed":"true","marketing_agreed":"false","birth_date":"2000-01-01"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', :c4, 'authenticated', 'authenticated', 'c4@test.local',
   '{"iss":"https://accounts.google.com","sub":"g4","name":"구글유저","email":"c4@test.local","email_verified":true,"provider_id":"g4"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', :c5, 'authenticated', 'authenticated', 'c5@test.local',
   '{"iss":"https://appleid.apple.com","sub":"a5","email":"c5@test.local","provider_id":"a5"}'::jsonb, now(), now());
select pg_temp.ok((select role is null and profile_completed_at is null and nickname = '카카오유저' and full_name = '카카오유저' and email = 'c1@test.local' and status = 'active'
                     and terms_agreed_at is null and privacy_agreed_at is null and marketing_agreed = false and birth_date is null from public.users where id = :c1),
                  'B-1 ★ 소셜 가입(app_role 없음 · provider 메타): role NULL · profile_completed_at NULL · 이름 = provider name · email = auth.users · 약관/생년월일 NULL');
select pg_temp.ok((select count(*) from public.mentor_profiles where user_id = :c1) = 0 and (select count(*) from public.verification_logs where user_id = :c1) = 0
                  and (select count(*) from public.user_consent_records where user_id = :c1) = 0, 'B-1 소셜 가입: 프로필 행 0 · 인증 로그 0 · 동의 원장 0');
select pg_temp.ok((select role is null and email is null and full_name = '이메일없음' and nickname = '이메일없음' from public.users where id = :c2), 'B-1 소셜 가입 · 이메일 미동의(auth.users.email NULL): users.email NULL 로 생성(실패 없음)');
select pg_temp.ok((select role is null and full_name is null and nickname is null and email = 'c5@test.local' from public.users where id = :c5), 'B-1 소셜 가입 · 이름 없는 provider(Apple): 이름 NULL 로 생성');
select pg_temp.ok((select role = 'mentor' and profile_completed_at is not null and terms_agreed_at is not null and privacy_agreed_at is not null and marketing_agreed = false
                     and nickname = '멘토닉' and birth_date = date '2000-01-01' from public.users where id = :c3),
                  'B-2 ★ 이메일 가입(app_role 있음): 지금 그대로 + profile_completed_at = now()');
select pg_temp.ok((select university_name = '서울대학교' and department_name = '수학과' and teaching_subjects = array['수학','물리'] and high_school_name = '검증고' and verification_status = 'pending'
                     from public.mentor_profiles where user_id = :c3)
                  and (select count(*) from public.verification_logs where user_id = :c3 and log_type = 'mentor_verification' and status = 'pending') = 1
                  and (select count(*) from public.user_consent_records where user_id = :c3) = 2
                  and (select count(*) from public.user_consent_records where user_id = :c3 and consent_type in ('terms','privacy')) = 2,
                  'B-2 이메일 멘토 가입: mentor_profiles pending(122 동일) · 인증 로그 1 · 동의 원장 정확히 2(impl 기록 · zz 트리거 멱등 no-op · 중복 0)');
select pg_temp.ok((select count(distinct consent_actor || '|' || guardian_consent::text || '|' || consent_version || '|' || source || '|' || (select string_agg(k, ',' order by k) from jsonb_object_keys(metadata) k) || '|' || (idempotency_key = 'signup:' || user_id::text || ':' || consent_type || ':' || consent_version)::text) from public.user_consent_records where user_id = :c3) = 1
                  and (select consent_actor || '|' || guardian_consent::text || '|' || consent_version || '|' || source || '|' || (select string_agg(k, ',' order by k) from jsonb_object_keys(metadata) k) || '|' || (idempotency_key = 'signup:' || user_id::text || ':' || consent_type || ':' || consent_version)::text from public.user_consent_records where user_id = :c3 limit 1) = 'user|false|legal-placeholder-2026-06-20|signup|age_gate_checked_at,birth_date,role,verification_method|true'
                  and (select bool_and(metadata ->> 'role' = 'mentor' and metadata ->> 'birth_date' = '2000-01-01' and metadata ->> 'verification_method' = 'legal_review_pending' and not is_minor) from public.user_consent_records where user_id = :c3),
                  'B-2 이메일 가입 원장 행 모양 = 187 원문(actor user · version 기본값 · source signup · metadata 4키 · 멱등 키 signup:<uid>:<type>:<version>)');
select pg_temp.ok(pg_temp.try(format($q$ update public.users set profile_completed_at = now() where id = %L $q$, :c1::uuid)) like '%users_role_required_when_completed%', 'B-3 CHECK: role NULL 인 채 완성 시각만 채우기 거부');

-- 완성 전 사용자(c1)의 접근 — 자기 users 행 읽기만 · 쓰기 전부 거부
set local role authenticated;
select pg_temp.as_user(:c1, 'authenticated');
select pg_temp.ok((select count(*) from public.users where id = :c1) = 1 and (select profile_completed_at is null and role is null from public.users where id = :c1), 'B-4 완성 전: 자기 users 행 읽기 OK(users_select_own)');
select pg_temp.ok((select count(*) from public.question_threads) = 0 and (select count(*) from public.subscriptions) = 0 and (select count(*) from public.cash_wallets) = 0
                  and (select count(*) from public.individual_questions) = 0 and (select count(*) from public.notifications) = 0, 'B-4 완성 전: 질문방·구독·지갑·개별질문·알림 SELECT 0행');
select pg_temp.ok(pg_temp.try(format($q$ insert into public.favorites (user_id, mentor_id) values (%L, %L) $q$, :c1::uuid, :m1::uuid)) like '%row-level security%', 'B-4 완성 전 거부: favorites INSERT');
select pg_temp.ok(pg_temp.try(format($q$ insert into public.user_blocks (blocker_id, blocked_id) values (%L, %L) $q$, :c1::uuid, :m1::uuid)) like '%row-level security%', 'B-4 완성 전 거부: user_blocks INSERT');
select pg_temp.ok(pg_temp.try(format($q$ insert into public.content_reports (reporter_id, target_type, target_id, reason) values (%L, 'user', %L, '신고') $q$, :c1::uuid, :m1::uuid)) like '%row-level security%', 'B-4 완성 전 거부: content_reports INSERT');
select pg_temp.try(format($q$ insert into public.free_question_usage (student_id, mentor_id) values (%L, %L) $q$, :c1::uuid, :m1::uuid));
select pg_temp.ok((select count(*) from public.free_question_usage where student_id = :c1) = 0, 'B-4 완성 전: free_question_usage 행 0(레거시 standalone noop 트리거가 행을 버린다 — 정책 게이트는 방 경로에서만 의미)');
select pg_temp.ok(pg_temp.try(format($q$ insert into public.payments (user_id, amount, status) values (%L, 1000, 'pending') $q$, :c1::uuid)) like '%row-level security%', 'B-4 완성 전 거부: payments intent INSERT');
select pg_temp.ok(pg_temp.try(format($q$ insert into public.verification_logs (user_id, log_type, status) values (%L, 'x', 'pending') $q$, :c1::uuid)) like '%row-level security%', 'B-4 완성 전 거부: verification_logs INSERT');
select pg_temp.ok(pg_temp.try(format($q$ insert into public.device_tokens (user_id, token) values (%L, 'tok') $q$, :c1::uuid)) like '%row-level security%', 'B-4 완성 전 거부: device_tokens INSERT');
select pg_temp.ok(pg_temp.try(format($q$ insert into public.notification_settings (user_id) values (%L) $q$, :c1::uuid)) like '%row-level security%', 'B-4 완성 전 거부: notification_settings INSERT');
select pg_temp.ok(pg_temp.try(format($q$ insert into public.ai_drafts (mentor_id, draft_body) values (%L, 'd') $q$, :c1::uuid)) like '%row-level security%', 'B-4 완성 전 거부: ai_drafts INSERT');
select pg_temp.ok(pg_temp.try(format($q$ insert into public.custom_request_posts (author_id) values (%L) $q$, :c1::uuid)) like '%row-level security%', 'B-4 완성 전 거부: custom_request_posts INSERT(crp_insert OR is_admin 형 + 레거시 to public)');
select pg_temp.ok(pg_temp.try(format($q$ insert into public.custom_request_applications (post_id, mentor_id) values (gen_random_uuid(), %L) $q$, :c1::uuid)) like '%row-level security%', 'B-4 완성 전 거부: custom_request_applications INSERT(cra_insert OR is_admin 형 + 레거시)');
select pg_temp.ok(pg_temp.try(format($q$ insert into public.custom_request_orders (post_id, student_id, mentor_id) values (gen_random_uuid(), %L, %L) $q$, :c1::uuid, :m1::uuid)) like '%row-level security%', 'B-4 완성 전 거부: custom_request_orders INSERT(cro_insert OR is_admin 형)');
select pg_temp.ok(pg_temp.try(format($q$ insert into public.custom_order_messages (custom_request_order_id, author_id, body) values (gen_random_uuid(), %L, 'b') $q$, :c1::uuid)) like '%row-level security%', 'B-4 완성 전 거부: custom_order_messages INSERT');
select pg_temp.ok(pg_temp.try(format($q$ insert into public.custom_order_deliverables (custom_request_order_id, mentor_id) values (gen_random_uuid(), %L) $q$, :c1::uuid)) like '%row-level security%', 'B-4 완성 전 거부: custom_order_deliverables INSERT');
select pg_temp.ok(pg_temp.try(format($q$ insert into public.admin_action_logs (admin_id, action_type) values (%L, 'x') $q$, :c1::uuid)) like '%row-level security%', 'B-4 완성 전 거부: admin_action_logs INSERT');
select pg_temp.ok(pg_temp.try(format($q$ insert into public.withdrawals (mentor_id, amount_cash, status) values (%L, 1000, 'requested') $q$, :c1::uuid)) <> 'OK', 'B-4 완성 전 거부: withdrawals INSERT');
select pg_temp.ok(pg_temp.try(format($q$ update public.users set role = 'student' where id = %L $q$, :c1::uuid)) like '%permission denied%', 'B-4 완성 전 거부: users 직접 UPDATE(권한 없음 — 20260803162257)');
select pg_temp.expect('B4sub', format($q$ select api_app_v1.subscribe_with_cash(%L, 'limited', 'k-c1') $q$, :m1::uuid), 'ROLE_NOT_STUDENT', 'B-4 완성 전 거부: subscribe_with_cash');
select pg_temp.ok(pg_temp.try($q$ select * from api_app_v1.create_individual_question_as_student_v3('open', 't', 'b', 100000, null, 'k-c1-iq', 'math_calculus', null, null, null) $q$) like '%invalid_student%', 'B-4 완성 전 거부: 개별질문 v3(코어 invalid_student)');
select pg_temp.ok(pg_temp.try($q$ select api_app_v1.user_profile_update_self_v2('닉', null, null) $q$) like '%ROLE_NOT_ALLOWED%', 'B-4 완성 전 거부: user_profile_update_self_v2(impl NULL 거부 보강 — 보강 전엔 통과했다)');
select pg_temp.ok(pg_temp.try($q$ select api_app_v1.user_profile_update_self('닉', null) $q$) like '%ROLE_NOT_ALLOWED%' and pg_temp.try($q$ select api_web_v1.user_profile_update_self('닉', null) $q$) like '%ROLE_NOT_ALLOWED%', 'B-4 완성 전 거부: 앱 v1 · 웹 self 프로필 RPC(같은 impl)');
select pg_temp.expect('B4cp', $q$ select api_app_v1.community_post_create('제목', '본문 본문 본문', 'free', gen_random_uuid(), null, 'published') $q$, 'ROLE_NOT_ALLOWED', 'B-4 완성 전 거부: community_post_create(envelope · 역할 검사)');
select pg_temp.ok(not public.user_profile_completed(), 'B-4 user_profile_completed() = false');
reset role;
set local role anon;
select pg_temp.as_user(null, 'anon');
select pg_temp.ok(pg_temp.try($q$ select api_app_v1.complete_profile('student', 'x', '2000-01-01', true, false, '고1', null, null) $q$) like '%permission denied%', 'B-5 anon: complete_profile EXECUTE 거부');
select pg_temp.ok(not public.user_profile_completed(), 'B-5 anon: user_profile_completed() = false');
reset role;

-- ═══ C. 프로필 완성 RPC (206) ═══
set local role authenticated;
select pg_temp.as_user(:c1, 'authenticated');
select pg_temp.expect('C1', $q$ select api_app_v1.complete_profile('student', '소셜닉', '2013-05-05', false, false, '중1', null, null) $q$, 'TERMS_REQUIRED', 'C-1 필수 약관 미동의');
select pg_temp.expect('C2', $q$ select api_app_v1.complete_profile('student', '소셜닉', '2013-05-05', true, false, null, null, null) $q$, 'GRADE_REQUIRED', 'C-1 학생 학년 없음');
select pg_temp.expect('C3', $q$ select api_app_v1.complete_profile('mentor', '소셜닉', '2000-05-05', true, false, null, null, null) $q$, 'UNIVERSITY_REQUIRED', 'C-1 멘토 대학 없음');
select pg_temp.expect('C4', $q$ select api_app_v1.complete_profile('admin', '소셜닉', '2000-05-05', true, false, '고1', null, null) $q$, 'ROLE_INVALID', 'C-1 admin 불가');
select pg_temp.expect('C5', $q$ select api_app_v1.complete_profile('student', '  ', '2000-05-05', true, false, '고1', null, null) $q$, 'DISPLAY_NAME_REQUIRED', 'C-1 표시명 없음');
select pg_temp.expect('C6', $q$ select api_app_v1.complete_profile('student', repeat('닉', 31), '2000-05-05', true, false, '고1', null, null) $q$, 'DISPLAY_NAME_TOO_LONG', 'C-1 표시명 31자(UTF8 char_length)');
select pg_temp.expect('C7', $q$ select api_app_v1.complete_profile('student', '소셜닉', null, true, false, '고1', null, null) $q$, 'BIRTHDATE_REQUIRED', 'C-1 생년월일 없음');
select pg_temp.expect('C8', $q$ select api_app_v1.complete_profile('student', '소셜닉', (current_date + 1)::date, true, false, '고1', null, null) $q$, 'BIRTHDATE_INVALID', 'C-1 미래 생년월일');
select pg_temp.expect('C9', $q$ select api_app_v1.complete_profile('student', '소셜닉', '2000-05-05', true, false, repeat('고', 21), null, null) $q$, 'GRADE_LEVEL_TOO_LONG', 'C-1 학년 21자');
select pg_temp.ok((select role is null and profile_completed_at is null from public.users where id = :c1) and (select count(*) from public.user_consent_records where user_id = :c1) = 0, 'C-1 실패 호출은 행·동의 원장을 바꾸지 않는다');
-- 만 13세 학생 → guardian_consent
select pg_temp.expect('C10', $q$ select api_app_v1.complete_profile('student', '소셜닉', ((now() at time zone 'Asia/Seoul')::date - interval '13 years')::date, true, true, '중1', null, null) $q$, 'OK', 'C-2 ★ 학생 완성(만 13세)');
select pg_temp.ok((pg_temp.res('C10') ->> 'role') = 'student' and (pg_temp.res('C10') ->> 'is_minor')::boolean and (pg_temp.res('C10') ->> 'next') = 'guardian_consent' and (pg_temp.res('C10') ->> 'nickname') = '소셜닉',
                  'C-2 반환: role student · is_minor true · next guardian_consent');
select pg_temp.ok((select role = 'student' and nickname = '소셜닉' and full_name = '카카오유저' and grade_level = '중1' and terms_agreed_at is not null and privacy_agreed_at is not null and marketing_agreed = true
                     and profile_completed_at is not null and birth_date = ((now() at time zone 'Asia/Seoul')::date - interval '13 years')::date from public.users where id = :c1),
                  'C-2 users 갱신: role · nickname(표시명) · full_name 유지(provider) · 학년 · 약관/개인정보 시각 · 마케팅 · 완성 시각 · 생년월일');
select pg_temp.ok((select count(*) from public.mentor_profiles where user_id = :c1) = 0, 'C-2 학생은 프로필 행 없음(student_profiles 부재)');
reset role;   -- 원장 대조는 서비스 시점(RLS 밖)에서 — c3 행과 비교
select pg_temp.ok((select string_agg(consent_type, ',' order by consent_type) from public.user_consent_records where user_id = :c1) = 'marketing,privacy,terms'
                  and (select count(distinct consent_actor || '|' || guardian_consent::text || '|' || consent_version || '|' || source || '|' || (select string_agg(k, ',' order by k) from jsonb_object_keys(metadata) k) || '|' || (idempotency_key = 'signup:' || user_id::text || ':' || consent_type || ':' || consent_version)::text) from public.user_consent_records where user_id = :c1) = 1
                  and (select consent_actor || '|' || guardian_consent::text || '|' || consent_version || '|' || source || '|' || (select string_agg(k, ',' order by k) from jsonb_object_keys(metadata) k) || '|' || (idempotency_key = 'signup:' || user_id::text || ':' || consent_type || ':' || consent_version)::text from public.user_consent_records where user_id = :c1 limit 1) = (select consent_actor || '|' || guardian_consent::text || '|' || consent_version || '|' || source || '|' || (select string_agg(k, ',' order by k) from jsonb_object_keys(metadata) k) || '|' || (idempotency_key = 'signup:' || user_id::text || ':' || consent_type || ':' || consent_version)::text from public.user_consent_records where user_id = :c3 limit 1),
                  'C-2 ★ 동의 원장(후속 a): terms · privacy · marketing 3행 — 이메일 가입(c3) 행과 같은 모양(actor · guardian false · version · source signup · metadata 4키 · 멱등 키 형식)');
select pg_temp.ok((select bool_and(is_minor and metadata ->> 'role' = 'student' and metadata ->> 'birth_date' = ((now() at time zone 'Asia/Seoul')::date - interval '13 years')::date::text
                                      and metadata ->> 'verification_method' = 'legal_review_pending' and metadata -> 'age_gate_checked_at' = 'null'::jsonb and agreed_at is not null)
                     from public.user_consent_records where user_id = :c1), 'C-2 동의 원장 값: is_minor true(만 13세) · role student · birth_date · verification_method legal_review_pending');
set local role authenticated;
select pg_temp.as_user(:c1, 'authenticated');
select pg_temp.expect('C11', $q$ select api_app_v1.complete_profile('student', '소셜닉', '2013-05-05', true, true, '중1', null, null) $q$, 'ALREADY_COMPLETED', 'C-2 두 번째 호출');
select pg_temp.ok((pg_temp.res('C11') ->> 'role') = 'student', 'C-2 ALREADY_COMPLETED 는 현재 role 을 동봉');
select pg_temp.ok(public.user_profile_completed(), 'C-2 완성 후 user_profile_completed() = true');
select pg_temp.ok(pg_temp.try(format($q$ insert into public.favorites (user_id, mentor_id) values (%L, %L) $q$, :c1::uuid, :m1::uuid)) = 'OK', 'C-2 완성 후: favorites INSERT OK(같은 정책 · 완성 조건 통과)');
select pg_temp.ok(pg_temp.try(format($q$ insert into public.content_reports (reporter_id, target_type, target_id, reason) values (%L, 'user', %L, '신고') $q$, :c1::uuid, :m1::uuid)) = 'OK', 'C-2 완성 후: content_reports INSERT OK');
select pg_temp.ok(pg_temp.try($q$ select api_app_v1.user_profile_update_self_v2('닉변경', null, null) $q$) = 'OK', 'C-2 완성 후: user_profile_update_self_v2 OK(학생 게이트 통과)');
reset role;
select pg_temp.ok((select count(*) from public.user_consent_records where user_id = :c1) = 3, 'C-2 두 번째 호출(ALREADY_COMPLETED)은 원장을 늘리지 않는다');
set local role authenticated;
-- c2(이메일 없음) → 멘토 완성
select pg_temp.as_user(:c2, 'authenticated');
select pg_temp.expect('C12', $q$ select api_app_v1.complete_profile('mentor', '멘토닉2', '1999-01-01', true, false, null, '연세대학교', '경영학과') $q$, 'OK', 'C-3 ★ 멘토 완성(이메일 NULL 사용자)');
select pg_temp.ok((pg_temp.res('C12') ->> 'next') = 'identity_verification' and not (pg_temp.res('C12') ->> 'is_minor')::boolean, 'C-3 반환: next identity_verification · is_minor false');
reset role;
select pg_temp.ok((select role = 'mentor' and email is null and nickname = '멘토닉2' and profile_completed_at is not null from public.users where id = :c2)
                  and (select university_name = '연세대학교' and department_name = '경영학과' and high_school_name = '(미입력)' and teaching_subjects = '{}' and verification_status = 'pending' and cap_limit = 50
                         from public.mentor_profiles where user_id = :c2)
                  and (select count(*) from public.verification_logs where user_id = :c2 and log_type = 'mentor_verification' and status = 'pending') = 1,
                  'C-3 mentor_profiles pending(이메일 가입 트리거와 같은 형태 · 특권 가드 미발화) · 인증 로그 1');
select pg_temp.ok((select string_agg(consent_type, ',' order by consent_type) from public.user_consent_records where user_id = :c2) = 'privacy,terms'
                  and (select bool_and(not is_minor and metadata ->> 'role' = 'mentor' and source = 'signup') from public.user_consent_records where user_id = :c2), 'C-3 동의 원장: terms · privacy 2행(마케팅 미동의 → 행 없음) · is_minor false · role mentor');
select pg_temp.ok((select count(*) from public.mentor_plans where mentor_id = :c2) = 0, 'C-3 미승인 멘토 — 플랜 시드 없음(166 은 승인 시)');
-- c4 성인 학생 → home · 이후 역할 변경 가드
set local role authenticated;
select pg_temp.as_user(:c4, 'authenticated');
select pg_temp.expect('C13', $q$ select api_app_v1.complete_profile('student', '구글닉', '2005-03-03', true, false, '재수생', null, null) $q$, 'OK', 'C-4 성인 학생 완성');
select pg_temp.ok((pg_temp.res('C13') ->> 'next') = 'home' and (pg_temp.res('C13') ->> 'is_minor')::text = 'false', 'C-4 반환: next home');
reset role;
select pg_temp.ok((select count(*) from public.user_consent_records where user_id = :c4) = 2, 'C-4 동의 원장 2행');
select pg_temp.ok((select count(*) from public.user_consent_records where user_id not in ('00000000-0000-4000-8000-00000000d5c1','00000000-0000-4000-8000-00000000d5c2','00000000-0000-4000-8000-00000000d5c3','00000000-0000-4000-8000-00000000d5c4','00000000-0000-4000-8000-00000000d5c5','00000000-0000-4000-8000-00000000d5c6','00000000-0000-4000-8000-00000000d5d1','00000000-0000-4000-8000-00000000d5d2'))::text = pg_temp.snap('ucr_count'), 'C-4 기존(백필) 사용자의 원장은 건드리지 않았다(행 수 불변)');
-- 119 가드: 완성 전(NULL) → student/mentor 만 열렸다. 그 외 전이는 JWT 분기 원문 그대로(authenticated 세션은 거부)
select pg_temp.as_user(:c4, 'authenticated');
select pg_temp.ok(pg_temp.try(format($q$ update public.users set role = 'admin' where id = %L $q$, :c4::uuid)) like '%ROLE_CHANGE_FORBIDDEN%', 'C-5 119 가드: 완성된 student → admin 전이(authenticated JWT) 거부');
select pg_temp.ok(pg_temp.try(format($q$ update public.users set role = 'mentor' where id = %L $q$, :c4::uuid)) like '%ROLE_CHANGE_FORBIDDEN%', 'C-5 119 가드: 완성된 student → mentor 전이(authenticated JWT) 거부');
select pg_temp.as_user(:c5, 'authenticated');
select pg_temp.ok(pg_temp.try(format($q$ update public.users set role = 'admin' where id = %L $q$, :c5::uuid)) like '%ROLE_CHANGE_FORBIDDEN%', 'C-5 119 가드: 완성 전 NULL → admin 전이(authenticated JWT) 거부(student/mentor 만 허용)');
select pg_temp.as_user(null, 'anon');
select pg_temp.ok(pg_temp.try(format($q$ update public.users set role = 'admin' where id = %L $q$, :c4::uuid)) = 'OK', 'C-5 119 가드: JWT 없는 직접 세션(SQL Editor·마이그레이션)은 원문대로 통과');
update public.users set role = 'student' where id = :c4;
-- 계정 게이트: banned 완성 전 사용자
update public.users set status = 'banned' where id = :c5;
set local role authenticated;
select pg_temp.as_user(:c5, 'authenticated');
select pg_temp.expect('C14', $q$ select api_app_v1.complete_profile('student', '애플닉', '2005-03-03', true, false, '고1', null, null) $q$, 'ACCOUNT_BANNED', 'C-6 banned 계정은 완성 불가');
reset role;
select pg_temp.as_user(null, 'anon');
select pg_temp.expect('C15', $q$ select api_app_v1.complete_profile('student', '애플닉', '2005-03-03', true, false, '고1', null, null) $q$, 'AUTH_REQUIRED', 'C-6 JWT 없음');

-- ═══ D. 개별질문 v3 (207) — S1 지갑 30,000,000 ═══
set local role authenticated;
select pg_temp.as_user(:s1, 'authenticated');
select pg_temp.iq('D1', $q$ select * from api_app_v1.create_individual_question_as_student_v3('open', '공개 질문', '본문', 500000, null, 'iq3-k1', 'math_calculus', ' 극한과 연속 ', '서연고', '공학') $q$);
select pg_temp.ok((pg_temp.res('D1') ->> 'status') = 'open' and (pg_temp.res('D1') ->> 'subject') = 'math_calculus' and (pg_temp.res('D1') ->> 'topic') = '극한과 연속'
                  and (pg_temp.res('D1') ->> 'required_school_tier') = '서연고' and (pg_temp.res('D1') ->> 'required_major_category') = '공학'
                  and (pg_temp.res('D1') ->> 'price_cents')::int = 500000 and (pg_temp.res('D1') ->> 'create_idempotency_key') = 'iq3-k1',
                  'D-1 ★ 공개형 v3: subject · topic(trim) · 자격 조건(서연고·공학) 저장 · open · 500,000');
select pg_temp.iq('D1r', $q$ select * from api_app_v1.create_individual_question_as_student_v3('open', '공개 질문', '본문', 500000, null, 'iq3-k1', 'math_calculus', '극한과 연속', '서연고', '공학') $q$);
select pg_temp.ok((pg_temp.res('D1r') ->> 'id') = (pg_temp.res('D1') ->> 'id'), 'D-1 같은 키 재호출 = 같은 행(코어 already_exists · 이중 홀드 0)');
select pg_temp.ok(pg_temp.try($q$ select * from api_app_v1.create_individual_question_as_student_v3('open', 't', 'b', 500000, null, 'iq3-k2', 'math_calculus', null, '미분류', null) $q$) like 'INVALID_TIER%', 'D-2 미분류 → INVALID_TIER');
select pg_temp.ok(pg_temp.try($q$ select * from api_app_v1.create_individual_question_as_student_v3('open', 't', 'b', 500000, null, 'iq3-k3', 'math_calculus', null, '하버드', null) $q$) like 'INVALID_TIER%', 'D-2 목록 밖 학교군 → INVALID_TIER');
select pg_temp.ok(pg_temp.try($q$ select * from api_app_v1.create_individual_question_as_student_v3('open', 't', 'b', 500000, null, 'iq3-k4', 'math_calculus', null, null, '의학') $q$) like 'INVALID_MAJOR%', 'D-2 목록 밖 전공계열 → INVALID_MAJOR');
select pg_temp.ok(pg_temp.try($q$ select * from api_app_v1.create_individual_question_as_student_v3('open', 't', 'b', 500000, null, 'iq3-k5', 'math_calculus', repeat('가', 201), null, null) $q$) like 'TOPIC_TOO_LONG%', 'D-2 topic 201자 → TOPIC_TOO_LONG');
select pg_temp.ok(pg_temp.try($q$ select * from api_app_v1.create_individual_question_as_student_v3('open', 't', 'b', 500000, null, 'iq3-k6', null, null, null, null) $q$) like 'SUBJECT_REQUIRED%', 'D-2 공개형 과목 없음 → SUBJECT_REQUIRED(v2 동일)');
select pg_temp.ok(pg_temp.try($q$ select * from api_app_v1.create_individual_question_as_student_v3('open', 't', 'b', 500000, null, 'iq3-k7', '미적분', null, null, null) $q$) like 'INVALID_SUBJECT%', 'D-2 코드 정본 밖 과목 → INVALID_SUBJECT(v2 동일)');
select pg_temp.ok(pg_temp.try($q$ select * from api_app_v1.create_individual_question_as_student_v3('open', 't', 'b', null, null, 'iq3-k8', 'math_calculus', null, null, null) $q$) like 'INVALID_INPUT%', 'D-2 공개형 금액 없음 → INVALID_INPUT(v2 동일)');
select pg_temp.iq('D3', format($q$ select * from api_app_v1.create_individual_question_as_student_v3('direct', '지정 질문', '본문', null, %L, 'iq3-k9', 'english', '가정법', '서연고', '공학') $q$, :m1::uuid));
select pg_temp.ok((pg_temp.res('D3') ->> 'status') = 'assigned' and (pg_temp.res('D3') ->> 'designated_mentor_id') = :m1 and (pg_temp.res('D3') ->> 'price_cents')::int = 300000
                  and (pg_temp.res('D3') ->> 'topic') = '가정법' and (pg_temp.res('D3') ->> 'required_school_tier') is null and (pg_temp.res('D3') ->> 'required_major_category') is null,
                  'D-3 지정형 v3: 멘토 단가 300,000 · topic 저장 · 자격 조건은 무시(NULL)');
select pg_temp.ok(pg_temp.try(format($q$ select * from api_app_v1.create_individual_question_as_student_v3('direct', 't', 'b', null, %L, 'iq3-k10', null, null, '미분류', null) $q$, :m7::uuid)) like 'MENTOR_PRICE_NOT_SET%', 'D-3 지정형: 자격 값 검사 없이 단가 없음 → MENTOR_PRICE_NOT_SET(v2 동일)');
select pg_temp.iq('D4', $q$ select * from api_app_v1.create_individual_question_as_student_v2('open', 'v2 질문', '본문', 100000, null, 'iq2-k1', 'math_calculus') $q$);
select pg_temp.ok((pg_temp.res('D4') ->> 'status') = 'open' and (pg_temp.res('D4') ->> 'topic') is null and (pg_temp.res('D4') ->> 'required_school_tier') is null, 'D-4 v2 그대로 동작(topic·자격 NULL)');
select pg_temp.ok((select balance_cents from public.cash_wallets where user_id = :s1) = 30000000 - 500000 - 300000 - 100000, 'D-5 지갑: 홀드 3건(500,000 + 300,000 + 100,000) · 재호출 이중 홀드 0');
select pg_temp.ok((select count(*) from public.cash_ledger where idempotency_key = 'iq_hold:' || (pg_temp.res('D1') ->> 'id')) = 1, 'D-5 홀드 원장 iq_hold 1건');
-- ═══ D-6. 정지·차단·탈퇴 진행 계정 등록 차단(후속 b) — v2·v3 공통 판정 core_private.account_blocked_state ═══
select pg_temp.ok(pg_temp.snap('pre_v2_banned') = 'OK', 'D-6 (근거) 보강 전 v2 는 banned 학생의 등록을 통과시켰다(사전 실측 OK)');
select pg_temp.as_user(:s2, 'authenticated');
select pg_temp.ok(pg_temp.try_detail($q$ select * from api_app_v1.create_individual_question_as_student_v2('open', 't', 'b', 500000, null, 'iq2-banned', 'math_calculus') $q$) = 'ACCOUNT_BLOCKED|banned', 'D-6 ★ banned 학생 v2 → ACCOUNT_BLOCKED · detail banned');
select pg_temp.ok(pg_temp.try_detail($q$ select * from api_app_v1.create_individual_question_as_student_v3('open', 't', 'b', 500000, null, 'iq3-banned', 'math_calculus', null, null, null) $q$) = 'ACCOUNT_BLOCKED|banned', 'D-6 ★ banned 학생 v3 → ACCOUNT_BLOCKED · detail banned');
select pg_temp.ok(pg_temp.try($q$ select * from public.create_individual_question_as_student('open', 'v1', 'b', 100000, null, 'iq1-banned') $q$) = 'OK', 'D-6 (참고) v1 은 손대지 않았다 — banned 학생도 여전히 통과(호환 유지 · 앱 v1 미사용)');
reset role;
-- suspended: 무기한 · 미래 → 차단, 만료 → 통과(코어로 진행 · 지갑 없어 CASH_INSUFFICIENT)
update public.users set status = 'suspended', suspended_until = null where id = :s5;
set local role authenticated;
select pg_temp.as_user(:s5, 'authenticated');
select pg_temp.ok(pg_temp.try_detail($q$ select * from api_app_v1.create_individual_question_as_student_v2('open', 't', 'b', 500000, null, 'iq2-susp1', 'math_calculus') $q$) = 'ACCOUNT_BLOCKED|suspended', 'D-6 무기한 정지 v2 → ACCOUNT_BLOCKED|suspended');
reset role;
update public.users set suspended_until = now() + interval '1 day' where id = :s5;
set local role authenticated;
select pg_temp.as_user(:s5, 'authenticated');
select pg_temp.ok(pg_temp.try_detail($q$ select * from api_app_v1.create_individual_question_as_student_v3('open', 't', 'b', 500000, null, 'iq3-susp2', 'math_calculus', null, null, null) $q$) = 'ACCOUNT_BLOCKED|suspended', 'D-6 기한 정지(미래) v3 → ACCOUNT_BLOCKED|suspended');
reset role;
update public.users set suspended_until = now() - interval '1 day' where id = :s5;
set local role authenticated;
select pg_temp.as_user(:s5, 'authenticated');
select pg_temp.ok(pg_temp.try($q$ select * from api_app_v1.create_individual_question_as_student_v2('open', 't', 'b', 500000, null, 'iq2-susp3', 'math_calculus') $q$) like 'INDIVIDUAL_QUESTION_CREATE_FAILED:insufficient_cash%', 'D-6 만료된 정지 v2 → 게이트 통과(코어 CASH_INSUFFICIENT — 앱·웹 동일)');
reset role;
update public.users set status = 'active', suspended_until = null where id = :s5;
-- deleted · 탈퇴 진행 중(locked) → 차단 · 탈퇴 대기(pending · 취소 가능) → 통과
update public.users set status = 'deleted' where id = :s5;
set local role authenticated;
select pg_temp.as_user(:s5, 'authenticated');
select pg_temp.ok(pg_temp.try_detail($q$ select * from api_app_v1.create_individual_question_as_student_v3('open', 't', 'b', 500000, null, 'iq3-del', 'math_calculus', null, null, null) $q$) = 'ACCOUNT_BLOCKED|deleted', 'D-6 deleted v3 → ACCOUNT_BLOCKED|deleted');
reset role;
update public.users set status = 'active' where id = :s5;
insert into public.account_deletion_jobs (user_id, state) values (:s5, 'locked');
set local role authenticated;
select pg_temp.as_user(:s5, 'authenticated');
select pg_temp.ok(pg_temp.try_detail($q$ select * from api_app_v1.create_individual_question_as_student_v2('open', 't', 'b', 500000, null, 'iq2-lock', 'math_calculus') $q$) = 'ACCOUNT_BLOCKED|deletion_in_progress'
                  and pg_temp.try_detail($q$ select * from api_app_v1.create_individual_question_as_student_v3('open', 't', 'b', 500000, null, 'iq3-lock', 'math_calculus', null, null, null) $q$) = 'ACCOUNT_BLOCKED|deletion_in_progress', 'D-6 탈퇴 진행 중(locked) v2·v3 → ACCOUNT_BLOCKED|deletion_in_progress');
reset role;
update public.account_deletion_jobs set state = 'pending' where user_id = :s5;
set local role authenticated;
select pg_temp.as_user(:s5, 'authenticated');
select pg_temp.ok(pg_temp.try($q$ select * from api_app_v1.create_individual_question_as_student_v3('open', 't', 'b', 500000, null, 'iq3-pend', 'math_calculus', null, null, null) $q$) like 'INDIVIDUAL_QUESTION_CREATE_FAILED:insufficient_cash%', 'D-6 탈퇴 대기(pending · 취소 가능 창) → 게이트 통과(앱 deletionPending 허용과 동일)');
reset role;
delete from public.account_deletion_jobs where user_id = :s5;
select pg_temp.as_user(null, 'anon');
select pg_temp.ok(pg_temp.try($q$ select * from api_app_v1.create_individual_question_as_student_v3('open', 't', 'b', 500000, null, 'iq3-nojwt', 'math_calculus', null, null, null) $q$) like 'AUTH_REQUIRED%', 'D-7 JWT 없음 → AUTH_REQUIRED');
set local role anon;
select pg_temp.ok(pg_temp.try($q$ select * from api_app_v1.create_individual_question_as_student_v3('open', 't', 'b', 500000, null, 'iq3-anon', 'math_calculus', null, null, null) $q$) like '%permission denied%', 'D-7 anon EXECUTE 거부');
reset role;

-- ═══ E. 리뷰 자격 (208) ═══
select pg_temp.ok(public.check_review_eligibility(:m1, :s3) and not public.check_review_eligibility(:m1, :s4) and not public.check_review_eligibility(:m2, :s5)
                  and not public.check_review_eligibility(:m1, :s6) and not public.check_review_eligibility(null, :s3),
                  'E-1 ★ check_review_eligibility: 결제 2회 → true · 결제 1회+완료 IQ → false · IQ 만 → false · 결제 0 → false · NULL → false');
-- 세지 않는 이벤트: 환불(status refunded) · 금액 0 · 실패
insert into public.subscription_billing_events (subscription_id, student_id, mentor_id, event_type, status, amount_cents, plan_tier, idempotency_key) values
  ('00000000-0000-4000-8000-00000000d5e2', :s4, :m1, 'renewal', 'refunded', 2990000, 'limited', 'post-s4-refunded'),
  ('00000000-0000-4000-8000-00000000d5e2', :s4, :m1, 'renewal', 'succeeded', 0, 'limited', 'post-s4-zero');
select pg_temp.ok(not public.check_review_eligibility(:m1, :s4), 'E-1 refunded · 금액 0 이벤트는 세지 않는다(S4 여전히 false)');
insert into public.subscription_billing_events (subscription_id, student_id, mentor_id, event_type, status, amount_cents, plan_tier, idempotency_key) values
  ('00000000-0000-4000-8000-00000000d5e2', :s4, :m1, 'renewal', 'succeeded', 2990000, 'limited', 'post-s4-second');
select pg_temp.ok(public.check_review_eligibility(:m1, :s4), 'E-1 두 번째 결제 성공 → true(누적 2회 — 연속성 무관)');
delete from public.subscription_billing_events where idempotency_key in ('post-s4-refunded', 'post-s4-zero', 'post-s4-second');
set local role authenticated;
select pg_temp.as_user(:s3, 'authenticated');
select pg_temp.expect('E2', format($q$ select api_app_v1.review_eligibility_self(%L) $q$, :m1::uuid), 'OK', 'E-2 self(S3)');
select pg_temp.ok((pg_temp.res('E2') ->> 'eligible')::boolean and (pg_temp.res('E2') ->> 'reason') = 'OK' and (pg_temp.res('E2') ->> 'paid_count')::int = 2 and (pg_temp.res('E2') ->> 'required_count')::int = 2, 'E-2 S3: eligible · OK · paid 2/2');
select pg_temp.ok(pg_temp.try(format($q$ insert into public.reviews (mentor_id, author_id, rating, body) values (%L, %L, 5, '두 달 동안 꾸준히 도움을 받았어요. 추천합니다.') $q$, :m1::uuid, :s3::uuid)) = 'OK', 'E-2 S3 reviews INSERT OK(reviews_insert_student 정책 그대로 동작)');
select pg_temp.as_user(:s4, 'authenticated');
select pg_temp.expect('E3', format($q$ select api_app_v1.review_eligibility_self(%L) $q$, :m1::uuid), 'OK', 'E-3 self(S4)');
select pg_temp.ok(not (pg_temp.res('E3') ->> 'eligible')::boolean and (pg_temp.res('E3') ->> 'reason') = 'NOT_ENOUGH_PAYMENTS' and (pg_temp.res('E3') ->> 'paid_count')::int = 1, 'E-3 S4: NOT_ENOUGH_PAYMENTS · paid 1/2');
select pg_temp.ok(pg_temp.try(format($q$ insert into public.reviews (mentor_id, author_id, rating, body) values (%L, %L, 4, '결제는 한 번뿐이라 아직 후기를 못 써요.') $q$, :m1::uuid, :s4::uuid)) like '%row-level security%', 'E-3 S4 reviews INSERT 거부(정책)');
select pg_temp.as_user(:s5, 'authenticated');
select pg_temp.expect('E4', format($q$ select api_app_v1.review_eligibility_self(%L) $q$, :m2::uuid), 'OK', 'E-4 self(S5)');
select pg_temp.ok((pg_temp.res('E4') ->> 'reason') = 'NOT_ENOUGH_PAYMENTS' and (pg_temp.res('E4') ->> 'paid_count')::int = 0, 'E-4 S5(IQ 만): NOT_ENOUGH_PAYMENTS · paid 0');
select pg_temp.ok(pg_temp.try(format($q$ insert into public.reviews (mentor_id, author_id, rating, body) values (%L, %L, 4, '개별질문만 이용했는데 후기는 안 되네요.') $q$, :m2::uuid, :s5::uuid)) like '%row-level security%', 'E-4 S5 reviews INSERT 거부');
select pg_temp.as_user(:s6, 'authenticated');
select pg_temp.expect('E5', format($q$ select api_app_v1.review_eligibility_self(%L) $q$, :m1::uuid), 'OK', 'E-5 self(S6 기작성)');
select pg_temp.ok((pg_temp.res('E5') ->> 'reason') = 'ALREADY_REVIEWED' and (pg_temp.res('E5') ->> 'existing_review_id') = :rev6 and (pg_temp.res('E5') ->> 'can_edit')::boolean, 'E-5 S6: ALREADY_REVIEWED · existing_review_id · can_edit true');
select pg_temp.expect('E6', format($q$ select api_app_v1.review_eligibility_self(%L) $q$, :s1::uuid), 'MENTOR_NOT_FOUND', 'E-6 멘토 아님');
select pg_temp.expect('E7', $q$ select api_app_v1.review_eligibility_self(null) $q$, 'MENTOR_NOT_FOUND', 'E-6 NULL');
reset role;
select pg_temp.as_user(null, 'anon');
select pg_temp.expect('E8', format($q$ select api_app_v1.review_eligibility_self(%L) $q$, :m1::uuid), 'AUTH_REQUIRED', 'E-6 JWT 없음');
select pg_temp.ok((select coalesce(with_check, '') from pg_policies where tablename = 'reviews' and policyname = 'reviews_insert_student') = pg_temp.snap('pol_reviews_insert'), 'E-7 reviews_insert_student 정책 불변');

-- ═══ F. 마케팅 동의 RPC (209 · 후속 d) — 모든 사용자 on/off 왕복 ═══
set local role authenticated;
select pg_temp.as_user(:s1, 'authenticated');
select pg_temp.expect('F1', $q$ select api_web_v1.user_marketing_consent_set_self(true) $q$, 'OK', 'F-1 ★ 학생 S1 동의 on(보강 전엔 NOT NULL 로 실패 — 사전 실측)');
select pg_temp.ok((select count(*) from public.user_consent_records where user_id = :s1 and source = 'self_rpc') = 1
                  and (select consent_type || '|' || consent_actor || '|' || consent_version || '|' || (metadata ->> 'agreed') || '|' || (idempotency_key like 'self_rpc:' || :s1 || ':marketing:%')::text from public.user_consent_records where user_id = :s1 and source = 'self_rpc') = 'marketing|user|v1|true|true'
                  and (select marketing_agreed from public.users where id = :s1), 'F-1 원장 1행(marketing · self_rpc · v1 · agreed true · 키 self_rpc:<uid>:marketing:<uuid>) · users.marketing_agreed true');
select pg_temp.expect('F2', $q$ select api_web_v1.user_marketing_consent_set_self(false) $q$, 'OK', 'F-1 동의 off');
select pg_temp.ok((select count(*) from public.user_consent_records where user_id = :s1 and source = 'self_rpc') = 2 and not (select marketing_agreed from public.users where id = :s1), 'F-1 off → 원장 append(2행 · 이력 보존) · 플래그 false');
select pg_temp.expect('F3', $q$ select api_web_v1.user_marketing_consent_set_self(true) $q$, 'OK', 'F-1 다시 on');
select pg_temp.ok((select count(*) from public.user_consent_records where user_id = :s1 and source = 'self_rpc') = 3 and (select count(distinct idempotency_key) from public.user_consent_records where user_id = :s1 and source = 'self_rpc') = 3, 'F-1 3행 · 멱등 키 전부 다름(UNIQUE 충돌 0)');
select pg_temp.as_user(:m1, 'authenticated');
select pg_temp.expect('F4', $q$ select api_web_v1.user_marketing_consent_set_self(true) $q$, 'OK', 'F-2 멘토 M1 on');
select pg_temp.as_user(:c4, 'authenticated');
select pg_temp.expect('F5', $q$ select api_web_v1.user_marketing_consent_set_self(false) $q$, 'OK', 'F-2 완성된 소셜 학생 c4 off');
select pg_temp.as_user(:s2, 'authenticated');
select pg_temp.ok(pg_temp.try($q$ select api_web_v1.user_marketing_consent_set_self(true) $q$) like 'ACCOUNT_BANNED%', 'F-3 banned → ACCOUNT_BANNED(원문 게이트 그대로)');
reset role;
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', :c6, 'authenticated', 'authenticated', 'c6@test.local', '{"iss":"https://accounts.google.com","sub":"g6","name":"미완성","provider_id":"g6"}'::jsonb, now(), now());
set local role authenticated;
select pg_temp.as_user(:c6, 'authenticated');
select pg_temp.expect('F6', $q$ select api_web_v1.user_marketing_consent_set_self(true) $q$, 'OK', 'F-4 (관찰 · DB-6 이월) 완성 전 사용자도 이 RPC 는 통과한다 — 원문 게이트가 role·완성을 보지 않음(후속 d 는 원인 컬럼만 고쳤다)');
reset role;
select pg_temp.as_user(null, 'anon');
select pg_temp.ok(pg_temp.try($q$ select api_web_v1.user_marketing_consent_set_self(true) $q$) like 'AUTH_REQUIRED%', 'F-5 JWT 없음 → AUTH_REQUIRED');
set local role anon;
select pg_temp.ok(pg_temp.try($q$ select api_web_v1.user_marketing_consent_set_self(true) $q$) like '%permission denied%', 'F-5 anon EXECUTE 거부(ACL 불변)');
reset role;

-- ═══ G. 불변 ═══
select pg_temp.ok(md5(pg_get_functiondef('public.create_individual_question_as_student(text,text,text,int,uuid,text)'::regprocedure)) = pg_temp.snap('fn_iq_v1')
                  and md5(pg_get_functiondef('api_app_v1.create_individual_question_as_student_v2(text,text,text,int,uuid,text,text)'::regprocedure)) <> pg_temp.snap('fn_iq_v2')
                  and md5(pg_get_functiondef('public.create_individual_question_with_hold_v2(uuid,text,uuid,text,text,text,text,int,text,text,text)'::regprocedure)) = pg_temp.snap('fn_iq_core_v2'),
                  'G-1 v1 · 코어 v2 md5 불변 · v2 는 계정 검사 1곳만 추가(md5 변경)');
select pg_temp.ok(md5(pg_get_functiondef('api_web_v1.subscription_checkout_confirm_v2(uuid,uuid,integer,text)'::regprocedure)) = pg_temp.snap('fn_f12'), 'G-1 F12 md5 불변');
select pg_temp.ok(md5(pg_get_functiondef('public.handle_new_auth_user()'::regprocedure)) <> pg_temp.snap('fn_trigger')
                  and md5(pg_get_functiondef('public.enforce_users_role_guard()'::regprocedure)) <> pg_temp.snap('fn_role_guard')
                  and md5(pg_get_functiondef('public.check_review_eligibility(uuid,uuid)'::regprocedure)) <> pg_temp.snap('fn_review')
                  and md5(pg_get_functiondef('public.handle_new_auth_user_consent_records()'::regprocedure)) <> pg_temp.snap('fn_consent_trigger')
                  and md5(pg_get_functiondef('api_web_v1.user_marketing_consent_set_self(boolean)'::regprocedure)) <> pg_temp.snap('fn_marketing'), 'G-2 교체 대상 5종(가입 트리거 · 동의 트리거(위임) · 가드 · 리뷰 자격 · 마케팅 RPC)은 본문이 바뀌었다');
select pg_temp.ok((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api_web_v1')::text = pg_temp.snap('fn_web_count')
                  and (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r')::text = pg_temp.snap('tables_count'), 'G-3 api_web_v1 함수 수 · 테이블 수 불변');
select pg_temp.ok((select count(*) from pg_policies where schemaname = 'public' and (coalesce(qual, '') || coalesce(with_check, '')) like '%user_profile_completed()%') = 18, 'G-4 완성 조건 정책 정확히 18');
select pg_temp.ok((select string_agg(plan_tier || '=' || amount_cents || ':' || is_active, ',' order by plan_tier) from public.mentor_plans where mentor_id = :m1) = pg_temp.snap('m1_plans'), 'G-5 M1 플랜 불변(A 는 읽기만)');

\echo DB5 POST FIXTURE PASS
rollback;
