-- --------------------------------------------------------------------------
-- 128_refund_admin_restore_escrow.sql   (P1-9 · 관리자 환불 승인 맞춤의뢰 에스크로 분기 복원)
-- [적용됨 — ssambership-staging 에 2026-07-19 단일 트랜잭션(lock_timeout 3s) 적용·검증 통과
--   (구조 T1~T5 + 기능 S1~S4 PASS: 맞춤의뢰 에스크로 환불 복원·generic 이중credit 0·구독 generic 유지·
--   멱등 noop·정산 paid 차단). def md5 0e730afb…→변경. fixture savepoint 롤백·baseline 0행 복원.
--   원장 미기재 — 적용 이력: docs/audit/sql_apply_manifest.md]
-- 목적: 099 가 재정의한 approve_refund_request_admin 은 맞춤의뢰(custom_request_order_id) 환불에도
--   generic 'refund_approved' 크레딧(r.amount_cents)만 실행하고 056 에스크로 refund helper 를 호출하지
--   않아, hold 반환·정산/주문 정리가 에스크로 정본 경로로 이뤄지지 않았다. 본 파일은 **최신 099 본문**을
--   기준으로 맞춤의뢰 분기를 복원해 record_custom_order_escrow_refund(056) 로 위임하고, 그 경우
--   generic 크레딧을 실행하지 않아 **이중 credit 을 방지**한다.
-- 선행: 057(=056 계열 에스크로), 072(권한 재확인). record_custom_order_escrow_refund(056) helper 는 재작성하지 않는다.
-- 보존: admin 가드 · pending 가드 · 구독 settlement-paid 가드(099) · 구독 generic 크레딧/멱등키·지갑·
--   payment/subscription 상태 전이. 서명·SECURITY DEFINER·service_role 전용 ACL 불변.
-- P1-13 주의: 향후 P1-13 이 승인 함수를 재정의할 때 **본 128 본문을 기반**으로 구독 paid 가드·맞춤의뢰
--   에스크로 분기·(P1-13) billing-event/settlement 잠금을 함께 보존해야 한다.
-- 실상태(2026-07-19 staging): refunds/custom_request_orders/관련 원장 모두 0행(백필·대사 불필요).
-- --------------------------------------------------------------------------

