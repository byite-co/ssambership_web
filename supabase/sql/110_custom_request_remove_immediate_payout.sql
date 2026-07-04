-- =============================================================================
-- 110_custom_request_remove_immediate_payout.sql  ★★★ DRAFT — DB 미적용 / 실행 금지 ★★★
-- =============================================================================
-- 목적(②단계): 맞춤의뢰(CR) 즉시지급 제거 → 후불(23일 배치)로 일원화.
--   현행(090) accept_custom_order_deliverable_atomic 는 납품 수락 시
--     · 주문 completed + settlement(pending) 생성까지 하고
--     · 곧바로 perform record_custom_order_escrow_payout(...) 로 '즉시지급'한다(090:178, 090:208).
--   후불 모델에선 수락=완료사실만(settlement 'pending' 유지), 지급은 108 배치에서.
--   → due_payouts(107) CR 브랜치가 settlement.status in (pending,on_hold,payable) &
--     order.accepted_at not null 인 건을 후보로 잡으므로, 수락만 해두면 배치가 포착한다.
--
-- 변경(초안): 090 본문 verbatim + 즉시지급 2줄(perform/ v_payout_done) 제거.
--   · v_fee_rate=0.05 유지(090). 수수료·정산 생성·멱등·예외수리 로직 전부 동일.
--   · 제거 대상: 090:178-179(정상 경로), 090:208-209(23505 예외 수리 경로)의
--     perform record_custom_order_escrow_payout + v_payout_done := true.
--   · record_custom_order_escrow_payout 함수 자체는 미터치(108 배치가 그대로 호출).
--
-- ⚠️ 미적용 초안. '동작 변경'(즉시지급 제거)이므로 108·109 와 함께 오너 승인 후 적용.
-- 근거: 090(현행 accept), 055(record_custom_order_escrow_payout), 107(CR due 브랜치 54-62).
-- =============================================================================

