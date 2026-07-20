-- notification_atomization_157_159_fixture.sql — rollback-only 검증 fixture.
-- 대상: 157(구독 4종)·158(멘토 4종)·159(맞춤의뢰 2종) 알림 원자화 트리거.
-- 실행: staging(lbeqxarxothkmzqvpudy)에 157~159 적용 후, postgres 권한 psql/SQL Editor 에서
--   전체를 한 번에 실행한다. 마지막 ROLLBACK 으로 모든 fixture 가 사라진다(실데이터 무변경).
-- 주의: 전체가 단일 트랜잭션이므로 txid_current() 는 상수 — mentor_plans 가격 변경의
--   "다른 제출(다른 tx) 재알림"은 본 fixture 로 검증 불가(2세션/2트랜잭션 실측 항목).

begin;
set local search_path to public;

-- ── fixture 사용자 ───────────────────────────────────────────────────────────
-- auth.users FK 충족용 최소 행(전부 rollback). 스키마 드리프트 시 컬럼 보정.
insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-0000000157a1', 'authenticated', 'authenticated', 'fx157-student1@test.local', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-0000000157a2', 'authenticated', 'authenticated', 'fx157-student2@test.local', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-0000000157b1', 'authenticated', 'authenticated', 'fx157-mentor@test.local', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-0000000157c1', 'authenticated', 'authenticated', 'fx157-admin@test.local', now(), now());

insert into public.users (id, role, full_name, nickname, email) values
  ('00000000-0000-4000-8000-0000000157a1', 'student', '검증학생일', null, 'fx157-student1@test.local'),
  ('00000000-0000-4000-8000-0000000157a2', 'student', '검증학생이', null, 'fx157-student2@test.local'),
  ('00000000-0000-4000-8000-0000000157b1', 'mentor', '검증멘토', null, 'fx157-mentor@test.local'),
  ('00000000-0000-4000-8000-0000000157c1', 'admin', '검증관리자', null, 'fx157-admin@test.local');

insert into public.mentor_profiles (user_id, university_name, department_name, high_school_name)
values ('00000000-0000-4000-8000-0000000157b1', '검증대학교', '검증학과', '검증고등학교');

insert into public.subscriptions (id, student_id, mentor_id, plan_tier, status, current_period_start, current_period_end, next_billing_at)
values
  ('00000000-0000-4000-8000-0000000157d1', '00000000-0000-4000-8000-0000000157a1', '00000000-0000-4000-8000-0000000157b1', 'standard', 'active', now() - interval '20 days', now() + interval '10 days', now() + interval '10 days'),
  ('00000000-0000-4000-8000-0000000157d2', '00000000-0000-4000-8000-0000000157a2', '00000000-0000-4000-8000-0000000157b1', 'limited', 'active', now() - interval '20 days', now() + interval '10 days', now() + interval '10 days');

create temp table fx_expect (label text, got bigint, want bigint) on commit drop;

-- assert 헬퍼: 수신자·type 별 알림/outbox 카운트.
create or replace function pg_temp.fx_n(p_recipient uuid, p_type text) returns bigint language sql as
$$ select count(*) from public.notifications where recipient_user_id = p_recipient and type = p_type $$;
create or replace function pg_temp.fx_o(p_recipient uuid, p_type text) returns bigint language sql as
$$ select count(*) from public.notification_outbox o where o.recipient_user_id = p_recipient and o.dedup_key like p_type || ':%' $$;

-- ══ A. 157 구독 4종 ══════════════════════════════════════════════════════════

-- A1) 예고 마커 INSERT → 학생1 upcoming 1건(알림+outbox), 본문에 금액 캐시 표기.
insert into public.subscription_billing_events
  (subscription_id, student_id, mentor_id, event_type, status, period_start, period_end, billing_at,
   amount_cents, plan_tier, idempotency_key, failure_code, failure_message, attempt_count)
values
  ('00000000-0000-4000-8000-0000000157d1', '00000000-0000-4000-8000-0000000157a1', '00000000-0000-4000-8000-0000000157b1',
   'renewal', 'skipped', now() - interval '20 days', now() + interval '10 days', now() + interval '10 days',
   8490000, 'standard', 'fx157:notice:d1', 'pre_renewal_notice_sent', 'pre-renewal notice marker', 0);
