-- =============================================================================
-- 20260730095441_api_web_v1_read_views_rollback.sql (S2 M4 rollback)
-- =============================================================================
-- forward: supabase/sql/20260730095441_api_web_v1_read_views.sql
-- 정본: 계약 §20.2 M4("DROP VIEW") · §22 #2(역의존 — M4 는 M13·M1 보다 먼저).
-- 제거 대상은 M4 가 만든 View 5종뿐이며 생성 역순으로 제거한다:
--   V5 my_cash_ledger_v1 → V4 my_wallet_v1 → V3 mentor_directory_v1
--   → V2 community_comments_v1 → V1 community_posts_v1
-- 손대지 않는 것: schema 2종(M1 rollback 소유) · 기존 public 객체·권한·데이터.
-- 금지: CASCADE · IF EXISTS 은닉(부분 상태는 실패로 드러낸다).
-- 실행: 장애 시 오너 승인 후 apply_migration 으로 이 파일 1건을 명시 선택,
--   ledger name = 20260730095441_api_web_v1_read_views_rollback
--   (원장 새 행 append — forward 행 삭제·수정·reverted 처리 금지).
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- A. 사전 게이트 — M4 적용 상태(정확히 View 5종) 확인
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_cnt int;
BEGIN
  SELECT count(*) INTO v_cnt
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'api_web_v1' AND c.relkind = 'v'
     AND c.relname IN ('community_posts_v1', 'community_comments_v1', 'mentor_directory_v1',
                       'my_wallet_v1', 'my_cash_ledger_v1');
  IF v_cnt <> 5
     OR (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'api_web_v1') <> 5 THEN
    RAISE EXCEPTION 'S2_M4_ROLLBACK_GATE: api_web_v1 must contain exactly the 5 M4 views (matched %)', v_cnt;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- B. View 5종 제거 — 생성 역순 · RESTRICT (CASCADE 금지)
-- -----------------------------------------------------------------------------
DROP VIEW api_web_v1.my_cash_ledger_v1;
DROP VIEW api_web_v1.my_wallet_v1;
DROP VIEW api_web_v1.mentor_directory_v1;
DROP VIEW api_web_v1.community_comments_v1;
DROP VIEW api_web_v1.community_posts_v1;

-- -----------------------------------------------------------------------------
-- C. 사후 자가 검증 — schema 는 남고(M1 소유) api_web_v1 객체 0
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'api_web_v1')
     OR NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'core_private') THEN
    RAISE EXCEPTION 'S2_M4_ROLLBACK_SELFCHECK: M1 schemas must remain (M1 rollback 소유)';
  END IF;
  IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'api_web_v1') <> 0 THEN
    RAISE EXCEPTION 'S2_M4_ROLLBACK_SELFCHECK: api_web_v1 not empty after view drops';
  END IF;
END $$;

commit;
