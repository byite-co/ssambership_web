begin;
CREATE OR REPLACE FUNCTION api_web_v1.subscription_checkout_confirm_v2(p_payment_id uuid, p_plan_id uuid, p_expected_amount_cents integer, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
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
    EXCEPTION WHEN OTHERS THEN
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

    v_res := api_web_v1.subscription_checkout_confirm_v2(v_payment_id, v_plan_id, v_amount, 'sub_checkout_' || v_payment_id::text);
    if not coalesce((v_res ->> 'ok')::boolean, false) then
      v_abort_code := coalesce(v_res ->> 'code', 'FINANCIAL_WRITE_ERROR');
      v_abort_detail := v_res - 'ok' - 'contract_version' - 'code';
      raise exception 'APP_SUB_ABORT';
    end if;
    v_sub_id := (v_res ->> 'subscription_id')::uuid;
    v_room_id := (v_res ->> 'room_id')::uuid;
    v_reactivated := coalesce((v_res ->> 'reactivated')::boolean, false);

    -- ④ initial billing event — 웹 recordInitialSubscriptionBillingEvent 와 같은 키·필드(upsert)
    select s.student_id, s.mentor_id, s.plan_tier, s.plan_id, s.created_at, s.started_at,
           s.current_period_start, s.current_period_end, s.next_billing_at, s.payment_id
      into v_sub
      from public.subscriptions s where s.id = v_sub_id;
    select l.id, l.created_at into v_ledger
      from public.cash_ledger l where l.idempotency_key = 'sub_debit_' || v_payment_id::text;
    v_period_start := coalesce(v_sub.current_period_start, v_sub.started_at, v_sub.created_at, now());
    v_period_end := coalesce(v_sub.current_period_end,
                             ((v_period_start at time zone 'Asia/Seoul' + interval '1 month') at time zone 'Asia/Seoul'));
    insert into public.subscription_billing_events
      (subscription_id, student_id, mentor_id, event_type, status, period_start, period_end, billing_at, amount_cents,
       plan_tier, plan_id, idempotency_key, ledger_id, payment_id, processed_at)
    values
      (v_sub_id, coalesce(v_sub.student_id, v_uid), coalesce(v_sub.mentor_id, p_mentor_id), 'initial', 'succeeded',
       v_period_start, v_period_end, coalesce(v_ledger.created_at, v_sub.created_at, now()), v_amount,
       coalesce(v_sub.plan_tier, v_tier), v_sub.plan_id, 'sub_initial:' || v_sub_id::text, v_ledger.id,
       coalesce(v_sub.payment_id, v_payment_id), coalesce(v_ledger.created_at, now()))
    on conflict (idempotency_key) do update
      set subscription_id = excluded.subscription_id, student_id = excluded.student_id, mentor_id = excluded.mentor_id,
          event_type = excluded.event_type, status = excluded.status, period_start = excluded.period_start,
          period_end = excluded.period_end, billing_at = excluded.billing_at, amount_cents = excluded.amount_cents,
          plan_tier = excluded.plan_tier, plan_id = excluded.plan_id, ledger_id = excluded.ledger_id,
          payment_id = excluded.payment_id, processed_at = excluded.processed_at
    returning id into v_event_id;
    update public.subscriptions s
       set last_billing_event_id = v_event_id, last_payment_id = v_payment_id
     where s.id = v_sub_id;

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
$function$
;
drop function if exists api_web_v1.subscription_checkout_confirm_v3(uuid,uuid,integer,text);
drop function if exists core_private.subscription_checkout_confirm_impl(uuid,uuid,integer,text);
drop function if exists core_private.record_initial_subscription_billing_event(uuid,uuid,boolean);
drop function if exists public.process_subscription_renewal_v2(uuid,timestamptz,text,timestamptz);
drop function if exists public.record_subscription_renewal_notice(uuid,timestamptz,timestamptz);
drop function if exists public.subscription_renewal_quote(uuid);
drop function if exists public.finalize_subscription_terminal_transition(uuid,text,timestamptz,text);
notify pgrst, 'reload schema';
commit;
