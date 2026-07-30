-- =============================================================================
-- 20260730112531_api_web_v1_payout_account_rpc.sql (S2 M14)
-- =============================================================================
-- F13 mentor_payout_account_update_self — 정산계좌 전용 RPC (rev 8 A-4, U-06 해소).
-- 정본 계약: docs/contracts/api_web_v1_contract_v1_1.md §7 F13 · §9.5 · §10.3 ·
--            §11.5 · §20.2 M14 (M11 게이트 ② 의 선행 조건).
--   - 정산계좌(payout_*)는 자금 수취 대상이라 프로필 수정(F7)과 분리한다.
--   - 대상 행은 auth.uid() 자체 도출(§11.3 — user_id 인자 없음).
--   - 승인 멘토 판정 = individual_question_user_is_approved_mentor(auth.uid())
--     (판정식 이원화 금지). 실패 시 MENTOR_NOT_APPROVED.
--   - 은행명 allowlist = 웹 정본 BANK_OPTIONS 16종
--     (components/mentor/payouts/MentorPayoutAccountPanel.tsx 실측) —
--     밖이면 PAYOUT_BANK_NAME_INVALID.
--   - 계좌번호는 숫자만·길이 8~24 — 위반 시 PAYOUT_ACCOUNT_NUMBER_INVALID
--     (웹 정본 mentorPayoutAccountActions.ts 의 8~24 규칙과 동일).
--   - 계좌 원문 비반환 — 성공 {ok, contract_version, updated_at, account_masked}
--     (끝 4자리 외 '*' 마스킹 — §11.4).
--   - 관리자/service_role 조회·수정 겸용 경로를 만들지 않는다(별도 계약).
--   - SECDEF + SET search_path='' · PUBLIC EXECUTE 회수 · EXECUTE
--     {authenticated, service_role}(§10.3 — anon 0).
-- 선행조건: M1(20260730095435) 적용 완료(§20.2.1 — M14 : M1).
-- rollback 정본: supabase/rollback/20260730112531_api_web_v1_payout_account_rpc_rollback.sql
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- A. 사전 게이트
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'api_web_v1') THEN
    RAISE EXCEPTION 'BATCH_D_BASELINE_OBJECT_MISMATCH: M1 api_web_v1 schema not applied';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'mentor_profiles'
         AND column_name IN ('user_id', 'payout_bank_name', 'payout_account_number', 'updated_at')) <> 4
     OR NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'public'
                       AND p.proname = 'individual_question_user_is_approved_mentor') THEN
    RAISE EXCEPTION 'BATCH_D_BASELINE_OBJECT_MISMATCH: payout base objects mismatch';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'api_web_v1' AND p.proname = 'mentor_payout_account_update_self') THEN
    RAISE EXCEPTION 'UNEXPECTED_EXISTING_CONTRACT_OBJECT: F13 already exists';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- B. F13
-- -----------------------------------------------------------------------------
CREATE FUNCTION api_web_v1.mentor_payout_account_update_self(
  p_bank_name text, p_account_number text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE
  v_uid    uuid := (SELECT auth.uid());
  v_role   text;
  v_status text;
  v_susp   timestamptz;
  v_bank   text := btrim(coalesce(p_bank_name, ''));
  v_acct   text := btrim(coalesce(p_account_number, ''));
  v_updated timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'AUTH_REQUIRED');
  END IF;
  SELECT u.role, u.status, u.suspended_until INTO v_role, v_status, v_susp
    FROM public.users u WHERE u.id = v_uid;
  IF NOT FOUND OR v_role IS DISTINCT FROM 'mentor' THEN
    RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'ROLE_NOT_MENTOR');
  END IF;
  IF lower(coalesce(v_status, 'active')) = 'banned' THEN
    RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'ACCOUNT_BANNED');
  END IF;
  IF lower(coalesce(v_status, 'active')) = 'suspended' AND (v_susp IS NULL OR v_susp > now()) THEN
    RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'ACCOUNT_SUSPENDED');
  END IF;
  IF public.account_deletion_write_blocked(v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'ACCOUNT_DELETION_IN_PROGRESS');
  END IF;
  IF NOT public.individual_question_user_is_approved_mentor(v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'MENTOR_NOT_APPROVED');
  END IF;

  -- 은행명 allowlist (웹 정본 BANK_OPTIONS 16종 — MentorPayoutAccountPanel.tsx)
  IF v_bank NOT IN ('KB국민은행', '신한은행', '우리은행', '하나은행', 'NH농협은행',
                    'IBK기업은행', '카카오뱅크', '토스뱅크', '케이뱅크', 'SC제일은행',
                    '씨티은행', 'KDB산업은행', '수협은행', '신협', '새마을금고', '우체국') THEN
    RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'PAYOUT_BANK_NAME_INVALID');
  END IF;
  -- 계좌번호 숫자만·길이 8~24
  IF v_acct !~ '^[0-9]{8,24}$' THEN
    RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'PAYOUT_ACCOUNT_NUMBER_INVALID');
  END IF;

  UPDATE public.mentor_profiles mp
     SET payout_bank_name = v_bank,
         payout_account_number = v_acct
   WHERE mp.user_id = v_uid
   RETURNING mp.updated_at INTO v_updated;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'MENTOR_PROFILE_NOT_FOUND');
  END IF;

  -- 계좌 원문 비반환 — 끝 4자리 외 마스킹(§11.4)
  RETURN jsonb_build_object('ok', true, 'contract_version', 1, 'updated_at', v_updated,
    'account_masked', repeat('*', greatest(char_length(v_acct) - 4, 0)) || right(v_acct, 4));
END $fn$;

COMMENT ON FUNCTION api_web_v1.mentor_payout_account_update_self(text, text) IS
  'S2 M14 F13(계약 §7 — rev 8 A-4, U-06 해소): 정산계좌 전용 RPC — 승인 멘토·은행 allowlist·계좌 8~24 숫자·원문 비반환(끝 4자리 마스킹). M11 게이트 ② 선행.';

-- -----------------------------------------------------------------------------
-- C. GRANT (§10.3)
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION api_web_v1.mentor_payout_account_update_self(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api_web_v1.mentor_payout_account_update_self(text, text) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- D. 적용 직후 자가 검증
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'api_web_v1' AND p.proname = 'mentor_payout_account_update_self'
                    AND pg_get_function_identity_arguments(p.oid) = 'p_bank_name text, p_account_number text'
                    AND p.prosecdef AND p.proconfig::text LIKE '%search_path=%'
                    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
                    AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
                    AND has_function_privilege('service_role', p.oid, 'EXECUTE')
                    AND (p.proacl IS NULL OR (p.proacl::text NOT LIKE '{=%' AND p.proacl::text NOT LIKE '%,=%'))) THEN
    RAISE EXCEPTION 'S2_M14_SELFCHECK: F13 hardening mismatch';
  END IF;
END $$;

commit;
