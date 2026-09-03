-- db1_batch_pre_fixture.sql — DB-1 로컬 검증용 사전 fixture (오프라인 스크래치 PG 전용 · 운영 적용 금지).
-- 목적: DB-1 적용 **전** 운영 형태를 재현하고 §5 사전 실측값을 찍는다.
--   · 관리자 1 (오너 지정 UUID 9bf48819-… 그대로 — B-1 이 이 계정을 요구한다)
--   · 승인 멘토 M1(서울대/의예과)·M2(성균관대/경영학과, 이미 확정)·M3(홍익대/디자인학과)·M6(연세대/철학과, 행 superseded)
--     ·M7(고려대/통계학과, 행 rejected) — 승인 전이로 20260830150838 tmp 트리거가 approved·reviewed_by NULL 행을 만든다
--   · 대기 멘토 M4(성균관대/화학과, pending — 운영의 '성균관대 대기 멘토' 재현) · M5(연세대/컴퓨터공학과, pending — B-2 검증용)
--   · 학생 S01~S13 (cap 검증용 구독자) · 맞춤의뢰 주문 O1(정산 행 요율 0.07)·O2(정산 행 없음)·O3(정산 행, 요율 NULL 검증용)
-- 이 파일은 COMMIT 한다(적용 대상 데이터). 검증 assertion 은 post fixture 가 한다.
begin;
set local search_path to public;

create schema if not exists db1_check;
create table if not exists db1_check.snapshot (key text primary key, val text);

-- ── 사용자 (auth.users INSERT → handle_new_auth_user 가 public.users 를 만든다) ──
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated', email, meta::jsonb, now(), now()
from (values
  ('9bf48819-1dd2-40dd-96a3-d64bcca2e60c'::uuid, 'db1-admin@test.local',  '{"app_role":"student","full_name":"검증관리자"}'),
  ('00000000-0000-4000-8000-00000000d1a1'::uuid, 'db1-m1@test.local', '{"app_role":"mentor","full_name":"검증멘토일"}'),
  ('00000000-0000-4000-8000-00000000d1a2'::uuid, 'db1-m2@test.local', '{"app_role":"mentor","full_name":"검증멘토이"}'),
  ('00000000-0000-4000-8000-00000000d1a3'::uuid, 'db1-m3@test.local', '{"app_role":"mentor","full_name":"검증멘토삼"}'),
  ('00000000-0000-4000-8000-00000000d1a4'::uuid, 'db1-m4@test.local', '{"app_role":"mentor","full_name":"검증멘토사"}'),
  ('00000000-0000-4000-8000-00000000d1a5'::uuid, 'db1-m5@test.local', '{"app_role":"mentor","full_name":"검증멘토오"}'),
  ('00000000-0000-4000-8000-00000000d1a6'::uuid, 'db1-m6@test.local', '{"app_role":"mentor","full_name":"검증멘토육"}'),
  ('00000000-0000-4000-8000-00000000d1a7'::uuid, 'db1-m7@test.local', '{"app_role":"mentor","full_name":"검증멘토칠"}')
) as v(id, email, meta);

insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000',
       ('00000000-0000-4000-8000-00000000d1' || lpad(to_hex(g), 2, '0'))::uuid,
       'authenticated', 'authenticated', 'db1-s' || g || '@test.local',
       '{"app_role":"student","full_name":"검증학생"}'::jsonb, now(), now()
from generate_series(1, 13) g;

update public.users set role = 'admin' where id = '9bf48819-1dd2-40dd-96a3-d64bcca2e60c';

-- ── 멘토 프로필 (기본 pending · cap_limit 기본값 28) ──
-- handle_new_auth_user 가 app_role=mentor 에 대해 프로필 행을 이미 만든다(가입 경로 재현) → 학적만 upsert.
insert into public.mentor_profiles (user_id, university_name, department_name, high_school_name) values
  ('00000000-0000-4000-8000-00000000d1a1', '서울대학교',   '의예과',       '검증고'),
  ('00000000-0000-4000-8000-00000000d1a2', '성균관대학교', '경영학과',     '검증고'),
  ('00000000-0000-4000-8000-00000000d1a3', '홍익대학교',   '디자인학과',   '검증고'),
  ('00000000-0000-4000-8000-00000000d1a4', '성균관대학교', '화학과',       '검증고'),
  ('00000000-0000-4000-8000-00000000d1a5', '연세대학교',   '컴퓨터공학과', '검증고'),
  ('00000000-0000-4000-8000-00000000d1a6', '연세대학교',   '철학과',       '검증고'),
  ('00000000-0000-4000-8000-00000000d1a7', '고려대학교',   '통계학과',     '검증고')
