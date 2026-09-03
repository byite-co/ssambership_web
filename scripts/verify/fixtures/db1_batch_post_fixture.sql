-- db1_batch_post_fixture.sql — DB-1(190/191/192) 적용 후 실구동 assertion (오프라인 스크래치 PG 전용).
-- 전체가 단일 트랜잭션이며 마지막 ROLLBACK 으로 검증 쓰기를 전부 지운다(적용 상태는 그대로 남는다).
-- JWT 에뮬레이션: platform_stub 의 auth.uid() 는 request.jwt.claim.sub, auth.jwt() 는 request.jwt.claims 를 읽는다.
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
-- 예외 코드/메시지 캡처: 실행이 성공하면 'OK', 실패하면 SQLERRM 앞부분
create or replace function pg_temp.try(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql; return 'OK';
exception when others then return left(sqlerrm, 80);
end $$;

-- 고정 ID
\set admin '''9bf48819-1dd2-40dd-96a3-d64bcca2e60c'''
\set m1 '''00000000-0000-4000-8000-00000000d1a1'''
\set m2 '''00000000-0000-4000-8000-00000000d1a2'''
\set m3 '''00000000-0000-4000-8000-00000000d1a3'''
\set m4 '''00000000-0000-4000-8000-00000000d1a4'''
\set m5 '''00000000-0000-4000-8000-00000000d1a5'''
\set m6 '''00000000-0000-4000-8000-00000000d1a6'''
\set m7 '''00000000-0000-4000-8000-00000000d1a7'''
\set s1 '''00000000-0000-4000-8000-00000000d101'''
\set o1 '''00000000-0000-4000-8000-00000000d1c1'''
\set o2 '''00000000-0000-4000-8000-00000000d1c2'''
\set o3 '''00000000-0000-4000-8000-00000000d1c3'''

-- ═══ A. 캡 구조 ═══
select pg_temp.ok(public.subscription_cap_weight('limited') = 1.0 and public.subscription_cap_weight('standard') = 2.25
                  and public.subscription_cap_weight('premium') = 4.75, 'A-1 가중치 1.0/2.25/4.75');
select pg_temp.ok(public.mentor_cap_limit(:m1::uuid) = 50 and public.mentor_cap_limit(gen_random_uuid()) = 50, 'A-1 mentor_cap_limit = 50 (행 · 폴백)');
select pg_temp.ok((select string_agg(distinct cap_limit::text, ',') from public.mentor_profiles) = '50', 'A-1 mentor_profiles.cap_limit distinct = {50}');
select pg_temp.ok((select column_default from information_schema.columns where table_name = 'mentor_profiles' and column_name = 'cap_limit') = '50', 'A-1 cap_limit 기본값 50');
select pg_temp.ok((select updated_at::text from public.mentor_profiles where user_id = :m1::uuid) = (select val from db1_check.snapshot where key = 'mp_updated_at_m1'), 'A-3 백필이 mentor_profiles.updated_at 을 바꾸지 않았다');
select pg_temp.ok((select string_agg(updated_at::text, ',' order by plan_tier) from public.mentor_plans where mentor_id = :m1::uuid) = (select val from db1_check.snapshot where key = 'mplans_updated_at_m1'), 'A-7 백필이 mentor_plans.updated_at 을 바꾸지 않았다');
select pg_temp.ok((select string_agg(plan_tier || '=' || cap_weight, ',' order by plan_tier) from public.mentor_plans where mentor_id = :m1::uuid) = 'limited=1.0,premium=4.75,standard=2.25', 'A-7 mentor_plans.cap_weight 백필 1.0/2.25/4.75');

-- A-4 특권 가드: 본인 JWT(authenticated) 로 기본값 INSERT 는 통과(WHEN 절 불발), cap_limit 지정 INSERT 는 42501
-- 사용자 행만 먼저(학생 메타 → 프로필 자동 생성 없음), 프로필 INSERT 는 본인 JWT 로.
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-00000000d1a8', 'authenticated', 'authenticated', 'db1-m8@test.local', '{"app_role":"student"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-00000000d1a9', 'authenticated', 'authenticated', 'db1-m9@test.local', '{"app_role":"student"}', now(), now());
select pg_temp.as_user('00000000-0000-4000-8000-00000000d1a8'::uuid, 'authenticated');
select pg_temp.ok(r = 'OK', 'A-4 본인 JWT 기본값(50) INSERT 통과 — WHEN 절 50 정합: ' || r)
  from (select pg_temp.try($q$ insert into public.mentor_profiles (user_id, university_name, department_name, high_school_name)
                              values ('00000000-0000-4000-8000-00000000d1a8', '검증대', '검증과', '검증고') $q$) r) t;
select pg_temp.as_user('00000000-0000-4000-8000-00000000d1a9'::uuid, 'authenticated');
select pg_temp.ok(r like 'MENTOR_PROFILE_PRIVILEGED_COLUMN_FORBIDDEN%', 'A-4 본인 JWT cap_limit=60 INSERT 는 42501: ' || r)
  from (select pg_temp.try($q$ insert into public.mentor_profiles (user_id, university_name, department_name, high_school_name, cap_limit)
                              values ('00000000-0000-4000-8000-00000000d1a9', '검증대', '검증과', '검증고', 60) $q$) r) t;
select pg_temp.as_user(null, null);
select pg_temp.ok((select cap_limit from public.mentor_profiles where user_id = '00000000-0000-4000-8000-00000000d1a8') = 50, 'A-4 새 프로필 cap_limit 기본값 50');

-- A-6 F8: 멘토 JWT 로 가격 설정 — cap_weight 는 함수값
select pg_temp.as_user(:m1::uuid, 'authenticated');
select pg_temp.ok((api_web_v1.mentor_plan_prices_set_self(29900, 84900, 174900) ->> 'ok') = 'true'
                  and jsonb_array_length(api_web_v1.mentor_plan_prices_set_self(29900, 84900, 174900) -> 'unchanged') = 3,
                  'A-6 F8 시드값 재전송 = unchanged 3 (cap_weight 정합)');
select pg_temp.ok((api_web_v1.mentor_plan_prices_set_self(29900, 84900, 200000) ->> 'ok') = 'true'
                  and (select cap_weight from public.mentor_plans where mentor_id = :m1::uuid and plan_tier = 'premium') = 4.75,
                  'A-6 F8 가격 변경 후 premium cap_weight = 4.75');
select pg_temp.as_user(null, null);

-- A-5 enforce_mentor_cap: 50 한도 · 4.75 가중치 (premium 10 = 47.5 OK · 11 번째 52.25 초과 · standard 2.25 → 49.75 OK · limited 1.0 초과)
do $$
declare i int; r text;
begin
  for i in 1..10 loop
    insert into public.subscriptions (student_id, mentor_id, plan_tier, status)
    values (('00000000-0000-4000-8000-00000000d1' || lpad(to_hex(i), 2, '0'))::uuid, '00000000-0000-4000-8000-00000000d1a1', 'premium', 'active');
  end loop;
  perform pg_temp.ok(public.mentor_cap_used('00000000-0000-4000-8000-00000000d1a1') = 47.5, 'A-5 premium 10건 = 47.5');
  r := pg_temp.try($q$ insert into public.subscriptions (student_id, mentor_id, plan_tier, status)
                        values ('00000000-0000-4000-8000-00000000d10b', '00000000-0000-4000-8000-00000000d1a1', 'premium', 'active') $q$);
  perform pg_temp.ok(r like 'MENTOR_CAP_EXCEEDED%', 'A-5 11번째 premium(52.25) 은 MENTOR_CAP_EXCEEDED: ' || r);
  insert into public.subscriptions (student_id, mentor_id, plan_tier, status)
  values ('00000000-0000-4000-8000-00000000d10c', '00000000-0000-4000-8000-00000000d1a1', 'standard', 'active');
  perform pg_temp.ok(public.mentor_cap_used('00000000-0000-4000-8000-00000000d1a1') = 49.75, 'A-5 + standard = 49.75');
  r := pg_temp.try($q$ insert into public.subscriptions (student_id, mentor_id, plan_tier, status)
                        values ('00000000-0000-4000-8000-00000000d10d', '00000000-0000-4000-8000-00000000d1a1', 'limited', 'active') $q$);
  perform pg_temp.ok(r like 'MENTOR_CAP_EXCEEDED%', 'A-5 + limited(50.75) 은 MENTOR_CAP_EXCEEDED');
end $$;

-- ═══ B-1. 일괄 확정 ═══
select pg_temp.ok((select count(*) from public.mentor_school_verifications v join public.mentor_profiles p on p.user_id = v.mentor_id
                    where v.status = 'approved' and v.reviewed_by is null and p.verification_status = 'approved') = 0, 'B-1 잠정 approved 0건');
select pg_temp.ok((select reviewed_by from public.mentor_school_verifications where mentor_id = :m1::uuid and status = 'approved') = :admin::uuid
                  and (select reviewed_by from public.mentor_school_verifications where mentor_id = :m3::uuid and status = 'approved') = :admin::uuid,
                  'B-1 M1·M3 reviewed_by = 오너 admin');
select pg_temp.ok((select reviewed_at::text from public.mentor_school_verifications where mentor_id = :m2::uuid) = (select val from db1_check.snapshot where key = 'msv_m2_reviewed_at'), 'B-1 이미 확정된 M2 는 불변');
select pg_temp.ok((select count(*) from public.mentor_school_verifications where mentor_id = :m4::uuid) = 0, 'B-1 성균관대 대기 멘토 M4 행 없음(제외)');
select pg_temp.ok((select (detail ->> 'count')::int from public.admin_action_logs where action_type = 'school_verification_bulk_confirmed' order by created_at desc limit 1) = 2
                  and (select detail ->> 'note' from public.admin_action_logs where action_type = 'school_verification_bulk_confirmed' order by created_at desc limit 1) = '2026-09-03 오너 결정에 따른 자동 판정 건 일괄 확정'
                  and (select admin_id from public.admin_action_logs where action_type = 'school_verification_bulk_confirmed' order by created_at desc limit 1) = :admin::uuid,
                  'B-1 admin_action_logs 기록(count 2 · note · admin_id)');
select pg_temp.ok((select count(*) from public.mentor_school_verifications v join public.admin_action_logs l on l.action_type = 'school_verification_bulk_confirmed'
                    where v.reviewed_by = l.admin_id and v.reviewed_at = (l.detail ->> 'reviewed_at')::timestamptz) = 2, 'B-1 기록 reviewed_at 이 행과 바이트 일치(롤백 대조 가능)');

-- ═══ B-2. 자동 생성 = pending ═══
select pg_temp.ok(not exists (select 1 from pg_trigger where tgname = 'trg_tmp_auto_school_verification')
                  and not exists (select 1 from pg_proc where proname = 'tmp_auto_school_verification')
                  and exists (select 1 from pg_trigger where tgname = 'trg_auto_school_verification'), 'B-2 tmp_ 제거 · trg_auto_school_verification 존재');
update public.mentor_profiles set verification_status = 'approved' where user_id = :m5::uuid;   -- 관리자 승인(서비스 경로)
select pg_temp.ok((select count(*) from public.mentor_school_verifications where mentor_id = :m5::uuid) = 1
                  and (select status || '|' || coalesce(reviewed_by::text, 'null') || '|' || coalesce(reviewed_at::text, 'null') || '|' || school_tier || '|' || verified_major_category || '|' || verified_university_name || '|' || verified_department_name || '|' || coalesce(document_storage_ref, 'nodoc')
                         from public.mentor_school_verifications where mentor_id = :m5::uuid) = 'pending|null|null|서연고|공학|연세대학교|컴퓨터공학과|nodoc',
                  'B-2 M5 승인 → pending · reviewed NULL · 서연고/공학 제안값');
update public.mentor_profiles set verification_status = 'approved' where user_id = :m5::uuid;   -- 재승인(값 동일) → 중복 생성 없음
select pg_temp.ok((select count(*) from public.mentor_school_verifications where mentor_id = :m5::uuid) = 1, 'B-2 재승인 시 pending 중복 생성 없음');
select pg_temp.ok((select string_agg(plan_tier || '=' || cap_weight, ',' order by plan_tier) from public.mentor_plans where mentor_id = :m5::uuid) = 'limited=1.0,premium=4.75,standard=2.25', 'A-5 신규 승인 시드 플랜 cap_weight 1.0/2.25/4.75');

-- ═══ B-3. 확정 RPC ═══
select pg_temp.as_user(:m5::uuid, 'authenticated');
select pg_temp.ok(pg_temp.try(format($q$ select public.approve_mentor_school_verification_admin(%L, '연세대학교', 'yonsei', '컴퓨터공학과', '공학', '서연고') $q$,
                                     (select id from public.mentor_school_verifications where mentor_id = :m5::uuid))) like 'NOT_ADMIN%', 'B-3 멘토 JWT 는 NOT_ADMIN');
select pg_temp.as_user(:admin::uuid, 'authenticated');
select pg_temp.ok(public.is_admin(), 'B-3 admin JWT 에서 is_admin() = true');
select pg_temp.ok((public.approve_mentor_school_verification_admin((select id from public.mentor_school_verifications where mentor_id = :m5::uuid),
                     '연세대학교', 'yonsei', '컴퓨터공학과', '공학', '서연고') ->> 'status') = 'approved', 'B-3 pending · 서류 없음 행 확정 성공');
select pg_temp.ok((select status || '|' || reviewed_by::text || '|' || (reviewed_at is not null)::text || '|' || verified_university_id from public.mentor_school_verifications where mentor_id = :m5::uuid) = 'approved|' || :admin || '|true|yonsei', 'B-3 확정 결과: approved · reviewed_by admin · 관리자 값');
select pg_temp.ok(pg_temp.try(format($q$ select public.approve_mentor_school_verification_admin(%L, '연세대학교', 'yonsei', '컴퓨터공학과', '공학', '서연고') $q$,
                                     (select id from public.mentor_school_verifications where mentor_id = :m5::uuid))) like 'NOT_REVIEWABLE: approved%', 'B-3 이미 확정된 approved 행은 NOT_REVIEWABLE');
-- 잠정 approved(reviewed_by NULL) 행 확정 — M6 에 직접 만든다(서비스 경로)
select pg_temp.as_user(null, null);
insert into public.mentor_school_verifications (mentor_id, status, school_tier, verified_major_category) values (:m6::uuid, 'approved', '서연고', '인문');
select pg_temp.as_user(:admin::uuid, 'authenticated');
select pg_temp.ok((public.approve_mentor_school_verification_admin((select id from public.mentor_school_verifications where mentor_id = :m6::uuid and status = 'approved'),
                     '연세대학교', 'yonsei', '철학과', '인문', '서연고') ->> 'superseded_count') = '0', 'B-3 잠정 approved(reviewed_by NULL) 행 확정 성공');
select pg_temp.ok((select reviewed_by from public.mentor_school_verifications where mentor_id = :m6::uuid and status = 'approved') = :admin::uuid, 'B-3 잠정 행 확정 후 reviewed_by admin');
select pg_temp.as_user(null, null);

-- ═══ B-4. 학적 변경 재판정 ═══
-- 서비스 경로(학적 변경 승인 액션 = service role) : M3 홍익대/디자인 → 고려대
update public.mentor_profiles set university_name = '고려대학교' where user_id = :m3::uuid;
select pg_temp.ok((select status || '|' || coalesce(reviewed_by::text, 'null') || '|' || coalesce(reviewed_at::text, 'null') || '|' || school_tier || '|' || verified_major_category || '|' || verified_university_name || '|' || coalesce(verified_university_id, 'null')
                     from public.mentor_school_verifications where mentor_id = :m3::uuid) = 'pending|null|null|서연고|예체능|고려대학교|null',
                  'B-4 university_name 변경 → pending · reviewed NULL · 서연고 재판정 · university_id NULL');
update public.mentor_profiles set department_name = '경영학과' where user_id = :m3::uuid;
select pg_temp.ok((select verified_major_category || '|' || verified_department_name from public.mentor_school_verifications where mentor_id = :m3::uuid) = '사회상경|경영학과', 'B-4 department_name 변경 → 사회상경 재판정');
-- 확정 후 같은 값으로 UPDATE 하면 트리거가 돌지 않는다(IS DISTINCT FROM)
select pg_temp.as_user(:admin::uuid, 'authenticated');
select public.approve_mentor_school_verification_admin((select id from public.mentor_school_verifications where mentor_id = :m3::uuid), '고려대학교', 'korea', '경영학과', '사회상경', '서연고');
select pg_temp.as_user(null, null);
update public.mentor_profiles set university_name = '고려대학교', department_name = '경영학과' where user_id = :m3::uuid;
select pg_temp.ok((select status || '|' || (reviewed_by is not null)::text from public.mentor_school_verifications where mentor_id = :m3::uuid) = 'approved|true', 'B-4 같은 값 UPDATE 는 재판정하지 않는다');
-- 멘토 본인 JWT 경로(F7 자기 편집): 077 guard_self_review 가 제안값을 비우지만 잠정(pending · reviewed NULL) 상태는 동일
select pg_temp.as_user(:m3::uuid, 'authenticated');
update public.mentor_profiles set university_name = '서강대학교' where user_id = :m3::uuid;
select pg_temp.as_user(null, null);
select pg_temp.ok((select status || '|' || coalesce(reviewed_by::text, 'null') || '|' || coalesce(school_tier, 'null') from public.mentor_school_verifications where mentor_id = :m3::uuid) = 'pending|null|null',
                  'B-4 멘토 본인 JWT 변경 → pending · reviewed NULL (guard_self_review 가 제안값은 NULL 로)');
-- approved 멘토인데 approved·pending 행이 없으면 pending 행 신규 생성 (M7: rejected 만 있음)
update public.mentor_profiles set university_name = '중앙대학교' where user_id = :m7::uuid;
select pg_temp.ok((select string_agg(status || ':' || coalesce(school_tier, 'null'), ',' order by status) from public.mentor_school_verifications where mentor_id = :m7::uuid) = 'pending:중경외시,rejected:서연고', 'B-4 재판정할 행이 없는 승인 멘토 → pending 행 신규 생성(중경외시)');
-- 대기(pending) 멘토의 학적 변경은 행을 만들지 않는다
update public.mentor_profiles set university_name = '서울대학교' where user_id = :m4::uuid;
select pg_temp.ok((select count(*) from public.mentor_school_verifications where mentor_id = :m4::uuid) = 0, 'B-4 미승인 멘토 학적 변경은 행 생성 없음');

-- ═══ C. 분쟁 분배 수수료 = 정산 행 요율 ═══
select pg_temp.ok((select prosrc not like '%0.05%' from pg_proc where proname = 'record_custom_order_dispute_split'), 'C 상수 0.05 잔존 없음');
select pg_temp.ok((public.record_custom_order_dispute_split(:o1::uuid, 6000, 4000, :admin::uuid) ->> 'fee_rate')::numeric = 0.07, 'C O1 분배 fee_rate = 정산 행 0.07');
select pg_temp.ok((select (delta_cents) from public.cash_ledger where idempotency_key = 'cr_dispute_payout_' || :o1) = 558000
                  and (select (delta_cents) from public.cash_ledger where idempotency_key = 'cr_dispute_refund_' || :o1) = 400000,
                  'C O1 멘토 실수령 5,580원(= 6,000 − floor(6,000×0.07)=420) · 학생 환불 4,000원');
select pg_temp.ok((select status from public.custom_order_settlement_items where custom_request_order_id = :o1::uuid) = 'cancelled'
                  and (select payment_status from public.custom_request_orders where id = :o1::uuid) = 'dispute_resolved', 'C O1 정산 행 cancelled · 주문 dispute_resolved');
select pg_temp.ok((public.record_custom_order_dispute_split(:o1::uuid, 6000, 4000, :admin::uuid) ->> 'noop') = 'true', 'C O1 재호출은 noop(멱등 · 요율 게이트 통과)');
select pg_temp.ok(pg_temp.try(format($q$ select public.record_custom_order_dispute_split(%L, 6000, 4000, %L) $q$, :o2::uuid, :admin::uuid)) like 'SETTLEMENT_FEE_RATE_MISSING%', 'C O2 정산 행 없음 → SETTLEMENT_FEE_RATE_MISSING');
alter table public.custom_order_settlement_items alter column fee_rate drop not null;   -- 로컬 검증 전용(트랜잭션 rollback)
update public.custom_order_settlement_items set fee_rate = null where custom_request_order_id = :o3::uuid;
select pg_temp.ok(pg_temp.try(format($q$ select public.record_custom_order_dispute_split(%L, 6000, 4000, %L) $q$, :o3::uuid, :admin::uuid)) like 'SETTLEMENT_FEE_RATE_MISSING%', 'C O3 fee_rate NULL → SETTLEMENT_FEE_RATE_MISSING');
select pg_temp.ok((select count(*) from public.cash_ledger where idempotency_key in ('cr_dispute_payout_' || :o2, 'cr_dispute_refund_' || :o2, 'cr_dispute_payout_' || :o3, 'cr_dispute_refund_' || :o3)) = 0, 'C 예외 시 원장 기록 0(부분 반영 없음)');

\echo DB1 POST FIXTURE PASS
rollback;
