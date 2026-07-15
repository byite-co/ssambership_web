-- =============================================================================
-- 125: approve_refund_request_admin — 056 에스크로 분기 복원 + 099 구독 가드 유지 (XV-REFUND)
-- =============================================================================
-- 배경(XV-REFUND): 056 은 approve_refund_request_admin 에 "맞춤의뢰 예치(에스크로)
--   주문은 record_custom_order_escrow_refund 경로로 반환(이중 credit 방지)" 분기를
--   넣었다. 이후 099 가 같은 함수를 030 본문 기준으로 재작성하며 구독 정산-지급 가드를
--   추가했으나, 그 과정에서 056 의 에스크로 분기가 통째로 소실됐다. 결과적으로 현행
--   함수는 맞춤의뢰 예치 환불을 일반 refund_credit(amount_cents, 멱등키 refund_credit:)
--   경로로 처리한다 — 예치 반환 경로(hold 실액, 멱등키 cr_refund_, cr_payout_ 지급차단)
--   와 정렬되지 않아 잠재적 이중 credit·오지급 반환 구멍이다.
--   ※ 현재는 refunds.custom_request_order_id 를 세팅하는 생성 경로가 없어 '도달 불가'
--     상태지만, 맞춤의뢰/분쟁 환불 흐름이 도입되면 즉시 P0 돈 버그가 된다. 흐름 도입
--     전에 함수를 정본화한다(심층방어).
--
-- 조치: 056(에스크로 분기 + 일반 경로) 을 기준 본문으로 복원하고, 099 의 구독 정산-
--   지급 가드 블록을 그대로 삽입한다. 즉 이 버전은:
--     · 맞춤의뢰 정산 paid → 소프트 거부 (056·099 공통)
--     · 구독 정산 paid(payment_id 매칭) → 소프트 거부 (099)
--     · 맞춤의뢰 + 에스크로 hold 존재 → record_custom_order_escrow_refund 경로(056)
--     · 그 외(구독/비예치 맞춤의뢰) → 일반 refund_credit 경로
--   두 정산 가드 모두 어떤 캐시/원장 변경보다 앞서며, 예치 경로는 hold 실액을 반환한다.
--
-- 성격: 재실행 안전(create or replace). service_role 전용 권한 재적용.
-- 사전 조건: 056(record_custom_order_escrow_refund), 099(직전 함수 정의),
--   086(subscription_settlement_items), 069(refunds.subscription_id/request_type).
-- 검증: 파일 하단 §V.
-- =============================================================================