insert into fx_expect values
  ('A1 upcoming notif', pg_temp.fx_n('00000000-0000-4000-8000-0000000157a1', 'subscription_renewal_upcoming'), 1),
  ('A1 upcoming outbox', pg_temp.fx_o('00000000-0000-4000-8000-0000000157a1', 'subscription_renewal_upcoming'), 1),
  ('A1 body cash', (select count(*) from public.notifications
     where recipient_user_id = '00000000-0000-4000-8000-0000000157a1'
       and type = 'subscription_renewal_upcoming' and body like '%84,900캐시%'), 1);

-- A2) 원자성: 마커 INSERT 를 savepoint 롤백 → 알림도 함께 사라진다.
savepoint a2;
insert into public.subscription_billing_events
  (subscription_id, student_id, mentor_id, event_type, status, period_end, billing_at,
   amount_cents, plan_tier, idempotency_key, failure_code, failure_message, attempt_count)
values
  ('00000000-0000-4000-8000-0000000157d2', '00000000-0000-4000-8000-0000000157a2', '00000000-0000-4000-8000-0000000157b1',
   'renewal', 'skipped', now() + interval '10 days', now() + interval '10 days',
   2990000, 'limited', 'fx157:notice:d2', 'pre_renewal_notice_sent', 'pre-renewal notice marker', 0);
rollback to savepoint a2;
insert into fx_expect values
  ('A2 rollback atomic', pg_temp.fx_n('00000000-0000-4000-8000-0000000157a2', 'subscription_renewal_upcoming'), 0);

-- A3) 갱신 성공: processing INSERT(무발화) → succeeded UPDATE(1건) → 동일 UPDATE 재실행(중복 0).
insert into public.subscription_billing_events
  (id, subscription_id, student_id, mentor_id, event_type, status, period_start, period_end, billing_at,
   amount_cents, plan_tier, idempotency_key, attempt_count)
values
  ('00000000-0000-4000-8000-0000000157e1', '00000000-0000-4000-8000-0000000157d1',
   '00000000-0000-4000-8000-0000000157a1', '00000000-0000-4000-8000-0000000157b1',
   'renewal', 'processing', now() + interval '10 days', now() + interval '40 days', now() + interval '10 days',
   8490000, 'standard', 'fx157:renew:d1', 1);
insert into fx_expect values
  ('A3 processing silent', pg_temp.fx_n('00000000-0000-4000-8000-0000000157a1', 'subscription_renewal_succeeded'), 0);
update public.subscription_billing_events set status = 'succeeded', processed_at = now()
 where id = '00000000-0000-4000-8000-0000000157e1';
update public.subscription_billing_events set processed_at = now()  -- 상태 불변 UPDATE → WHEN 미충족
 where id = '00000000-0000-4000-8000-0000000157e1';
insert into fx_expect values
  ('A3 succeeded notif', pg_temp.fx_n('00000000-0000-4000-8000-0000000157a1', 'subscription_renewal_succeeded'), 1);

-- A4) 갱신 실패(캐시 부족): 재시도(failed→processing→failed)에도 주기당 1건.
insert into public.subscription_billing_events
  (id, subscription_id, student_id, mentor_id, event_type, status, period_start, period_end, billing_at,
   amount_cents, plan_tier, idempotency_key, attempt_count)
values
  ('00000000-0000-4000-8000-0000000157e2', '00000000-0000-4000-8000-0000000157d2',
   '00000000-0000-4000-8000-0000000157a2', '00000000-0000-4000-8000-0000000157b1',
   'renewal', 'processing', now() - interval '20 days', now() + interval '10 days', now(),
   2990000, 'limited', 'fx157:renew:d2', 1);
update public.subscription_billing_events
   set event_type = 'renewal_failed', status = 'failed', failure_code = 'insufficient_cash',
       failure_message = 'CASH_INSUFFICIENT', processed_at = now()
 where id = '00000000-0000-4000-8000-0000000157e2';
update public.subscription_billing_events  -- 재시도 사이클
   set event_type = 'renewal', status = 'processing', attempt_count = 2
 where id = '00000000-0000-4000-8000-0000000157e2';
update public.subscription_billing_events
   set event_type = 'renewal_failed', status = 'failed', failure_code = 'insufficient_cash',
       failure_message = 'CASH_INSUFFICIENT', processed_at = now()
 where id = '00000000-0000-4000-8000-0000000157e2';
