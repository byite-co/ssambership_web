-- =============================================================================
-- 20260730090049_api_web_v1_read_views_rollback.sql (S2 M4 rollback)
-- =============================================================================
-- forward: supabase/sql/20260730090049_api_web_v1_read_views.sql
-- 정본: 물리 정책 §6·§7 / 계약 §20.2 M4("DROP VIEW") · §22 #2.
-- 제거 대상은 M4 가 만든 View 5종뿐이며, 생성의 역순으로 제거한다(역의존 순서).
--   View GRANT 는 View 와 함께 소멸한다 — 별도 회수 불요.
-- 손대지 않는 것: api_web_v1·core_private schema(M1 rollback 소유),
--   기존 public 객체·권한·데이터, M13 산출물. CASCADE 금지.
-- 실행: 장애 시 오너 승인 후 apply_migration 으로 이 파일 1건을 명시 선택,
--   ledger name = 20260730090049_api_web_v1_read_views_rollback
--   (원장 새 행 append — forward 행 삭제·수정·reverted 처리 금지).
-- =============================================================================

begin;

DROP VIEW api_web_v1.my_cash_ledger_v1;
DROP VIEW api_web_v1.my_wallet_v1;
DROP VIEW api_web_v1.mentor_directory_v1;
DROP VIEW api_web_v1.community_comments_v1;
DROP VIEW api_web_v1.community_posts_v1;

commit;
