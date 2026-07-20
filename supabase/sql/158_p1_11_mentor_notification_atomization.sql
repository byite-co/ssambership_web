-- 158_p1_11_mentor_notification_atomization.sql
-- P1-11 알림 원자화 — 멘토 4 이벤트. domain write 와 같은 트랜잭션에서
-- record_domain_notification 를 AFTER 트리거로 호출 → 원자·멱등. 웹 best-effort 알림은 코드에서 제거.
--
-- 원자성: 트리거는 domain UPDATE/INSERT 트랜잭션 안에서 실행 → domain write 롤백 시 알림도 롤백,
--   record_domain_notification 오류 시 domain write 도 롤백(예외 미포획 — 원자 계약).
-- 멱등: (recipient,event_key) UNIQUE(132) → 재실행·중복 0.
-- 커버 이벤트:
--   mentor_termination_notice   mentor_profiles UPDATE(activity_status → 'terminating') — 활성 구독 학생 fan-out
--   mentor_pause_notice         mentor_profiles UPDATE(activity_status → 'paused') — 활성 구독 학생 fan-out
--   mentor_termination_refund   refunds INSERT(request_type='subscription_mentor_suspended')
--   mentor_subscription_price_changed
--                               mentor_plans INSERT/UPDATE(amount_cents 변경) — 활성 구독 학생 fan-out.
--                               event_key 에 txid 포함 → 동일 트랜잭션 다중 tier upsert 는 학생당 1건.
-- 선행: 157(notification_mentor_label/notification_cash_label 헬퍼)·132(record_domain_notification)·
--   103(mentor_profiles activity 컬럼)·069(refunds subscription_id/request_type)·067(mentor_plans).

begin;
set local lock_timeout='5s';

-- 1) mentor_profiles activity_status 전이 → 구독 학생 fan-out(terminating/paused).
create or replace function public.mp_notify_activity_transition()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_sub record;
  v_key text;
  v_date_key text;
begin
  if NEW.activity_status = 'terminating' then
    v_date_key := to_char(coalesce(NEW.termination_effective_at, now()) at time zone 'UTC', 'YYYY-MM-DD');
    for v_sub in
      select s.id, s.student_id from public.subscriptions s
      where s.mentor_id = NEW.user_id and s.status in ('active', 'past_due')
    loop
      v_key := 'mentor_termination_notice:' || v_sub.id::text || ':' || v_date_key;
      perform public.record_domain_notification(
        v_sub.student_id, v_key, v_key, 'mentor_termination_notice',
        '멘토 활동 종료 예정',
        '구독 중인 멘토가 활동을 종료합니다. 2주 후(' || v_date_key
          || ') 구독이 정리되며 남은 기간은 환불됩니다. 그때까지는 정상 이용할 수 있어요.',
        '/subscriptions',
        jsonb_build_object('mentor_id', NEW.user_id, 'effective_at', NEW.termination_effective_at,
          'subscription_id', v_sub.id),
        jsonb_build_object('mentor_id', NEW.user_id, 'subscription_id', v_sub.id));
    end loop;
  elsif NEW.activity_status = 'paused' then
    v_date_key := to_char(coalesce(NEW.pause_until, now()) at time zone 'UTC', 'YYYY-MM-DD');
    for v_sub in
      select s.id, s.student_id from public.subscriptions s
      where s.mentor_id = NEW.user_id and s.status in ('active', 'past_due')
    loop
      v_key := 'mentor_pause_notice:' || v_sub.id::text || ':' || v_date_key;
      perform public.record_domain_notification(
        v_sub.student_id, v_key, v_key, 'mentor_pause_notice',
        '멘토 일시 휴식 안내',
        '구독 중인 멘토가 ' || v_date_key || '까지 일시 휴식합니다. 쉰 기간만큼 구독 기간이 자동 연장됩니다.',
        '/subscriptions',
        jsonb_build_object('mentor_id', NEW.user_id, 'pause_until', NEW.pause_until,
          'subscription_id', v_sub.id),
        jsonb_build_object('mentor_id', NEW.user_id, 'subscription_id', v_sub.id));
    end loop;
  end if;
  return NEW;
end $$;

