-- =============================================================================
-- 20260730105248_api_web_v1_self_rpc_rollback.sql (S2 M6 rollback)
-- =============================================================================
-- forward: supabase/sql/20260730105248_api_web_v1_self_rpc.sql
-- 정본: 계약 §20.2 M6 · §22 #2. 제거 대상은 M6 이 만든 6객체(F1·F2·F3·F9·V6·V7)
-- 뿐이다 — 생성 역순 DROP · CASCADE 금지 · 정본 public 함수·데이터 무접촉.
-- Batch C 역순 정본: M7 → M6 → M5 (이 파일은 M7 rollback 후 실행).
-- 실행: ledger name = 20260730105248_api_web_v1_self_rpc_rollback (원장 새 행 append).
-- =============================================================================

begin;

DO $$
BEGIN
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'api_web_v1'
         AND p.proname IN ('weekly_question_usage_self','ensure_free_question_room',
                           'qna_create_question_thread','account_deletion_status_self',
                           'my_subscriptions_self','mentor_settlement_self')) <> 6 THEN
    RAISE EXCEPTION 'S2_M6_ROLLBACK_GATE: M6 forward state incomplete — nothing/partial to roll back';
  END IF;
END $$;

DROP FUNCTION api_web_v1.mentor_settlement_self();
DROP FUNCTION api_web_v1.my_subscriptions_self();
DROP FUNCTION api_web_v1.account_deletion_status_self();
DROP FUNCTION api_web_v1.qna_create_question_thread(uuid, text, text, text, text);
DROP FUNCTION api_web_v1.ensure_free_question_room(uuid);
DROP FUNCTION api_web_v1.weekly_question_usage_self(uuid);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'api_web_v1'
                AND p.proname IN ('weekly_question_usage_self','ensure_free_question_room',
                                  'qna_create_question_thread','account_deletion_status_self',
                                  'my_subscriptions_self','mentor_settlement_self')) THEN
    RAISE EXCEPTION 'S2_M6_ROLLBACK_SELFCHECK: M6 objects not fully removed';
  END IF;
  -- M5 F10·M4 view 5종·정본 public 함수는 불변이어야 한다
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'core_private' AND p.proname = 'ensure_student_mentor_room')
     OR (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'api_web_v1' AND c.relkind = 'v') <> 5
     OR NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'qna_create_question_thread') THEN
    RAISE EXCEPTION 'S2_M6_ROLLBACK_SELFCHECK: out-of-scope objects were touched';
  END IF;
END $$;

commit;