insert into fx_expect values
  ('A4 failed once per period', pg_temp.fx_n('00000000-0000-4000-8000-0000000157a2', 'subscription_renewal_failed_insufficient_cash'), 1);

-- A5) 만료 전이 → 학생2 expired 1건. 터미널 billing event(expired/succeeded) INSERT 자체는 무발화.
insert into public.subscription_billing_events
  (subscription_id, student_id, mentor_id, event_type, status, period_end, billing_at, idempotency_key)
values
  ('00000000-0000-4000-8000-0000000157d2', '00000000-0000-4000-8000-0000000157a2', '00000000-0000-4000-8000-0000000157b1',
   'expired', 'succeeded', now(), now(), 'fx157:expired:d2');
insert into fx_expect values
  ('A5 terminal event silent', pg_temp.fx_n('00000000-0000-4000-8000-0000000157a2', 'subscription_expired'), 0);
update public.subscriptions set status = 'expired', expired_at = now()
 where id = '00000000-0000-4000-8000-0000000157d2';
insert into fx_expect values
  ('A5 expired notif', pg_temp.fx_n('00000000-0000-4000-8000-0000000157a2', 'subscription_expired'), 1);

-- ══ B. 158 멘토 4종 ══════════════════════════════════════════════════════════

-- B1) terminating 전이 → 활성 구독 학생 fan-out. (d2 는 expired → 대상은 d1 학생1 만)
update public.mentor_profiles
   set activity_status = 'terminating', termination_requested_at = now(),
       termination_effective_at = now() + interval '14 days'
 where user_id = '00000000-0000-4000-8000-0000000157b1';
insert into fx_expect values
  ('B1 termination fan-out', pg_temp.fx_n('00000000-0000-4000-8000-0000000157a1', 'mentor_termination_notice'), 1),
  ('B1 not to expired sub', pg_temp.fx_n('00000000-0000-4000-8000-0000000157a2', 'mentor_termination_notice'), 0);

-- B2) paused 전이 → 활성 구독 학생 fan-out.
update public.mentor_profiles set activity_status = 'active' where user_id = '00000000-0000-4000-8000-0000000157b1';
update public.mentor_profiles
   set activity_status = 'paused', pause_started_at = now(), pause_until = now() + interval '7 days'
 where user_id = '00000000-0000-4000-8000-0000000157b1';
insert into fx_expect values
  ('B2 pause fan-out', pg_temp.fx_n('00000000-0000-4000-8000-0000000157a1', 'mentor_pause_notice'), 1);

-- B3) 멘토 종료 잔여 환불 INSERT → 학생 1건, 금액 캐시 표기(cents÷100 = 5,000캐시).
insert into public.refunds (id, user_id, amount_cents, status, subscription_id, request_type, reason)
values ('00000000-0000-4000-8000-0000000157f1', '00000000-0000-4000-8000-0000000157a1', 500000, 'pending',
        '00000000-0000-4000-8000-0000000157d1', 'subscription_mentor_suspended', 'fixture');
insert into fx_expect values
  ('B3 refund notif', pg_temp.fx_n('00000000-0000-4000-8000-0000000157a1', 'mentor_termination_refund'), 1),
  ('B3 refund cash body', (select count(*) from public.notifications
     where recipient_user_id = '00000000-0000-4000-8000-0000000157a1'
       and type = 'mentor_termination_refund' and body like '%5,000캐시%'), 1),
  ('B3 other request_type silent', (select count(*) from public.notifications
     where type = 'mentor_termination_refund'
       and recipient_user_id = '00000000-0000-4000-8000-0000000157a2'), 0);

-- B4) 가격 변경 fan-out: 활성 구독(d1) 존재 시 plan INSERT → 학생당 1건. 이후 2-tier UPDATE 는
--     같은 트랜잭션(같은 txid)이라 event_key dedup 으로 추가 0. is_active 토글도 무발화.
--     ※ "다른 제출(다른 tx) 재알림"은 단일 tx fixture 로 검증 불가 — 2트랜잭션 실측 항목.
insert into public.mentor_plans (id, mentor_id, plan_tier, amount_cents)
values
  ('00000000-0000-4000-8000-0000000157e5', '00000000-0000-4000-8000-0000000157b1', 'limited', 2990000),
  ('00000000-0000-4000-8000-0000000157e6', '00000000-0000-4000-8000-0000000157b1', 'standard', 8490000);
