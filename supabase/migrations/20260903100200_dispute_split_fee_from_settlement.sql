-- =============================================================================
-- 191_dispute_split_fee_from_settlement.sql  (2026-09-03 · DB-1 묶음 C — 분쟁 분배 수수료)
--
-- Purpose: record_custom_order_dispute_split 의 내부 상수 `v_fee_rate := 0.05` 를 제거하고
--   해당 주문의 정산 행 `custom_order_settlement_items.fee_rate` 를 읽는다(PR-1b 원칙 완성 —
--   요율 정본은 DB 정산 행. 웹 미리보기(disputeConsole.buildDisputeSplitPreview)도 같은 행을 읽는다).
--   정산 행이 없거나 fee_rate 가 NULL 이면 `SETTLEMENT_FEE_RATE_MISSING` 예외 — 추측하지 않는다.
--   반환 jsonb 의 'fee_rate' 키(적용 요율 — PR-1b 감사 로그 기록)는 유지하며 값이 정산 행 요율이 된다.
--
-- Base: supabase/sql/125_dispute_split_fee_5pct.sql 본문(운영 실행본 def md5 c60df394… 과 동일 로직).
--   이후 이 함수를 재정의한 migration 없음.
-- 변경 없음: 시그니처(uuid, integer, integer, uuid) · SECURITY DEFINER · search_path public · 계산 순서 ·
--   반올림(floor) · 멱등키 · 원장 사유/참조 · 상태 전이 · 반환 계약 · ACL(service_role 전용).
-- 변경 3곳: ① v_fee_rate 초기값 제거 + v_settlement_found 선언 ② 정산 행 SELECT 직후 found 보존 +
--   요율 부재 예외 + v_fee_rate := s.fee_rate ③ COMMENT 문구. (기존 `if found then` 게이트는 손대지 않는다.)
--   요율 게이트는 멱등 noop 분기보다 앞이다 — 이미 분배된 주문은 정산 행이 반드시 있으므로(분배 시
--   ESCROW_HOLD_AMOUNT_MISMATCH 게이트 통과 = 정산 행 존재) 재호출 noop 동작은 그대로다.
--
-- 운영 영향: 분쟁 0건 · 기존 정산 행 fee_rate NULL 0건(컬럼 NOT NULL · default 0.05).
-- Apply: 저장소 표준 경로(db-apply-pending) — 즉석 실행 금지.
--   pack 등재: supabase/baseline/post_ledger_backfills/20260903100200_dispute_split_fee_from_settlement.sql
-- Rollback: supabase/rollback/20260903100200_dispute_split_fee_from_settlement_rollback.sql (125 본문 복원)
-- 검증(§5): select prosrc like '%0.05%' as 상수잔존 from pg_proc where proname='record_custom_order_dispute_split';  → false
-- =============================================================================

begin;

-- ── 0. 사전 게이트 — 125 본문(상수 0.05)이 실재해야 한다 ────────────────────────
do $$
declare v_src text;
begin
  select p.prosrc into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'record_custom_order_dispute_split'
     and pg_get_function_identity_arguments(p.oid) = 'p_order_id uuid, p_mentor_gross_won integer, p_student_refund_won integer, p_admin_id uuid';
  if v_src is null then
    raise exception '191_GATE: record_custom_order_dispute_split(uuid, integer, integer, uuid) 부재';
  end if;
  if v_src not like '%v_fee_rate numeric := 0.05;%' then
    raise exception '191_GATE: 내부 상수 `v_fee_rate numeric := 0.05` 를 찾지 못했다 — 이미 적용됐거나 125 전제 불일치';
  end if;
end $$;

-- ── 1. 재정의 — 125 본문 + 요율을 정산 행에서 ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_custom_order_dispute_split(p_order_id uuid, p_mentor_gross_won integer, p_student_refund_won integer, p_admin_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_fee_rate numeric;                 -- 191: 정산 행(custom_order_settlement_items.fee_rate)에서 읽는다 — 내부 상수 없음
  v_settlement_found boolean := false;
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
  v_settlement_found := found;

  if v_settlement_found and s.status = 'paid' then
    raise exception 'ALREADY_PAID_OUT';
  end if;

  -- 191: 플랫폼 수수료율은 해당 주문의 정산 행 요율만 쓴다. 정산 행이 없거나 요율이 NULL 이면
  --      추측하지 않고 예외(부분 반영 0 — 트랜잭션 전체 rollback).
  if not v_settlement_found or s.fee_rate is null then
    raise exception 'SETTLEMENT_FEE_RATE_MISSING';
  end if;
  v_fee_rate := s.fee_rate;

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

-- ── 2. COMMENT · ACL 재확정(멱등 — service_role 전용) ──────────────────────────
comment on function public.record_custom_order_dispute_split(
  uuid, integer, integer, uuid
) is
  'P0: Custom order dispute escrow split — mentor net (gross − settlement fee_rate) + student refund; hold gross must match sum. 191: fee_rate from custom_order_settlement_items (SETTLEMENT_FEE_RATE_MISSING if absent). service_role only.';

revoke all on function public.record_custom_order_dispute_split(
  uuid, integer, integer, uuid
) from public, anon, authenticated;

grant execute on function public.record_custom_order_dispute_split(
  uuid, integer, integer, uuid
) to service_role;

-- ── 3. 적용 직후 자가 검증 ─────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'record_custom_order_dispute_split'
                    and p.prosecdef and p.proconfig::text like '%search_path=%'
                    and p.prosrc not like '%0.05%'
                    and p.prosrc like '%SETTLEMENT_FEE_RATE_MISSING%'
                    and p.prosrc like '%v_fee_rate := s.fee_rate;%'
                    and NOT has_function_privilege('anon', p.oid, 'EXECUTE')
                    and NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
                    and has_function_privilege('service_role', p.oid, 'EXECUTE')
                    and (p.proacl IS NULL OR (p.proacl::text NOT LIKE '{=%' AND p.proacl::text NOT LIKE '%,=%'))) then
    raise exception '191_SELFCHECK: 본문/ACL 불일치';
  end if;
end $$;

commit;
