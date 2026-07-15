-- 121_custom_order_dispute_fee_5pct.sql
-- 분쟁 예치 분배 수수료 20% → 5% (멘토 net = gross − 5%). 맞춤의뢰 수수료 잠금값 정합.
--
-- 배경: 090_custom_order_fee_5pct.sql 이 맞춤의뢰 플랫폼 수수료를 5%로 확정했으나
--   accept_custom_order_deliverable_atomic 만 교체했고, 분쟁 분배 RPC
--   record_custom_order_dispute_split(057)의 v_fee_rate := 0.20 은 그대로 남아 있었다.
--   관리자가 분쟁을 분할 해결하면 멘토가 배정 gross 의 80%만 받아(정상 95% 대비 15%p 손해)
--   잠금값(맞춤의뢰 5%·멘토 95%)과 어긋났다.
--
-- 조치: 057 함수 본문을 그대로 두고 v_fee_rate 만 0.05 로 교체(create or replace).
--   불변식 보존: platform_fee = floor(mentor_gross*0.05), mentor_net = gross − platform_fee.
--   멱등성·에스크로·상태전이·revoke/grant 로직 미변경. 소급 안 함(기존 분배분은 그대로).
--
-- 실행: 검토 후 Supabase SQL Editor 에서 전체 실행. (service_role 권한 RPC, idempotent)