on conflict (user_id) do update set
  university_name = excluded.university_name,
  department_name = excluded.department_name,
  high_school_name = excluded.high_school_name;

-- 승인 전이 → 시드 플랜(1.0/2.5/4.5) + tmp 트리거(approved · reviewed_by NULL 행)
update public.mentor_profiles set verification_status = 'approved'
 where user_id in ('00000000-0000-4000-8000-00000000d1a1', '00000000-0000-4000-8000-00000000d1a2',
                   '00000000-0000-4000-8000-00000000d1a3', '00000000-0000-4000-8000-00000000d1a6',
                   '00000000-0000-4000-8000-00000000d1a7');

-- M2 는 '이미 확정' 재현 (과거 시각)
update public.mentor_school_verifications
   set reviewed_by = '9bf48819-1dd2-40dd-96a3-d64bcca2e60c', reviewed_at = '2026-08-01 00:00:00+00'
 where mentor_id = '00000000-0000-4000-8000-00000000d1a2';
-- M6 의 자동 행은 superseded, M7 의 자동 행은 rejected (B-4 신규 생성 경로 검증용)
update public.mentor_school_verifications set status = 'superseded' where mentor_id = '00000000-0000-4000-8000-00000000d1a6';
update public.mentor_school_verifications set status = 'rejected'   where mentor_id = '00000000-0000-4000-8000-00000000d1a7';

-- ── 맞춤의뢰 주문 · 정산 행 · 에스크로 hold (C 검증) ──
insert into public.custom_request_posts (id, author_id, title, status)
values ('00000000-0000-4000-8000-00000000d1c0', '00000000-0000-4000-8000-00000000d101', '검증 의뢰', 'open');

insert into public.custom_request_orders (id, post_id, student_id, mentor_id, payment_status, status)
values
  ('00000000-0000-4000-8000-00000000d1c1', '00000000-0000-4000-8000-00000000d1c0', '00000000-0000-4000-8000-00000000d101', '00000000-0000-4000-8000-00000000d1a1', 'escrowed', 'in_progress'),
  ('00000000-0000-4000-8000-00000000d1c2', '00000000-0000-4000-8000-00000000d1c0', '00000000-0000-4000-8000-00000000d101', '00000000-0000-4000-8000-00000000d1a1', 'escrowed', 'in_progress'),
  ('00000000-0000-4000-8000-00000000d1c3', '00000000-0000-4000-8000-00000000d1c0', '00000000-0000-4000-8000-00000000d101', '00000000-0000-4000-8000-00000000d1a1', 'escrowed', 'in_progress');

insert into public.custom_order_settlement_items
  (custom_request_order_id, mentor_id, student_id, gross_amount, platform_fee_amount, mentor_amount, fee_rate, status)
values
  ('00000000-0000-4000-8000-00000000d1c1', '00000000-0000-4000-8000-00000000d1a1', '00000000-0000-4000-8000-00000000d101', 10000, 700, 9300, 0.07, 'on_hold'),
  ('00000000-0000-4000-8000-00000000d1c3', '00000000-0000-4000-8000-00000000d1a1', '00000000-0000-4000-8000-00000000d101', 10000, 500, 9500, 0.05, 'on_hold');

insert into public.cash_wallets (user_id, balance_cents) values
  ('00000000-0000-4000-8000-00000000d101', 0), ('00000000-0000-4000-8000-00000000d1a1', 0)
on conflict (user_id) do nothing;

insert into public.cash_ledger (user_id, delta_cents, reason, ref_type, ref_id, idempotency_key)
select '00000000-0000-4000-8000-00000000d101', -1000000, 'custom_order_escrow_hold', 'custom_request_orders', o, 'cr_hold_' || o::text
from unnest(array['00000000-0000-4000-8000-00000000d1c1'::uuid, '00000000-0000-4000-8000-00000000d1c2'::uuid, '00000000-0000-4000-8000-00000000d1c3'::uuid]) o;

