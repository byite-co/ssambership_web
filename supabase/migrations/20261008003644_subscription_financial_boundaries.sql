-- Subscription writes: DB price authority and atomic billing. Old RPC contracts stay callable.
begin;
set local lock_timeout = '5s';

create or replace function core_private.record_initial_subscription_billing_event(
  p_payment_id uuid, p_subscription_id uuid, p_set_latest boolean default false
) returns uuid language plpgsql security invoker set search_path = '' as $fn$
declare
  p public.payments%rowtype; s public.subscriptions%rowtype; l public.cash_ledger%rowtype;
  e public.subscription_billing_events%rowtype;
  v_tier text; v_key text := 'sub_initial:' || p_subscription_id::text;
  v_start timestamptz; v_end timestamptz;
begin
  select * into strict p from public.payments where id = p_payment_id;
  select * into strict s from public.subscriptions where id = p_subscription_id for update;
  select * into l from public.cash_ledger where idempotency_key = 'sub_debit_' || p_payment_id::text;
  if l.id is null or l.user_id is distinct from p.user_id or l.ref_id is distinct from s.id
     or l.ref_type is distinct from 'subscriptions' or l.reason is distinct from 'subscription_payment'
     or l.delta_cents is distinct from -(p.amount * 100)::bigint
     or s.student_id is distinct from p.user_id or s.mentor_id is distinct from p.mentor_id
     or p.status not in ('succeeded','paid','success','complete','captured') then
    raise exception 'BILLING_EVENT_BINDING_MISMATCH';
  end if;
  select plan_tier into v_tier from public.mentor_plans where id = p.plan_id and mentor_id = p.mentor_id;
  if v_tier is null then raise exception 'PLAN_BINDING_MISMATCH'; end if;
  select * into e from public.subscription_billing_events
    where payment_id = p.id and event_type = 'initial' order by created_at, id limit 1;
  if e.id is not null then
    if e.subscription_id is distinct from s.id or e.ledger_id is distinct from l.id
       or e.amount_cents is distinct from -l.delta_cents or e.plan_id is distinct from p.plan_id
       or e.status not in ('succeeded', 'refunded') then
      raise exception 'BILLING_EVENT_BINDING_MISMATCH';
    end if;
    return e.id;
  end if;
  -- Preserve the previous payment's event on reactivation. The current payment keeps the
  -- legacy key so web versions still doing their post-RPC upsert remain compatible.
  update public.subscription_billing_events
     set idempotency_key = v_key || ':' || payment_id::text
   where idempotency_key = v_key and payment_id is not null and payment_id <> p.id;
  if exists (select 1 from public.subscription_billing_events where idempotency_key = v_key) then
    raise exception 'BILLING_EVENT_BINDING_MISMATCH';
  end if;
  v_start := case when s.last_payment_id = p.id then coalesce(s.current_period_start,l.created_at) else l.created_at end;
  v_end := case when s.last_payment_id = p.id then s.current_period_end else null end;
  v_end := coalesce(v_end, ((v_start at time zone 'Asia/Seoul' + interval '1 month') at time zone 'Asia/Seoul'));
  insert into public.subscription_billing_events
    (subscription_id,student_id,mentor_id,event_type,status,period_start,period_end,billing_at,
     amount_cents,plan_tier,plan_id,idempotency_key,ledger_id,payment_id,processed_at)
  values (s.id,p.user_id,p.mentor_id,'initial','succeeded',v_start,v_end,l.created_at,
          -l.delta_cents,v_tier,p.plan_id,v_key,l.id,p.id,l.created_at)
  returning * into e;
  if p_set_latest and s.last_payment_id = p.id then
    update public.subscriptions set last_billing_event_id = e.id where id = s.id;
  end if;
  return e.id;
end $fn$;
revoke all on function core_private.record_initial_subscription_billing_event(uuid,uuid,boolean) from public,anon,authenticated,service_role;

