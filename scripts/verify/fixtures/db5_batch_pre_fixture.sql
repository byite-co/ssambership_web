-- db5_batch_pre_fixture.sql — DB-5 로컬 검증용 사전 fixture (오프라인 스크래치 PG 전용 · 운영 적용 금지).
-- 목적: DB-5 적용 **전**(= 운영 pack 118본 = DB-4 까지 적용 상태) 운영 형태를 재현하고, 현재 동작(소셜 가입 폴백 · 170 리뷰 자격 · v2 계정 상태)을 실측한다.
--   · 관리자 1(오너 지정 UUID) · 승인 멘토 M1~M6(요금제 가격을 A 검증용으로 배치 · M6 standard/premium 비활성 · M5 premium 비활성) · 대기 멘토 M7(미승인 · 플랜 수동 삽입 → 제외 대상)
--   · 학생 S1(캐시 300,000) · S2(banned · 캐시 100,000) · S3(M1 구독 · 결제 성공 2회 + 실패 1회) · S4(M1 구독 만료 · 결제 1회 + M1 완료 개별질문)
--     · S5(M2 완료 개별질문만) · S6(M1 후기 기작성)
-- 이 파일은 데이터를 COMMIT 한다. 현재 동작 실측 블록은 별도 트랜잭션에서 ROLLBACK 한다.
begin;
set local search_path to public;

create schema if not exists db5_check;
create table if not exists db5_check.snapshot (key text primary key, val text);
grant usage on schema db5_check to authenticated, anon;
grant select on db5_check.snapshot to authenticated, anon;   -- post fixture 가 클라이언트 역할로도 스냅샷을 읽는다

-- ── 사용자 (auth.users INSERT → handle_new_auth_user 가 public.users · mentor_profiles 를 만든다 · 전부 app_role 있는 이메일 경로) ──
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated', email, meta::jsonb, now() - interval '30 days', now() - interval '30 days'
from (values
  ('9bf48819-1dd2-40dd-96a3-d64bcca2e60c'::uuid, 'db5-admin@test.local', '{"app_role":"student","full_name":"검증관리자"}'),
  ('00000000-0000-4000-8000-00000000d5a1'::uuid, 'db5-m1@test.local', '{"app_role":"mentor","full_name":"검증멘토일","nickname":"멘토일","terms_agreed":"true","privacy_agreed":"true","birth_date":"1999-03-01"}'),
  ('00000000-0000-4000-8000-00000000d5a2'::uuid, 'db5-m2@test.local', '{"app_role":"mentor","full_name":"검증멘토이","nickname":"멘토이"}'),
  ('00000000-0000-4000-8000-00000000d5a3'::uuid, 'db5-m3@test.local', '{"app_role":"mentor","full_name":"검증멘토삼","nickname":"멘토삼"}'),
  ('00000000-0000-4000-8000-00000000d5a4'::uuid, 'db5-m4@test.local', '{"app_role":"mentor","full_name":"검증멘토사","nickname":"멘토사"}'),
  ('00000000-0000-4000-8000-00000000d5a5'::uuid, 'db5-m5@test.local', '{"app_role":"mentor","full_name":"검증멘토오","nickname":"멘토오"}'),
  ('00000000-0000-4000-8000-00000000d5a6'::uuid, 'db5-m6@test.local', '{"app_role":"mentor","full_name":"검증멘토육","nickname":"멘토육"}'),
  ('00000000-0000-4000-8000-00000000d5a7'::uuid, 'db5-m7@test.local', '{"app_role":"mentor","full_name":"검증멘토칠","nickname":"멘토칠"}'),
  ('00000000-0000-4000-8000-00000000d5b1'::uuid, 'db5-s1@test.local', '{"app_role":"student","full_name":"검증학생일","nickname":"학생일","grade_level":"고2","terms_agreed":"true","privacy_agreed":"true","marketing_agreed":"true","birth_date":"2009-05-05"}'),
  ('00000000-0000-4000-8000-00000000d5b2'::uuid, 'db5-s2@test.local', '{"app_role":"student","full_name":"검증학생이","nickname":"학생이"}'),
  ('00000000-0000-4000-8000-00000000d5b3'::uuid, 'db5-s3@test.local', '{"app_role":"student","full_name":"검증학생삼","nickname":"학생삼"}'),
  ('00000000-0000-4000-8000-00000000d5b4'::uuid, 'db5-s4@test.local', '{"app_role":"student","full_name":"검증학생사","nickname":"학생사"}'),
  ('00000000-0000-4000-8000-00000000d5b5'::uuid, 'db5-s5@test.local', '{"app_role":"student","full_name":"검증학생오","nickname":"학생오"}'),
  ('00000000-0000-4000-8000-00000000d5b6'::uuid, 'db5-s6@test.local', '{"app_role":"student","full_name":"검증학생육","nickname":"학생육"}')
) as v(id, email, meta);

