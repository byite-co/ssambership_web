-- =============================================================================
-- 20260730112528_api_web_v1_mentor_rpc_rollback.sql (S2 M8 rollback)
-- =============================================================================
-- forward: supabase/sql/20260730112528_api_web_v1_mentor_rpc.sql
-- 정본: 계약 §20.2 M8 · §22 #2 (역의존 — M11·M12 rollback 이 먼저. Batch D 시점
-- 에는 미적용). 제거 대상은 F7·F8 2객체뿐 — CASCADE 금지 · mentor_profiles ·
-- mentor_plans 데이터·GRANT 무접촉. Batch D 역순 정본: M14 → M8 → M17.
-- 실행: ledger name = 20260730112528_api_web_v1_mentor_rpc_rollback (원장 새 행 append).
-- =============================================================================

begin;

DO $$
BEGIN
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'api_web_v1'
         AND p.proname IN ('mentor_profile_update_self', 'mentor_plan_prices_set_self')) <> 2 THEN
    RAISE EXCEPTION 'S2_M8_ROLLBACK_GATE: M8 forward state incomplete — nothing/partial to roll back';
  END IF;
END $$;

DROP FUNCTION api_web_v1.mentor_plan_prices_set_self(integer, integer, integer);
DROP FUNCTION api_web_v1.mentor_profile_update_self(text, text, text, text[], text, text, text, text, boolean);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'api_web_v1'
                AND p.proname IN ('mentor_profile_update_self', 'mentor_plan_prices_set_self')) THEN
    RAISE EXCEPTION 'S2_M8_ROLLBACK_SELFCHECK: M8 objects not fully removed';
  END IF;
END $$;

commit;
