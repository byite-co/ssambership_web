-- 157_p1_11_subscription_notification_atomization.sql
-- [적용됨 — ssambership-staging 에 2026-07-20 단일 execute_sql(전문 그대로) 적용. staging fixture 24 assertion
--   전부 PASS(rollback-only)·baseline 복원 확인. ACL 후속 보정: 160(표시 헬퍼 anon/authenticated revoke).
--   원장 미기재 — 적용 이력: docs/audit/sql_apply_manifest.md]
-- P1-11 알림 원자화 — 구독 4 이벤트. domain write 와 같은 트랜잭션에서
-- record_domain_notification 를 AFTER 트리거로 호출 → 원자·멱등. 웹 best-effort 알림은 코드에서 제거.
--
-- 원자성: 트리거는 domain INSERT/UPDATE 트랜잭션 안에서 실행 → domain write 롤백 시 알림도 롤백,
--   record_domain_notification 오류 시 domain write 도 롤백(예외 미포획 — 원자 계약).
-- 멱등: (recipient,event_key) UNIQUE(132) → 재실행·재시도 중복 0.
--   event_key = {event}:{subscription_id}:{period_end date | expired date} — 주기(회차)별 1건.
-- 커버 이벤트:
--   subscription_renewal_upcoming   billing_events INSERT(renewal/skipped/pre_renewal_notice_sent 마커)
--   subscription_renewal_succeeded  billing_events INSERT/UPDATE(renewal/succeeded 전이 — 068 RPC)
--   subscription_renewal_failed_insufficient_cash
--                                   billing_events INSERT/UPDATE(renewal_failed/failed/insufficient_cash — 068 RPC.
--                                   재시도 failed→processing→failed 반복은 event_key 로 주기당 1건)
--   subscription_expired            subscriptions UPDATE(status → 'expired' 전이 — 만료·해지예약 경로 공통)
-- 선행: 132(record_domain_notification)·064(subscription_billing_events)·068/100(renewal RPC).

begin;
set local lock_timeout='5s';

-- 0) 표시 이름 헬퍼 — 웹 fetchUserDisplayName(full_name → nickname → '멘토')과 동일 우선순위.
create or replace function public.notification_display_name(p_user_id uuid)
returns text language sql stable security definer set search_path to 'public' as $$
  select coalesce((
    select coalesce(
      nullif(trim(coalesce(u.full_name, '')), ''),
      nullif(trim(coalesce(u.nickname, '')), ''))
    from public.users u where u.id = p_user_id
  ), '멘토');
$$;
revoke all on function public.notification_display_name(uuid) from public;

-- '멘토' 접미(noticeMentorLabel)까지 붙인 구독 안내용 라벨.
create or replace function public.notification_mentor_label(p_user_id uuid)
returns text language sql stable security definer set search_path to 'public' as $$
  select case when n like '%멘토' then n else n || ' 멘토' end
  from (select public.notification_display_name(p_user_id) as n) s;
$$;
revoke all on function public.notification_mentor_label(uuid) from public;

-- 캐시 표기 헬퍼 — 웹 formatCashFromCents(cents ÷ 100, 천단위 콤마, '캐시')와 동일.
create or replace function public.notification_cash_label(p_amount_cents bigint)
returns text language sql immutable as $$
  select to_char(greatest(0, round(coalesce(p_amount_cents, 0) / 100.0)), 'FM999,999,999,999') || '캐시';
$$;
revoke all on function public.notification_cash_label(bigint) from public;

-- 한국어 날짜 헬퍼 — 웹 formatNoticeDate(Asia/Seoul, 'YYYY년 M월 D일')와 동일. null 이면 '예정일'.
create or replace function public.notification_date_label(p_at timestamptz)
returns text language sql immutable as $$
  select case when p_at is null then '예정일'
    else to_char(p_at at time zone 'Asia/Seoul', 'YYYY"년" FMMM"월" FMDD"일"') end;