update public.users set role = 'admin' where id = '9bf48819-1dd2-40dd-96a3-d64bcca2e60c';
update public.users set status = 'banned' where id = '00000000-0000-4000-8000-00000000d5b2';

update public.mentor_profiles set university_name = '서울대학교', department_name = '컴퓨터공학부', high_school_name = '검증고'
 where user_id in ('00000000-0000-4000-8000-00000000d5a1','00000000-0000-4000-8000-00000000d5a2','00000000-0000-4000-8000-00000000d5a3',
                   '00000000-0000-4000-8000-00000000d5a4','00000000-0000-4000-8000-00000000d5a5','00000000-0000-4000-8000-00000000d5a6','00000000-0000-4000-8000-00000000d5a7');

-- 승인(서비스 경로 · JWT 없음 → 특권 가드 통과) → 166 트리거가 3 tier 플랜을 권장가로 시드(limited 2,990,000 · standard 8,490,000 · premium 17,490,000)
update public.mentor_profiles set verification_status = 'approved'
 where user_id in ('00000000-0000-4000-8000-00000000d5a1','00000000-0000-4000-8000-00000000d5a2','00000000-0000-4000-8000-00000000d5a3',
                   '00000000-0000-4000-8000-00000000d5a4','00000000-0000-4000-8000-00000000d5a5','00000000-0000-4000-8000-00000000d5a6');

-- A 검증용 가격 배치 (밴드 안 · 서비스 경로 직접 UPDATE)
--   limited : M1 29,900 · M2 29,900 · M3 30,000 · M4 31,000 · M5 35,000 · M6 40,000 → 6명 · 평균 32,633.33 → 32,600 · 최소 29,900 · 최대 40,000
--   standard: M1~M5 84,900 · M6 비활성 → 5명(경계) · 84,900 · fallback false
--   premium : M1 174,900 · M2 174,900 · M3 180,000 · M4 200,000 · M5·M6 비활성 → 4명 → fallback true · avg_won = 최소 174,900 · 최대 200,000
update public.mentor_plans set amount_cents = 3000000 where mentor_id = '00000000-0000-4000-8000-00000000d5a3' and plan_tier = 'limited';
update public.mentor_plans set amount_cents = 3100000 where mentor_id = '00000000-0000-4000-8000-00000000d5a4' and plan_tier = 'limited';
update public.mentor_plans set amount_cents = 3500000 where mentor_id = '00000000-0000-4000-8000-00000000d5a5' and plan_tier = 'limited';
update public.mentor_plans set amount_cents = 4000000 where mentor_id = '00000000-0000-4000-8000-00000000d5a6' and plan_tier = 'limited';
update public.mentor_plans set is_active = false    where mentor_id = '00000000-0000-4000-8000-00000000d5a6' and plan_tier = 'standard';
update public.mentor_plans set amount_cents = 18000000 where mentor_id = '00000000-0000-4000-8000-00000000d5a3' and plan_tier = 'premium';
update public.mentor_plans set amount_cents = 20000000 where mentor_id = '00000000-0000-4000-8000-00000000d5a4' and plan_tier = 'premium';
update public.mentor_plans set is_active = false    where mentor_id in ('00000000-0000-4000-8000-00000000d5a5','00000000-0000-4000-8000-00000000d5a6') and plan_tier = 'premium';
-- M7(미승인) 플랜 수동 삽입 — 승인 필터로 제외돼야 한다(포함되면 limited 최대가 69,000 으로 바뀐다)
insert into public.mentor_plans (mentor_id, plan_tier, amount_cents, is_active) values
  ('00000000-0000-4000-8000-00000000d5a7', 'limited', 6900000, true),
  ('00000000-0000-4000-8000-00000000d5a7', 'standard', 8490000, true),
  ('00000000-0000-4000-8000-00000000d5a7', 'premium', 17490000, true);

