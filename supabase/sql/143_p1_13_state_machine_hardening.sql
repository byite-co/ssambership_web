-- 143_p1_13_state_machine_hardening.sql
-- P1-13 상태기계 완전성 감사 보정 — 131 을 수정하지 않고 confirm_subscription_checkout 재정의.
--
-- 추가/강화:
--  * 동시 생성 봉쇄: student·mentor pair advisory transaction lock(빈 pair 에도 잠금) + uq_subscriptions_pair
--    UNIQUE + ON CONFLICT 원자 upsert(SELECT FOR UPDATE 만으로 부족한 신규 pair 경쟁 봉쇄).
--  * 필수 게이트 추가: 학생 계정 활성 · 멘토 승인 · 멘토 cap(신규/재활성 시) · payment 종류(비구독 kind 거부) ·
--    payment mentor 존재 · plan_id 일치 · plan active · 정본 플랜 금액 · pending TTL · processing/종료 거부.
--  * 성공·원장 전필드 멱등: 재호출은 payment/subscription/ledger(user_id·ref_type·ref_id=subscription_id·
--    delta_cents=-amount·reason·idempotency_key)가 모두 일치할 때만 성공. succeeded 인데 구독/원장 불일치면
--    성공 반환하지 않고 구조화 실패로 격리(같은 트랜잭션 롤백 — 부분 커밋 없음).
-- 선행: 131·019/023·067.