create or replace function public.accept_custom_order_deliverable_atomic(
  p_order_id uuid,
  p_student_id uuid,
  p_require_payment boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  o public.custom_request_orders%rowtype;
  app public.custom_request_applications%rowtype;
  v_norm text;
  v_pay text;
  v_dispute_cnt integer;
  v_deliverable_cnt integer;
  v_existing_settlement uuid;
  v_gross integer;
  v_platform_fee integer;
  v_mentor_amount integer;
  v_settlement_id uuid;
  v_settlement_created boolean := false;
  v_now timestamptz := now();
  v_fee_rate numeric := 0.05;  -- 252: 맞춤의뢰 수수료 5%(090 유지)
begin
  if p_order_id is null then
    return jsonb_build_object('ok', false, 'message', 'orderId가 필요합니다.');
  end if;
  if p_student_id is null then
    return jsonb_build_object('ok', false, 'message', '학생 ID가 필요합니다.');
  end if;

  select * into o from public.custom_request_orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'message', '주문을 찾을 수 없어요.');
  end if;
  if o.student_id is distinct from p_student_id then
    return jsonb_build_object('ok', false, 'message', '의뢰자(학생) 본인만 납품을 수락할 수 있습니다.');
  end if;

  v_pay := lower(trim(coalesce(nullif(trim(o.payment_status), ''), '')));
  if p_require_payment and v_pay not in ('paid', 'escrowed') then
    return jsonb_build_object('ok', false, 'message', '결제(예치)가 완료되지 않은 주문은 수락할 수 없습니다.');
  end if;

  if o.completed_at is not null or o.closed_at is not null or o.finished_at is not null
     or lower(trim(coalesce(o.status, ''))) in ('completed','accepted','closed','finished','cancelled','canceled','refunded','rejected','done','resolved','dispute_resolved')
     or lower(trim(coalesce(o.state, ''))) in ('completed','accepted','closed','finished','cancelled','canceled','refunded','rejected','done','resolved','dispute_resolved')
     or lower(trim(coalesce(o.order_status, ''))) in ('completed','accepted','closed','finished','cancelled','canceled','refunded','rejected','done','resolved','dispute_resolved')
  then
    return jsonb_build_object('ok', false, 'message', '이미 완료된 주문입니다.');
  end if;

  v_norm := public._order_primary_status_norm(o);
  if v_norm = '' then
    return jsonb_build_object('ok', false, 'message', '주문 상태를 확인할 수 없어 수락할 수 없습니다.');
  end if;
  if v_norm not in ('delivered','delivered_pending_review','waiting_review','pending_review','redelivered','delivery_submitted','in_review') then
    return jsonb_build_object('ok', false, 'message', format('현재 상태(%s)에서는 납품 수락을 할 수 없습니다.', v_norm));
  end if;

  select count(*)::integer into v_dispute_cnt
  from public.disputes d
  where d.custom_request_order_id = p_order_id and d.status in ('open', 'under_review', 'escalated');
  if v_dispute_cnt > 0 then
    return jsonb_build_object('ok', false, 'message', '진행 중인 분쟁이 있어 납품 수락을 할 수 없습니다.');
  end if;

  select count(*)::integer into v_deliverable_cnt
  from public.custom_order_deliverables d where d.custom_request_order_id = p_order_id;
  if v_deliverable_cnt < 1 then
    return jsonb_build_object('ok', false, 'message', '등록된 납품이 없어 수락할 수 없습니다.');
  end if;

  select id into v_existing_settlement
  from public.custom_order_settlement_items s where s.custom_request_order_id = p_order_id;

  select a.* into app from public.custom_request_applications a
  where a.id = coalesce(o.application_id, o.custom_request_application_id, o.selected_application_id) limit 1;

  if v_existing_settlement is null then
    v_gross := public._pick_custom_order_gross_won(o, app);
    if v_gross is not null and v_gross > 0 then
      v_platform_fee := floor(v_gross * v_fee_rate)::integer;
      v_mentor_amount := v_gross - v_platform_fee;
      insert into public.custom_order_settlement_items (
        custom_request_order_id, mentor_id, student_id, gross_amount,
        platform_fee_amount, mentor_amount, fee_rate, status
      ) values (
        p_order_id, o.mentor_id, o.student_id, v_gross,
        v_platform_fee, v_mentor_amount, v_fee_rate, 'pending'
      ) returning id into v_settlement_id;
      v_settlement_created := true;
    end if;
  else
    v_settlement_id := v_existing_settlement;
  end if;

  update public.custom_request_orders
  set status = 'completed', state = 'completed', order_status = 'completed',
      accepted_at = coalesce(accepted_at, v_now), completed_at = coalesce(completed_at, v_now), updated_at = v_now
  where id = p_order_id;

  -- [110 제거] 즉시지급 없음. settlement 는 'pending' 유지 → 108 배치(23일)가 지급.
  --   (구 090:178-179 perform record_custom_order_escrow_payout + v_payout_done 제거)

  return jsonb_build_object(
    'ok', true,
    'settlement_created', v_settlement_created,
    'settlement_id', v_settlement_id,
    'gross', v_gross,
    'fee_rate', v_fee_rate,
    'payout_done', false,           -- 후불: 수락 시점 미지급
    'payout_deferred', true
  );
exception
  when others then
    if sqlstate = '23505' then
      select id into v_existing_settlement
      from public.custom_order_settlement_items s where s.custom_request_order_id = p_order_id;

      update public.custom_request_orders
      set status = 'completed', state = 'completed', order_status = 'completed',
          accepted_at = coalesce(accepted_at, v_now), completed_at = coalesce(completed_at, v_now), updated_at = v_now
      where id = p_order_id;

      -- [110 제거] 예외 수리 경로도 즉시지급 안 함(구 090:208-209 제거).
      return jsonb_build_object(
        'ok', true,
        'settlement_created', false,
        'settlement_id', v_existing_settlement,
        'payout_done', false,
        'payout_deferred', true,
        'reason', 'already_exists'
      );
    end if;
    raise;
end;
$function$;

comment on function public.accept_custom_order_deliverable_atomic(uuid, uuid, boolean) is
  '110[DRAFT]: 납품 수락 = 주문 completed + settlement(pending)만. 즉시지급 제거 → 지급은 108 배치(23일). fee 5% 유지. service_role only.';

revoke all on function public.accept_custom_order_deliverable_atomic(uuid, uuid, boolean) from public;
grant execute on function public.accept_custom_order_deliverable_atomic(uuid, uuid, boolean) to service_role;