-- M1 지정 질문 단가(v2/v3 direct 경로)
insert into public.mentor_individual_question_pricing (mentor_id, amount_cents) values ('00000000-0000-4000-8000-00000000d5a1', 300000)
on conflict (mentor_id) do update set amount_cents = excluded.amount_cents;

-- 지갑(서비스 경로) — 1캐시 = 100 cents
insert into public.cash_wallets (user_id, balance_cents) values
  ('00000000-0000-4000-8000-00000000d5b1', 30000000),
  ('00000000-0000-4000-8000-00000000d5b2', 10000000),
  ('00000000-0000-4000-8000-00000000d5b3', 0),
  ('00000000-0000-4000-8000-00000000d5b4', 0)
on conflict (user_id) do update set balance_cents = excluded.balance_cents;

-- S3 → M1 스탠다드 활성 구독 + 결제 성공 2회(initial + renewal) + 갱신 실패 1회(세지 않음)
insert into public.subscriptions (id, student_id, mentor_id, plan_id, plan_tier, status, started_at, current_period_start, current_period_end, next_billing_at, billing_cycle)
select '00000000-0000-4000-8000-00000000d5e1', '00000000-0000-4000-8000-00000000d5b3', '00000000-0000-4000-8000-00000000d5a1', mp.id, 'standard', 'active',
       now() - interval '40 days', now() - interval '10 days', now() + interval '20 days', now() + interval '20 days', 'monthly'
  from public.mentor_plans mp where mp.mentor_id = '00000000-0000-4000-8000-00000000d5a1' and mp.plan_tier = 'standard';
insert into public.subscription_billing_events (subscription_id, student_id, mentor_id, event_type, status, period_start, period_end, billing_at, amount_cents, plan_tier, idempotency_key, processed_at) values
  ('00000000-0000-4000-8000-00000000d5e1', '00000000-0000-4000-8000-00000000d5b3', '00000000-0000-4000-8000-00000000d5a1', 'initial', 'succeeded',
   now() - interval '40 days', now() - interval '10 days', now() - interval '40 days', 8490000, 'standard', 'sub_initial:00000000-0000-4000-8000-00000000d5e1', now() - interval '40 days'),
  ('00000000-0000-4000-8000-00000000d5e1', '00000000-0000-4000-8000-00000000d5b3', '00000000-0000-4000-8000-00000000d5a1', 'renewal', 'succeeded',
   now() - interval '10 days', now() + interval '20 days', now() - interval '10 days', 8490000, 'standard', 'sub_renewal:d5e1:1', now() - interval '10 days'),
  ('00000000-0000-4000-8000-00000000d5e1', '00000000-0000-4000-8000-00000000d5b3', '00000000-0000-4000-8000-00000000d5a1', 'renewal', 'failed',
   now() - interval '9 days', now() + interval '21 days', now() - interval '9 days', 8490000, 'standard', 'sub_renewal:d5e1:2-failed', now() - interval '9 days');

-- S4 → M1 라이트 만료 구독 + 결제 1회 + M1 이 답변한 지정 개별질문(170 기준 자격 있음 · 208 기준 없음)
insert into public.subscriptions (id, student_id, mentor_id, plan_id, plan_tier, status, started_at, current_period_start, current_period_end, next_billing_at, billing_cycle)
select '00000000-0000-4000-8000-00000000d5e2', '00000000-0000-4000-8000-00000000d5b4', '00000000-0000-4000-8000-00000000d5a1', mp.id, 'limited', 'expired',
       now() - interval '70 days', now() - interval '70 days', now() - interval '40 days', now() - interval '40 days', 'monthly'
  from public.mentor_plans mp where mp.mentor_id = '00000000-0000-4000-8000-00000000d5a1' and mp.plan_tier = 'limited';
insert into public.subscription_billing_events (subscription_id, student_id, mentor_id, event_type, status, period_start, period_end, billing_at, amount_cents, plan_tier, idempotency_key, processed_at) values
  ('00000000-0000-4000-8000-00000000d5e2', '00000000-0000-4000-8000-00000000d5b4', '00000000-0000-4000-8000-00000000d5a1', 'initial', 'succeeded',
   now() - interval '70 days', now() - interval '40 days', now() - interval '70 days', 2990000, 'limited', 'sub_initial:00000000-0000-4000-8000-00000000d5e2', now() - interval '70 days');