create or replace function public.approve_refund_request_admin(p_refund_id uuid, p_admin_id uuid, p_admin_note text default null::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  r public.refunds%rowtype;
  v_amount bigint;
  v_settlement_status text;
  v_idem text := 'refund_credit:' || p_refund_id::text;
  v_ledger_id uuid;
  v_existing_delta bigint;
  v_wu int;
  v_admin_ok boolean;
begin
  if p_refund_id is null then
    return jsonb_build_object('ok', false, 'message', '환불 ID가 필요합니다.');
  end if;
  if p_admin_id is null then
    return jsonb_build_object('ok', false, 'message', '관리자 ID가 필요합니다.');
  end if;

  select exists(
    select 1 from public.users u where u.id = p_admin_id and u.role = 'admin'
  ) into v_admin_ok;
  if not coalesce(v_admin_ok, false) then
    raise exception 'ADMIN_REQUIRED';
  end if;

  select * into r from public.refunds where id = p_refund_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'message', '환불 요청을 찾을 수 없습니다.');
  end if;

  if r.status is distinct from 'pending' then
    return jsonb_build_object('ok', true, 'noop', true, 'refund_id', p_refund_id,
      'message', '이미 처리되었거나 대기 상태가 아닙니다.', 'status', r.status);
  end if;

  -- 정산 지급 완료 시 자동 환불 차단 (맞춤의뢰)
  if r.custom_request_order_id is not null then
    select s.status into v_settlement_status
    from public.custom_order_settlement_items s
    where s.custom_request_order_id = r.custom_request_order_id
    limit 1;
    if found and v_settlement_status = 'paid' then
      return jsonb_build_object('ok', false,
        'message', '이미 정산 지급이 완료된 건은 자동 환불할 수 없습니다. 수동 조정이 필요합니다.');
    end if;
  end if;

  -- 정산 지급 완료 시 자동 환불 차단 (구독) — 099
  if r.payment_id is not null
     and (r.subscription_id is not null or coalesce(r.request_type, '') = 'subscription_prorated') then
    select s.status into v_settlement_status
    from public.subscription_settlement_items s
    where s.payment_id = r.payment_id and s.status = 'paid'
    limit 1;
    if found then
      return jsonb_build_object('ok', false,
        'message', '이미 멘토 정산 지급이 완료된 구독 건은 자동 환불할 수 없습니다. 수동 조정이 필요합니다.');
    end if;
  end if;

  -- ===== P1-9 복원: 맞춤의뢰 환불은 에스크로 helper(056)로 위임한다.
  --   helper 가 hold 반환(custom_order_escrow_refund)·정산 취소·주문 취소/refunded 를 멱등 처리한다.
  --   generic 'refund_approved' 크레딧을 함께 실행하지 않아 이중 credit 을 방지한다. =====
  if r.custom_request_order_id is not null then
    perform public.record_custom_order_escrow_refund(r.custom_request_order_id);
    update public.refunds
    set status = 'succeeded', processed_at = now(), processed_by = p_admin_id,
        admin_note = p_admin_note, updated_at = now()
    where id = r.id;
    return jsonb_build_object('ok', true, 'noop', false, 'refund_id', r.id,
      'kind', 'custom_order_escrow', 'message', '맞춤의뢰 환불이 승인되었습니다.');
  end if;

  -- ===== 구독/결제 환불: generic 크레딧(기존 099 로직 보존) =====
  if r.amount_cents is null or r.amount_cents <= 0 then
    raise exception '환불 금액이 설정되지 않아 자동 승인할 수 없습니다.';
  end if;

  v_amount := r.amount_cents;

  if v_amount > 1000000000 then
    return jsonb_build_object('ok', false, 'message', '환불 금액이 허용 한도를 초과합니다.');
  end if;

  insert into public.cash_ledger (user_id, delta_cents, reason, ref_type, ref_id, idempotency_key)
  values (r.user_id, v_amount, 'refund_approved', 'refunds', r.id, v_idem)
  on conflict (idempotency_key) do nothing
  returning id into v_ledger_id;

  if v_ledger_id is null then
    select cl.delta_cents into v_existing_delta
    from public.cash_ledger cl where cl.idempotency_key = v_idem limit 1;
    if not found then
      raise exception 'REFUND_LEDGER_IDEMPOTENT_MISS' using errcode = 'P0001';
    end if;
    if v_existing_delta is distinct from v_amount then
      raise exception 'REFUND_LEDGER_AMOUNT_MISMATCH' using errcode = 'P0001';
    end if;
  end if;

  if v_ledger_id is not null then
    insert into public.cash_wallets (user_id, balance_cents)
    values (r.user_id, 0)
    on conflict (user_id) do nothing;

    update public.cash_wallets w
    set balance_cents = w.balance_cents + v_amount
    where w.user_id = r.user_id;
    get diagnostics v_wu = row_count;
    if coalesce(v_wu, 0) = 0 then
      raise exception 'CASH_WALLET_UPDATE_FAILED' using errcode = 'P0001';
    end if;
  end if;

  update public.refunds
  set status = 'succeeded', processed_at = now(), processed_by = p_admin_id,
      admin_note = p_admin_note, updated_at = now()
  where id = r.id;

  if r.payment_id is not null then
    update public.payments p set status = 'refunded', updated_at = now() where p.id = r.payment_id;
  end if;

  if r.payment_id is not null then
    update public.subscriptions s
    set status = 'canceled', updated_at = now()
    where s.payment_id = r.payment_id and s.status is distinct from 'canceled';
  end if;

  return jsonb_build_object('ok', true, 'noop', false, 'refund_id', r.id,
    'ledger_inserted', (v_ledger_id is not null), 'amount_cents', v_amount,
    'message', '환불이 승인되었습니다.');
end;
$function$;

revoke all on function public.approve_refund_request_admin(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.approve_refund_request_admin(uuid, uuid, text) to service_role;
