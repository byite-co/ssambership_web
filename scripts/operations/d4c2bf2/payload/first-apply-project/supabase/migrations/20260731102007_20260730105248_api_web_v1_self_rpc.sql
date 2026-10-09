-- =============================================================================
-- 20260730105248_api_web_v1_self_rpc.sql (S2 M6)
-- =============================================================================
-- api_web_v1 self RPC — F1·F2·F3·F9 + V6·V7 조회 RPC + GRANT.
-- 정본 계약: docs/contracts/api_web_v1_contract_v1_1.md
--   §7 F1(weekly_question_usage_self — XW-01 해소: 학생 id 를 인자로 받지 않고
--     auth.uid() 도출, 계산부는 정본 get_weekly_question_usage 호출로 단일화) ·
--   §7 F2(ensure_free_question_room — F10 얇은 wrapper, 앱 동명 함수와 시그니처·
--     반환·오류코드 완전 동일) ·
--   §7 F3(qna_create_question_thread — 정본 호출 + 예외→envelope 변환(XW-07),
--     트리거 FREE_QUESTION_* 4종을 FREE_QUOTA_* 로 수렴(XW-08), 사전에 없는
--     예외는 그대로 전파 — §8.2) ·
--   §7 F9(account_deletion_status_self — 기존 public 함수 얇은 wrapper,
--     envelope(ok/contract_version) 통일 + §8.3 job_id 필드) ·
--   §6 V6(my_subscriptions_self — 범위 제한 SECDEF RPC, subscriptions_select_parties
--     와 동일한 당사자 판정식, current_plan_amount_cents = 라이브 mentor_plans) ·
--   §6 V7(mentor_settlement_self — ssi_select_mentor_own 동일 판정식,
--     idempotency_key·ledger_id·payment_id 비노출) ·
--   §8(envelope) · §9(오류코드 사전) · §10.3(GRANT — authenticated·service_role).
--   라벨 규칙(§7 F0 승계): users.nickname 만, 비면 '쌤버십 사용자'. PII 미반환.
-- 선행조건: M5(20260730105244) 적용 완료(§20.2.1 — M6 : M5).
-- rollback 정본: supabase/rollback/20260730105248_api_web_v1_self_rpc_rollback.sql
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- A. 사전 게이트
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  -- M1·M5 적용 확인
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'api_web_v1') THEN
    RAISE EXCEPTION 'BATCH_C_BASELINE_OBJECT_MISMATCH: M1 api_web_v1 schema not applied';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'core_private' AND p.proname = 'ensure_student_mentor_room') THEN
    RAISE EXCEPTION 'BATCH_C_BASELINE_OBJECT_MISMATCH: M5 F10 not applied';
  END IF;
  -- 정본 함수 실측
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'get_weekly_question_usage'
                    AND pg_get_function_identity_arguments(p.oid) = 'p_student_id uuid, p_mentor_id uuid')
     OR NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'qna_create_question_thread'
                    AND pg_get_function_identity_arguments(p.oid)
                        = 'p_room_id uuid, p_title text, p_subject text, p_topic text, p_first_message_body text')
     OR NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'account_deletion_status_self')
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public'
            AND p.proname IN ('account_deletion_active_job_id', 'account_deletion_latest_job_id')) <> 2 THEN
    RAISE EXCEPTION 'BATCH_C_BASELINE_OBJECT_MISMATCH: canonical public functions missing';
  END IF;
  -- V6·V7 기반 컬럼 실측 (불일치는 추정하지 않고 중단)
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'subscriptions'
         AND column_name IN ('id','student_id','mentor_id','plan_id','plan_tier','status','started_at',
                             'current_period_start','current_period_end','next_billing_at',
                             'cancel_at_period_end','grace_until','created_at')) <> 13
     OR (SELECT count(*) FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'mentor_plans'
            AND column_name IN ('id','amount_cents')) <> 2
     OR (SELECT count(*) FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'subscription_settlement_items'
            AND column_name IN ('id','subscription_id','mentor_id','student_id','event_type','billing_at',
                                'period_start','period_end','gross_cents','platform_fee_cents',
                                'mentor_amount_cents','fee_rate','status','hold_reason','paid_at','created_at')) <> 16 THEN
    RAISE EXCEPTION 'BATCH_C_BASELINE_OBJECT_MISMATCH: V6/V7 base columns mismatch';
  END IF;
  -- 대상 선재 금지
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'api_web_v1'
                AND p.proname IN ('weekly_question_usage_self','ensure_free_question_room',
                                  'qna_create_question_thread','account_deletion_status_self',
                                  'my_subscriptions_self','mentor_settlement_self')) THEN
    RAISE EXCEPTION 'UNEXPECTED_EXISTING_CONTRACT_OBJECT: M6 target functions already exist';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- B. F1 weekly_question_usage_self (T2 — XW-01 해소)
