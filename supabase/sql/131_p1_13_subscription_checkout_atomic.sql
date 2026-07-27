-- 131_p1_13_subscription_checkout_atomic.sql
-- P1-13: 구독·결제 원자 상태기계 (예약 번호 131 = P1-13 전용).
--
-- 모델: 즉시 내부지갑 적립(실은행 송금 아님). 정본 테이블 public.payments / public.subscriptions.
-- 기존 웹 체크아웃(finalizeSubscriptionCheckout)의 3단계 비원자 시퀀스
--   insertSubscriptionRow(직접 INSERT) → record_subscription_cash_debit → markPaymentSucceeded
-- 를 단일 트랜잭션 RPC 로 대체한다. 실패 시 부분 반영·수동 보상 경로 제거.
--
-- 안전: staging 0행(금융 계보 충돌 없음). rollback-only fixture 만. 실지갑·실결제·실원장 무변경.
--       기존 019/023 record_subscription_cash_debit(멱등 primitive) 재사용. 028/029 direct-write 잠금 유지.
-- 동시성: 독립 2세션 실측 부재 → CONCURRENCY_VALIDATION_DEBT.
-- 선행: 019/023(cash debit), 064(billing period), 067(mentor_plans), 121(plan band).

begin;
set local lock_timeout='5s';

-- ── 1) 스키마: payments.plan_id + camelCase metadata.planId 백필 ──
alter table public.payments add column if not exists plan_id uuid;
update public.payments
  set plan_id = (metadata->>'planId')::uuid
  where plan_id is null
    and coalesce(metadata->>'planId','') ~ '^[0-9a-fA-F-]{36}$';

-- ── 2) 스키마: mentor_profiles.is_open_for_subscriptions 정본(기본 open) ──
alter table public.mentor_profiles
  add column if not exists is_open_for_subscriptions boolean not null default true;

