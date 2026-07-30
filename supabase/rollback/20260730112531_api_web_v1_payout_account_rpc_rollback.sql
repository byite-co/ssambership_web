-- =============================================================================
-- 20260730112531_api_web_v1_payout_account_rpc_rollback.sql (S2 M14 rollback)
-- =============================================================================
-- forward: supabase/sql/20260730112531_api_web_v1_payout_account_rpc.sql
-- 정본: 계약 §20.2 M14 · §22 #2 (역의존 — M11 rollback 이 먼저. Batch D 시점에는
-- 미적용이라 Batch D 역순 최선두다). 제거 대상은 F13 1객체뿐 — CASCADE 금지 ·
-- mentor_profiles 데이터(정산계좌 값 포함) 무접촉. Batch D 역순: M14 → M8 → M17.
-- 실행: ledger name = 20260730112531_api_web_v1_payout_account_rpc_rollback (원장 새 행 append).
-- =============================================================================

begin;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'api_web_v1' AND p.proname = 'mentor_payout_account_update_self') THEN
    RAISE EXCEPTION 'S2_M14_ROLLBACK_GATE: F13 not present — nothing to roll back';
  END IF;
END $$;

DROP FUNCTION api_web_v1.mentor_payout_account_update_self(text, text);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'api_web_v1' AND p.proname = 'mentor_payout_account_update_self') THEN
    RAISE EXCEPTION 'S2_M14_ROLLBACK_SELFCHECK: F13 not removed';
  END IF;
END $$;

commit;