insert into public.individual_questions (id, student_id, question_type, designated_mentor_id, claimed_mentor_id, subject, title, body, price_cents, status, create_idempotency_key, answered_at)
values ('00000000-0000-4000-8000-00000000d5f1', '00000000-0000-4000-8000-00000000d5b4', 'direct', '00000000-0000-4000-8000-00000000d5a1', '00000000-0000-4000-8000-00000000d5a1',
        'math_calculus', 'S4 지정 질문', '본문', 300000, 'answered', 'pre-iq-s4', now() - interval '5 days');
-- S5 → M2 가 답변한 공개 개별질문만(결제 0)
insert into public.individual_questions (id, student_id, question_type, claimed_mentor_id, subject, title, body, price_cents, status, create_idempotency_key, answered_at)
values ('00000000-0000-4000-8000-00000000d5f2', '00000000-0000-4000-8000-00000000d5b5', 'open', '00000000-0000-4000-8000-00000000d5a2',
        'english', 'S5 공개 질문', '본문', 200000, 'answered', 'pre-iq-s5', now() - interval '3 days');
-- S6 → M1 후기 기작성(서비스 경로 — 170 자격과 무관하게 행만 둔다)
insert into public.reviews (id, mentor_id, author_id, rating, body)
values ('00000000-0000-4000-8000-00000000d5f9', '00000000-0000-4000-8000-00000000d5a1', '00000000-0000-4000-8000-00000000d5b6', 5, '설명이 친절하고 이해가 잘 됐어요. 다시 듣고 싶어요.');