do $gate$ begin if md5(replace(pg_get_functiondef('api_web_v1.subscription_checkout_confirm_v2(uuid,uuid,integer,text)'::regprocedure),chr(13),'')) <> '8655ffd516d3a4034a465eb15c1061c2' then raise exception 'FINANCIAL_SOURCE_DRIFT: api_web_v1.subscription_checkout_confirm_v2'; end if; end $gate$;
do $gate$ begin if md5(replace(pg_get_functiondef('api_app_v1.subscribe_with_cash(uuid,text,text)'::regprocedure),chr(13),'')) <> '1fa39311718b47163783362daecaff9d' then raise exception 'FINANCIAL_SOURCE_DRIFT: api_app_v1.subscribe_with_cash'; end if; end $gate$;
CREATE OR REPLACE FUNCTION core_private.subscription_checkout_confirm_impl(p_payment_id uuid, p_plan_id uuid, p_expected_amount_cents integer, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO ''
AS $function$
DECLARE
  v_succeeded    constant text[] := array['succeeded','paid','success','complete','captured'];
  -- 정본 confirm_subscription_checkout raise 17종(§9.8 — 동명 envelope 변환)
  v_canon_raises constant text[] := array[
    'PAYMENT_NOT_FOUND','PAYMENT_NO_USER','PAYMENT_NO_MENTOR','PAYMENT_KIND_INVALID',
    'PLAN_NOT_FOUND','PLAN_MENTOR_MISMATCH','PLAN_AMOUNT_INVALID',
    'PAYMENT_PROCESSING','PAYMENT_NOT_PENDING','PAYMENT_STATE_UNEXPECTED','PAYMENT_STALE',
    'ACCOUNT_BANNED','ACCOUNT_SUSPENDED',
    'MENTOR_NOT_OPEN_FOR_SUBSCRIPTIONS','MENTOR_NOT_APPROVED','PLAN_INACTIVE','MENTOR_CAP_EXCEEDED'];
  p_rec          record;      -- P = 이번 호출 payment
  v_sub          record;      -- 잠근 subscription
  v_led          record;      -- P 자신의 sub_debit_ 원장 행
  v_c            record;      -- C = subscription.last_payment_id 가 가리키는 payment
  v_room         record;
  v_intent       bigint;      -- 결제 시점 불변 동의 금액 = payments.amount × 100
  v_plan_amount  integer;
  v_anom         uuid;
  v_canon        jsonb;
  v_roomres      jsonb;
  v_room_id      uuid;
  v_sub_id       uuid;
  v_room_found   boolean := false;
  v_room_new_sub uuid;        -- Phase 2 보정 후보(subscription_id)
  v_room_new_pay uuid;        -- Phase 2 보정 후보(payment_id)
  v_room_dirty   boolean := false;
BEGIN
  IF p_payment_id IS NULL OR p_plan_id IS NULL OR p_expected_amount_cents IS NULL THEN
    RAISE EXCEPTION 'p_payment_id, p_plan_id, p_expected_amount_cents are required';
  END IF;

  -- 1) payments FOR UPDATE — §12.2/[C3]: 레거시와 동일하게 payments 를 먼저 잠근다
  SELECT p.id, p.user_id, p.mentor_id, p.status, p.kind, p.amount, p.currency, p.plan_id
    INTO p_rec
    FROM public.payments p WHERE p.id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'PAYMENT_NOT_FOUND');
  END IF;
  IF p_rec.user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'PAYMENT_NO_USER');
  END IF;
  IF p_rec.mentor_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'PAYMENT_NO_MENTOR');
  END IF;
  -- 결제 시점 불변 동의 금액 검증(§7 F12 — 구현 결정: 사전 동명 재사용, anomaly 미기록)
  IF p_rec.kind IS DISTINCT FROM 'subscription' THEN
    RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'PAYMENT_KIND_INVALID');
  END IF;
  IF p_rec.currency IS DISTINCT FROM 'KRW'
     OR p_rec.amount IS NULL OR p_rec.amount <= 0 OR p_rec.amount <> trunc(p_rec.amount) THEN
    RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'PAYMENT_STATE_UNEXPECTED');
  END IF;
  v_intent := (p_rec.amount * 100)::bigint;

  -- 2) 재생 판정 — succeeded 계열이면 재생 계약(Phase 1/2)으로 분기(정본 재호출 금지)
  IF p_rec.status = ANY(v_succeeded) THEN
    -- ── Phase 1: 검증 전용 (business-state 쓰기 금지 · anomaly INSERT 만 허용) ──
    -- 1·2. subscription 행 확인·잠금 (최신 결제 정본은 오직 last_payment_id — 추론 금지)
    SELECT s.id, s.student_id, s.mentor_id, s.last_payment_id
      INTO v_sub
      FROM public.subscriptions s
     WHERE s.student_id = p_rec.user_id AND s.mentor_id = p_rec.mentor_id
     FOR UPDATE;
    IF NOT FOUND THEN
      INSERT INTO public.subscription_checkout_anomalies(payment_id, subscription_id, code, detail)
      VALUES (p_payment_id, NULL, 'SUCCEEDED_NO_SUBSCRIPTION', 'F12 replay: succeeded payment without subscription')
      RETURNING id INTO v_anom;
      RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'SUCCEEDED_NO_SUBSCRIPTION', 'anomaly_id', v_anom);
    END IF;
    -- 3. P 자신의 원장 행 확인
    SELECT l.user_id, l.delta_cents, l.reason, l.ref_type, l.ref_id
      INTO v_led
      FROM public.cash_ledger l
     WHERE l.idempotency_key = 'sub_debit_' || p_payment_id::text;
    IF NOT FOUND THEN
      INSERT INTO public.subscription_checkout_anomalies(payment_id, subscription_id, code, detail)
      VALUES (p_payment_id, v_sub.id, 'SUCCEEDED_NO_LEDGER', 'F12 replay: succeeded payment without ledger debit')
      RETURNING id INTO v_anom;
      RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'SUCCEEDED_NO_LEDGER', 'anomaly_id', v_anom);
    END IF;
    -- 4. P 의 payment–plan 결속 (필수 관계 — NULL 은 일치가 아니라 명시 거부)
    IF p_rec.plan_id IS NULL OR p_rec.plan_id <> p_plan_id THEN
      INSERT INTO public.subscription_checkout_anomalies(payment_id, subscription_id, code, detail, expected, found)
      VALUES (p_payment_id, v_sub.id, 'PLAN_BINDING_MISMATCH', 'F12 replay: payments.plan_id <> p_plan_id',
              jsonb_build_object('plan_id', p_plan_id), jsonb_build_object('plan_id', p_rec.plan_id))
      RETURNING id INTO v_anom;
      RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'PLAN_BINDING_MISMATCH', 'anomaly_id', v_anom);
    END IF;
    -- 5. P 의 payment–subscription 당사자 결속
    IF p_rec.user_id <> v_sub.student_id OR p_rec.mentor_id <> v_sub.mentor_id THEN
      INSERT INTO public.subscription_checkout_anomalies(payment_id, subscription_id, code, detail)
      VALUES (p_payment_id, v_sub.id, 'PARTY_BINDING_MISMATCH', 'F12 replay: P party mismatch')
      RETURNING id INTO v_anom;
      RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'PARTY_BINDING_MISMATCH', 'anomaly_id', v_anom);
    END IF;
    -- 6. ledger–subscription 결속 (필수 관계 — NULL 명시 거부)
    IF v_led.user_id IS NULL OR v_led.user_id <> p_rec.user_id
       OR v_led.ref_id IS NULL OR v_led.ref_id <> v_sub.id THEN
      INSERT INTO public.subscription_checkout_anomalies(payment_id, subscription_id, code, detail, expected, found)
      VALUES (p_payment_id, v_sub.id, 'LEDGER_BINDING_MISMATCH', 'F12 replay: ledger user/ref binding mismatch',
              jsonb_build_object('user_id', p_rec.user_id, 'ref_id', v_sub.id),
              jsonb_build_object('user_id', v_led.user_id, 'ref_id', v_led.ref_id))
      RETURNING id INTO v_anom;
      RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'LEDGER_BINDING_MISMATCH', 'anomaly_id', v_anom);
    END IF;
    -- 7. 원장 필드값 대조 — 기준은 결제 시점 불변 동의 금액(payments.amount×100).
    --    현재 플랜 가격을 읽지 않는다(가격 변경 후 정당한 재시도 오탐 금지 — T-CONC-09).
    IF v_led.delta_cents IS DISTINCT FROM -v_intent
       OR coalesce(v_led.reason, '') <> 'subscription_payment'
       OR coalesce(v_led.ref_type, '') <> 'subscriptions' THEN
      INSERT INTO public.subscription_checkout_anomalies(payment_id, subscription_id, code, detail, expected, found)
      VALUES (p_payment_id, v_sub.id, 'LEDGER_FIELD_MISMATCH', 'F12 replay: ledger field mismatch vs intent amount',
              jsonb_build_object('user_id', p_rec.user_id, 'ref_id', v_sub.id, 'ref_type', 'subscriptions',
                                 'reason', 'subscription_payment', 'delta_cents', -v_intent),
              jsonb_build_object('user_id', v_led.user_id, 'ref_id', v_led.ref_id, 'ref_type', v_led.ref_type,
                                 'reason', v_led.reason, 'delta_cents', v_led.delta_cents))
      RETURNING id INTO v_anom;
      RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'LEDGER_FIELD_MISMATCH', 'anomaly_id', v_anom);
    END IF;
    -- 8. C = subscription.last_payment_id 유효성 (detail 은 anomaly 에만 — 코드는 1종 고정)
    IF v_sub.last_payment_id IS NULL THEN
      INSERT INTO public.subscription_checkout_anomalies(payment_id, subscription_id, code, detail)
      VALUES (p_payment_id, v_sub.id, 'SUBSCRIPTION_REF_INVALID', 'LAST_PAYMENT_ID_NULL')
      RETURNING id INTO v_anom;
      RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'SUBSCRIPTION_REF_INVALID', 'anomaly_id', v_anom);
    END IF;
    SELECT p2.id, p2.user_id, p2.mentor_id, p2.status
      INTO v_c FROM public.payments p2 WHERE p2.id = v_sub.last_payment_id;
    IF NOT FOUND THEN
      INSERT INTO public.subscription_checkout_anomalies(payment_id, subscription_id, code, detail)
      VALUES (p_payment_id, v_sub.id, 'SUBSCRIPTION_REF_INVALID', 'LAST_PAYMENT_NOT_FOUND')
      RETURNING id INTO v_anom;
      RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'SUBSCRIPTION_REF_INVALID', 'anomaly_id', v_anom);
    END IF;
    IF NOT (v_c.status = ANY(v_succeeded)) THEN
      INSERT INTO public.subscription_checkout_anomalies(payment_id, subscription_id, code, detail)
      VALUES (p_payment_id, v_sub.id, 'SUBSCRIPTION_REF_INVALID', 'LAST_PAYMENT_NOT_SUCCEEDED')
      RETURNING id INTO v_anom;
      RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'SUBSCRIPTION_REF_INVALID', 'anomaly_id', v_anom);
    END IF;
    -- C 당사자 불일치는 8단계 PARTY_BINDING_MISMATCH (LEDGER_BINDING 으로 뭉개지 않는다)
    IF v_c.user_id IS NULL OR v_c.user_id <> v_sub.student_id
       OR v_c.mentor_id IS NULL OR v_c.mentor_id <> v_sub.mentor_id THEN
      INSERT INTO public.subscription_checkout_anomalies(payment_id, subscription_id, code, detail)
      VALUES (p_payment_id, v_sub.id, 'PARTY_BINDING_MISMATCH', 'F12 replay: C party mismatch')
      RETURNING id INTO v_anom;
      RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'PARTY_BINDING_MISMATCH', 'anomaly_id', v_anom);
    END IF;
    -- 9. room 참조 판정 (쓰기 없음 — 보정 예정값 후보만 계산)
    SELECT r.id, r.subscription_id, r.payment_id
      INTO v_room
      FROM public.mentor_student_rooms r
     WHERE r.student_id = v_sub.student_id AND r.mentor_id = v_sub.mentor_id
     FOR UPDATE;
    v_room_found := FOUND;
    IF v_room_found THEN
      IF v_room.subscription_id IS NULL THEN
        v_room_new_sub := v_sub.id; v_room_dirty := true;
      ELSIF v_room.subscription_id <> v_sub.id THEN
        INSERT INTO public.subscription_checkout_anomalies(payment_id, subscription_id, code, detail, expected, found)
        VALUES (p_payment_id, v_sub.id, 'ROOM_REF_MISMATCH', 'F12 replay: room.subscription_id conflict',
                jsonb_build_object('subscription_id', v_sub.id),
                jsonb_build_object('subscription_id', v_room.subscription_id))
        RETURNING id INTO v_anom;
        RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'ROOM_REF_MISMATCH', 'anomaly_id', v_anom);
      ELSE
        v_room_new_sub := v_room.subscription_id;
      END IF;
      IF v_room.payment_id IS NULL THEN
        v_room_new_pay := v_sub.last_payment_id; v_room_dirty := true;                  -- NULL → C 로 복구 후보
      ELSIF v_room.payment_id = v_sub.last_payment_id THEN
        v_room_new_pay := v_room.payment_id;                                            -- C 동일 → 유지
      ELSIF v_room.payment_id = p_payment_id AND p_payment_id <> v_sub.last_payment_id THEN
        v_room_new_pay := v_sub.last_payment_id; v_room_dirty := true;                  -- stale → C 로 교체 후보
      ELSE
        INSERT INTO public.subscription_checkout_anomalies(payment_id, subscription_id, code, detail, expected, found)
        VALUES (p_payment_id, v_sub.id, 'ROOM_REF_MISMATCH', 'F12 replay: room.payment_id references third payment',
                jsonb_build_object('payment_id_c', v_sub.last_payment_id, 'payment_id_p', p_payment_id),
                jsonb_build_object('payment_id', v_room.payment_id))
        RETURNING id INTO v_anom;
        RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'ROOM_REF_MISMATCH', 'anomaly_id', v_anom);
      END IF;
    END IF;

    -- ── Phase 2: 검증 전부 통과 후에만 room 확보·보정 (참조 복구 — 자금 반복 0) ──
    BEGIN
      IF NOT v_room_found THEN
        v_roomres := core_private.ensure_student_mentor_room(
                       v_sub.student_id, v_sub.mentor_id,
                       p_payment_id => v_sub.last_payment_id,
                       p_subscription_id => v_sub.id,
                       p_require_entitlement => false);
        IF NOT coalesce((v_roomres->>'ok')::boolean, false) THEN
          RAISE EXCEPTION 'S2_M9_ROOM_STEP_FAILED';
        END IF;
        v_room_id := (v_roomres->>'room_id')::uuid;
        -- 동시 생성 경합 포함 재확인: NULL 참조만 채운다(F10 은 기존 방 참조를 덮어쓰지 않음)
        UPDATE public.mentor_student_rooms r
           SET subscription_id = coalesce(r.subscription_id, v_sub.id),
               payment_id      = coalesce(r.payment_id, v_sub.last_payment_id)
         WHERE r.id = v_room_id;
      ELSE
        v_room_id := v_room.id;
        IF v_room_dirty THEN
          UPDATE public.mentor_student_rooms r
             SET subscription_id = v_room_new_sub,
                 payment_id      = v_room_new_pay
           WHERE r.id = v_room_id;
        END IF;
      END IF;
      PERFORM core_private.record_initial_subscription_billing_event(p_payment_id, v_sub.id, false);
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM = 'BILLING_EVENT_BINDING_MISMATCH' THEN RAISE; END IF;
      -- 운영 오류(9단계와 별도): 자금·원장·구독·결제 성공 상태는 건드리지 않고,
      -- room 부분 변경은 이 블록에서 롤백되며, 재시도 가능하다(§7 F12 재생 결과)
      RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'ROOM_ENSURE_FAILED');
    END;

    RETURN jsonb_build_object('ok', true, 'contract_version', 1, 'idempotent', true,
                              'subscription_id', v_sub.id, 'payment_status', 'succeeded',
                              'room_id', v_room_id);
  END IF;

  -- ── 최초 실행 경로 ──
  -- 3) advisory (정본과 동일 인자 형식 — 전환기 잠금 순서 일치 [C3])
  PERFORM pg_advisory_xact_lock(hashtext(p_rec.user_id::text), hashtext(p_rec.mentor_id::text));
  -- 4) mentor_plans FOR UPDATE — 5)~6) 내내 유지되어 TOCTOU 차단(멘토 UPDATE 대기, T-CONC-04)
  SELECT mp.amount_cents INTO v_plan_amount
    FROM public.mentor_plans mp WHERE mp.id = p_plan_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'PLAN_NOT_FOUND');
  END IF;
  -- 5) 3자 일치: payments.amount×100 = p_expected_amount_cents = 잠근 amount_cents
  IF v_intent <> p_expected_amount_cents OR v_intent <> v_plan_amount THEN
    RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'PLAN_AMOUNT_CHANGED',
                              'expected_amount_cents', p_expected_amount_cents,
                              'actual_amount_cents', v_plan_amount);
  END IF;
  -- 6)~7) 정본 호출 + 방 확보 — 한 subtransaction: 방 확보 실패 시 자금·원장·구독·
  --       결제 변경 전부 롤백(rev 8 A-2 §3). 정본 raise 는 잡아 동명 envelope 변환.
  BEGIN
    v_canon := public.confirm_subscription_checkout(p_payment_id, p_plan_id, p_idempotency_key);
    IF NOT coalesce((v_canon->>'ok')::boolean, false) THEN
      -- 정본 envelope 실패(CASH_INSUFFICIENT·anomaly 계열): 금융 변경은 정본 내부에서
      -- 이미 롤백됨 — anomaly 행만 유지한 채 그대로 승격 반환
      RETURN v_canon || jsonb_build_object('contract_version', 1);
    END IF;
    v_sub_id := (v_canon->>'subscription_id')::uuid;
    v_roomres := core_private.ensure_student_mentor_room(
                   p_rec.user_id, p_rec.mentor_id,
                   p_payment_id => p_payment_id,
                   p_subscription_id => v_sub_id,
                   p_require_entitlement => false);
    IF NOT coalesce((v_roomres->>'ok')::boolean, false) THEN
      RAISE EXCEPTION 'S2_M9_ROOM_STEP_FAILED';
    END IF;
    v_room_id := (v_roomres->>'room_id')::uuid;
    -- room 참조 규칙(신규 결제 — §7 F12 표): pair 불변 · subscription_id NULL 이면
    -- 채움/다른 값이면 거부 · payment_id 는 현재 결제로 갱신(최신 참조 의미론)
    SELECT r.id, r.subscription_id, r.payment_id INTO v_room
      FROM public.mentor_student_rooms r WHERE r.id = v_room_id FOR UPDATE;
    IF v_room.subscription_id IS NOT NULL AND v_room.subscription_id <> v_sub_id THEN
      RAISE EXCEPTION 'S2_M9_ROOM_REF_CONFLICT';
    END IF;
    UPDATE public.mentor_student_rooms r
       SET subscription_id = coalesce(r.subscription_id, v_sub_id),
           payment_id      = p_payment_id
     WHERE r.id = v_room_id;
    PERFORM core_private.record_initial_subscription_billing_event(p_payment_id, v_sub_id, true);
  EXCEPTION WHEN OTHERS THEN
    IF sqlerrm LIKE '%S2_M9_ROOM_REF_CONFLICT%' THEN
      -- 초기 경로 room 참조 충돌 = 거부(§7 F12 표) — 자금 변경은 위 블록에서 전부 롤백됨
      INSERT INTO public.subscription_checkout_anomalies(payment_id, subscription_id, code, detail)
      VALUES (p_payment_id, v_sub_id, 'ROOM_REF_MISMATCH', 'F12 initial: room.subscription_id conflict')
      RETURNING id INTO v_anom;
      RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'ROOM_REF_MISMATCH', 'anomaly_id', v_anom);
    ELSIF sqlerrm LIKE '%S2_M9_ROOM_STEP_FAILED%' THEN
      RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'ROOM_ENSURE_FAILED');
    ELSIF sqlerrm = ANY(v_canon_raises) THEN
      RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', sqlerrm);
    ELSE
      RAISE;  -- 사전 밖 예외는 그대로 전파(§8.2)
    END IF;
  END;

  -- 8) 성공: 기존 정본 반환 + contract_version + room_id (§8.3 F12 행)
  RETURN v_canon || jsonb_build_object('contract_version', 1, 'room_id', v_room_id);