$$;
revoke all on function public.notification_date_label(timestamptz) from public;

-- 1) subscription_billing_events → 갱신 예고·성공·실패(캐시 부족) 알림.
create or replace function public.sbe_notify_billing_event()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_mentor_label text;
  v_period_key text;
  v_grace timestamptz;
begin
  -- 예고 마커: 배치가 INSERT 하는 renewal/skipped/pre_renewal_notice_sent 행(멱등키 sub_renewal_notice:*).
  if TG_OP = 'INSERT'
     and NEW.event_type = 'renewal' and NEW.status = 'skipped'
     and NEW.failure_code = 'pre_renewal_notice_sent' then
    v_mentor_label := public.notification_mentor_label(NEW.mentor_id);
    v_period_key := to_char(coalesce(NEW.period_end, NEW.billing_at, NEW.created_at, now()), 'YYYY-MM-DD');
    perform public.record_domain_notification(
      NEW.student_id,
      'subscription_renewal_upcoming:' || NEW.subscription_id::text || ':' || v_period_key,
      'subscription_renewal_upcoming:' || NEW.subscription_id::text || ':' || v_period_key,
      'subscription_renewal_upcoming',
      '구독이 곧 갱신돼요',
      v_mentor_label || ' 구독이 곧 갱신돼요. ' || public.notification_date_label(NEW.billing_at)
        || '에 ' || public.notification_cash_label(NEW.amount_cents) || '가 결제됩니다. 잔액을 확인해 주세요.',
      '/wallet/charge',
      jsonb_build_object('subscription_id', NEW.subscription_id, 'billing_event_id', NEW.id,
        'next_billing_at', NEW.billing_at, 'amount_cents', NEW.amount_cents),
      jsonb_build_object('subscription_id', NEW.subscription_id));
    return NEW;
  end if;

  -- 갱신 성공: 068 RPC 가 processing → renewal/succeeded 로 UPDATE(INSERT 직행도 커버).
  if NEW.event_type = 'renewal' and NEW.status = 'succeeded'
     and (TG_OP = 'INSERT' or OLD.status is distinct from NEW.status) then
    v_mentor_label := public.notification_mentor_label(NEW.mentor_id);
    v_period_key := to_char(coalesce(NEW.period_end, NEW.billing_at, NEW.created_at, now()), 'YYYY-MM-DD');
    perform public.record_domain_notification(
      NEW.student_id,
      'subscription_renewal_succeeded:' || NEW.subscription_id::text || ':' || v_period_key,
      'subscription_renewal_succeeded:' || NEW.subscription_id::text || ':' || v_period_key,
      'subscription_renewal_succeeded',
      '구독이 갱신되었어요',
      v_mentor_label || ' 구독이 갱신되었어요. ' || public.notification_cash_label(NEW.amount_cents)
        || ' 결제가 완료됐고, 다음 결제일은 ' || public.notification_date_label(NEW.period_end) || '입니다.',
      '/subscriptions',
      jsonb_build_object('subscription_id', NEW.subscription_id, 'billing_event_id', NEW.id,
        'ledger_id', NEW.ledger_id, 'next_period_end', NEW.period_end),
      jsonb_build_object('subscription_id', NEW.subscription_id));
    return NEW;
  end if;

  -- 갱신 실패(캐시 부족): 068 RPC 가 processing → renewal_failed/failed 로 UPDATE.
  -- 재시도 주기(failed→processing→failed)마다 발화해도 event_key 로 주기당 1건(웹의 attempt<=1 정책과 동일 효과).
  if NEW.event_type = 'renewal_failed' and NEW.status = 'failed'
     and NEW.failure_code = 'insufficient_cash'
     and (TG_OP = 'INSERT'
          or OLD.status is distinct from NEW.status
          or OLD.event_type is distinct from NEW.event_type) then
    v_mentor_label := public.notification_mentor_label(NEW.mentor_id);
    v_period_key := to_char(coalesce(NEW.period_end, NEW.billing_at, NEW.created_at, now()), 'YYYY-MM-DD');
    -- 068 은 billing event UPDATE 뒤 subscriptions.grace_until 을 세팅 → 첫 실패 시점엔 아직 null.
    -- RPC 와 동일 공식(coalesce(grace_until, processed_at + 2일))로 유예일을 계산한다.
    select s.grace_until into v_grace from public.subscriptions s where s.id = NEW.subscription_id;
    v_grace := coalesce(v_grace, coalesce(NEW.processed_at, now()) + interval '2 days');
    perform public.record_domain_notification(
      NEW.student_id,
      'subscription_renewal_failed_insufficient_cash:' || NEW.subscription_id::text || ':' || v_period_key,
      'subscription_renewal_failed_insufficient_cash:' || NEW.subscription_id::text || ':' || v_period_key,
      'subscription_renewal_failed_insufficient_cash',
      '구독 갱신에 실패했어요',
      v_mentor_label || ' 구독 갱신에 실패했어요(캐시 부족). ' || public.notification_date_label(v_grace)
        || '까지 충전하면 구독이 유지됩니다.',
      '/wallet/charge',
      jsonb_build_object('subscription_id', NEW.subscription_id, 'billing_event_id', NEW.id,
        'attempt_count', NEW.attempt_count),
      jsonb_build_object('subscription_id', NEW.subscription_id));
    return NEW;
  end if;

  return NEW;