create or replace function public.approve_refund_request_admin(
  p_refund_id uuid,
  p_admin_id uuid,
  p_admin_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
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
  v_hold_cents bigint;
  v_escrow_refund boolean := false;
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
    return jsonb_build_object(
      'ok', true,
      'noop', true,
      'refund_id', p_refund_id,
      'message', '이미 처리되었거나 대기 상태가 아닙니다.',
      'status', r.status
    );
  end if;

  -- 정산 지급 완료 시 자동 환불 차단 (맞춤의뢰) — 056·099 공통
  if r.custom_request_order_id is not null then
    select s.status into v_settlement_status
    from public.custom_order_settlement_items s
    where s.custom_request_order_id = r.custom_request_order_id
    limit 1;
    if found and v_settlement_status = 'paid' then
      return jsonb_build_object(
        'ok', false,
        'message', '이미 정산 지급이 완료된 건은 자동 환불할 수 없습니다. 수동 조정이 필요합니다.'
      );
    end if;
  end if;

  -- 정산 지급 완료 시 자동 환불 차단 (구독) — 099 추가분 유지
  -- payment_id 매칭: 다기간 구독의 과거 paid 갱신분이 신규 미지급 기간 환불을 오탐 차단하지 않도록.
  if r.payment_id is not null
     and (r.subscription_id is not null
          or coalesce(r.request_type, '') = 'subscription_prorated') then
    select s.status into v_settlement_status
    from public.subscription_settlement_items s
    where s.payment_id = r.payment_id
      and s.status = 'paid'
    limit 1;
    if found then
      return jsonb_build_object(
        'ok', false,
        'message', '이미 멘토 정산 지급이 완료된 구독 건은 자동 환불할 수 없습니다. 수동 조정이 필요합니다.'
      );
    end if;
  end if;

  -- 맞춤의뢰 예치(에스크로) 주문은 escrow refund 경로(이중 credit 방지) — 056 복원
  if r.custom_request_order_id is not null then
    if exists (
      select 1 from public.cash_ledger l
      where l.idempotency_key = 'cr_payout_' || r.custom_request_order_id::text
        and l.reason = 'custom_order_escrow_payout'
    ) then
      return jsonb_build_object(
        'ok', false,
        'message', '이미 정산 지급이 완료된 건은 자동 환불할 수 없습니다. 수동 조정이 필요합니다.'
      );
    end if;

    select abs(l.delta_cents) into v_hold_cents
    from public.cash_ledger l
    where l.idempotency_key = 'cr_hold_' || r.custom_request_order_id::text
      and l.reason = 'custom_order_escrow_hold'
    limit 1;

    if v_hold_cents is not null then
      v_escrow_refund := true;
      begin
        perform public.record_custom_order_escrow_refund(r.custom_request_order_id);
      exception
        when others then
          if sqlerrm like '%ALREADY_PAID_OUT%' or sqlerrm like '%ESCROW_HOLD_MISSING%' then
            return jsonb_build_object('ok', false, 'message', '이미 정산 지급이 완료된 건은 자동 환불할 수 없습니다. 수동 조정이 필요합니다.');
          end if;
          if sqlerrm like '%PAYMENT_NOT_ESCROWED%' then
            return jsonb_build_object('ok', false, 'message', '예치(에스크로) 상태가 아니어서 예치 반환을 할 수 없습니다.');
          end if;
          raise;
      end;
      v_amount := v_hold_cents;
    end if;
  end if;

  if not v_escrow_refund then
    if r.amount_cents is null or r.amount_cents <= 0 then
      raise exception '환불 금액이 설정되지 않아 자동 승인할 수 없습니다.';
    end if;

    v_amount := r.amount_cents;

    if v_amount > 1000000000 then
      return jsonb_build_object('ok', false, 'message', '환불 금액이 허용 한도를 초과합니다.');
    end if;

    -- 정산 예정만 취소 (paid 는 위에서 차단)
    if r.custom_request_order_id is not null then
      update public.custom_order_settlement_items s
      set status = 'cancelled', updated_at = now()
      where s.custom_request_order_id = r.custom_request_order_id
        and s.status in ('pending', 'on_hold', 'payable');
    end if;

    insert into public.cash_ledger (
      user_id, delta_cents, reason, ref_type, ref_id, idempotency_key
    )
    values (
      r.user_id, v_amount, 'refund_approved', 'refunds', r.id, v_idem
    )
    on conflict (idempotency_key) do nothing
    returning id into v_ledger_id;

    if v_ledger_id is null then
      select cl.delta_cents into v_existing_delta
      from public.cash_ledger cl
      where cl.idempotency_key = v_idem
      limit 1;
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

    if r.custom_request_order_id is not null then
      update public.custom_request_orders o
      set payment_status = 'refunded', updated_at = now()
      where o.id = r.custom_request_order_id;
    end if;
  end if;

  update public.refunds
  set
    status = 'succeeded',
    processed_at = now(),
    processed_by = p_admin_id,
    admin_note = p_admin_note,
    updated_at = now()
  where id = r.id;

  if r.payment_id is not null then
    update public.payments p
    set status = 'refunded', updated_at = now()
    where p.id = r.payment_id;
  end if;

  if r.payment_id is not null then
    update public.subscriptions s
    set status = 'canceled', updated_at = now()
    where s.payment_id = r.payment_id
      and s.status is distinct from 'canceled';
  end if;

  return jsonb_build_object(
    'ok', true,
    'noop', false,
    'refund_id', r.id,
    'ledger_inserted', case when v_escrow_refund then true else (v_ledger_id is not null) end,
    'escrow_refund', v_escrow_refund,
    'amount_cents', v_amount,
    'message', '환불이 승인되었습니다.'
  );
end;
$function$;

comment on function public.approve_refund_request_admin(uuid, uuid, text) is
  'XV-REFUND: Admin refund approve — 맞춤의뢰 예치는 record_custom_order_escrow_refund 경로(이중 credit 방지, 056 복원) + 맞춤의뢰/구독 정산 paid 자동환불 차단(099). service_role only.';

-- EXECUTE: service_role 만 (승인 RPC) — 030/099 와 동일 권한 재적용
revoke all on function public.approve_refund_request_admin(uuid, uuid, text) from public;
revoke all on function public.approve_refund_request_admin(uuid, uuid, text) from anon;
revoke all on function public.approve_refund_request_admin(uuid, uuid, text) from authenticated;
grant execute on function public.approve_refund_request_admin(uuid, uuid, text) to service_role;

-- =============================================================================
-- §V. 적용 직후 검증 (Supabase SQL Editor 에서 수동 실행)
-- =============================================================================
-- §V-0. 정의 확인: select proname from pg_proc where proname='approve_refund_request_admin';
-- §V-a. 구독 정산 paid → ok:false(자동환불 차단), 캐시/원장 무변경.
-- §V-b. 맞춤의뢰 예치 hold 존재 → escrow_refund:true, 학생 지갑에 hold 실액 반환,
--        refund_credit: 라인 미생성(cr_refund_ 라인만).
-- §V-c. 비예치 환불 → escrow_refund:false, refund_credit: 경로 amount_cents 반영.
-- =============================================================================