END $function$
;
revoke all on function core_private.subscription_checkout_confirm_impl(uuid,uuid,integer,text) from public,anon,authenticated,service_role;

create or replace function api_web_v1.subscription_checkout_confirm_v2(p_payment_id uuid,p_plan_id uuid,p_expected_amount_cents integer,p_idempotency_key text default null)
 returns jsonb language sql security definer set search_path = '' as $fn$
 select core_private.subscription_checkout_confirm_impl(p_payment_id,p_plan_id,p_expected_amount_cents,p_idempotency_key)
 $fn$;
 revoke all on function api_web_v1.subscription_checkout_confirm_v2(uuid,uuid,integer,text) from public,anon,authenticated;
 grant execute on function api_web_v1.subscription_checkout_confirm_v2(uuid,uuid,integer,text) to service_role;

create or replace function api_web_v1.subscription_checkout_confirm_v3(p_payment_id uuid,p_plan_id uuid,p_expected_amount_cents integer,p_idempotency_key text default null)
 returns jsonb language sql security definer set search_path = '' as $fn$
 select core_private.subscription_checkout_confirm_impl(p_payment_id,p_plan_id,p_expected_amount_cents,p_idempotency_key)
 $fn$;
 revoke all on function api_web_v1.subscription_checkout_confirm_v3(uuid,uuid,integer,text) from public,anon,authenticated;
 grant execute on function api_web_v1.subscription_checkout_confirm_v3(uuid,uuid,integer,text) to service_role;