-- ── 3) 원자 상태기계 RPC (service_role 전용) ──
create or replace function public.confirm_subscription_checkout(
  p_payment_id uuid,
  p_plan_id uuid,
  p_idempotency_key text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_student uuid; v_mentor uuid; v_pay_status text; v_created_at timestamptz;
  v_plan_mentor uuid; v_plan_tier text; v_plan_active boolean; v_amount_cents int;
  v_is_open boolean; v_sub_id uuid; v_existing_delta bigint; v_reactivated boolean := false;
  v_succeeded_aliases text[] := array['succeeded','paid','success','complete','captured'];
begin
  -- 결제 행 잠금 + 로드.
  select user_id, mentor_id, status, created_at
    into v_student, v_mentor, v_pay_status, v_created_at
  from public.payments where id = p_payment_id for update;
  if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;
  if v_student is null then raise exception 'PAYMENT_NO_USER'; end if;

  -- 이미 성공(별칭 포함) → 멱등 반환.
  if v_pay_status = any(v_succeeded_aliases) then
    select id into v_sub_id from public.subscriptions where student_id=v_student and mentor_id=v_mentor;
    return jsonb_build_object('ok', true, 'idempotent', true, 'subscription_id', v_sub_id, 'payment_status', 'succeeded');
  end if;
  -- processing 은 성공 아님. 그 외 종료 상태 거부.
  if v_pay_status = 'processing' then raise exception 'PAYMENT_PROCESSING'; end if;
  if v_pay_status in ('failed','canceled','refunded') then raise exception 'PAYMENT_NOT_PENDING'; end if;
  if v_pay_status <> 'pending' then raise exception 'PAYMENT_STATE_UNEXPECTED'; end if;
  -- pending 확정 TTL 30분(서버 시각 강제).
  if v_created_at is null or now() > v_created_at + interval '30 minutes' then
    raise exception 'PAYMENT_STALE';
  end if;

  -- 멘토·플랜 잠금 + 자격/금액 정본.
  perform 1 from public.mentor_profiles where user_id = v_mentor for update;
  select is_open_for_subscriptions into v_is_open from public.mentor_profiles where user_id = v_mentor;
  if not coalesce(v_is_open, true) then raise exception 'MENTOR_NOT_OPEN_FOR_SUBSCRIPTIONS'; end if;

  select mentor_id, plan_tier, is_active, amount_cents
    into v_plan_mentor, v_plan_tier, v_plan_active, v_amount_cents
  from public.mentor_plans where id = p_plan_id for update;
  if not found then raise exception 'PLAN_NOT_FOUND'; end if;
  if v_plan_mentor <> v_mentor then raise exception 'PLAN_MENTOR_MISMATCH'; end if;
  if not coalesce(v_plan_active, true) then raise exception 'PLAN_INACTIVE'; end if;
  if v_amount_cents is null or v_amount_cents <= 0 then raise exception 'PLAN_AMOUNT_INVALID'; end if;

  -- 원장 멱등 사전 검사: 동일 payment 의 기존 debit 행이 있으면 금액(전 필드) 일치만 허용.
  select delta_cents into v_existing_delta from public.cash_ledger
    where idempotency_key = 'sub_debit_' || p_payment_id::text;
  if v_existing_delta is not null and v_existing_delta <> -v_amount_cents then
    -- 불일치 격리: 구조화 실패(롤백되나 호출자가 대사 기록). 자동 삭제·대사 금지.
    raise exception 'LEDGER_AMOUNT_MISMATCH existing=% expected=%', v_existing_delta, -v_amount_cents;
  end if;

  -- 구독 생성/재활성화(uq_subscriptions_pair 로 pair 잠금·mutex).
  insert into public.subscriptions (
    student_id, mentor_id, plan_id, plan_tier, status, payment_id,
    started_at, current_period_start, current_period_end, next_billing_at, billing_cycle,
    cancel_at_period_end, last_payment_id
  ) values (
    v_student, v_mentor, p_plan_id, v_plan_tier, 'active', p_payment_id,
    now(), now(), now() + interval '1 month', now() + interval '1 month', 'monthly',
    false, p_payment_id
  )
  on conflict (student_id, mentor_id) do update set
    plan_id = excluded.plan_id, plan_tier = excluded.plan_tier, status = 'active',
    payment_id = excluded.payment_id, last_payment_id = excluded.last_payment_id,
    started_at = coalesce(public.subscriptions.started_at, now()),
    current_period_start = now(), current_period_end = now() + interval '1 month',
    next_billing_at = now() + interval '1 month', cancel_at_period_end = false,
    cancel_requested_at = null, canceled_at = null, expired_at = null, grace_until = null,
    last_renewed_at = now(), updated_at = now()
  returning id into v_sub_id;
  v_reactivated := (v_existing_delta is not null);

  -- 지갑 차감(019/023 멱등 primitive; 잔액 부족 시 CASH_INSUFFICIENT).
  perform public.record_subscription_cash_debit(v_student, v_sub_id, p_payment_id, v_amount_cents::bigint);

  -- payment succeeded 정본화 + plan_id/metadata 백필.
  update public.payments
    set status = 'succeeded', plan_id = p_plan_id,
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('planId', p_plan_id::text, 'subscription_id', v_sub_id::text),
        updated_at = now()
  where id = p_payment_id;

  return jsonb_build_object(
    'ok', true, 'subscription_id', v_sub_id, 'payment_status', 'succeeded',
    'amount_cents', v_amount_cents, 'reactivated', v_reactivated
  );
end;
$$;

revoke all on function public.confirm_subscription_checkout(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.confirm_subscription_checkout(uuid,uuid,text) to service_role;

commit;

-- §V (rollback-only): pending→active+debit+succeeded · 재호출 멱등 · processing 거부 · TTL stale 거부 ·
--   is_open=false 거부 · 잔액부족 CASH_INSUFFICIENT · 금액은 mentor_plans 정본 · plan_id/metadata 백필 ·
--   재활성화(취소 후) 기간 초기화 · 원장 금액 불일치 LEDGER_AMOUNT_MISMATCH.
-- service_role 전용(authenticated/anon 실행 불가). 동시성 2세션 = CONCURRENCY_VALIDATION_DEBT.