-- ── 사전 스냅샷 (rollback 복원 대조용) ──
insert into db1_check.snapshot (key, val) values
  ('f8_md5',    (select md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api_web_v1' and p.proname = 'mentor_plan_prices_set_self')),
  ('seed_md5',  (select md5(pg_get_functiondef(p.oid)) from pg_proc p where p.proname = 'mp_seed_default_plans_on_approval')),
  ('guard_md5', (select md5(pg_get_functiondef(p.oid)) from pg_proc p where p.proname = 'enforce_mentor_profile_privileged_guard')),
  ('guard_ins_trg', (select pg_get_triggerdef(t.oid) from pg_trigger t where t.tgname = 'trg_mentor_profile_privileged_guard_ins')),
  ('rpc174_md5', (select md5(pg_get_functiondef(p.oid)) from pg_proc p where p.proname = 'approve_mentor_school_verification_admin')),
  ('tmp_fn_md5', (select md5(pg_get_functiondef(p.oid)) from pg_proc p where p.proname = 'tmp_auto_school_verification')),
  ('tmp_trg',    (select pg_get_triggerdef(t.oid) from pg_trigger t where t.tgname = 'trg_tmp_auto_school_verification')),
  ('split_md5',  (select md5(pg_get_functiondef(p.oid)) from pg_proc p where p.proname = 'record_custom_order_dispute_split')),
  ('cap_w_md5',  (select md5(pg_get_functiondef(p.oid)) from pg_proc p where p.proname = 'subscription_cap_weight')),
  ('cap_l_md5',  (select md5(pg_get_functiondef(p.oid)) from pg_proc p where p.proname = 'mentor_cap_limit')),
  ('mp_updated_at_m1', (select updated_at::text from public.mentor_profiles where user_id = '00000000-0000-4000-8000-00000000d1a1')),
  ('mplans_updated_at_m1', (select string_agg(updated_at::text, ',' order by plan_tier) from public.mentor_plans where mentor_id = '00000000-0000-4000-8000-00000000d1a1')),
  ('msv_m2_reviewed_at', (select reviewed_at::text from public.mentor_school_verifications where mentor_id = '00000000-0000-4000-8000-00000000d1a2'));

-- 전제 확인: DB-1 이전 상태여야 한다
do $$
begin
  if public.subscription_cap_weight('premium') <> 4.5 then raise exception 'PRE: 가중치가 4.5 가 아니다'; end if;
  if (select count(distinct cap_limit) from public.mentor_profiles) <> 1 or (select min(cap_limit) from public.mentor_profiles) <> 28 then
    raise exception 'PRE: cap_limit 이 28 단일값이 아니다';
  end if;
  if not exists (select 1 from pg_proc where proname = 'record_custom_order_dispute_split' and prosrc like '%v_fee_rate numeric := 0.05;%') then
    raise exception 'PRE: 125 본문(0.05) 이 아니다';
  end if;
  if (select count(*) from public.mentor_school_verifications v join public.mentor_profiles p on p.user_id = v.mentor_id
       where v.status = 'approved' and v.reviewed_by is null and p.verification_status = 'approved') <> 2 then
    raise exception 'PRE: B-1 대상(M1·M3) 2건이 아니다';
  end if;
  if (select count(*) from public.mentor_school_verifications where mentor_id = '00000000-0000-4000-8000-00000000d1a4') <> 0 then
    raise exception 'PRE: 대기 멘토 M4 에 인증 행이 있다';
  end if;
end $$;

commit;

-- ── §5 사전 실측 (tuples only) ──
\pset tuples_only on
\pset format unaligned
select 'PRE snapshot ' || key || '=' || val from db1_check.snapshot where key like '%md5' order by key;
select 'PRE A cap_limit=' || string_agg(cap_limit::text, ',') from (select distinct cap_limit from public.mentor_profiles) d;
select 'PRE A weights=' || public.subscription_cap_weight('limited') || '/' || public.subscription_cap_weight('standard') || '/' || public.subscription_cap_weight('premium');
select 'PRE B ' || status || ' 미확정=' || (reviewed_by is null) || ' n=' || count(*) from public.mentor_school_verifications group by status, (reviewed_by is null) order by 1;
select 'PRE B trigger=' || tgname from pg_trigger where tgname like '%school_verification%' order by 1;
select 'PRE C 상수잔존=' || (prosrc like '%0.05%') from pg_proc where proname = 'record_custom_order_dispute_split';
