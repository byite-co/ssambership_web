-- =============================================================================
-- 20260730120103_money_rpc.sql (S2 M9)
-- =============================================================================
-- 자금 RPC — F11 3층 + F12. 정본 계약: docs/contracts/api_web_v1_contract_v1_1.md
--   §7 F11(3층 — rev 8 A-6) · §7 F12(rev 8 A-2·A-5 전면 재작성) · §8(envelope) ·
--   §9.6(자금 코드) · §9.8(confirm raise 17종 동명 유지) · §10.3(service_role 전용) ·
--   §12.2/[C3](잠금 순서 payments → advisory → mentor_plans) · §20.3(M9 이전 게이트) ·
--   §21.3 T-CONC-02·03·04·08·09 · §21.4 T-FIN · §21.8 T-REP · §21.9 T-TOP.
--
-- 한 마이그레이션에서 전부 수행(§20.2 M9 행):
--   [1층] core_private.record_cash_topup_impl — 공용 원자 구현부(SECURITY INVOKER,
--         외부 EXECUTE 0). ON CONFLICT 원자 판정(사전 SELECT 추정 금지), 신규에만
--         지갑 가산, duplicate 는 FOR UPDATE 재조회 후 8필드 내부 형상 반환.
--   [2층] public.record_cash_topup — 기존 시그니처·void·SECDEF·service_role 전용·
--         duplicate 무음 반환 불변. 내부 구현만 공용 구현부 위임으로 교체(T-REG-06:
--         계약된 본문 교체 허용·신규 public 함수 0). 검증 4종은 impl 이 020 과
--         동일 메시지·동일 순서로 수행한다.
--   [3층] api_web_v1.record_cash_topup_v2 — strict wrapper(3인자,
--         p_idempotency_key = p_order_ref). `^cash-(.+)-([0-9]+)$` 강제(ORDER_REF_INVALID),
--         소유자 재검증(ORDER_REF_OWNER_MISMATCH), duplicate 6필드 NULL-safe 전건
--         대조(LEDGER_FIELD_MISMATCH). service_role 전용 EXECUTE.
--   [F12] api_web_v1.subscription_checkout_confirm_v2 — 최초 실행은 정본
--         public.confirm_subscription_checkout 을 감싸고(재생 판정은 자체 수행 —
--         정본 재호출 금지), 잠금 순서 [C3](payments FOR UPDATE → advisory →
--         mentor_plans FOR UPDATE) 준수, 3자 일치(payments.amount×100 =
--         p_expected_amount_cents = 잠근 mentor_plans.amount_cents, 불일치 =
--         PLAN_AMOUNT_CHANGED 차감 0), 방 확보 실패 시 이번 트랜잭션 자금·원장·
--         구독·결제 변경 전부 롤백(ROOM_ENSURE_FAILED). 재생은 Phase 1(검증 전용,
--         9단계 우선순위·anomaly 기록만 허용) → Phase 2(room 확보·보정)로 분리하고
--         현재 플랜 가격을 읽지 않는다. 정본 raise 17종은 동명 envelope 로 변환,
--         사전 밖 예외는 그대로 전파(§8.2 — bare RAISE).
--
-- 구현 결정(사전에 없는 이름·코드 임의 생성 금지 — 기존 사전 재사용):
--   * F12 의 결제 시점 불변 동의 금액 검증(§7 F12): kind ≠ 'subscription' →
--     `PAYMENT_KIND_INVALID`, currency ≠ 'KRW'·amount ≤ 0·비정수 →
--     `PAYMENT_STATE_UNEXPECTED` (둘 다 §9.6 "결제 행 상태" 사전 동명 재사용,
--     raise 변환 계열이므로 anomaly 미기록). 정본도 kind 검증을 succeeded 분기
--     이전에 수행하므로 동일 위치(재생 분기 이전 공통부)에 둔다.
--   * 최초 실행 경로에서 기존 방의 `subscription_id` 가 다른 값이면 §7 F12 room
--     참조 규칙 표의 "거부" = `ROOM_REF_MISMATCH` + anomaly + subtransaction 전부
--     롤백으로 구현한다(재생 9단계와 동일 코드 — §9.6 정의가 재생 한정이 아님).
--   * §20.3 "F12 배포 전 사전 검사"는 이 파일의 사전 게이트가 **탐지만** 수행한다
--     (>0 이면 중단 — 보정은 운영 절차(§20.3)이며 migration 이 무단 쓰기하지 않는다).
--   * PG17.6 실측(M1 헤더 참조): 신규 함수는 하드와이어드 default 로 PUBLIC EXECUTE
--     를 받으므로 함수별 명시 `REVOKE ALL … FROM PUBLIC` 이 유효한 방어층이다.
-- 선행조건: M5(20260730105244 — F10) 적용 완료(§20.2.1 — M9 : M5).
-- rollback 정본: supabase/rollback/20260730120103_money_rpc_rollback.sql
--   (레거시 record_cash_topup 020 구 본문 문자 그대로 복원 포함 — §22 #3)
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- A. 사전 게이트 — 기반 실측 (불일치 시 수정 0건 중단)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_cnt bigint;
BEGIN
  -- M1·M5 경계
  IF (SELECT count(*) FROM pg_namespace WHERE nspname IN ('api_web_v1','core_private')) <> 2 THEN
    RAISE EXCEPTION 'BATCH_E_BASELINE_OBJECT_MISMATCH: M1 schemas not applied';
  END IF;
  IF has_schema_privilege('anon', 'core_private', 'USAGE')
     OR has_schema_privilege('authenticated', 'core_private', 'USAGE')
     OR has_schema_privilege('service_role', 'core_private', 'USAGE') THEN
    RAISE EXCEPTION 'BATCH_E_BASELINE_OBJECT_MISMATCH: core_private boundary violated';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'core_private' AND p.proname = 'ensure_student_mentor_room'
                    AND pg_get_function_identity_arguments(p.oid)
                        = 'p_student_id uuid, p_mentor_id uuid, p_payment_id uuid, p_subscription_id uuid, p_require_entitlement boolean') THEN
    RAISE EXCEPTION 'BATCH_E_BASELINE_OBJECT_MISMATCH: M5 F10 missing or identity mismatch';
  END IF;
  -- 자금 기반 테이블·제약 (§7 F11 — cash_ledger_idempotency_key_key UNIQUE 실재)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid
                  JOIN pg_namespace n ON n.oid = r.relnamespace
                  WHERE n.nspname = 'public' AND r.relname = 'cash_ledger'
                    AND c.conname = 'cash_ledger_idempotency_key_key' AND c.contype = 'u') THEN
    RAISE EXCEPTION 'BATCH_E_BASELINE_OBJECT_MISMATCH: cash_ledger idempotency UNIQUE missing';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'cash_ledger'
         AND column_name IN ('id','user_id','delta_cents','reason','ref_type','ref_id','idempotency_key')) <> 7
     OR (SELECT count(*) FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'cash_wallets'
            AND column_name IN ('user_id','balance_cents')) <> 2 THEN
    RAISE EXCEPTION 'BATCH_E_BASELINE_OBJECT_MISMATCH: cash tables columns mismatch';
  END IF;
  -- ref_text 컬럼은 존재하지 않아야 한다(rev 8 A-6 — v1.0 ref_text·M2 폐기, T-FIN-01)
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'cash_ledger' AND column_name = 'ref_text') THEN
    RAISE EXCEPTION 'BATCH_E_BASELINE_OBJECT_MISMATCH: cash_ledger.ref_text must not exist';
  END IF;
  -- 결제·구독·방 기반 (131 payments.plan_id · 064 last_payment_id · uq 2종)
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'payments'
         AND column_name IN ('id','user_id','mentor_id','amount','currency','status','kind','plan_id','metadata','created_at')) <> 10 THEN
    RAISE EXCEPTION 'BATCH_E_BASELINE_OBJECT_MISMATCH: payments columns mismatch';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'subscriptions'
         AND column_name IN ('id','student_id','mentor_id','plan_id','status','payment_id','last_payment_id')) <> 7
     OR NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public'
                     AND tablename = 'subscriptions' AND indexname = 'uq_subscriptions_pair')
     OR NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public'
                     AND tablename = 'mentor_student_rooms' AND indexname = 'uq_msr_pair') THEN
    RAISE EXCEPTION 'BATCH_E_BASELINE_OBJECT_MISMATCH: subscriptions/rooms baseline mismatch';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema = 'public' AND table_name = 'subscription_checkout_anomalies') THEN
    RAISE EXCEPTION 'BATCH_E_BASELINE_OBJECT_MISMATCH: 145 anomaly table missing';
  END IF;
  -- 레거시 정본 함수 3종 (020·145·019)
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'record_cash_topup'
                    AND pg_get_function_identity_arguments(p.oid) = 'p_user_id uuid, p_amount_cents bigint, p_idempotency_key text'
                    AND p.prorettype = 'void'::regtype AND p.prosecdef) THEN
    RAISE EXCEPTION 'BATCH_E_BASELINE_OBJECT_MISMATCH: legacy record_cash_topup mismatch';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'confirm_subscription_checkout'
                    AND pg_get_function_identity_arguments(p.oid) = 'p_payment_id uuid, p_plan_id uuid, p_idempotency_key text'
                    AND p.prorettype = 'jsonb'::regtype AND p.prosecdef) THEN
    RAISE EXCEPTION 'BATCH_E_BASELINE_OBJECT_MISMATCH: legacy confirm_subscription_checkout mismatch';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'record_subscription_cash_debit') THEN
    RAISE EXCEPTION 'BATCH_E_BASELINE_OBJECT_MISMATCH: record_subscription_cash_debit missing';
  END IF;
  -- 대상 선재 금지 (부분 생성 은닉 금지)
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE (n.nspname = 'api_web_v1' AND p.proname IN ('record_cash_topup_v2','subscription_checkout_confirm_v2'))
                 OR (n.nspname = 'core_private' AND p.proname = 'record_cash_topup_impl')) THEN
    RAISE EXCEPTION 'UNEXPECTED_EXISTING_CONTRACT_OBJECT: M9 target objects already exist';
  END IF;
  -- §20.3 "F12 배포 전 사전 검사": 구독이 참조하는 succeeded 결제 중 방 없는 건 탐지.
  -- 탐지만 한다 — >0 이면 중단하고 보정은 운영 절차로 수행한다(로컬 clean install = 0).
  SELECT count(*) INTO v_cnt
    FROM public.payments p
   WHERE p.status IN ('succeeded','paid','success','complete','captured')
     AND p.user_id IS NOT NULL AND p.mentor_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.subscriptions s
                  WHERE s.payment_id = p.id OR s.last_payment_id = p.id)
     AND NOT EXISTS (SELECT 1 FROM public.mentor_student_rooms r
                      WHERE r.student_id = p.user_id AND r.mentor_id = p.mentor_id);
  IF v_cnt > 0 THEN
    RAISE EXCEPTION 'S2_M9_PRE_CHECK_ROOMLESS_SUCCEEDED_SUBSCRIPTION_PAYMENTS: % 건 — §20.3 보정 후 재적용', v_cnt;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- B. [1층] core_private.record_cash_topup_impl — 공용 원자 구현부 (F11i)