drop trigger if exists trg_mp_notify_activity on public.mentor_profiles;
create trigger trg_mp_notify_activity
  after update on public.mentor_profiles
  for each row when (old.activity_status is distinct from new.activity_status
                     and new.activity_status in ('terminating', 'paused'))
  execute function public.mp_notify_activity_transition();

-- 2) refunds INSERT(멘토 종료 잔여 환불) → 학생 알림.
--    금액 표기는 notification_cash_label(cents ÷ 100) — 구 웹 본문이 cents 를 캐시로 그대로 찍던 표기 오류를 바로잡음.
create or replace function public.refund_notify_mentor_termination()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_mentor uuid;
begin
  select s.mentor_id into v_mentor from public.subscriptions s where s.id = NEW.subscription_id;
  perform public.record_domain_notification(
    NEW.user_id,
    'mentor_termination_refund:' || NEW.id::text,
    'mentor_termination_refund:' || NEW.id::text,
    'mentor_termination_refund',
    '멘토 활동 종료 — 환불 접수',
    '멘토 활동 종료로 남은 기간 환불(' || public.notification_cash_label(NEW.amount_cents)
      || ')이 접수되었습니다. 관리자 검토 후 처리됩니다.',
    '/support/refunds',
    jsonb_build_object('refund_id', NEW.id, 'subscription_id', NEW.subscription_id, 'mentor_id', v_mentor),
    jsonb_build_object('refund_id', NEW.id, 'subscription_id', NEW.subscription_id));
  return NEW;
end $$;

drop trigger if exists trg_refund_notify_mentor_termination on public.refunds;
create trigger trg_refund_notify_mentor_termination
  after insert on public.refunds
  for each row when (new.request_type = 'subscription_mentor_suspended')
  execute function public.refund_notify_mentor_termination();

-- 3) mentor_plans 가격 변경 → 활성 구독 학생 fan-out.
--    is_active 토글(활동 중단/복귀)은 amount_cents 불변 → 무발화. 동일 제출(단일 트랜잭션) 다중 tier 는
--    event_key 의 txid 로 학생당 1건. 다른 제출(다른 트랜잭션)은 새 알림.
create or replace function public.mplan_notify_price_changed()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_sub record;
  v_key text;
begin
  for v_sub in
    select s.id, s.student_id from public.subscriptions s
    where s.mentor_id = NEW.mentor_id and s.status in ('active', 'cancel_scheduled', 'past_due')
  loop
    v_key := 'mentor_subscription_price_changed:' || NEW.mentor_id::text || ':' || v_sub.id::text
      || ':' || txid_current()::text;
    perform public.record_domain_notification(
      v_sub.student_id, v_key, v_key, 'mentor_subscription_price_changed',
      '멘토 구독 요금이 변경됐어요',
      '구독 중인 멘토의 요금제가 변경됐어요. 현재 구독에는 바로 적용되지 않고 신규 구독 또는 다음 갱신부터 반영됩니다.',
      '/mentors/' || NEW.mentor_id::text,
      jsonb_build_object('mentor_id', NEW.mentor_id, 'plan_tier', NEW.plan_tier,
        'subscription_id', v_sub.id),
      jsonb_build_object('mentor_id', NEW.mentor_id, 'subscription_id', v_sub.id));
  end loop;
  return NEW;
end $$;

drop trigger if exists trg_mplan_notify_price_insert on public.mentor_plans;
create trigger trg_mplan_notify_price_insert
  after insert on public.mentor_plans
  for each row execute function public.mplan_notify_price_changed();

drop trigger if exists trg_mplan_notify_price_update on public.mentor_plans;
create trigger trg_mplan_notify_price_update
  after update on public.mentor_plans
  for each row when (old.amount_cents is distinct from new.amount_cents)
  execute function public.mplan_notify_price_changed();

commit;

-- §V(rollback-only): terminating 전이 시 활성 구독 학생별 1건 · paused 전이 시 1건 ·
--   suspended 환불 INSERT 시 학생 1건(금액 캐시 표기 = cents÷100) · 가격 UPDATE 시 활성 구독 학생별 1건 ·
--   동일 트랜잭션 3-tier upsert 는 학생당 1건 · is_active 토글 무발화 · domain write 롤백 시 알림 0.