-- -----------------------------------------------------------------------------
CREATE FUNCTION api_web_v1.weekly_question_usage_self(p_mentor_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  -- 사전 검사 필수(§7 F1) — 정본의 원문 raise 가 새어 나가지 않게 선검사한다
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'AUTH_REQUIRED');
  END IF;
  IF p_mentor_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'MENTOR_ID_REQUIRED');
  END IF;
  -- 계산부는 정본 단일화 — 한도 규칙을 두 곳에 만들지 않는다(§7 F1)
  RETURN public.get_weekly_question_usage(v_uid, p_mentor_id)::jsonb
         || jsonb_build_object('ok', true, 'contract_version', 1);
END $$;

COMMENT ON FUNCTION api_web_v1.weekly_question_usage_self(uuid) IS
  'S2 M6 F1(계약 §7): 자기 주간 사용량 — 학생 id 는 auth.uid() 로만 도출(XW-01). 계산은 정본 get_weekly_question_usage 호출.';

-- -----------------------------------------------------------------------------
-- C. F2 ensure_free_question_room (T2 — F10 얇은 wrapper, 앱 동명과 완전 동일)
-- -----------------------------------------------------------------------------
CREATE FUNCTION api_web_v1.ensure_free_question_room(p_mentor_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'AUTH_REQUIRED');
  END IF;
  IF p_mentor_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'MENTOR_NOT_FOUND');
  END IF;
  -- 자격 판정·원자성은 전부 F10 이 수행(§7 F2 — wrapper 는 auth.uid() 결합만)
  RETURN core_private.ensure_student_mentor_room(v_uid, p_mentor_id, NULL, NULL, true)
         || jsonb_build_object('contract_version', 1);
END $$;

COMMENT ON FUNCTION api_web_v1.ensure_free_question_room(uuid) IS
  'S2 M6 F2(계약 §7): 무료질문 방 확보 — core_private.ensure_student_mentor_room(F10) 얇은 wrapper. 앱 동명 함수와 시그니처·반환·오류코드 동일.';

-- -----------------------------------------------------------------------------
-- D. F3 qna_create_question_thread (T2 — 정본 호출 + envelope 변환, XW-07/XW-08)
-- -----------------------------------------------------------------------------
CREATE FUNCTION api_web_v1.qna_create_question_thread(
  p_room_id uuid,
  p_title text,
  p_subject text DEFAULT NULL,
  p_topic text DEFAULT NULL,
  p_first_message_body text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_res  jsonb;
  v_code text;
BEGIN
  -- 판정 로직을 복제하지 않는다 — 정본 호출 + 예외의 안정 코드 변환만(§13.2)
  v_res := public.qna_create_question_thread(p_room_id, p_title, p_subject, p_topic, p_first_message_body);
  RETURN v_res || jsonb_build_object('contract_version', 1);
EXCEPTION WHEN OTHERS THEN
  v_code := CASE SQLERRM
    -- 트리거 코드 수렴(XW-08 — §9.8 매핑표)
    WHEN 'FREE_QUESTION_EXPIRED'           THEN 'FREE_QUOTA_EXPIRED'
    WHEN 'FREE_QUESTION_TOTAL_LIMIT'       THEN 'FREE_QUOTA_TOTAL_EXHAUSTED'
    WHEN 'FREE_QUESTION_PER_MENTOR_LIMIT'  THEN 'FREE_QUOTA_MENTOR_EXHAUSTED'
    WHEN 'FREE_QUESTION_STUDENT_NOT_FOUND' THEN 'FREE_QUOTA_STUDENT_NOT_FOUND'
    -- 정본 raise 14종(실측 전수 — §9.8 "qna_* raise 14종 동명 유지")
    WHEN 'AUTH_REQUIRED'                 THEN 'AUTH_REQUIRED'
    WHEN 'TITLE_REQUIRED'                THEN 'TITLE_REQUIRED'
    WHEN 'ROOM_NOT_FOUND'                THEN 'ROOM_NOT_FOUND'
    WHEN 'NOT_ROOM_PARTY'                THEN 'NOT_ROOM_PARTY'
    WHEN 'MENTOR_CANNOT_CREATE_THREAD'   THEN 'MENTOR_CANNOT_CREATE_THREAD'
    WHEN 'ACCOUNT_BANNED'                THEN 'ACCOUNT_BANNED'
    WHEN 'ACCOUNT_SUSPENDED'             THEN 'ACCOUNT_SUSPENDED'
    WHEN 'ACCOUNT_DELETION_IN_PROGRESS'  THEN 'ACCOUNT_DELETION_IN_PROGRESS'
    WHEN 'BLOCKED'                       THEN 'BLOCKED'
    WHEN 'MENTOR_NOT_APPROVED'           THEN 'MENTOR_NOT_APPROVED'
    WHEN 'SUBSCRIPTION_REFUND_PENDING'   THEN 'SUBSCRIPTION_REFUND_PENDING'
    WHEN 'WEEKLY_LIMIT_EXHAUSTED'        THEN 'WEEKLY_LIMIT_EXHAUSTED'
    WHEN 'FREE_QUOTA_EXPIRED'            THEN 'FREE_QUOTA_EXPIRED'
    WHEN 'FREE_QUOTA_TOTAL_EXHAUSTED'    THEN 'FREE_QUOTA_TOTAL_EXHAUSTED'
    WHEN 'FREE_QUOTA_MENTOR_EXHAUSTED'   THEN 'FREE_QUOTA_MENTOR_EXHAUSTED'
    ELSE NULL
  END;
  IF v_code IS NULL THEN
    -- 사전에 없는 예외는 삼키지 않고 그대로 전파(§8.2 — T-CON-06)
    RAISE;
  END IF;
  RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', v_code);
END $$;

COMMENT ON FUNCTION api_web_v1.qna_create_question_thread(uuid, text, text, text, text) IS
  'S2 M6 F3(계약 §7): 정본 스레드 생성 호출 + raise→안정 코드 envelope 변환(XW-07) + FREE_QUESTION_* 수렴(XW-08). 사전 밖 예외는 전파.';

-- -----------------------------------------------------------------------------
-- E. F9 account_deletion_status_self (T2 — 얇은 wrapper, envelope 통일)
-- -----------------------------------------------------------------------------
CREATE FUNCTION api_web_v1.account_deletion_status_self()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_res jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'AUTH_REQUIRED');
  END IF;
  v_res := public.account_deletion_status_self();
  -- §8.3 F9 필드(state·cancelable_until·job_id) — job_id 는 정본이 쓰는 동일 헬퍼로 도출
  RETURN v_res || jsonb_build_object(
    'contract_version', 1,
    'job_id', coalesce(public.account_deletion_active_job_id(v_uid),
                       public.account_deletion_latest_job_id(v_uid)));