-- ── 사전 스냅샷 (rollback 복원 대조용) ──
insert into db5_check.snapshot (key, val) values
  ('fn_public_count',  (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public')),
  ('fn_app_count',     (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api_app_v1')),
  ('fn_core_count',    (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'core_private')),
  ('fn_web_count',     (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api_web_v1')),
  ('policies_count',   (select count(*)::text from pg_policies where schemaname = 'public')),
  ('tables_count',     (select count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r')),
  ('users_count',      (select count(*)::text from public.users)),
  ('fn_iq_v1',         (select md5(pg_get_functiondef('public.create_individual_question_as_student(text,text,text,int,uuid,text)'::regprocedure)))),
  ('fn_iq_v2',         (select md5(pg_get_functiondef('api_app_v1.create_individual_question_as_student_v2(text,text,text,int,uuid,text,text)'::regprocedure)))),
  ('fn_iq_core_v2',    (select md5(pg_get_functiondef('public.create_individual_question_with_hold_v2(uuid,text,uuid,text,text,text,text,int,text,text,text)'::regprocedure)))),
  ('fn_f12',           (select md5(pg_get_functiondef('api_web_v1.subscription_checkout_confirm_v2(uuid,uuid,integer,text)'::regprocedure)))),
  ('fn_trigger',       (select md5(pg_get_functiondef('public.handle_new_auth_user()'::regprocedure)))),
  ('fn_consent_trigger', (select md5(pg_get_functiondef('public.handle_new_auth_user_consent_records()'::regprocedure)))),
  ('fn_role_guard',    (select md5(pg_get_functiondef('public.enforce_users_role_guard()'::regprocedure)))),
  ('fn_review',        (select md5(pg_get_functiondef('public.check_review_eligibility(uuid,uuid)'::regprocedure)))),
  ('fn_profile_impl',  (select md5(pg_get_functiondef('core_private.user_profile_update_self_impl(uuid,text,text)'::regprocedure)))),
  ('fn_marketing',     (select md5(pg_get_functiondef('api_web_v1.user_marketing_consent_set_self(boolean)'::regprocedure)))),
  ('ucr_count',        (select count(*)::text from public.user_consent_records)),
  ('pol_reviews_insert', (select coalesce(with_check, '') from pg_policies where tablename = 'reviews' and policyname = 'reviews_insert_student')),
  ('pol18_md5',        (select md5(string_agg(tablename || '.' || policyname || '|' || cmd || '|' || array_to_string(roles, ',') || '|' || coalesce(qual, '') || '|' || coalesce(with_check, ''), E'\n' order by tablename, policyname))
                         from pg_policies where schemaname = 'public'
                          and (tablename, policyname) in (('admin_action_logs','관리자만 로그 기록'),('ai_drafts','ai_drafts_insert_own'),('content_reports','content_reports_insert_reporter'),('custom_order_deliverables','멘토만 납품 업로드'),('custom_order_messages','당사자만 메시지 전송'),('custom_request_applications','cra_insert'),('custom_request_applications','멘토만 지원'),('custom_request_orders','cro_insert'),('custom_request_posts','crp_insert'),('custom_request_posts','학생만 의뢰 등록'),('device_tokens','device_tokens_modify_own'),('favorites','favorites_insert_own'),('free_question_usage','fqu_insert_own'),('notification_settings','notif_settings_modify_own'),('payments','payments_insert_intent'),('user_blocks','ub_insert_own'),('verification_logs','ver_logs_insert_own'),('withdrawals','withdrawals_insert_self_requested')))),
  ('m1_plans',         (select string_agg(plan_tier || '=' || amount_cents || ':' || is_active, ',' order by plan_tier) from public.mentor_plans where mentor_id = '00000000-0000-4000-8000-00000000d5a1'));

-- 전제 확인: 운영 pack(DB-4 까지) 적용 · DB-5 이전 상태
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where (n.nspname, p.proname) in (('public','plan_price_stats'),('api_app_v1','complete_profile'),('api_app_v1','create_individual_question_as_student_v3'),
                                               ('api_app_v1','review_eligibility_self'),('core_private','user_signup_provision_impl'),('core_private','review_eligibility_impl'),('public','user_profile_completed'))) then
    raise exception 'PRE: DB-5 객체가 이미 있다';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'users' and column_name = 'profile_completed_at') then
    raise exception 'PRE: profile_completed_at 이 이미 있다';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api_app_v1') <> 16
     or (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'core_private') <> 8 then
    raise exception 'PRE: api_app_v1 16 · core_private 8 이 아니다(DB-4 미적용?)';
  end if;
  if (select val from db5_check.snapshot where key = 'fn_trigger') <> '297616fe4e28f0dbda3b24244763a917'
     or (select val from db5_check.snapshot where key = 'fn_role_guard') <> '702ddc298e6892306e796cae22f60201'
     or (select val from db5_check.snapshot where key = 'fn_review') <> '7f458145b70b0eb239a0c67f265a4c93'
     or (select val from db5_check.snapshot where key = 'fn_iq_v2') <> 'aa8c27d2dcaa1c9cbfe5ae852f1c2dcc'
     or (select val from db5_check.snapshot where key = 'fn_profile_impl') <> 'a0cb1b7f37b8195cc9ca370bfb5e90e7'
     or (select val from db5_check.snapshot where key = 'fn_consent_trigger') <> 'abc7c96e8d5707a6d8324a75d4b14815'
     or (select val from db5_check.snapshot where key = 'fn_marketing') <> '9a84375f8ae7662f0f20f5ac76a4d2c4' then
    raise exception 'PRE: 트리거/가드/리뷰/v2 본문 md5 가 2026-09-06 운영 실측과 다르다';
  end if;
  if (select string_agg(plan_tier || '=' || amount_cents, ',' order by plan_tier) from public.mentor_plans where mentor_id = '00000000-0000-4000-8000-00000000d5a1') <> 'limited=2990000,premium=17490000,standard=8490000' then
    raise exception 'PRE: 승인 시드 플랜(166) 3 tier 권장가 불일치';
  end if;
  if (select count(*) from public.mentor_plans mp join public.mentor_profiles p on p.user_id = mp.mentor_id where p.verification_status = 'approved' and mp.is_active and mp.plan_tier = 'premium') <> 4 then
    raise exception 'PRE: premium 활성 표본이 4 가 아니다';
  end if;
  if (select status from public.users where id = '00000000-0000-4000-8000-00000000d5b2') <> 'banned' then
    raise exception 'PRE: S2 banned 아님';
  end if;
  if (select count(*) from public.subscription_billing_events where student_id = '00000000-0000-4000-8000-00000000d5b3' and mentor_id = '00000000-0000-4000-8000-00000000d5a1' and status = 'succeeded') <> 2 then
    raise exception 'PRE: S3 결제 성공 2회 아님';
  end if;
  raise notice 'PRE 전제 OK — pack 118(DB-4 까지) · 멘토 승인 6 · 미승인 1 · 학생 6 · S3 결제 2회 · S4 결제 1회+IQ · S5 IQ 만 · S6 후기 · 동의 원장 % 행(이메일 가입 트리거 187)', (select val from db5_check.snapshot where key = 'ucr_count');
end $$;

commit;

-- ── 현재 동작 실측(전부 ROLLBACK) ──
begin;
set local search_path to public;
do $$
declare v_role text; v_terms timestamptz; v_nick text;
begin
  -- (1) app_role 없는 auth.users INSERT(소셜 provider 메타만) → 현재 트리거의 동작
  insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-00000000d5c0', 'authenticated', 'authenticated', 'pre-social@test.local',
          '{"iss":"https://kauth.kakao.com","sub":"pre","name":"사전소셜","avatar_url":"https://x/y.png","email":"pre-social@test.local","email_verified":true,"provider_id":"pre"}'::jsonb, now(), now());
  select role, terms_agreed_at, nickname into v_role, v_terms, v_nick from public.users where id = '00000000-0000-4000-8000-00000000d5c0';
  raise notice 'PRE 현재 동작: app_role 없는 가입 → users.role=% · terms_agreed_at=% · nickname=% · mentor_profiles=% (실패도 스킵도 아닌 조용한 student 폴백)',
    coalesce(v_role, 'NULL'), coalesce(v_terms::text, 'NULL'), coalesce(v_nick, 'NULL'),
    (select count(*) from public.mentor_profiles where user_id = '00000000-0000-4000-8000-00000000d5c0');
  if v_role is distinct from 'student' then
    raise exception 'PRE: 현재 트리거의 app_role 없음 폴백이 student 가 아니다(%)', v_role;
  end if;
  -- (2) 170 기준 리뷰 자격 — S4(결제 1회 + 완료 IQ) · S5(완료 IQ 만) 둘 다 true(느슨함 실측)
  raise notice 'PRE 170 자격: (M1,S4)=% · (M2,S5)=% · (M1,S3)=%',
    public.check_review_eligibility('00000000-0000-4000-8000-00000000d5a1', '00000000-0000-4000-8000-00000000d5b4'),
    public.check_review_eligibility('00000000-0000-4000-8000-00000000d5a2', '00000000-0000-4000-8000-00000000d5b5'),
    public.check_review_eligibility('00000000-0000-4000-8000-00000000d5a1', '00000000-0000-4000-8000-00000000d5b3');
  if not public.check_review_eligibility('00000000-0000-4000-8000-00000000d5a1', '00000000-0000-4000-8000-00000000d5b4')
     or not public.check_review_eligibility('00000000-0000-4000-8000-00000000d5a2', '00000000-0000-4000-8000-00000000d5b5') then
    raise exception 'PRE: 170 기준 자격이 기대(느슨함)와 다르다';
  end if;
end $$;
rollback;

-- (3) v2 가 banned 학생(S2)에 대해 무엇을 하는지 — 결과만 스냅샷(질문·홀드는 서브트랜잭션으로 되돌린다) · v3 동일성 대조용
begin;
set local search_path to public;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000d5b2', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d5b2","role":"authenticated"}', true);
do $$
declare r text;
begin
  begin
    perform * from api_app_v1.create_individual_question_as_student_v2('open', 't', 'b', 500000, null, 'pre-v2-banned', 'math_calculus');
    raise exception using message = 'PROBE_ROLLBACK';
  exception when others then
    if sqlerrm = 'PROBE_ROLLBACK' then r := 'OK'; else r := left(sqlerrm, 90); end if;
  end;
  perform set_config('db5.pre_v2_banned', r, false);
  raise notice 'PRE v2(banned S2): %', r;
end $$;
reset role;
insert into db5_check.snapshot (key, val) values ('pre_v2_banned', current_setting('db5.pre_v2_banned'))
on conflict (key) do update set val = excluded.val;
commit;

-- (4) 마케팅 동의 RPC 현재 동작 — 정상 학생 S1 도 idempotency_key NOT NULL 로 실패한다(후속 d 근거 · ROLLBACK)
begin;
set local search_path to public;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000d5b1', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d5b1","role":"authenticated"}', true);
do $$
declare r text;
begin
  begin
    perform api_web_v1.user_marketing_consent_set_self(true);
    r := 'OK';
  exception when others then
    r := left(sqlerrm, 90);
  end;
  raise notice 'PRE 마케팅 동의 RPC(S1 정상 학생): %', r;
  if r not like '%idempotency_key%' then
    raise exception 'PRE: 마케팅 동의 RPC 가 idempotency_key NOT NULL 로 실패하지 않는다(%)', r;
  end if;
end $$;
reset role;
rollback;