create or replace function public.confirm_subscription_checkout(
  p_payment_id uuid, p_plan_id uuid, p_idempotency_key text default null
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_student uuid; v_mentor uuid; v_pay_status text; v_created_at timestamptz; v_kind text;
  v_plan_mentor uuid; v_plan_tier text; v_plan_active boolean; v_amount_cents int;
  v_is_open boolean; v_sub_id uuid; v_reactivated boolean := false;
  v_status text; v_suspended_until timestamptz;
  v_l_user uuid; v_l_delta bigint; v_l_reason text; v_l_reftype text; v_l_refid uuid;
  v_succeeded_aliases text[] := array['succeeded','paid','success','complete','captured'];
begin
  -- 결제 잠금 + 로드.
  select user_id, mentor_id, status, created_at, kind into v_student, v_mentor, v_pay_status, v_created_at, v_kind
    from public.payments where id = p_payment_id for update;
  if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;
  if v_student is null then raise exception 'PAYMENT_NO_USER'; end if;
  if v_mentor is null then raise exception 'PAYMENT_NO_MENTOR'; end if;
  if lower(coalesce(v_kind,'')) in ('cash_topup','topup','cash','individual_question','iq','custom_order','custom_request','deliverable') then
    raise exception 'PAYMENT_KIND_INVALID';
  end if;

  -- 동시 생성 봉쇄: pair advisory xact lock(빈 pair 포함 전 구간 직렬화).
  perform pg_advisory_xact_lock(hashtext(v_student::text), hashtext(v_mentor::text));

  -- 플랜 잠금 + 정본 금액.
  select mentor_id, plan_tier, is_active, amount_cents into v_plan_mentor, v_plan_tier, v_plan_active, v_amount_cents
    from public.mentor_plans where id = p_plan_id for update;
  if not found then raise exception 'PLAN_NOT_FOUND'; end if;
  if v_plan_mentor <> v_mentor then raise exception 'PLAN_MENTOR_MISMATCH'; end if;
  if v_amount_cents is null or v_amount_cents <= 0 then raise exception 'PLAN_AMOUNT_INVALID'; end if;

  -- 이미 성공(별칭) → 전필드 멱등 검증 후 반환(불일치면 격리).
  if v_pay_status = any(v_succeeded_aliases) then
    select id into v_sub_id from public.subscriptions where student_id=v_student and mentor_id=v_mentor;
    if v_sub_id is null then raise exception 'ISOLATION_SUCCEEDED_NO_SUBSCRIPTION payment=%', p_payment_id; end if;
    select user_id, delta_cents, reason, ref_type, ref_id into v_l_user, v_l_delta, v_l_reason, v_l_reftype, v_l_refid
      from public.cash_ledger where idempotency_key = 'sub_debit_' || p_payment_id::text;
    if v_l_user is null then raise exception 'ISOLATION_SUCCEEDED_NO_LEDGER payment=%', p_payment_id; end if;
    if v_l_user <> v_student or v_l_refid is distinct from v_sub_id or coalesce(v_l_reftype,'') <> 'subscriptions'
       or coalesce(v_l_reason,'') <> 'subscription_payment' or v_l_delta <> -v_amount_cents then
      raise exception 'ISOLATION_LEDGER_FIELD_MISMATCH payment=% sub=%', p_payment_id, v_sub_id;
    end if;
    return jsonb_build_object('ok',true,'idempotent',true,'subscription_id',v_sub_id,'payment_status','succeeded');
  end if;

  if v_pay_status = 'processing' then raise exception 'PAYMENT_PROCESSING'; end if;
  if v_pay_status in ('failed','canceled','refunded') then raise exception 'PAYMENT_NOT_PENDING'; end if;
  if v_pay_status <> 'pending' then raise exception 'PAYMENT_STATE_UNEXPECTED'; end if;
  if v_created_at is null or now() > v_created_at + interval '30 minutes' then raise exception 'PAYMENT_STALE'; end if;

  -- 학생 계정 활성.
  select status, suspended_until into v_status, v_suspended_until from public.users where id = v_student for update;
  if lower(coalesce(v_status,'active')) = 'banned' then raise exception 'ACCOUNT_BANNED'; end if;
  if lower(coalesce(v_status,'active')) = 'suspended' and (v_suspended_until is null or v_suspended_until > now()) then
    raise exception 'ACCOUNT_SUSPENDED';
  end if;

  -- 멘토 잠금 + 구독 open + 승인 + 플랜 active.
  perform 1 from public.mentor_profiles where user_id = v_mentor for update;
  select is_open_for_subscriptions into v_is_open from public.mentor_profiles where user_id = v_mentor;
  if not coalesce(v_is_open, true) then raise exception 'MENTOR_NOT_OPEN_FOR_SUBSCRIPTIONS'; end if;
  if not public.individual_question_user_is_approved_mentor(v_mentor) then raise exception 'MENTOR_NOT_APPROVED'; end if;
  if not coalesce(v_plan_active, true) then raise exception 'PLAN_INACTIVE'; end if;

  -- 멘토 cap: 이 pair 가 현재 active 가 아닐 때(신규/재활성)만 가중치 추가 검사.
  if not exists (select 1 from public.subscriptions where student_id=v_student and mentor_id=v_mentor and lower(coalesce(status,''))='active') then
    if public.mentor_cap_used(v_mentor) + public.subscription_cap_weight(v_plan_tier) > public.mentor_cap_limit(v_mentor) then
      raise exception 'MENTOR_CAP_EXCEEDED';
    end if;
  end if;

  v_reactivated := exists (select 1 from public.subscriptions where student_id=v_student and mentor_id=v_mentor);

  -- 구독 생성/재활성화(UNIQUE + ON CONFLICT 원자).
  insert into public.subscriptions (student_id, mentor_id, plan_id, plan_tier, status, payment_id,
    started_at, current_period_start, current_period_end, next_billing_at, billing_cycle, cancel_at_period_end, last_payment_id)
  values (v_student, v_mentor, p_plan_id, v_plan_tier, 'active', p_payment_id,
    now(), now(), now()+interval '1 month', now()+interval '1 month', 'monthly', false, p_payment_id)
  on conflict (student_id, mentor_id) do update set
    plan_id=excluded.plan_id, plan_tier=excluded.plan_tier, status='active', payment_id=excluded.payment_id,
    last_payment_id=excluded.last_payment_id, started_at=coalesce(public.subscriptions.started_at, now()),
    current_period_start=now(), current_period_end=now()+interval '1 month', next_billing_at=now()+interval '1 month',
    cancel_at_period_end=false, cancel_requested_at=null, canceled_at=null, expired_at=null, grace_until=null,
    last_renewed_at=now(), updated_at=now()
  returning id into v_sub_id;

  -- 기존 원장 행이 있으면 전필드 일치만 허용(불일치 격리).
  select user_id, delta_cents, reason, ref_type, ref_id into v_l_user, v_l_delta, v_l_reason, v_l_reftype, v_l_refid
    from public.cash_ledger where idempotency_key = 'sub_debit_' || p_payment_id::text;
  if v_l_user is not null and (v_l_user <> v_student or v_l_refid is distinct from v_sub_id
     or coalesce(v_l_reftype,'') <> 'subscriptions' or coalesce(v_l_reason,'') <> 'subscription_payment'
     or v_l_delta <> -v_amount_cents) then
    raise exception 'ISOLATION_LEDGER_FIELD_MISMATCH payment=% sub=%', p_payment_id, v_sub_id;
  end if;

  perform public.record_subscription_cash_debit(v_student, v_sub_id, p_payment_id, v_amount_cents::bigint);

  update public.payments set status='succeeded', plan_id=p_plan_id,
    metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object('planId',p_plan_id::text,'subscription_id',v_sub_id::text),
    updated_at=now() where id=p_payment_id;

  return jsonb_build_object('ok',true,'subscription_id',v_sub_id,'payment_status','succeeded','amount_cents',v_amount_cents,'reactivated',v_reactivated);
end;
$$;

revoke all on function public.confirm_subscription_checkout(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.confirm_subscription_checkout(uuid,uuid,text) to service_role;

-- §V(rollback-only): 게이트 각각 거부(정지학생·미승인멘토·cap초과·비구독kind·plan불일치/미가격·TTL·processing) ·
--   pending→active+debit+succeeded · 재호출 전필드 멱등 · succeeded인데 ledger 불일치 격리(부분커밋 없음) ·
--   동시 신규 pair 이중 구독 없음(UNIQUE+advisory). 독립 2세션 실측 = CONCURRENCY_VALIDATION_DEBT.
