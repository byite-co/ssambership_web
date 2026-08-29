-- =============================================================================
-- 185_tz_fix_subscription_month_kst.sql  (TZ-FIX R1 — 감사 보고서 버그표 #1)
--
-- Purpose: 구독 결제·갱신의 +1개월 기간 산출을 UTC(세션 달력)에서 KST 달력으로 교정.
--   `timestamptz + interval '1 month'` 는 세션 TZ(UTC) 달력으로 계산되어
--   KST 00~09시 결제 구독의 이용기간이 같은 날 09시 이후 결제보다 최대 3일 짧다
--   (2026-03-01 02:00 KST 결제 = 28일 / 09:00 결제 = 31일).
--
-- Base: 라이브(lbeqxarxothkmzqvpudy) pg_get_functiondef 원문 2026-08-29 추출.
--   confirm_subscription_checkout  def md5 1c378160aec0e4d0a321da340e246b65 (8,468 bytes)
--   process_subscription_renewal   def md5 ff4fb7f274d10a55be66ad3c554eb3d9 (7,293 bytes)
--   (라이브는 저장소 131·143·145·068·100 보다 최신 패치 상태 — 저장소 구본을 베이스로 쓰지 않았다.
--    라이브 본문은 supabase/baseline/interleaves/20260804100002_as_applied_function_bodies.sql
--    의 두 함수 본문과 바이트 단위 일치를 확인했다.)
--
-- Fix (월 산술 식만 치환 — 그 외 라인은 라이브 원문 바이트 그대로):
--   confirm_subscription_checkout  4곳:
--     now()+interval '1 month'
--       -> ((now() at time zone 'Asia/Seoul' + interval '1 month') at time zone 'Asia/Seoul')
--   process_subscription_renewal   2곳:
--     v_period_start + interval '1 month'
--       -> ((v_period_start at time zone 'Asia/Seoul' + interval '1 month') at time zone 'Asia/Seoul')
--   변경 없음: PAYMENT_STALE 30분·grace 2일(순수 상대 간격) · 함수 시그니처 · 반환 스키마 ·
--   멱등 키 · 돈 흐름 로직.
--
-- 동시 배포 제약(감사 §6 R1): 체크아웃·갱신 2본은 반드시 같은 파일·같은 적용 단위.
--   한쪽만 고치면 최초 기간은 KST / 갱신 체이닝은 UTC 로 갈린다.
--
-- Apply: 저장소 표준 경로(db-apply-pending) — MCP apply_migration 직접 적용 금지.
--   TS 폴백(lib/subscribe/subscriptionsTable.ts addMonthsClampedKst)과 같은 배포로 나간다.
--
-- Rollback: 위 Base md5 의 라이브 원문(create or replace) 재적용으로 원복.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.confirm_subscription_checkout(p_payment_id uuid, p_plan_id uuid, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_student uuid; v_mentor uuid; v_pay_status text; v_created_at timestamptz; v_kind text;
  v_plan_mentor uuid; v_plan_tier text; v_plan_active boolean; v_amount_cents int;
  v_is_open boolean; v_sub_id uuid; v_reactivated boolean := false;
  v_status text; v_suspended_until timestamptz;
  v_l_user uuid; v_l_delta bigint; v_l_reason text; v_l_reftype text; v_l_refid uuid;
  v_succeeded_aliases text[] := array['succeeded','paid','success','complete','captured'];
  v_anom uuid; v_err text; v_errcode text;
begin
  select user_id, mentor_id, status, created_at, kind into v_student, v_mentor, v_pay_status, v_created_at, v_kind
    from public.payments where id = p_payment_id for update;
  if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;
  if v_student is null then raise exception 'PAYMENT_NO_USER'; end if;
  if v_mentor is null then raise exception 'PAYMENT_NO_MENTOR'; end if;
  if lower(coalesce(v_kind,'')) in ('cash_topup','topup','cash','individual_question','iq','custom_order','custom_request','deliverable') then raise exception 'PAYMENT_KIND_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtext(v_student::text), hashtext(v_mentor::text));
  select mentor_id, plan_tier, is_active, amount_cents into v_plan_mentor, v_plan_tier, v_plan_active, v_amount_cents
    from public.mentor_plans where id = p_plan_id for update;
  if not found then raise exception 'PLAN_NOT_FOUND'; end if;
  if v_plan_mentor <> v_mentor then raise exception 'PLAN_MENTOR_MISMATCH'; end if;
  if v_amount_cents is null or v_amount_cents <= 0 then raise exception 'PLAN_AMOUNT_INVALID'; end if;
  if v_pay_status = any(v_succeeded_aliases) then
    select id into v_sub_id from public.subscriptions where student_id=v_student and mentor_id=v_mentor;
    if v_sub_id is null then
      insert into public.subscription_checkout_anomalies(payment_id, subscription_id, code, detail)
        values (p_payment_id, null, 'SUCCEEDED_NO_SUBSCRIPTION', 'succeeded payment without subscription') returning id into v_anom;
      return jsonb_build_object('ok',false,'code','SUCCEEDED_NO_SUBSCRIPTION','anomaly_id',v_anom);
    end if;
    select user_id, delta_cents, reason, ref_type, ref_id into v_l_user, v_l_delta, v_l_reason, v_l_reftype, v_l_refid
      from public.cash_ledger where idempotency_key = 'sub_debit_' || p_payment_id::text;
    if v_l_user is null then
      insert into public.subscription_checkout_anomalies(payment_id, subscription_id, code, detail)
        values (p_payment_id, v_sub_id, 'SUCCEEDED_NO_LEDGER', 'succeeded payment without ledger debit') returning id into v_anom;
      return jsonb_build_object('ok',false,'code','SUCCEEDED_NO_LEDGER','anomaly_id',v_anom);
    end if;
    if v_l_user <> v_student or v_l_refid is distinct from v_sub_id or coalesce(v_l_reftype,'') <> 'subscriptions'
       or coalesce(v_l_reason,'') <> 'subscription_payment' or v_l_delta <> -v_amount_cents then
      insert into public.subscription_checkout_anomalies(payment_id, subscription_id, code, detail, expected, found)
        values (p_payment_id, v_sub_id, 'LEDGER_FIELD_MISMATCH', 'idempotent re-check field mismatch',
          jsonb_build_object('user_id',v_student,'ref_id',v_sub_id,'ref_type','subscriptions','reason','subscription_payment','delta_cents',-v_amount_cents),
          jsonb_build_object('user_id',v_l_user,'ref_id',v_l_refid,'ref_type',v_l_reftype,'reason',v_l_reason,'delta_cents',v_l_delta))
        returning id into v_anom;
      return jsonb_build_object('ok',false,'code','LEDGER_FIELD_MISMATCH','anomaly_id',v_anom);
    end if;
    return jsonb_build_object('ok',true,'idempotent',true,'subscription_id',v_sub_id,'payment_status','succeeded');
  end if;
  if v_pay_status = 'processing' then raise exception 'PAYMENT_PROCESSING'; end if;
  if v_pay_status in ('failed','canceled','refunded') then raise exception 'PAYMENT_NOT_PENDING'; end if;
  if v_pay_status <> 'pending' then raise exception 'PAYMENT_STATE_UNEXPECTED'; end if;
  if v_created_at is null or now() > v_created_at + interval '30 minutes' then raise exception 'PAYMENT_STALE'; end if;
  select status, suspended_until into v_status, v_suspended_until from public.users where id = v_student for update;
  if lower(coalesce(v_status,'active')) = 'banned' then raise exception 'ACCOUNT_BANNED'; end if;
  if lower(coalesce(v_status,'active')) = 'suspended' and (v_suspended_until is null or v_suspended_until > now()) then raise exception 'ACCOUNT_SUSPENDED'; end if;
  perform 1 from public.mentor_profiles where user_id = v_mentor for update;
  select is_open_for_subscriptions into v_is_open from public.mentor_profiles where user_id = v_mentor;
  if not coalesce(v_is_open, true) then raise exception 'MENTOR_NOT_OPEN_FOR_SUBSCRIPTIONS'; end if;
  if not public.individual_question_user_is_approved_mentor(v_mentor) then raise exception 'MENTOR_NOT_APPROVED'; end if;
  if not coalesce(v_plan_active, true) then raise exception 'PLAN_INACTIVE'; end if;
  if not exists (select 1 from public.subscriptions where student_id=v_student and mentor_id=v_mentor and lower(coalesce(status,''))='active') then
    if public.mentor_cap_used(v_mentor) + public.subscription_cap_weight(v_plan_tier) > public.mentor_cap_limit(v_mentor) then raise exception 'MENTOR_CAP_EXCEEDED'; end if;
  end if;
  v_reactivated := exists (select 1 from public.subscriptions where student_id=v_student and mentor_id=v_mentor);
  begin
    insert into public.subscriptions (student_id, mentor_id, plan_id, plan_tier, status, payment_id,
      started_at, current_period_start, current_period_end, next_billing_at, billing_cycle, cancel_at_period_end, last_payment_id)
    values (v_student, v_mentor, p_plan_id, v_plan_tier, 'active', p_payment_id,
      now(), now(), ((now() at time zone 'Asia/Seoul' + interval '1 month') at time zone 'Asia/Seoul'), ((now() at time zone 'Asia/Seoul' + interval '1 month') at time zone 'Asia/Seoul'), 'monthly', false, p_payment_id)
    on conflict (student_id, mentor_id) do update set
      plan_id=excluded.plan_id, plan_tier=excluded.plan_tier, status='active', payment_id=excluded.payment_id,
      last_payment_id=excluded.last_payment_id, started_at=coalesce(public.subscriptions.started_at, now()),
      current_period_start=now(), current_period_end=((now() at time zone 'Asia/Seoul' + interval '1 month') at time zone 'Asia/Seoul'), next_billing_at=((now() at time zone 'Asia/Seoul' + interval '1 month') at time zone 'Asia/Seoul'),
      cancel_at_period_end=false, cancel_requested_at=null, canceled_at=null, expired_at=null, grace_until=null,
      last_renewed_at=now(), updated_at=now()
    returning id into v_sub_id;
    select user_id, delta_cents, reason, ref_type, ref_id into v_l_user, v_l_delta, v_l_reason, v_l_reftype, v_l_refid
      from public.cash_ledger where idempotency_key = 'sub_debit_' || p_payment_id::text;
    if v_l_user is not null and (v_l_user <> v_student or v_l_refid is distinct from v_sub_id
       or coalesce(v_l_reftype,'') <> 'subscriptions' or coalesce(v_l_reason,'') <> 'subscription_payment' or v_l_delta <> -v_amount_cents) then
      raise exception 'LEDGER_FIELD_MISMATCH';
    end if;
    perform public.record_subscription_cash_debit(v_student, v_sub_id, p_payment_id, v_amount_cents::bigint);
    update public.payments set status='succeeded', plan_id=p_plan_id,
      metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object('planId',p_plan_id::text,'subscription_id',v_sub_id::text),
      updated_at=now() where id=p_payment_id;
  exception when others then
    get stacked diagnostics v_errcode = returned_sqlstate;
    v_err := sqlerrm;
  end;
  if v_err is not null then
    if v_err like '%CASH_INSUFFICIENT%' then return jsonb_build_object('ok',false,'code','CASH_INSUFFICIENT'); end if;
    insert into public.subscription_checkout_anomalies(payment_id, subscription_id, code, detail)
      values (p_payment_id, v_sub_id, case when v_err like '%LEDGER_FIELD_MISMATCH%' then 'LEDGER_FIELD_MISMATCH' else 'FINANCIAL_WRITE_ERROR' end, left(v_err,500)) returning id into v_anom;
    return jsonb_build_object('ok',false,'code', case when v_err like '%LEDGER_FIELD_MISMATCH%' then 'LEDGER_FIELD_MISMATCH' else 'FINANCIAL_WRITE_ERROR' end, 'sqlstate',v_errcode,'anomaly_id',v_anom);
  end if;
  return jsonb_build_object('ok',true,'subscription_id',v_sub_id,'payment_status','succeeded','amount_cents',v_amount_cents,'reactivated',v_reactivated);
end; $function$;

-- ---------------------------------------------------------------------------
-- process_subscription_renewal: v_period_start + 1 month (KST) 2곳 치환
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.process_subscription_renewal(p_subscription_id uuid, p_period_end timestamp with time zone, p_amount_cents bigint, p_idempotency_key text, p_processed_at timestamp with time zone DEFAULT now())
 RETURNS TABLE(ok boolean, code text, message text, billing_event_id uuid, ledger_id uuid, next_period_start timestamp with time zone, next_period_end timestamp with time zone, wallet_balance_cents bigint, attempt_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_sub public.subscriptions%rowtype;
  v_event public.subscription_billing_events%rowtype;
  v_event_id uuid;
  v_ledger_id uuid;
  v_wallet_balance bigint;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_attempt_count int;
begin
  if p_subscription_id is null then
    return query select false, 'invalid_subscription'::text, 'subscription_id is required'::text, null::uuid, null::uuid, null::timestamptz, null::timestamptz, null::bigint, 0::int;
    return;
  end if;

  if p_amount_cents is null or p_amount_cents <= 0 then
    return query select false, 'invalid_amount'::text, 'p_amount_cents must be positive'::text, null::uuid, null::uuid, null::timestamptz, null::timestamptz, null::bigint, 0::int;
    return;
  end if;

  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
    return query select false, 'invalid_idempotency_key'::text, 'idempotency_key is required'::text, null::uuid, null::uuid, null::timestamptz, null::timestamptz, null::bigint, 0::int;
    return;
  end if;

  select *
    into v_sub
  from public.subscriptions
  where id = p_subscription_id
  for update;

  if not found then
    return query select false, 'not_found'::text, 'subscription not found'::text, null::uuid, null::uuid, null::timestamptz, null::timestamptz, null::bigint, 0::int;
    return;
  end if;

  if coalesce(v_sub.status, '') not in ('active', 'past_due') then
    return query select false, 'not_renewable_status'::text, 'subscription status is not renewable'::text, null::uuid, null::uuid, v_sub.current_period_start, v_sub.current_period_end, null::bigint, 0::int;
    return;
  end if;

  select *
    into v_event
  from public.subscription_billing_events
  where idempotency_key = p_idempotency_key
  for update;

  if found then
    if v_event.status = 'succeeded' then
      return query select true, 'already_succeeded'::text, 'renewal already processed'::text, v_event.id, v_event.ledger_id, v_event.period_start, v_event.period_end, null::bigint, coalesce(v_event.attempt_count, 0);
      return;
    end if;

    if v_event.status in ('pending', 'processing') then
      return query select false, 'already_processing'::text, 'renewal is already processing'::text, v_event.id, v_event.ledger_id, v_event.period_start, v_event.period_end, null::bigint, coalesce(v_event.attempt_count, 0);
      return;
    end if;

    update public.subscription_billing_events as e
    set
      event_type = 'renewal',
      status = 'processing',
      failure_code = null,
      failure_message = null,
      amount_cents = p_amount_cents::int,
      billing_at = p_processed_at,
      attempt_count = coalesce(attempt_count, 0) + 1,
      processed_at = null
    where e.id = v_event.id
    returning e.* into v_event;

    v_event_id := v_event.id;
    v_attempt_count := coalesce(v_event.attempt_count, 1);
  else
    v_period_start := coalesce(v_sub.current_period_end, p_period_end, p_processed_at);
    v_period_end := ((v_period_start at time zone 'Asia/Seoul' + interval '1 month') at time zone 'Asia/Seoul');

    insert into public.subscription_billing_events (
      subscription_id,
      student_id,
      mentor_id,
      event_type,
      status,
      period_start,
      period_end,
      billing_at,
      amount_cents,
      plan_tier,
      plan_id,
      idempotency_key,
      attempt_count,
      created_at
    )
    values (
      v_sub.id,
      v_sub.student_id,
      v_sub.mentor_id,
      'renewal',
      'processing',
      v_period_start,
      v_period_end,
      p_processed_at,
      p_amount_cents::int,
      v_sub.plan_tier,
      v_sub.plan_id,
      p_idempotency_key,
      1,
      p_processed_at
    )
    returning * into v_event;

    v_event_id := v_event.id;
    v_attempt_count := 1;
  end if;

  insert into public.cash_wallets (user_id, balance_cents)
  values (v_sub.student_id, 0)
  on conflict (user_id) do nothing;

  update public.cash_wallets
  set balance_cents = balance_cents - p_amount_cents
  where user_id = v_sub.student_id
    and balance_cents >= p_amount_cents
  returning balance_cents into v_wallet_balance;

  if not found then
    update public.subscription_billing_events as e
    set
      event_type = 'renewal_failed',
      status = 'failed',
      failure_code = 'insufficient_cash',
      failure_message = 'CASH_INSUFFICIENT',
      processed_at = p_processed_at
    where e.id = v_event_id
    returning e.attempt_count into v_attempt_count;

    update public.subscriptions
    set
      status = 'past_due',
      grace_until = coalesce(grace_until, p_processed_at + interval '2 days'),
      updated_at = p_processed_at,
      last_billing_event_id = v_event_id
    where id = v_sub.id;

    return query select false, 'insufficient_cash'::text, 'CASH_INSUFFICIENT'::text, v_event_id, null::uuid, v_event.period_start, v_event.period_end, null::bigint, coalesce(v_attempt_count, 1);
    return;
  end if;

  insert into public.cash_ledger (
    user_id,
    delta_cents,
    reason,
    ref_type,
    ref_id,
    idempotency_key,
    created_at
  )
  values (
    v_sub.student_id,
    -p_amount_cents,
    'subscription_renewal',
    'subscriptions',
    v_sub.id,
    p_idempotency_key,
    p_processed_at
  )
  on conflict (idempotency_key) do nothing
  returning id into v_ledger_id;

  if v_ledger_id is null then
    select id
      into v_ledger_id
    from public.cash_ledger
    where idempotency_key = p_idempotency_key;
  end if;

  v_period_start := coalesce(v_event.period_start, v_sub.current_period_end, p_period_end, p_processed_at);
  v_period_end := coalesce(v_event.period_end, ((v_period_start at time zone 'Asia/Seoul' + interval '1 month') at time zone 'Asia/Seoul'));

  update public.subscription_billing_events as e
  set
    event_type = 'renewal',
    status = 'succeeded',
    ledger_id = v_ledger_id,
    processed_at = p_processed_at,
    failure_code = null,
    failure_message = null,
    period_start = v_period_start,
    period_end = v_period_end,
    amount_cents = p_amount_cents::int
  where e.id = v_event_id
  returning e.attempt_count into v_attempt_count;

  update public.subscriptions
  set
    status = 'active',
    current_period_start = v_period_start,
    current_period_end = v_period_end,
    next_billing_at = v_period_end,
    last_renewed_at = p_processed_at,
    last_billing_event_id = v_event_id,
    grace_until = null,
    updated_at = p_processed_at
  where id = v_sub.id;

  return query select true, 'succeeded'::text, 'renewal processed'::text, v_event_id, v_ledger_id, v_period_start, v_period_end, v_wallet_balance, coalesce(v_attempt_count, 1);
end;
$function$;