insert into fx_expect values
  ('B4 insert fan-out(active sub)', pg_temp.fx_n('00000000-0000-4000-8000-0000000157a1', 'mentor_subscription_price_changed'), 1);
update public.mentor_plans set amount_cents = amount_cents + 100000
 where mentor_id = '00000000-0000-4000-8000-0000000157b1';
insert into fx_expect values
  ('B4 same-tx dedup', pg_temp.fx_n('00000000-0000-4000-8000-0000000157a1', 'mentor_subscription_price_changed'), 1);
update public.mentor_plans set is_active = false
 where mentor_id = '00000000-0000-4000-8000-0000000157b1';
insert into fx_expect values
  ('B4 is_active silent', pg_temp.fx_n('00000000-0000-4000-8000-0000000157a1', 'mentor_subscription_price_changed'), 1);

-- ══ C. 159 맞춤의뢰 2종 ═════════════════════════════════════════════════════

insert into public.custom_request_posts (id, author_id, title, body, status)
values ('00000000-0000-4000-8000-0000000159a1', '00000000-0000-4000-8000-0000000157a1', '검증 의뢰', '내용', 'open');

-- C1) 지원서 INSERT → 글 작성자 알림.
insert into public.custom_request_applications (id, post_id, mentor_id, message)
values ('00000000-0000-4000-8000-0000000159b1', '00000000-0000-4000-8000-0000000159a1',
        '00000000-0000-4000-8000-0000000157b1', '지원합니다');
insert into fx_expect values
  ('C1 new_application', pg_temp.fx_n('00000000-0000-4000-8000-0000000157a1', 'new_application'), 1),
  ('C1 body name', (select count(*) from public.notifications
     where recipient_user_id = '00000000-0000-4000-8000-0000000157a1'
       and type = 'new_application' and body like '검증멘토님이%'), 1);

-- C2) 자기 글에 자기 지원(작성자=지원자) → 무발화(카운트 1 유지, 행은 최종 rollback 으로 제거).
insert into public.custom_request_applications (post_id, mentor_id, message)
values ('00000000-0000-4000-8000-0000000159a1', '00000000-0000-4000-8000-0000000157a1', '셀프');
insert into fx_expect values
  ('C2 self silent', pg_temp.fx_n('00000000-0000-4000-8000-0000000157a1', 'new_application'), 1);

-- C3) 주문 메시지 → 상대방 알림(학생→멘토, 멘토→학생), 제3자 작성 무발화.
insert into public.custom_request_orders (id, post_id, application_id, student_id, mentor_id, status)
values ('00000000-0000-4000-8000-0000000159c1', '00000000-0000-4000-8000-0000000159a1',
        '00000000-0000-4000-8000-0000000159b1', '00000000-0000-4000-8000-0000000157a1',
        '00000000-0000-4000-8000-0000000157b1', 'in_progress');
insert into public.custom_order_messages (custom_request_order_id, author_id, body)
values ('00000000-0000-4000-8000-0000000159c1', '00000000-0000-4000-8000-0000000157a1', '학생 메시지');
insert into public.custom_order_messages (custom_request_order_id, author_id, body)
values ('00000000-0000-4000-8000-0000000159c1', '00000000-0000-4000-8000-0000000157b1', '멘토 메시지');
insert into public.custom_order_messages (custom_request_order_id, author_id, body)
values ('00000000-0000-4000-8000-0000000159c1', '00000000-0000-4000-8000-0000000157c1', '관리자 메시지');
insert into fx_expect values
  ('C3 student→mentor', pg_temp.fx_n('00000000-0000-4000-8000-0000000157b1', 'new_order_message'), 1),
  ('C3 mentor→student', pg_temp.fx_n('00000000-0000-4000-8000-0000000157a1', 'new_order_message'), 1),
  ('C3 third-party silent', pg_temp.fx_n('00000000-0000-4000-8000-0000000157c1', 'new_order_message'), 0);

-- ── 판정 ─────────────────────────────────────────────────────────────────────
select label, got, want, case when got = want then 'PASS' else 'FAIL' end as verdict from fx_expect order by label;
do $$
declare v_fail int;
begin
  select count(*) into v_fail from fx_expect where got is distinct from want;
  if v_fail > 0 then
    raise exception 'FIXTURE FAIL: % assertion(s) mismatched — 위 SELECT 결과 확인', v_fail;
  end if;
  raise notice 'FIXTURE PASS: all assertions matched';
end $$;

rollback;