CREATE OR REPLACE FUNCTION api_app_v1.subscribe_with_cash(p_mentor_id uuid, p_tier text, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := (select auth.uid());
  v_tier text := lower(btrim(coalesce(p_tier, '')));
  v_key text := btrim(coalesce(p_idempotency_key, ''));
  v_ext text;
  v_succeeded constant text[] := array['succeeded','paid','success','complete','captured'];
  -- 롤백 후에도 운영 진단을 위해 anomaly 를 다시 기록할 코드(정본·F12 anomaly 계열)
  v_anomaly_codes constant text[] := array['FINANCIAL_WRITE_ERROR','LEDGER_FIELD_MISMATCH','ROOM_ENSURE_FAILED','ROOM_REF_MISMATCH',
    'PLAN_AMOUNT_CHANGED','SUCCEEDED_NO_SUBSCRIPTION','SUCCEEDED_NO_LEDGER','PLAN_BINDING_MISMATCH','PARTY_BINDING_MISMATCH',
    'LEDGER_BINDING_MISMATCH','SUBSCRIPTION_REF_INVALID','LEDGER_AMOUNT_MISMATCH'];
  v_role text; v_status text; v_susp timestamptz; v_norm text;
  v_mrole text;
  v_act text; v_pause_until timestamptz; v_open boolean;
  v_dup uuid;
  v_plan_id uuid; v_plan_active boolean; v_amount integer;
  v_cap_used numeric; v_cap_limit numeric; v_cap_weight numeric;
  v_balance bigint;
  v_pay record;
  v_payment_id uuid;
  v_res jsonb;
  v_abort_code text;
  v_abort_detail jsonb;
  v_sub_id uuid; v_room_id uuid; v_reactivated boolean;
  v_sub record; v_ledger record;
  v_period_start timestamptz; v_period_end timestamptz;
  v_event_id uuid;
  v_balance_after bigint;
  v_result jsonb;
  v_anom uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'AUTH_REQUIRED');
  end if;
  if p_mentor_id is null then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'MENTOR_NOT_FOUND');
  end if;
  if v_tier not in ('limited', 'standard', 'premium') then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'PLAN_TIER_INVALID');
  end if;
  if v_key = '' or char_length(v_key) > 128 then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'IDEMPOTENCY_KEY_INVALID');
  end if;
  v_ext := 'sub_app_' || v_key;

  -- 직렬화: (학생, 키) — 같은 키 동시 재시도는 첫 호출 커밋 뒤 재생으로 수렴 · (학생, 멘토) — 정본과 같은 pair 잠금(재진입)
  perform pg_advisory_xact_lock(hashtext('app_sub_key:' || v_uid::text), hashtext(v_key));
  perform pg_advisory_xact_lock(hashtext(v_uid::text), hashtext(p_mentor_id::text));

  -- 멱등 재생 — 성공한 첫 결과를 그대로(차감 0). 실패 시도는 행을 남기지 않으므로 여기 오면 성공 행뿐이다.
  select p.id, p.status, p.mentor_id, p.metadata into v_pay
    from public.payments p
   where p.user_id = v_uid and p.external_id = v_ext
   order by p.created_at desc
   limit 1
   for update;
  if found then
    if v_pay.status = any(v_succeeded) and (v_pay.metadata ? 'app_result') then
      if v_pay.mentor_id is distinct from p_mentor_id or (v_pay.metadata ->> 'planTier') is distinct from v_tier then
        return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'IDEMPOTENCY_KEY_CONFLICT',
                                  'payment_id', v_pay.id);
      end if;
      return (v_pay.metadata -> 'app_result') || jsonb_build_object('idempotent', true);
    end if;
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'IDEMPOTENCY_KEY_CONFLICT',
                              'payment_id', v_pay.id, 'payment_status', v_pay.status);
  end if;

  -- 학생 · 계정 상태 (F10·정본과 동일 판정식)
  select u.role, u.status, u.suspended_until into v_role, v_status, v_susp from public.users u where u.id = v_uid;
  if not found or v_role is distinct from 'student' then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'ROLE_NOT_STUDENT');
  end if;
  v_norm := lower(btrim(coalesce(v_status, '')));
  if v_norm = 'banned' then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'ACCOUNT_BANNED');
  end if;
  if v_norm = 'suspended' and (v_susp is null or v_susp > now()) then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'ACCOUNT_SUSPENDED');
  end if;
  if v_norm not in ('active', 'suspended') then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'ACCOUNT_NOT_ACTIVE');
  end if;
  if public.account_deletion_write_blocked(v_uid) then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'ACCOUNT_DELETION_IN_PROGRESS');
  end if;

  -- 멘토: 역할 · 승인 · 활동 상태(웹 mentorActivityState 동일) · 구독 열림
  select u.role into v_mrole from public.users u where u.id = p_mentor_id;
  if not found or v_mrole is distinct from 'mentor' then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'MENTOR_NOT_FOUND');
  end if;
  if not public.individual_question_user_is_approved_mentor(p_mentor_id) then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'MENTOR_NOT_APPROVED');
  end if;
  select mp.activity_status, mp.pause_until, mp.is_open_for_subscriptions into v_act, v_pause_until, v_open
    from public.mentor_profiles mp where mp.user_id = p_mentor_id;
  if not found then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'MENTOR_NOT_FOUND');
  end if;
  v_act := lower(btrim(coalesce(v_act, 'active')));
  if v_act in ('terminating', 'terminated') then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'MENTOR_TERMINATED');
  end if;
  if v_act = 'paused' and (v_pause_until is null or v_pause_until > now()) then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'MENTOR_PAUSED', 'pause_until', v_pause_until);
  end if;
  if not coalesce(v_open, true) then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'MENTOR_NOT_OPEN_FOR_SUBSCRIPTIONS');
  end if;
  -- 상호 차단(F10 ③ 과 같은 판정) — 웹은 이 경우 F12 의 방 확보 단계에서 ROOM_ENSURE_FAILED 로 실패한다(차감 0). 앱에는 코드로 먼저 알린다.
  if exists (select 1 from public.user_blocks b
              where (b.blocker_id = v_uid and b.blocked_id = p_mentor_id) or (b.blocker_id = p_mentor_id and b.blocked_id = v_uid)) then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'BLOCKED');
  end if;

  -- 중복 구독 (활성 pair 1행 모델)
  select s.id into v_dup from public.subscriptions s
   where s.student_id = v_uid and s.mentor_id = p_mentor_id and lower(coalesce(s.status, '')) = 'active';
  if v_dup is not null then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'ALREADY_SUBSCRIBED', 'subscription_id', v_dup);
  end if;

  -- 요금제 행 = 실차감액 (멘토가 정한 값 · 잠금은 F12 가 다시 건다)
  select mp.id, mp.is_active, mp.amount_cents into v_plan_id, v_plan_active, v_amount
    from public.mentor_plans mp where mp.mentor_id = p_mentor_id and mp.plan_tier = v_tier;
  if not found then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'PLAN_NOT_FOUND', 'plan_tier', v_tier);
  end if;
  if not coalesce(v_plan_active, true) then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'PLAN_INACTIVE', 'plan_tier', v_tier);
  end if;
  if v_amount is null or v_amount <= 0 or v_amount % 100 <> 0 then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'PLAN_AMOUNT_INVALID', 'plan_tier', v_tier);
  end if;

  -- 정원 (정본 판정식 그대로 — DB 함수 3종 · 최종 방어는 enforce_mentor_cap 트리거)
  v_cap_used := public.mentor_cap_used(p_mentor_id);
  v_cap_weight := public.subscription_cap_weight(v_tier);
  v_cap_limit := public.mentor_cap_limit(p_mentor_id);
  if v_cap_used + v_cap_weight > v_cap_limit then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'MENTOR_CAP_EXCEEDED',
                              'cap_used', v_cap_used, 'cap_weight', v_cap_weight, 'cap_limit', v_cap_limit);
  end if;

  -- 잔액 (사전 판정 — 실제 차감의 원자 판정은 record_subscription_cash_debit)
  select w.balance_cents into v_balance from public.cash_wallets w where w.user_id = v_uid;
  v_balance := coalesce(v_balance, 0);
  if v_balance < v_amount then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'CASH_INSUFFICIENT',
                              'required_cents', v_amount, 'balance_cents', v_balance, 'shortfall_cents', v_amount - v_balance);
  end if;

  -- 자금 단계 — 한 subtransaction: intent → F12(정본 confirm + 방) → initial billing event. 실패 시 전부 롤백.
  begin
    insert into public.payments (user_id, mentor_id, status, amount, currency, kind, plan_id, external_id, metadata)
    values (v_uid, p_mentor_id, 'pending', (v_amount::numeric / 100), 'KRW', 'subscription', v_plan_id, v_ext,
            jsonb_build_object('planTier', v_tier, 'planId', v_plan_id::text, 'source', 'app_subscribe_with_cash',
                               'expected_amount_cents', v_amount, 'idempotency_key', v_key))
    returning id into v_payment_id;

    v_res := api_web_v1.subscription_checkout_confirm_v3(v_payment_id, v_plan_id, v_amount, 'sub_checkout_' || v_payment_id::text);
    if not coalesce((v_res ->> 'ok')::boolean, false) then
      v_abort_code := coalesce(v_res ->> 'code', 'FINANCIAL_WRITE_ERROR');
      v_abort_detail := v_res - 'ok' - 'contract_version' - 'code';
      raise exception 'APP_SUB_ABORT';
    end if;
    v_sub_id := (v_res ->> 'subscription_id')::uuid;
    v_room_id := (v_res ->> 'room_id')::uuid;
    v_reactivated := coalesce((v_res ->> 'reactivated')::boolean, false);

    -- Same external app contract; the common checkout implementation owns the billing event.
    select s.current_period_start, s.current_period_end, s.next_billing_at into v_sub
      from public.subscriptions s where s.id = v_sub_id;

    select w.balance_cents into v_balance_after from public.cash_wallets w where w.user_id = v_uid;
    v_result := jsonb_build_object(
      'ok', true, 'contract_version', 1, 'idempotent', false,
      'subscription_id', v_sub_id, 'room_id', v_room_id, 'payment_id', v_payment_id,
      'plan_id', v_plan_id, 'plan_tier', v_tier,
      'debited_cents', v_amount, 'balance_after_cents', coalesce(v_balance_after, 0),
      'reactivated', v_reactivated,
      'current_period_start', v_sub.current_period_start, 'current_period_end', v_sub.current_period_end,
      'next_billing_at', v_sub.next_billing_at);
    -- 재생용 첫 결과 보존 (정본이 넣은 planId/subscription_id 는 그대로 두고 app_result 만 덧붙인다)
    update public.payments p
       set metadata = coalesce(p.metadata, '{}'::jsonb) || jsonb_build_object('app_result', v_result)
     where p.id = v_payment_id;
  exception when others then
    if sqlerrm <> 'APP_SUB_ABORT' then
      raise;   -- 사전 밖 예외는 그대로 전파(§8.2)
    end if;
  end;

  if v_abort_code is not null then
    -- 이 시도의 payments·anomaly 행은 위 블록과 함께 롤백됐다. 이상 계열은 운영 진단용으로 다시 기록한다(payment_id 없음).
    if v_abort_code = any(v_anomaly_codes) then
      insert into public.subscription_checkout_anomalies (payment_id, subscription_id, code, detail, expected, found)
      values (null, null, v_abort_code, 'api_app_v1.subscribe_with_cash aborted (intent rolled back)',
              jsonb_build_object('student_id', v_uid, 'mentor_id', p_mentor_id, 'plan_id', v_plan_id, 'plan_tier', v_tier,
                                 'amount_cents', v_amount, 'idempotency_key', v_key),
              v_abort_detail)
      returning id into v_anom;
      return jsonb_build_object('ok', false, 'contract_version', 1, 'code', v_abort_code, 'anomaly_id', v_anom);
    end if;
    if v_abort_code = 'CASH_INSUFFICIENT' then
      select w.balance_cents into v_balance from public.cash_wallets w where w.user_id = v_uid;
      v_balance := coalesce(v_balance, 0);
      return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'CASH_INSUFFICIENT',
                                'required_cents', v_amount, 'balance_cents', v_balance,
                                'shortfall_cents', greatest(0, v_amount - v_balance));
    end if;
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', v_abort_code) || coalesce(v_abort_detail, '{}'::jsonb);
  end if;

  return v_result;
