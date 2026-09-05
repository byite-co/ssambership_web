-- db4_batch_pre_fixture.sql — DB-4 로컬 검증용 사전 fixture (오프라인 스크래치 PG 전용 · 운영 적용 금지).
-- 목적: DB-4 적용 **전**(= 운영 pack 112본 = DB-1·2·3 적용 상태) 운영 형태를 재현하고, 앱(authenticated)이 지금은 못 하는 쓰기 7종을 실측한다
--   (subscriptions UPDATE · refunds INSERT · F12 EXECUTE · users/mentor_plans/mentor_profiles(활동·학생증) UPDATE — 전부 권한/RLS 거부).
--   · 관리자 1(오너 지정 UUID) · 승인 멘토 M1(활동) · M2(일시 휴식 +3일) · M3(종료 예약 · 플랜 비활성) · M4(cap_limit 1) · M5(구독 닫힘) · M7(활동 · 구독자 S2)
--     · 대기 멘토 M6(미승인 · 플랜 없음)
--   · 학생 S1(캐시 300,000) · S2(캐시 0 · M7 스탠다드 활성 구독 · initial billing event) · S3(banned) · S4(50,000 · forward 데이터용) · S5(50,000 · 동시성용) · S6(100,000)
-- 이 파일은 데이터를 COMMIT 한다. 앱 불가 실측 블록은 별도 트랜잭션에서 ROLLBACK 한다.
begin;
set local search_path to public;

create schema if not exists db4_check;
create table if not exists db4_check.snapshot (key text primary key, val text);

-- ── 사용자 (auth.users INSERT → handle_new_auth_user 가 public.users · mentor_profiles 를 만든다) ──
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated', email, meta::jsonb, now(), now()
from (values
  ('9bf48819-1dd2-40dd-96a3-d64bcca2e60c'::uuid, 'db4-admin@test.local', '{"app_role":"student","full_name":"검증관리자"}'),
  ('00000000-0000-4000-8000-00000000d4a1'::uuid, 'db4-m1@test.local', '{"app_role":"mentor","full_name":"검증멘토일","nickname":"멘토일"}'),
  ('00000000-0000-4000-8000-00000000d4a2'::uuid, 'db4-m2@test.local', '{"app_role":"mentor","full_name":"검증멘토이","nickname":"멘토이"}'),
  ('00000000-0000-4000-8000-00000000d4a3'::uuid, 'db4-m3@test.local', '{"app_role":"mentor","full_name":"검증멘토삼","nickname":"멘토삼"}'),
  ('00000000-0000-4000-8000-00000000d4a4'::uuid, 'db4-m4@test.local', '{"app_role":"mentor","full_name":"검증멘토사","nickname":"멘토사"}'),
  ('00000000-0000-4000-8000-00000000d4a5'::uuid, 'db4-m5@test.local', '{"app_role":"mentor","full_name":"검증멘토오","nickname":"멘토오"}'),
  ('00000000-0000-4000-8000-00000000d4a6'::uuid, 'db4-m6@test.local', '{"app_role":"mentor","full_name":"검증멘토육","nickname":"멘토육"}'),
  ('00000000-0000-4000-8000-00000000d4a7'::uuid, 'db4-m7@test.local', '{"app_role":"mentor","full_name":"검증멘토칠","nickname":"멘토칠"}'),
  ('00000000-0000-4000-8000-00000000d4b1'::uuid, 'db4-s1@test.local', '{"app_role":"student","full_name":"검증학생일","nickname":"학생일","grade_level":"고2"}'),
  ('00000000-0000-4000-8000-00000000d4b2'::uuid, 'db4-s2@test.local', '{"app_role":"student","full_name":"검증학생이","nickname":"학생이"}'),
  ('00000000-0000-4000-8000-00000000d4b3'::uuid, 'db4-s3@test.local', '{"app_role":"student","full_name":"검증학생삼","nickname":"학생삼"}'),
  ('00000000-0000-4000-8000-00000000d4b4'::uuid, 'db4-s4@test.local', '{"app_role":"student","full_name":"검증학생사","nickname":"학생사"}'),
  ('00000000-0000-4000-8000-00000000d4b5'::uuid, 'db4-s5@test.local', '{"app_role":"student","full_name":"검증학생오","nickname":"학생오"}'),
  ('00000000-0000-4000-8000-00000000d4b6'::uuid, 'db4-s6@test.local', '{"app_role":"student","full_name":"검증학생육","nickname":"학생육"}')
) as v(id, email, meta);

