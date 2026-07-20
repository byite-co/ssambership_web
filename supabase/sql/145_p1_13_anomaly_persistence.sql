-- 145_p1_13_anomaly_persistence.sql
-- P1-13 (1-5) 금융 불일치 anomaly 영속성. 131/143 미수정, confirm_subscription_checkout 재정의.
--
-- 문제: 143 은 원장/구독 불일치 시 RAISE → audit 기록까지 롤백. 영속 기록이 남지 않는다.
-- 해결:
--   * service-role 전용 anomaly 테이블(RLS deny + revoke).
--   * 금융 write 전 사전 불일치는 anomaly INSERT 후 {ok:false,code} 반환(금융 변경 0 → anomaly 만 커밋).
--   * 금융 write 도중 오류는 내부 subtransaction(BEGIN..EXCEPTION)으로 구독·차감·payment 변경을 롤백한 뒤
--     바깥에서 anomaly 를 기록하고 {ok:false} 반환(anomaly 만 커밋).
-- 반환 계약 변경: 이제 anomaly 는 RAISE 가 아니라 {ok:false,code,anomaly_id} 로 반환한다. 웹은 data.ok 를 검사.
-- 선행: 131·143·019/023·067.

begin;
set local lock_timeout='5s';

create table if not exists public.subscription_checkout_anomalies (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid,
  subscription_id uuid,
  code text not null,
  detail text,
  expected jsonb,
  found jsonb,
  created_at timestamptz not null default now()
);
alter table public.subscription_checkout_anomalies enable row level security;
-- 정책 미부여 → authenticated/anon 접근 불가. service_role 은 RLS bypass. DEFINER(postgres) INSERT 가능.
revoke all on table public.subscription_checkout_anomalies from public, anon, authenticated;
grant select, insert on table public.subscription_checkout_anomalies to service_role;

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

  -- 이미 성공 → 전필드 멱등 검증. 불일치는 anomaly INSERT 후 {ok:false} (금융 변경 없음).
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

  -- 금융 write subtransaction: 오류 시 구독·차감·payment 변경 롤백, 바깥에서 anomaly 기록.
  begin
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
    -- 잔액 부족은 정상 사용자 오류(anomaly 아님) → anomaly 미기록.
    if v_err like '%CASH_INSUFFICIENT%' then
      return jsonb_build_object('ok',false,'code','CASH_INSUFFICIENT');
    end if;
    -- 그 외(원장 불일치·예상 밖) 금융 변경은 subtransaction 롤백됨. anomaly 만 기록·커밋.
    insert into public.subscription_checkout_anomalies(payment_id, subscription_id, code, detail)
      values (p_payment_id, v_sub_id,
        case when v_err like '%LEDGER_FIELD_MISMATCH%' then 'LEDGER_FIELD_MISMATCH' else 'FINANCIAL_WRITE_ERROR' end,
        left(v_err, 500)) returning id into v_anom;
    return jsonb_build_object('ok',false,
      'code', case when v_err like '%LEDGER_FIELD_MISMATCH%' then 'LEDGER_FIELD_MISMATCH' else 'FINANCIAL_WRITE_ERROR' end,
      'sqlstate',v_errcode,'anomaly_id',v_anom);
  end if;

  return jsonb_build_object('ok',true,'subscription_id',v_sub_id,'payment_status','succeeded','amount_cents',v_amount_cents,'reactivated',v_reactivated);
end;
$$;
revoke all on function public.confirm_subscription_checkout(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.confirm_subscription_checkout(uuid,uuid,text) to service_role;

commit;

-- §V(rollback-only): anomaly 는 별도 트랜잭션에서 조회 가능(영속) · 불일치 시 구독/원장/payment 변경 0 ·
--   {ok:false,code,anomaly_id} 반환 · 정상 경로 {ok:true}. service_role 외 anomaly 접근 불가.
