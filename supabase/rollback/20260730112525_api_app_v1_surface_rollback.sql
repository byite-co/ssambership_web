-- =============================================================================
-- 20260730112525_api_app_v1_surface_rollback.sql (S2 M17 rollback)
-- =============================================================================
-- forward: supabase/sql/20260730112525_api_app_v1_surface.sql
-- 정본: 계약 §22 M17 rollback 필수 선행 순서(rev 8 F) / 앱 계약 §3.1.
-- 운영 순서(§22 — 로컬 검증 단계에서는 D-API-A 미실행이라 1~4·6이 해당 없음):
--   1) 앱 호출부를 구 public 경로로 복원 → 2) api_app_v1 호출 0건 실측 →
--   3) Exposed schemas 에서 api_app_v1 제거(D-API-A 역방향) → 4) config 반영 확인 →
--   5) wrapper 5종 → View → schema 순 DROP → 6) schema cache reload.
-- 이 파일은 5)의 SQL 부분만 소유한다 — CASCADE 금지 · core_private(M5·M7 공유
-- 객체)·api_web_v1·public 무접촉. Batch D 역순 정본: M14 → M8 → M17 (최후미).
-- 실행: ledger name = 20260730112525_api_app_v1_surface_rollback (원장 새 행 append).
-- =============================================================================

begin;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'api_app_v1')
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'api_app_v1') <> 5
     OR (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'api_app_v1') <> 1 THEN
    RAISE EXCEPTION 'S2_M17_ROLLBACK_GATE: M17 forward state incomplete — nothing/partial to roll back';
  END IF;
END $$;

-- wrapper 5종 (생성 역순)
DROP FUNCTION api_app_v1.community_post_soft_delete(uuid);
DROP FUNCTION api_app_v1.community_post_update(uuid, text, text, text, timestamptz, text[], text);
DROP FUNCTION api_app_v1.community_post_create(text, text, text, uuid, text[], text);
DROP FUNCTION api_app_v1.qna_create_question_thread(uuid, text, text, text, text);
DROP FUNCTION api_app_v1.ensure_free_question_room(uuid);
-- View → schema (RESTRICT — CASCADE 금지)
DROP VIEW api_app_v1.community_posts_v1;
DROP SCHEMA api_app_v1 RESTRICT;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'api_app_v1') THEN
    RAISE EXCEPTION 'S2_M17_ROLLBACK_SELFCHECK: schema still present';
  END IF;
  -- 공유 구현부(M5·M7)·웹 표면 불변
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'core_private') <> 5
     OR (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'api_web_v1' AND c.relkind = 'v') <> 5 THEN
    RAISE EXCEPTION 'S2_M17_ROLLBACK_SELFCHECK: shared/out-of-scope objects were touched';
  END IF;
END $$;

commit;