update public.users set role = 'admin' where id = '9bf48819-1dd2-40dd-96a3-d64bcca2e60c';
update public.users set status = 'banned' where id = '00000000-0000-4000-8000-00000000d4b3';
update public.users set identity_verified_at = now()
 where id in ('00000000-0000-4000-8000-00000000d4b1', '00000000-0000-4000-8000-00000000d4b4', '00000000-0000-4000-8000-00000000d4b5', '00000000-0000-4000-8000-00000000d4b6');

insert into public.mentor_profiles (user_id, university_name, department_name, high_school_name)
select id, '서울대학교', '컴퓨터공학부', '검증고' from (values
  ('00000000-0000-4000-8000-00000000d4a1'::uuid), ('00000000-0000-4000-8000-00000000d4a2'::uuid), ('00000000-0000-4000-8000-00000000d4a3'::uuid),
  ('00000000-0000-4000-8000-00000000d4a4'::uuid), ('00000000-0000-4000-8000-00000000d4a5'::uuid), ('00000000-0000-4000-8000-00000000d4a6'::uuid),
  ('00000000-0000-4000-8000-00000000d4a7'::uuid)) v(id)
on conflict (user_id) do nothing;
update public.mentor_profiles set university_name = '서울대학교', department_name = '컴퓨터공학부'
 where user_id in ('00000000-0000-4000-8000-00000000d4a1','00000000-0000-4000-8000-00000000d4a2','00000000-0000-4000-8000-00000000d4a3',
                   '00000000-0000-4000-8000-00000000d4a4','00000000-0000-4000-8000-00000000d4a5','00000000-0000-4000-8000-00000000d4a6','00000000-0000-4000-8000-00000000d4a7');

-- 승인(서비스 경로 · JWT 없음 → 특권 가드 통과) → 166 트리거가 3 tier 플랜 시드 · 192 트리거가 잠정 pending 학교 인증 행
update public.mentor_profiles set verification_status = 'approved'
 where user_id in ('00000000-0000-4000-8000-00000000d4a1','00000000-0000-4000-8000-00000000d4a2','00000000-0000-4000-8000-00000000d4a3',
                   '00000000-0000-4000-8000-00000000d4a4','00000000-0000-4000-8000-00000000d4a5','00000000-0000-4000-8000-00000000d4a7');
-- M2 일시 휴식(+3일) · M3 종료 예약(웹 startMentorTermination 동일: terminating + 플랜 비활성) · M4 cap 1 · M5 구독 닫힘
update public.mentor_profiles set activity_status = 'paused', pause_started_at = now(), pause_until = now() + interval '3 days', pause_reason = 'rest', last_pause_at = now()
 where user_id = '00000000-0000-4000-8000-00000000d4a2';
update public.mentor_profiles set activity_status = 'terminating', termination_requested_at = now(), termination_effective_at = now() + interval '14 days'
 where user_id = '00000000-0000-4000-8000-00000000d4a3';
update public.mentor_plans set is_active = false where mentor_id = '00000000-0000-4000-8000-00000000d4a3';
update public.mentor_profiles set cap_limit = 1 where user_id = '00000000-0000-4000-8000-00000000d4a4';
update public.mentor_profiles set is_open_for_subscriptions = false where user_id = '00000000-0000-4000-8000-00000000d4a5';

-- 지갑(서비스 경로) — 1캐시 = 100 cents
insert into public.cash_wallets (user_id, balance_cents) values
  ('00000000-0000-4000-8000-00000000d4b1', 30000000),
  ('00000000-0000-4000-8000-00000000d4b2', 0),
  ('00000000-0000-4000-8000-00000000d4b4', 5000000),
  ('00000000-0000-4000-8000-00000000d4b5', 5000000),
  ('00000000-0000-4000-8000-00000000d4b6', 10000000)
on conflict (user_id) do update set balance_cents = excluded.balance_cents;

-- S2 → M7 스탠다드 활성 구독(웹 확정 형태 재현: 기간 10일 경과 · 남은 20일) + initial billing event
insert into public.subscriptions (id, student_id, mentor_id, plan_id, plan_tier, status, started_at, current_period_start, current_period_end, next_billing_at, billing_cycle)
select '00000000-0000-4000-8000-00000000d4c1', '00000000-0000-4000-8000-00000000d4b2', '00000000-0000-4000-8000-00000000d4a7', mp.id, 'standard', 'active',
       now() - interval '10 days', now() - interval '10 days', now() + interval '20 days', now() + interval '20 days', 'monthly'
  from public.mentor_plans mp where mp.mentor_id = '00000000-0000-4000-8000-00000000d4a7' and mp.plan_tier = 'standard';