END $$;

COMMENT ON FUNCTION api_web_v1.account_deletion_status_self() IS
  'S2 M6 F9(계약 §7): 기존 public.account_deletion_status_self 얇은 wrapper — envelope(ok/contract_version)·job_id 통일. 신규 판정 로직 없음.';

-- -----------------------------------------------------------------------------
-- F. V6 my_subscriptions_self() — 범위 제한 SECDEF 조회 RPC (§6 V6)
-- -----------------------------------------------------------------------------
CREATE FUNCTION api_web_v1.my_subscriptions_self()
RETURNS TABLE (
  subscription_id            uuid,
  mentor_id                  uuid,
  mentor_label               text,
  plan_id                    uuid,
  plan_tier                  text,
  current_plan_amount_cents  integer,
  status                     text,
  started_at                 timestamptz,
  current_period_start       timestamptz,
  current_period_end         timestamptz,
  next_billing_at            timestamptz,
  cancel_at_period_end       boolean,
  grace_until                timestamptz,
  created_at                 timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- 빈 결과가 아니라 예외 42501 (§6 V6)
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING errcode = '42501';
  END IF;
  RETURN QUERY
  SELECT
    s.id,
    s.mentor_id,
    coalesce(nullif(btrim(u.nickname), ''), '쌤버십 사용자'),  -- F0 승계 라벨 규칙(PII 미반환)
    s.plan_id,
    s.plan_tier,
    mp.amount_cents,                                            -- 라이브 현재 플랜 가격(rev 8 §6.4 필드명 확정)
    s.status,
    s.started_at,
    s.current_period_start,
    s.current_period_end,
    s.next_billing_at,
    s.cancel_at_period_end,
    s.grace_until,
    s.created_at
  FROM public.subscriptions s
  LEFT JOIN public.users u ON u.id = s.mentor_id
  LEFT JOIN public.mentor_plans mp ON mp.id = s.plan_id
  WHERE (SELECT auth.uid()) IN (s.student_id, s.mentor_id);     -- subscriptions_select_parties 동일 판정식
END $$;

COMMENT ON FUNCTION api_web_v1.my_subscriptions_self() IS
  'S2 M6 V6(계약 §6): 자기 당사자 구독 조회 RPC — 당사자 판정식은 subscriptions_select_parties 와 동일. XW-10 프로빙 대체.';

-- -----------------------------------------------------------------------------
-- G. V7 mentor_settlement_self() — 범위 제한 SECDEF 조회 RPC (§6 V7)
-- -----------------------------------------------------------------------------
CREATE FUNCTION api_web_v1.mentor_settlement_self()
RETURNS TABLE (
  item_id             uuid,
  subscription_id     uuid,
  student_label       text,
  event_type          text,
  billing_at          timestamptz,
  period_start        timestamptz,
  period_end          timestamptz,
  gross_cents         bigint,
  platform_fee_cents  bigint,
  mentor_amount_cents bigint,
  fee_rate            numeric,
  status              text,
  hold_reason         text,
  paid_at             timestamptz,
  created_at          timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING errcode = '42501';
  END IF;
  RETURN QUERY
  SELECT
    i.id,
    i.subscription_id,
    coalesce(nullif(btrim(u.nickname), ''), '쌤버십 사용자'),  -- F0 승계 라벨 규칙
    i.event_type,
    i.billing_at,
    i.period_start,
    i.period_end,
    i.gross_cents,
    i.platform_fee_cents,
    i.mentor_amount_cents,
    i.fee_rate,
    i.status,
    i.hold_reason,
    i.paid_at,
    i.created_at
  FROM public.subscription_settlement_items i
  LEFT JOIN public.users u ON u.id = i.student_id
  WHERE i.mentor_id = (SELECT auth.uid());                      -- ssi_select_mentor_own 동일 판정식
  -- idempotency_key·ledger_id·payment_id 는 내부 참조 — 노출하지 않는다(§6 V7)
END $$;

COMMENT ON FUNCTION api_web_v1.mentor_settlement_self() IS
  'S2 M6 V7(계약 §6): 멘토 자기 정산 항목 조회 RPC — ssi_select_mentor_own 동일 판정식. idempotency_key/ledger_id/payment_id 비노출.';

-- -----------------------------------------------------------------------------
-- H. GRANT (§10.3 — 명시 REVOKE 는 default privileges 와 이중 방어)
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION api_web_v1.weekly_question_usage_self(uuid)                          FROM PUBLIC;
REVOKE ALL ON FUNCTION api_web_v1.ensure_free_question_room(uuid)                            FROM PUBLIC;
REVOKE ALL ON FUNCTION api_web_v1.qna_create_question_thread(uuid, text, text, text, text)   FROM PUBLIC;
REVOKE ALL ON FUNCTION api_web_v1.account_deletion_status_self()                             FROM PUBLIC;
REVOKE ALL ON FUNCTION api_web_v1.my_subscriptions_self()                                    FROM PUBLIC;
REVOKE ALL ON FUNCTION api_web_v1.mentor_settlement_self()                                   FROM PUBLIC;

GRANT EXECUTE ON FUNCTION api_web_v1.weekly_question_usage_self(uuid)                        TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION api_web_v1.ensure_free_question_room(uuid)                         TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION api_web_v1.qna_create_question_thread(uuid, text, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION api_web_v1.account_deletion_status_self()                          TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION api_web_v1.my_subscriptions_self()                                 TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION api_web_v1.mentor_settlement_self()                                TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- I. 적용 직후 자가 검증
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_cnt int;
BEGIN
  SELECT count(*) INTO v_cnt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'api_web_v1'
     AND p.prosecdef AND p.proconfig::text LIKE '%search_path=%'
     AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
     AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND has_function_privilege('service_role', p.oid, 'EXECUTE')
     AND (p.proacl IS NULL OR (p.proacl::text NOT LIKE '{=%' AND p.proacl::text NOT LIKE '%,=%'))
     AND (pg_get_function_identity_arguments(p.oid), p.proname) IN
         (('p_mentor_id uuid', 'weekly_question_usage_self'),
          ('p_mentor_id uuid', 'ensure_free_question_room'),
          ('p_room_id uuid, p_title text, p_subject text, p_topic text, p_first_message_body text', 'qna_create_question_thread'),
          (('', 'account_deletion_status_self')),
          (('', 'my_subscriptions_self')),
          (('', 'mentor_settlement_self')));
  IF v_cnt <> 6 THEN
    RAISE EXCEPTION 'S2_M6_SELFCHECK: expected 6 hardened api_web_v1 functions, matched %', v_cnt;
  END IF;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'api_web_v1') <> 6 THEN
    RAISE EXCEPTION 'S2_M6_SELFCHECK: api_web_v1 must contain exactly 6 functions after M6';
  END IF;
END $$;

commit;