end
$function$
;


create or replace function public.subscription_renewal_quote(p_subscription_id uuid)
returns table(subscription_id uuid,plan_id uuid,plan_tier text,amount_cents bigint,next_billing_at timestamptz)
language sql stable security definer set search_path = '' as $fn$
 select s.id,p.id,p.plan_tier,p.amount_cents::bigint,s.next_billing_at
 from public.subscriptions s join public.mentor_plans p
 on p.id=s.plan_id and p.mentor_id=s.mentor_id and p.plan_tier=s.plan_tier
 where s.id=p_subscription_id and p.amount_cents>0 and p.amount_cents%100=0
$fn$;
revoke all on function public.subscription_renewal_quote(uuid) from public,anon,authenticated;
grant execute on function public.subscription_renewal_quote(uuid) to service_role;

create or replace function public.record_subscription_renewal_notice(
 p_subscription_id uuid,p_period_end timestamptz,p_at timestamptz default now()) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare s public.subscriptions%rowtype; p public.mentor_plans%rowtype; v_id uuid; v_key text;
begin
 select * into s from public.subscriptions where id=p_subscription_id for update;
 if s.id is null or p_period_end is null or p_at is null or s.status <> 'active'
    or s.cancel_at_period_end or s.current_period_end is distinct from p_period_end
    or s.next_billing_at is null or s.next_billing_at<=p_at then
   return jsonb_build_object('ok',false,'code','not_notice_eligible');
 end if;
 select * into p from public.mentor_plans where id=s.plan_id for share;
 if p.id is null or p.mentor_id is distinct from s.mentor_id or p.plan_tier is distinct from s.plan_tier
    or p.amount_cents is null or p.amount_cents<=0 or p.amount_cents%100<>0 then
   return jsonb_build_object('ok',false,'code','price_unavailable');
 end if;
 v_key := 'sub_renewal_notice:'||s.id::text||':'||to_char(p_period_end at time zone 'UTC','YYYY-MM-DD');
 insert into public.subscription_billing_events
   (subscription_id,student_id,mentor_id,event_type,status,period_start,period_end,billing_at,amount_cents,
    plan_tier,plan_id,idempotency_key,failure_code,failure_message,attempt_count,created_at,processed_at)
 values(s.id,s.student_id,s.mentor_id,'renewal','skipped',s.current_period_start,s.current_period_end,s.next_billing_at,
        p.amount_cents,p.plan_tier,p.id,v_key,'pre_renewal_notice_sent','pre-renewal notice marker',0,p_at,p_at)
 on conflict(idempotency_key) do nothing returning id into v_id;
 return jsonb_build_object('ok',true,'code',case when v_id is null then 'already' else 'sent' end);