insert into public.subscription_billing_events (subscription_id, student_id, mentor_id, event_type, status, period_start, period_end, billing_at, amount_cents, plan_tier, idempotency_key, processed_at)
values ('00000000-0000-4000-8000-00000000d4c1', '00000000-0000-4000-8000-00000000d4b2', '00000000-0000-4000-8000-00000000d4a7', 'initial', 'succeeded',
        now() - interval '10 days', now() + interval '20 days', now() - interval '10 days', 8490000, 'standard', 'sub_initial:00000000-0000-4000-8000-00000000d4c1', now() - interval '10 days');

-- ── 사전 스냅샷 (rollback 복원 대조용) ──
insert into db4_check.snapshot (key, val) values
  ('fn_public_count',  (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public')),
  ('fn_app_count',     (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api_app_v1')),
  ('fn_core_count',    (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'core_private')),
  ('fn_web_count',     (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api_web_v1')),
  ('policies_count',   (select count(*)::text from pg_policies where schemaname = 'public')),
  ('fn_iq_v1',         (select md5(pg_get_functiondef('public.create_individual_question_as_student(text,text,text,int,uuid,text)'::regprocedure)))),
  ('fn_f12',           (select md5(pg_get_functiondef('api_web_v1.subscription_checkout_confirm_v2(uuid,uuid,integer,text)'::regprocedure)))),
  ('fn_confirm',       (select md5(pg_get_functiondef('public.confirm_subscription_checkout(uuid,uuid,text)'::regprocedure)))),
  ('fn_profile_v1',    (select md5(pg_get_functiondef('api_app_v1.user_profile_update_self(text,text)'::regprocedure)))),
  ('fn_f8',            (select md5(pg_get_functiondef('api_web_v1.mentor_plan_prices_set_self(integer,integer,integer)'::regprocedure)))),
  ('pol_refund_ins',   (select coalesce(with_check, '') from pg_policies where tablename = 'refunds' and policyname = 'refund_ins')),
  ('m7_plans',         (select string_agg(plan_tier || '=' || amount_cents || ':' || is_active, ',' order by plan_tier) from public.mentor_plans where mentor_id = '00000000-0000-4000-8000-00000000d4a7'));

-- 전제 확인: 운영 pack(DB-3 까지) 적용 · DB-4 이전 상태
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api_app_v1'
              and p.proname in ('subscribe_with_cash', 'refund_estimate', 'mentor_activity_set', 'mentor_plan_active_set', 'user_profile_update_self_v2', 'create_individual_question_as_student_v2')) then
    raise exception 'PRE: DB-4 객체가 이미 있다';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api_app_v1') <> 6 then
    raise exception 'PRE: api_app_v1 함수 6 이 아니다(M17 5 + user_profile_update_self)';
  end if;
  if not exists (select 1 from pg_proc where proname = 'soft_delete_own_content') or not exists (select 1 from pg_proc where proname = 'ugc_block_hard_delete') then
    raise exception 'PRE: DB-3 미적용';
  end if;
  if (select count(*) from public.mentor_plans where mentor_id = '00000000-0000-4000-8000-00000000d4a1') <> 3
     or (select string_agg(plan_tier || '=' || amount_cents, ',' order by plan_tier) from public.mentor_plans where mentor_id = '00000000-0000-4000-8000-00000000d4a1') <> 'limited=2990000,premium=17490000,standard=8490000' then
    raise exception 'PRE: 승인 시드 플랜(166) 3 tier 권장가 불일치';
  end if;
  if (select count(*) from public.mentor_plans where mentor_id = '00000000-0000-4000-8000-00000000d4a6') <> 0 then
    raise exception 'PRE: 미승인 M6 에 플랜이 있다';
  end if;
  if public.mentor_cap_used('00000000-0000-4000-8000-00000000d4a7') <> 2.25 or public.mentor_cap_limit('00000000-0000-4000-8000-00000000d4a4') <> 1 then
    raise exception 'PRE: cap 전제 불일치';
  end if;
  if (select status from public.users where id = '00000000-0000-4000-8000-00000000d4b3') <> 'banned' then
    raise exception 'PRE: S3 banned 아님';
  end if;
end $$;

commit;

-- ── 앱(authenticated) 현재 불가 실측 — 별도 트랜잭션 · ROLLBACK ──
begin;
set local search_path to public;
create or replace function pg_temp.as_user(p_uid uuid, p_role text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  perform set_config('request.jwt.claims', case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', p_role)::text end, true);
end $$;
create or replace function pg_temp.try_rows(p_sql text) returns text language plpgsql as $$
declare n int;
begin
  execute p_sql; get diagnostics n = row_count; return 'ROWS=' || n;
exception when others then return left(sqlerrm, 90);
end $$;
create temp table pre_gap (key text, val text) on commit drop;
grant select, insert on pre_gap to authenticated;
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-00000000d4b2'::uuid, 'authenticated');
insert into pre_gap select 'gap_sub_cancel_update', pg_temp.try_rows($q$ update public.subscriptions set cancel_at_period_end = true where id = '00000000-0000-4000-8000-00000000d4c1' $q$);
insert into pre_gap select 'gap_refund_insert', pg_temp.try_rows($q$ insert into public.refunds (user_id, amount_cents, status, subscription_id, request_type, reason)
  values ('00000000-0000-4000-8000-00000000d4b2', 1000, 'pending', '00000000-0000-4000-8000-00000000d4c1', 'subscription_prorated', '검증 사유 다섯자') $q$);
insert into pre_gap select 'gap_f12_call', pg_temp.try_rows($q$ select api_web_v1.subscription_checkout_confirm_v2(gen_random_uuid(), gen_random_uuid(), 100, null) $q$);
insert into pre_gap select 'gap_users_student_status', pg_temp.try_rows($q$ update public.users set student_status = '휴학' where id = '00000000-0000-4000-8000-00000000d4b2' $q$);
select pg_temp.as_user('00000000-0000-4000-8000-00000000d4a7'::uuid, 'authenticated');
insert into pre_gap select 'gap_plan_toggle', pg_temp.try_rows($q$ update public.mentor_plans set is_active = false where mentor_id = '00000000-0000-4000-8000-00000000d4a7' and plan_tier = 'limited' $q$);
insert into pre_gap select 'gap_activity_update', pg_temp.try_rows($q$ update public.mentor_profiles set activity_status = 'paused' where user_id = '00000000-0000-4000-8000-00000000d4a7' $q$);
insert into pre_gap select 'gap_student_id_url', pg_temp.try_rows($q$ update public.mentor_profiles set student_id_image_url = 'student-id-images/x' where user_id = '00000000-0000-4000-8000-00000000d4a7' $q$);
reset role;
select pg_temp.as_user(null, null);
do $$
begin
  if (select val from pre_gap where key = 'gap_sub_cancel_update') not like 'permission denied%' then
    raise exception 'PRE: 학생 직접 해지 예약 UPDATE 가 권한 단계에서 거부돼야 한다(테이블 UPDATE 회수 · 정책 없음): %', (select val from pre_gap where key = 'gap_sub_cancel_update');
  end if;
  if (select val from pre_gap where key = 'gap_refund_insert') not like 'new row violates row-level security policy%' then
    raise exception 'PRE: refunds INSERT 가 RLS 로 거부돼야 한다: %', (select val from pre_gap where key = 'gap_refund_insert');
  end if;
  if (select val from pre_gap where key = 'gap_f12_call') not like 'permission denied%' then
    raise exception 'PRE: F12 는 service_role 전용이어야 한다: %', (select val from pre_gap where key = 'gap_f12_call');
  end if;
  if (select count(*) from pre_gap where key in ('gap_users_student_status', 'gap_plan_toggle', 'gap_activity_update', 'gap_student_id_url') and val like 'permission denied%') <> 4 then
    raise exception 'PRE: users/mentor_plans/mentor_profiles 직접 UPDATE 가 권한 단계에서 거부돼야 한다';
  end if;
end $$;
\pset tuples_only on
\pset format unaligned
select 'PRE gap ' || key || ' = ' || val from pre_gap order by key;
rollback;

-- ── §6 사전 실측 ──
select 'PRE snapshot ' || key || '=' || val from db4_check.snapshot order by key;
select 'PRE rows subscriptions=' || (select count(*) from public.subscriptions) || ' refunds=' || (select count(*) from public.refunds) || ' payments=' || (select count(*) from public.payments) || ' cash_ledger=' || (select count(*) from public.cash_ledger);