-- -----------------------------------------------------------------------------
CREATE FUNCTION core_private.record_cash_topup_impl(
  p_user_id uuid,
  p_amount_cents bigint,
  p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
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
END $$;

COMMENT ON FUNCTION core_private.record_cash_topup_impl(uuid, bigint, text) IS
  'S2 M9 F11i(계약 §7 F11 1층): topup 공용 원자 구현부 — F11·레거시 record_cash_topup 이 수렴. SECURITY INVOKER·외부 EXECUTE 0(SECDEF wrapper 소유자 문맥 전용).';

REVOKE ALL ON FUNCTION core_private.record_cash_topup_impl(uuid, bigint, text) FROM PUBLIC;

-- -----------------------------------------------------------------------------
-- C. [2층] public.record_cash_topup — 내부 구현만 공용 구현부 위임으로 교체
--    (시그니처·void·SECDEF·search_path·ACL·duplicate 무음 반환 전부 불변 — §7 F11 2층.
--     CREATE OR REPLACE 는 기존 proacl 을 보존한다. GRANT/REVOKE 재실행 없음.)
-- -----------------------------------------------------------------------------
create or replace function public.record_cash_topup(
  p_user_id uuid,
  p_amount_cents bigint,
  p_idempotency_key text
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  -- S2 M9(계약 §7 F11 2층): 검증·원자 판정·지갑 가산은 공용 구현부가 020 과 동일
  -- 메시지·순서로 수행한다. 반환값은 폐기하며 duplicate(필드 불일치 포함)는 기존
  -- 계약대로 무음 반환한다 — mismatch 를 새로 외부에 노출하지 않는다.
  perform core_private.record_cash_topup_impl(p_user_id, p_amount_cents, p_idempotency_key);
end;
$function$;

-- -----------------------------------------------------------------------------
-- D. [3층] api_web_v1.record_cash_topup_v2 — strict wrapper (F11)
-- -----------------------------------------------------------------------------
CREATE FUNCTION api_web_v1.record_cash_topup_v2(
  p_user_id uuid,
  p_amount_cents bigint,
  p_order_ref text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_key     text;
  v_m       text[];
  v_uid     uuid;
  v_res     jsonb;
  v_balance bigint;
BEGIN
  -- 1. 입력 검증 (사전 밖 예외는 전파 — §8.2. 레거시와 동일 메시지)
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id is required';
  END IF;
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'p_amount_cents must be positive';
  END IF;
  IF p_amount_cents > 1000000000 THEN
    RAISE EXCEPTION 'p_amount_too_large';
  END IF;

  -- 2. Toss 주문 참조 형식 강제 — lib/toss/tossTopupCore.ts `^cash-(.+)-(\d+)$` 동치
  v_key := nullif(trim(coalesce(p_order_ref, '')), '');
  IF v_key IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'ORDER_REF_INVALID');
  END IF;
  v_m := regexp_match(v_key, '^cash-(.+)-([0-9]+)$');
  IF v_m IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'ORDER_REF_INVALID');
  END IF;

  -- 3. 소유자 재검증 — parseUserIdFromCashOrderId 동치(uuid 파싱 불가 = 불일치)
  BEGIN
    v_uid := v_m[1]::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'ORDER_REF_OWNER_MISMATCH');
  END;
  IF v_uid IS DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'ORDER_REF_OWNER_MISMATCH');
  END IF;

  -- 4. 공용 원자 구현부 호출 (p_idempotency_key = p_order_ref — 별도 인자가 아니다)
  v_res := core_private.record_cash_topup_impl(p_user_id, p_amount_cents, v_key);

  -- 5. 신규 → 성공
  IF coalesce((v_res->>'inserted')::boolean, false) THEN
    SELECT w.balance_cents INTO v_balance FROM public.cash_wallets w WHERE w.user_id = p_user_id;
    RETURN jsonb_build_object('ok', true, 'contract_version', 1, 'duplicate', false,
                              'ledger_id', (v_res->>'ledger_id')::uuid,
                              'balance_cents', v_balance);
  END IF;

  -- 5. duplicate → 기존 6필드 NULL-safe 전건 대조 (일반 =·<> 는 nullable 필드에 금지)
  IF (v_res->>'user_id')::uuid IS NOT DISTINCT FROM p_user_id
     AND (v_res->>'delta_cents')::bigint IS NOT DISTINCT FROM p_amount_cents
     AND (v_res->>'reason') IS NOT DISTINCT FROM 'cash_topup'
     AND (v_res->>'ref_type') IS NOT DISTINCT FROM 'topup'
     AND (v_res->>'ref_id') IS NULL
     AND (v_res->>'idempotency_key') IS NOT NULL
     AND (v_res->>'idempotency_key') = v_key THEN
    SELECT w.balance_cents INTO v_balance FROM public.cash_wallets w WHERE w.user_id = p_user_id;
    RETURN jsonb_build_object('ok', true, 'contract_version', 1, 'duplicate', true,
                              'ledger_id', (v_res->>'ledger_id')::uuid,
                              'balance_cents', v_balance);
  END IF;
  RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'LEDGER_FIELD_MISMATCH');