end $$;

drop trigger if exists trg_sbe_notify_insert on public.subscription_billing_events;
create trigger trg_sbe_notify_insert
  after insert on public.subscription_billing_events
  for each row execute function public.sbe_notify_billing_event();

drop trigger if exists trg_sbe_notify_update on public.subscription_billing_events;
create trigger trg_sbe_notify_update
  after update on public.subscription_billing_events
  for each row when (old.status is distinct from new.status or old.event_type is distinct from new.event_type)
  execute function public.sbe_notify_billing_event();

-- 2) subscriptions → 만료 알림(만료·해지예약 소진 경로 공통. 멘토 종료의 'canceled' 전이는 대상 아님).
create or replace function public.sub_notify_expired()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_mentor_label text;
  v_key text;
begin
  v_mentor_label := public.notification_mentor_label(NEW.mentor_id);
  -- 재구독(pair 1행 모델 재활성) 후 재만료를 구분하기 위해 만료일을 키에 포함.
  v_key := 'subscription_expired:' || NEW.id::text || ':'
    || to_char(coalesce(NEW.expired_at, NEW.current_period_end, now()), 'YYYY-MM-DD');
  perform public.record_domain_notification(
    NEW.student_id, v_key, v_key, 'subscription_expired',
    '구독이 만료되었어요',
    v_mentor_label || ' 구독이 만료되었어요. 다시 구독하려면 멘토 페이지에서 재구독할 수 있어요.',
    '/subscriptions',
    jsonb_build_object('subscription_id', NEW.id, 'mentor_id', NEW.mentor_id,
      'reason', case when NEW.cancel_at_period_end then 'cancel_at_period_end' else 'expired' end),
    jsonb_build_object('subscription_id', NEW.id));
  return NEW;
end $$;

drop trigger if exists trg_sub_notify_expired on public.subscriptions;
create trigger trg_sub_notify_expired
  after update on public.subscriptions
  for each row when (old.status is distinct from new.status and new.status = 'expired')
  execute function public.sub_notify_expired();

commit;

-- §V(rollback-only): 예고 마커 INSERT 시 학생 1건 · renewal succeeded 전이 시 1건(재실행 중복 0) ·
--   insufficient_cash 실패 전이 시 1건(재시도 반복에도 주기당 1건) · status→expired 전이 시 1건 ·
--   initial/expired/canceled billing event 는 무발화 · domain write 롤백 시 알림 0.
