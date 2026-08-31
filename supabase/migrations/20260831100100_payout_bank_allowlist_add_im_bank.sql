-- =============================================================================
-- 189_payout_bank_allowlist_add_im_bank.sql  (2026-08-31)
--
-- Purpose: F13 `api_web_v1.mentor_payout_account_update_self` 은행명 allowlist
--   16종 → 17종. `iM뱅크` 추가 (DGB대구은행 → iM뱅크 명칭 전환 반영).
--   웹 정본 components/mentor/payouts/MentorPayoutAccountPanel.tsx BANK_OPTIONS 와
--   바이트 단위 동일 문자열 유지 (양쪽 동시 반영 — 본 PR).
--
-- Base: supabase/sql/20260730112531_api_web_v1_payout_account_rpc.sql (S2 M14) 본문.
--   이후 이 함수를 재정의한 migration 없음 (20260730195147·20260730195156 은 참조만).
--
-- 변경 없음: 시그니처(text, text) · SECURITY DEFINER · search_path '' · 오류코드 ·
--   상태 게이트 · 계좌 정규식 ^[0-9]{8,24}$ · 마스킹 식 · ACL(authenticated, service_role).
--
-- Apply: 저장소 표준 경로(db-apply-pending) — MCP apply_migration 직접 적용 금지.
--   pack 등재: supabase/baseline/post_ledger_backfills/20260831100100_payout_bank_allowlist_add_im_bank.sql
--
-- Rollback: 위 Base 파일의 함수 본문(16종)을 CREATE OR REPLACE 로 재적용. 데이터 무접촉.
--   (이미 'iM뱅크' 로 저장된 mentor_profiles 행은 남으며, UI customBankOption 으로
--    표시되고 재저장 시에만 PAYOUT_BANK_NAME_INVALID 로 거부됨.)
-- =============================================================================

begin;

-- A. 사전 게이트 — 함수가 실재하고 아직 iM뱅크가 없는 상태여야 한다
DO $$
DECLARE v_src text;
BEGIN
  SELECT p.prosrc INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'api_web_v1' AND p.proname = 'mentor_payout_account_update_self'
     AND pg_get_function_identity_arguments(p.oid) = 'p_bank_name text, p_account_number text';
  IF v_src IS NULL THEN
    RAISE EXCEPTION '189_GATE: F13 mentor_payout_account_update_self not present';
  END IF;
  IF v_src LIKE '%''iM뱅크''%' THEN
    RAISE EXCEPTION '189_GATE: iM뱅크 already in allowlist — nothing to do';
  END IF;
  IF v_src NOT LIKE '%''우체국''%' THEN
    RAISE EXCEPTION '189_GATE: base allowlist shape mismatch (우체국 not found)';
  END IF;
END $$;

-- B. F13 재정의 — allowlist 에 'iM뱅크' 추가 외 원본과 동일
CREATE OR REPLACE FUNCTION api_web_v1.mentor_payout_account_update_self(
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

  -- 은행명 allowlist (웹 정본 BANK_OPTIONS 17종 — MentorPayoutAccountPanel.tsx)
  IF v_bank NOT IN ('KB국민은행', '신한은행', '우리은행', '하나은행', 'NH농협은행',
                    'IBK기업은행', '카카오뱅크', '토스뱅크', '케이뱅크', 'SC제일은행',
                    '씨티은행', 'KDB산업은행', '수협은행', '신협', '새마을금고', '우체국',
                    'iM뱅크') THEN
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
  'S2 M14 F13(계약 §7 — rev 8 A-4, U-06 해소): 정산계좌 전용 RPC — 승인 멘토·은행 allowlist 17종(189: +iM뱅크)·계좌 8~24 숫자·원문 비반환(끝 4자리 마스킹). M11 게이트 ② 선행.';

-- C. GRANT 재선언 (§10.3 — 멱등, ACL 집합 불변 확인용)
REVOKE ALL ON FUNCTION api_web_v1.mentor_payout_account_update_self(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api_web_v1.mentor_payout_account_update_self(text, text) TO authenticated, service_role;

-- D. 적용 직후 자가 검증 — 원본 M14 §D 와 동일 조건 + iM뱅크 실재
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'api_web_v1' AND p.proname = 'mentor_payout_account_update_self'
                    AND pg_get_function_identity_arguments(p.oid) = 'p_bank_name text, p_account_number text'
                    AND p.prosecdef AND p.proconfig::text LIKE '%search_path=%'
                    AND p.prosrc LIKE '%''iM뱅크''%'
                    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
                    AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
                    AND has_function_privilege('service_role', p.oid, 'EXECUTE')
                    AND (p.proacl IS NULL OR (p.proacl::text NOT LIKE '{=%' AND p.proacl::text NOT LIKE '%,=%'))) THEN
    RAISE EXCEPTION '189_SELFCHECK: F13 hardening/allowlist mismatch';
  END IF;
END $$;

commit;