end $fn$;
revoke all on function public.record_subscription_renewal_notice(uuid,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.record_subscription_renewal_notice(uuid,timestamptz,timestamptz) to service_role;

create or replace function public.process_subscription_renewal_v2(
 p_subscription_id uuid,p_period_end timestamptz,p_idempotency_key text,p_processed_at timestamptz default now()) returns table(ok boolean,code text,message text,billing_event_id uuid,ledger_id uuid,
 next_period_start timestamptz,next_period_end timestamptz,wallet_balance_cents bigint,attempt_count integer)
language plpgsql security definer set search_path = '' as $fn$
declare
 s public.subscriptions%rowtype; p public.mentor_plans%rowtype;
 e public.subscription_billing_events%rowtype; l public.cash_ledger%rowtype;
 v_student uuid; v_mentor uuid; v_amount bigint; v_balance bigint; v_end timestamptz;
 v_key text; v_notice public.subscription_billing_events%rowtype;
begin
 if p_subscription_id is null or p_period_end is null or p_processed_at is null then
   return query select false,'invalid_subscription'::text,'subscription, period and time are required'::text,null::uuid,null::uuid,null::timestamptz,null::timestamptz,null::bigint,0; return;
 end if;
 v_key := 'sub_renewal:'||p_subscription_id::text||':'||to_char(p_period_end at time zone 'UTC','YYYY-MM-DD');
 if p_idempotency_key is distinct from v_key or char_length(p_idempotency_key)>128 then
   return query select false,'invalid_idempotency_key'::text,'key must identify this subscription period'::text,null::uuid,null::uuid,null::timestamptz,null::timestamptz,null::bigint,0; return;
 end if;
 -- Match checkout's pair mutex before row locks. No stale client snapshot decides eligibility.
 select student_id,mentor_id into v_student,v_mentor from public.subscriptions where id=p_subscription_id;
 if v_student is null then
   return query select false,'not_found'::text,'subscription not found'::text,null::uuid,null::uuid,null::timestamptz,null::timestamptz,null::bigint,0; return;
 end if;
 perform pg_advisory_xact_lock(hashtext(v_student::text),hashtext(v_mentor::text));
 select * into s from public.subscriptions where id=p_subscription_id for update;
 if s.id is null or s.student_id is distinct from v_student or s.mentor_id is distinct from v_mentor then
   raise exception 'SUBSCRIPTION_BINDING_MISMATCH';
 end if;
 select * into e from public.subscription_billing_events where idempotency_key=v_key for update;
 if e.id is not null then
   if e.subscription_id is distinct from s.id or e.student_id is distinct from s.student_id
      or e.mentor_id is distinct from s.mentor_id or e.period_start is distinct from p_period_end
      or e.event_type not in ('renewal','renewal_failed') then
     raise exception 'BILLING_EVENT_BINDING_MISMATCH';
   end if;
   if e.status='succeeded' then
     select * into l from public.cash_ledger where id=e.ledger_id;
     if l.id is null or l.delta_cents is distinct from -e.amount_cents::bigint
        or l.user_id is distinct from s.student_id or l.ref_id is distinct from s.id
        or l.idempotency_key is distinct from v_key or l.reason is distinct from 'subscription_renewal' then
       raise exception 'LEDGER_BINDING_MISMATCH';
     end if;
     return query select true,'already_succeeded'::text,'renewal already processed'::text,e.id,l.id,e.period_start,e.period_end,null::bigint,e.attempt_count; return;
   end if;
   if e.status not in ('failed','skipped') then
     return query select false,'already_processing'::text,'renewal is already processing'::text,e.id,e.ledger_id,e.period_start,e.period_end,null::bigint,e.attempt_count; return;
   end if;
 end if;
 if s.status not in ('active','past_due') or s.cancel_at_period_end
    or (s.status='past_due' and s.grace_until is not null and s.grace_until<=p_processed_at)
    or s.current_period_end is distinct from p_period_end or s.next_billing_at is null
    or s.next_billing_at>p_processed_at or p_period_end>p_processed_at then
   return query select false,'not_renewal_eligible'::text,'subscription state or period changed'::text,e.id,null::uuid,s.current_period_start,s.current_period_end,null::bigint,coalesce(e.attempt_count,0); return;
 end if;
 select * into p from public.mentor_plans where id=s.plan_id for share;
 if p.id is null or p.mentor_id is distinct from s.mentor_id or p.plan_tier is distinct from s.plan_tier
    or p.amount_cents is null or p.amount_cents<=0 or p.amount_cents%100<>0 then
   return query select false,'price_unavailable'::text,'plan price or binding unavailable'::text,e.id,null::uuid,s.current_period_start,s.current_period_end,null::bigint,coalesce(e.attempt_count,0); return;
 end if;
 -- is_active controls NEW subscriptions only. Existing subscriptions may renew.
 v_amount := p.amount_cents;
 select * into v_notice from public.subscription_billing_events
  where idempotency_key='sub_renewal_notice:'||s.id::text||':'||to_char(p_period_end at time zone 'UTC','YYYY-MM-DD');
 if v_notice.id is not null and (v_notice.amount_cents is distinct from v_amount
    or v_notice.plan_id is distinct from p.id or v_notice.plan_tier is distinct from p.plan_tier) then
   return query select false,'price_changed_since_notice'::text,'renewal price differs from the sent notice'::text,e.id,null::uuid,s.current_period_start,s.current_period_end,null::bigint,coalesce(e.attempt_count,0); return;
 end if;
 if exists(select 1 from public.cash_ledger where idempotency_key=v_key) then
   raise exception 'LEDGER_WITHOUT_SUCCEEDED_EVENT';
 end if;
 v_end := ((p_period_end at time zone 'Asia/Seoul' + interval '1 month') at time zone 'Asia/Seoul');
 if e.id is null then
   insert into public.subscription_billing_events
    (subscription_id,student_id,mentor_id,event_type,status,period_start,period_end,billing_at,
     amount_cents,plan_tier,plan_id,idempotency_key,attempt_count,created_at)
   values(s.id,s.student_id,s.mentor_id,'renewal','processing',p_period_end,v_end,p_processed_at,
          v_amount,p.plan_tier,p.id,v_key,1,p_processed_at) returning * into e;
 else
   update public.subscription_billing_events b set event_type='renewal',status='processing',
     amount_cents=v_amount,plan_id=p.id,plan_tier=p.plan_tier,billing_at=p_processed_at,
     attempt_count=b.attempt_count+1,processed_at=null,failure_code=null,failure_message=null
   where b.id=e.id returning b.* into e;
 end if;
 insert into public.cash_wallets(user_id,balance_cents) values(s.student_id,0) on conflict(user_id) do nothing;
 update public.cash_wallets w set balance_cents=w.balance_cents-v_amount
   where w.user_id=s.student_id and w.balance_cents>=v_amount returning w.balance_cents into v_balance;
 if not found then
   update public.subscription_billing_events b set event_type='renewal_failed',status='failed',
     failure_code='insufficient_cash',failure_message='CASH_INSUFFICIENT',processed_at=p_processed_at where b.id=e.id;
   update public.subscriptions set status='past_due',grace_until=coalesce(grace_until,p_processed_at+interval '2 days'),
     updated_at=p_processed_at,last_billing_event_id=e.id where id=s.id;
   return query select false,'insufficient_cash'::text,'CASH_INSUFFICIENT'::text,e.id,null::uuid,p_period_end,v_end,null::bigint,e.attempt_count; return;
 end if;
 insert into public.cash_ledger(user_id,delta_cents,reason,ref_type,ref_id,idempotency_key,created_at)
 values(s.student_id,-v_amount,'subscription_renewal','subscriptions',s.id,v_key,p_processed_at) returning * into l;
 update public.subscription_billing_events b set event_type='renewal',status='succeeded',ledger_id=l.id,
   processed_at=p_processed_at,failure_code=null,failure_message=null where b.id=e.id;
 update public.subscriptions set status='active',current_period_start=p_period_end,current_period_end=v_end,
   next_billing_at=v_end,last_renewed_at=p_processed_at,last_billing_event_id=e.id,grace_until=null,updated_at=p_processed_at where id=s.id;
 return query select true,'succeeded'::text,'renewal processed'::text,e.id,l.id,p_period_end,v_end,v_balance,e.attempt_count;
end $fn$;
revoke all on function public.process_subscription_renewal_v2(uuid,timestamptz,text,timestamptz) from public,anon,authenticated;
grant execute on function public.process_subscription_renewal_v2(uuid,timestamptz,text,timestamptz) to service_role;

do $gate$ begin if md5(replace(pg_get_functiondef('public.process_subscription_renewal(uuid,timestamptz,bigint,text,timestamptz)'::regprocedure),chr(13),'')) <> 'f212d344d7dd8b51ac6b0860cfee9cff' then raise exception 'FINANCIAL_SOURCE_DRIFT: public.process_subscription_renewal'; end if; end $gate$;

-- Old web deployments retain their signature; caller supplied prices are ignored.
create or replace function public.process_subscription_renewal(p_subscription_id uuid,p_period_end timestamptz,
 p_amount_cents bigint,p_idempotency_key text,p_processed_at timestamptz default now())
returns table(ok boolean,code text,message text,billing_event_id uuid,ledger_id uuid,next_period_start timestamptz,
 next_period_end timestamptz,wallet_balance_cents bigint,attempt_count integer)
language sql security definer set search_path = '' as $fn$
 select * from public.process_subscription_renewal_v2(p_subscription_id,p_period_end,p_idempotency_key,p_processed_at)
$fn$;
revoke all on function public.process_subscription_renewal(uuid,timestamptz,bigint,text,timestamptz) from public,anon,authenticated;
grant execute on function public.process_subscription_renewal(uuid,timestamptz,bigint,text,timestamptz) to service_role;


create or replace function public.finalize_subscription_terminal_transition(
 p_subscription_id uuid,p_transition text,p_at timestamptz,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare s public.subscriptions%rowtype; e public.subscription_billing_events%rowtype; v_type text; v_key text;
begin
 if p_subscription_id is null or p_at is null or p_transition is null
    or p_transition not in ('cancel_at_period_end','grace_expired') then
   return jsonb_build_object('ok',false,'code','invalid_transition');
 end if;
 select * into s from public.subscriptions where id=p_subscription_id for update;
 if s.id is null then return jsonb_build_object('ok',false,'code','not_found'); end if;
 v_type := case p_transition when 'cancel_at_period_end' then 'canceled' else 'expired' end;
 v_key := case p_transition when 'cancel_at_period_end' then 'sub_cancel:' else 'sub_expired:' end
          ||s.id::text||':'||to_char(s.current_period_end at time zone 'UTC','YYYY-MM-DD');
 if p_idempotency_key is distinct from v_key then
   return jsonb_build_object('ok',false,'code','stale_transition');
 end if;
 select * into e from public.subscription_billing_events where idempotency_key=v_key for update;
 if e.id is not null and (e.subscription_id is distinct from s.id or e.event_type is distinct from v_type
    or e.period_end is distinct from s.current_period_end or e.status is distinct from 'succeeded') then
   raise exception 'BILLING_EVENT_BINDING_MISMATCH';
 end if;
 if s.status='expired' and e.id is not null then
   return jsonb_build_object('ok',true,'code','already_succeeded','billing_event_id',e.id);
 end if;
 if s.status not in ('active','past_due') or s.current_period_end is null or s.current_period_end>p_at
    or (p_transition='cancel_at_period_end' and not coalesce(s.cancel_at_period_end,false))
    or (p_transition='grace_expired' and (s.status<>'past_due' or s.grace_until is null or s.grace_until>p_at or s.cancel_at_period_end)) then
   return jsonb_build_object('ok',false,'code','not_terminal_eligible');
 end if;
 if e.id is null then
   insert into public.subscription_billing_events
    (subscription_id,student_id,mentor_id,event_type,status,period_start,period_end,billing_at,plan_tier,plan_id,idempotency_key,processed_at)
   values(s.id,s.student_id,s.mentor_id,v_type,'succeeded',s.current_period_start,s.current_period_end,p_at,s.plan_tier,s.plan_id,v_key,p_at)
   returning * into e;
 end if;
 update public.subscriptions set status='expired',expired_at=p_at,next_billing_at=null,
   canceled_at=case when p_transition='cancel_at_period_end' then p_at else canceled_at end,
   last_billing_event_id=e.id,updated_at=p_at where id=s.id;
 return jsonb_build_object('ok',true,'code','succeeded','billing_event_id',e.id);
end $fn$;
revoke all on function public.finalize_subscription_terminal_transition(uuid,text,timestamptz,text) from public,anon,authenticated;
grant execute on function public.finalize_subscription_terminal_transition(uuid,text,timestamptz,text) to service_role;


notify pgrst, 'reload schema';
commit;
