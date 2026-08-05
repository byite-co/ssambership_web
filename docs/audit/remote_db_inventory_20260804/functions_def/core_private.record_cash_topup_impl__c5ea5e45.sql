CREATE OR REPLACE FUNCTION core_private.record_cash_topup_impl(p_user_id uuid, p_amount_cents bigint, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_idem   text;
  v_new_id uuid;
  v_wu     int;
  v_id     uuid;
  v_user   uuid;
  v_delta  bigint;
  v_reason text;
  v_rtype  text;
  v_rid    uuid;
  v_key    text;
BEGIN
  -- 검증 4종 — 020 레거시와 동일 메시지·동일 순서(2층 관측 계약 불변)
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id is required';
  END IF;
  v_idem := nullif(trim(coalesce(p_idempotency_key, '')), '');
  IF v_idem IS NULL OR length(v_idem) = 0 THEN
    RAISE EXCEPTION 'p_idempotency_key is required';
  END IF;
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'p_amount_cents must be positive';
  END IF;
  IF p_amount_cents > 1000000000 THEN
    RAISE EXCEPTION 'p_amount_too_large';
  END IF;

  -- ① 원자 판정 — 사전 SELECT 로 신규/duplicate 를 추정하는 구현은 금지(§7 F11 1층)
  INSERT INTO public.cash_ledger (user_id, delta_cents, reason, ref_type, ref_id, idempotency_key)
  VALUES (p_user_id, p_amount_cents, 'cash_topup', 'topup', NULL, v_idem)
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_new_id;

  IF v_new_id IS NOT NULL THEN
    -- ② 신규 INSERT 일 때만 지갑 upsert·잔액 가산 (row_count=0 → 예외 — 부분 실패 전파)
    INSERT INTO public.cash_wallets (user_id, balance_cents)
    VALUES (p_user_id, 0)
    ON CONFLICT (user_id) DO NOTHING;
    UPDATE public.cash_wallets w
       SET balance_cents = w.balance_cents + p_amount_cents
     WHERE w.user_id = p_user_id;
    GET DIAGNOSTICS v_wu = ROW_COUNT;
    IF coalesce(v_wu, 0) = 0 THEN
      RAISE EXCEPTION 'CASH_WALLET_UPSERT_FAILED' USING ERRCODE = 'P0001';
    END IF;
    RETURN jsonb_build_object(
      'ledger_id', v_new_id, 'inserted', true, 'user_id', p_user_id,
      'delta_cents', p_amount_cents, 'reason', 'cash_topup', 'ref_type', 'topup',
      'ref_id', NULL, 'idempotency_key', v_idem);
  END IF;

  -- ③ duplicate: 지갑 갱신 금지 ④ 기존 행 FOR UPDATE 재조회 ⑤ 8필드 내부 형상 반환
  SELECT l.id, l.user_id, l.delta_cents, l.reason, l.ref_type, l.ref_id, l.idempotency_key
    INTO v_id, v_user, v_delta, v_reason, v_rtype, v_rid, v_key
    FROM public.cash_ledger l
   WHERE l.idempotency_key = v_idem
   FOR UPDATE;
  RETURN jsonb_build_object(
    'ledger_id', v_id, 'inserted', false, 'user_id', v_user,
    'delta_cents', v_delta, 'reason', v_reason, 'ref_type', v_rtype,
    'ref_id', v_rid, 'idempotency_key', v_key);
END $function$