END $$;

COMMENT ON FUNCTION api_web_v1.record_cash_topup_v2(uuid, bigint, text) IS
  'S2 M9 F11(계약 §7 F11 3층): Toss 충전 strict wrapper — orderId 형식·소유자 재검증 + duplicate 6필드 NULL-safe 대조. service_role 전용(T4a).';

-- -----------------------------------------------------------------------------
-- E. F12 api_web_v1.subscription_checkout_confirm_v2
-- -----------------------------------------------------------------------------
CREATE FUNCTION api_web_v1.subscription_checkout_confirm_v2(
  p_payment_id uuid,
  p_plan_id uuid,
  p_expected_amount_cents integer,
  p_idempotency_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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
END $$;

COMMENT ON FUNCTION api_web_v1.subscription_checkout_confirm_v2(uuid, uuid, integer, text) IS
  'S2 M9 F12(계약 §7): 구독 checkout 확정 wrapper — 최초 실행은 정본 confirm_subscription_checkout + F10 방 확보(실패 시 전부 롤백), 재생은 Phase 1/2 자체 판정(9단계·불변 동의 금액). service_role 전용(T4a).';

-- -----------------------------------------------------------------------------
-- F. 권한 — service_role 전용 진입점 + 내부 구현부 EXECUTE 0 (§10.3, 같은 마이그레이션)
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION api_web_v1.record_cash_topup_v2(uuid, bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION api_web_v1.subscription_checkout_confirm_v2(uuid, uuid, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api_web_v1.record_cash_topup_v2(uuid, bigint, text) TO service_role;
GRANT EXECUTE ON FUNCTION api_web_v1.subscription_checkout_confirm_v2(uuid, uuid, integer, text) TO service_role;

-- -----------------------------------------------------------------------------
-- G. 적용 직후 자가 검증
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_oid oid;
BEGIN
  -- F11i: SECURITY INVOKER · search_path='' · 외부 EXECUTE 전부 0
  SELECT p.oid INTO v_oid
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'core_private' AND p.proname = 'record_cash_topup_impl'
     AND pg_get_function_identity_arguments(p.oid) = 'p_user_id uuid, p_amount_cents bigint, p_idempotency_key text'
     AND NOT p.prosecdef AND p.proconfig::text LIKE '%search_path=%';
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'S2_M9_SELFCHECK: F11i identity/attributes mismatch';
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'S2_M9_SELFCHECK: F11i external EXECUTE must be 0';
  END IF;
  -- F11·F12: SECDEF · search_path='' · service_role 만 EXECUTE
  FOR v_oid IN
    SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'api_web_v1' AND p.proname IN ('record_cash_topup_v2','subscription_checkout_confirm_v2')
  LOOP
    IF NOT (SELECT p.prosecdef AND p.proconfig::text LIKE '%search_path=%' FROM pg_proc p WHERE p.oid = v_oid) THEN
      RAISE EXCEPTION 'S2_M9_SELFCHECK: F11/F12 attributes mismatch';
    END IF;
    IF has_function_privilege('anon', v_oid, 'EXECUTE')
       OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'S2_M9_SELFCHECK: F11/F12 must be service_role-only';
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'api_web_v1' AND p.proname IN ('record_cash_topup_v2','subscription_checkout_confirm_v2')) <> 2 THEN
    RAISE EXCEPTION 'S2_M9_SELFCHECK: entrypoint census mismatch';
  END IF;
  -- 2층 레거시: 시그니처·void·SECDEF·service_role 전용 불변 + impl 위임 확인
  SELECT p.oid INTO v_oid
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'record_cash_topup'
     AND pg_get_function_identity_arguments(p.oid) = 'p_user_id uuid, p_amount_cents bigint, p_idempotency_key text'
     AND p.prorettype = 'void'::regtype AND p.prosecdef
     AND p.prosrc LIKE '%core_private.record_cash_topup_impl%';
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'S2_M9_SELFCHECK: legacy record_cash_topup replacement mismatch';
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'S2_M9_SELFCHECK: legacy record_cash_topup ACL must be unchanged (service_role only)';
  END IF;
  -- census: api_web_v1 함수 14(M6 6 + M7 3 + M8 2 + M14 1 + M9 2) · core_private 6(F10+B4종+F11i)
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'api_web_v1') <> 14 THEN
    RAISE EXCEPTION 'S2_M9_SELFCHECK: api_web_v1 function census must be 14';
  END IF;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'core_private') <> 6 THEN
    RAISE EXCEPTION 'S2_M9_SELFCHECK: core_private function census must be 6';
  END IF;
  -- default privilege 방어: PUBLIC 에 EXECUTE 를 주는 defacl 행 부재(M1 실측 주석 참조)
  IF EXISTS (SELECT 1 FROM pg_default_acl d JOIN pg_namespace n ON n.oid = d.defaclnamespace
              WHERE n.nspname IN ('api_web_v1','core_private') AND d.defaclacl::text LIKE '%=X/%') THEN
    RAISE EXCEPTION 'S2_M9_SELFCHECK: unexpected PUBLIC-granting default acl';
  END IF;
END $$;

commit;