create or replace function public.record_custom_order_dispute_split(
  p_order_id uuid,
  p_mentor_gross_won integer,
  p_student_refund_won integer,
  p_admin_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  o public.custom_request_orders%rowtype;
  s public.custom_order_settlement_items%rowtype;
  v_hold_idem text := 'cr_hold_' || p_order_id::text;
  v_payout_idem text := 'cr_payout_' || p_order_id::text;
  v_refund_idem text := 'cr_refund_' || p_order_id::text;
  v_dispute_payout_idem text := 'cr_dispute_payout_' || p_order_id::text;
  v_dispute_refund_idem text := 'cr_dispute_refund_' || p_order_id::text;
  v_hold_cents bigint;
  v_hold_gross_won integer;
  v_settlement_gross integer;
  v_fee_rate numeric := 0.05;  -- 121: 20%->5%
  v_platform_fee_won integer;
  v_mentor_net_won integer;
  v_mentor_cents bigint;
  v_student_cents bigint;
  v_pay text;
  v_norm text;
  v_admin_ok boolean;
  v_new_mentor_ledger uuid;
  v_new_student_ledger uuid;
  v_wu int;
  v_now timestamptz := now();
  v_disputes_resolved int := 0;
begin
  if p_order_id is null then
    raise exception 'p_order_id is required';
  end if;
  if p_admin_id is null then
    raise exception 'ADMIN_REQUIRED';
  end if;
  if p_mentor_gross_won is null or p_student_refund_won is null then
    raise exception 'DISPUTE_SPLIT_AMOUNTS_REQUIRED';
  end if;
  if p_mentor_gross_won < 0 or p_student_refund_won < 0 then
    raise exception 'DISPUTE_SPLIT_AMOUNTS_INVALID';
  end if;

  select exists(
    select 1 from public.users u where u.id = p_admin_id and u.role = 'admin'
  ) into v_admin_ok;
  if not coalesce(v_admin_ok, false) then
    raise exception 'ADMIN_REQUIRED';
  end if;

  select * into o
  from public.custom_request_orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  if o.student_id is null or o.mentor_id is null then
    raise exception 'ORDER_PARTIES_MISSING';
  end if;

  v_pay := lower(trim(coalesce(nullif(trim(o.payment_status), ''), '')));
  v_norm := public._order_primary_status_norm(o);

  -- payout / refund / dispute-split 상호 배타
  if exists (
    select 1 from public.cash_ledger l
    where l.idempotency_key = v_payout_idem
      and l.reason = 'custom_order_escrow_payout'
  ) then
    raise exception 'ALREADY_PAID_OUT';
  end if;

  if exists (
    select 1 from public.cash_ledger l
    where l.idempotency_key = v_refund_idem
      and l.reason = 'custom_order_escrow_refund'
  ) then
    raise exception 'ALREADY_REFUNDED';
  end if;

  select * into s
  from public.custom_order_settlement_items
  where custom_request_order_id = p_order_id
  for update;

  if found and s.status = 'paid' then
    raise exception 'ALREADY_PAID_OUT';
  end if;

  select abs(l.delta_cents) into v_hold_cents
  from public.cash_ledger l
  where l.idempotency_key = v_hold_idem
    and l.reason = 'custom_order_escrow_hold'
  limit 1;

  if v_hold_cents is null then
    raise exception 'ESCROW_HOLD_MISSING';
  end if;

  if v_hold_cents <= 0 or v_hold_cents > 1000000000 then
    raise exception 'ESCROW_HOLD_AMOUNT_INVALID';
  end if;

  if v_hold_cents % 100 <> 0 then
    raise exception 'ESCROW_HOLD_AMOUNT_INVALID';
  end if;

  v_hold_gross_won := (v_hold_cents / 100)::integer;

  if found then
    v_settlement_gross := s.gross_amount;
    if v_settlement_gross is distinct from v_hold_gross_won then
      raise exception 'ESCROW_HOLD_AMOUNT_MISMATCH';
    end if;
  end if;

  -- 멱등: 분배 ledger 가 하나라도 있으면 상태 수리 후 종료
  if exists (
    select 1 from public.cash_ledger l
    where l.idempotency_key in (v_dispute_payout_idem, v_dispute_refund_idem)
      and l.reason in ('custom_order_dispute_payout', 'custom_order_dispute_refund')
  ) then
    update public.custom_order_settlement_items
    set status = 'cancelled', updated_at = v_now
    where custom_request_order_id = p_order_id
      and status in ('pending', 'on_hold', 'payable');

    update public.custom_request_orders
    set
      payment_status = 'dispute_resolved',
      status = 'dispute_resolved',
      state = 'dispute_resolved',
      order_status = 'dispute_resolved',
      updated_at = v_now
    where id = p_order_id;

    update public.disputes d
    set
      status = 'resolved',
      resolved_at = coalesce(d.resolved_at, v_now),
      resolved_by = coalesce(d.resolved_by, p_admin_id),
      updated_at = v_now
    where d.custom_request_order_id = p_order_id
      and d.status in ('open', 'under_review', 'escalated');

    get diagnostics v_disputes_resolved = row_count;

    return jsonb_build_object(
      'ok', true,
      'noop', true,
      'order_id', p_order_id,
      'hold_gross_won', v_hold_gross_won,
      'disputes_resolved', v_disputes_resolved
    );
  end if;

  if p_mentor_gross_won + p_student_refund_won is distinct from v_hold_gross_won then
    raise exception 'DISPUTE_SPLIT_MISMATCH';
  end if;

  if v_pay not in ('escrowed', 'dispute_resolved') then
    raise exception 'PAYMENT_NOT_ESCROWED';
  end if;

  v_platform_fee_won := floor(p_mentor_gross_won * v_fee_rate)::integer;
  v_mentor_net_won := p_mentor_gross_won - v_platform_fee_won;
  v_mentor_cents := v_mentor_net_won::bigint * 100;
  v_student_cents := p_student_refund_won::bigint * 100;

  if v_mentor_cents > 1000000000 or v_student_cents > 1000000000 then
    raise exception 'p_amount_too_large';
  end if;

  if v_mentor_cents > 0 then
    insert into public.cash_ledger (user_id, delta_cents, reason, ref_type, ref_id, idempotency_key)
    values (
      o.mentor_id,
      v_mentor_cents,
      'custom_order_dispute_payout',
      'custom_request_orders',
      p_order_id,
      v_dispute_payout_idem
    )
    on conflict (idempotency_key) do nothing
    returning id into v_new_mentor_ledger;

    if v_new_mentor_ledger is not null then
      insert into public.cash_wallets (user_id, balance_cents)
      values (o.mentor_id, 0)
      on conflict (user_id) do nothing;

      update public.cash_wallets w
      set balance_cents = w.balance_cents + v_mentor_cents
      where w.user_id = o.mentor_id;
      get diagnostics v_wu = row_count;
      if coalesce(v_wu, 0) = 0 then
        raise exception 'CASH_WALLET_UPDATE_FAILED' using errcode = 'P0001';
      end if;
    end if;
  end if;

  if v_student_cents > 0 then
    insert into public.cash_ledger (user_id, delta_cents, reason, ref_type, ref_id, idempotency_key)
    values (
      o.student_id,
      v_student_cents,
      'custom_order_dispute_refund',
      'custom_request_orders',
      p_order_id,
      v_dispute_refund_idem
    )
    on conflict (idempotency_key) do nothing
    returning id into v_new_student_ledger;

    if v_new_student_ledger is not null then
      insert into public.cash_wallets (user_id, balance_cents)
      values (o.student_id, 0)
      on conflict (user_id) do nothing;

      update public.cash_wallets w
      set balance_cents = w.balance_cents + v_student_cents
      where w.user_id = o.student_id;
      get diagnostics v_wu = row_count;
      if coalesce(v_wu, 0) = 0 then
        raise exception 'CASH_WALLET_UPDATE_FAILED' using errcode = 'P0001';
      end if;
    end if;
  end if;

  update public.custom_order_settlement_items
  set status = 'cancelled', updated_at = v_now
  where custom_request_order_id = p_order_id
    and status in ('pending', 'on_hold', 'payable');

  update public.custom_request_orders
  set
    payment_status = 'dispute_resolved',
    status = 'dispute_resolved',
    state = 'dispute_resolved',
    order_status = 'dispute_resolved',
    updated_at = v_now
  where id = p_order_id;

  update public.disputes d
  set
    status = 'resolved',
    resolved_at = coalesce(d.resolved_at, v_now),
    resolved_by = coalesce(d.resolved_by, p_admin_id),
    updated_at = v_now
  where d.custom_request_order_id = p_order_id
    and d.status in ('open', 'under_review', 'escalated');

  get diagnostics v_disputes_resolved = row_count;

  return jsonb_build_object(
    'ok', true,
    'noop', false,
    'order_id', p_order_id,
    'hold_gross_won', v_hold_gross_won,
    'mentor_gross_won', p_mentor_gross_won,
    'mentor_platform_fee_won', v_platform_fee_won,
    'mentor_net_won', v_mentor_net_won,
    'mentor_cents', v_mentor_cents,
    'student_refund_won', p_student_refund_won,
    'student_cents', v_student_cents,
    'fee_rate', v_fee_rate,
    'disputes_resolved', v_disputes_resolved
  );
end;
$function$;

comment on function public.record_custom_order_dispute_split(uuid, integer, integer, uuid) is
  'P0: Custom order dispute escrow split — mentor net (gross−5%) + student refund; hold gross must match sum. service_role only.';

revoke all on function public.record_custom_order_dispute_split(uuid, integer, integer, uuid) from public;
revoke all on function public.record_custom_order_dispute_split(uuid, integer, integer, uuid) from anon;
revoke all on function public.record_custom_order_dispute_split(uuid, integer, integer, uuid) from authenticated;

grant execute on function public.record_custom_order_dispute_split(uuid, integer, integer, uuid) to service_role;
