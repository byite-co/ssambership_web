-- =============================================================================
-- 20260730090043_api_web_v1_schemas_rollback.sql (S2 M1 rollback)
-- =============================================================================
-- forward: supabase/sql/20260730090043_api_web_v1_schemas.sql
-- 정본: 물리 정책 §6·§7 / 계약 §20.2 M1("스키마 DROP — 비어 있을 때") · §22 #2.
-- 선행: M4 rollback 이 먼저 완료돼 두 schema 가 비어 있어야 한다.
--   생성 객체가 남아 있으면 DROP SCHEMA ... RESTRICT 가 실패한다 — 의도된 동작이며
--   CASCADE 로 우회하지 않는다.
-- 순서: forward 의 역순 —
--   ① default privilege 를 PostgreSQL 내장 기본값으로 복원(대칭 GRANT 로
--      pg_default_acl 항목 제거 — 역할 권한 확대가 아니라 forward 이전 상태 복원)
--   ② schema 2개 RESTRICT DROP (schema ACL·COMMENT 는 schema 와 함께 소멸)
-- 손대지 않는 것: 기존 public 객체·권한·데이터, anon/authenticated/service_role
--   역할 자체. rollback 편의를 이유로 기존 role 권한을 확대하지 않는다.
-- 실행: 장애 시 오너 승인 후 apply_migration 으로 이 파일 1건을 명시 선택,
--   ledger name = 20260730090043_api_web_v1_schemas_rollback
--   (원장 새 행 append — forward 행 삭제·수정·reverted 처리 금지).
-- =============================================================================

begin;

-- ① forward 의 ALTER DEFAULT PRIVILEGES ... REVOKE 를 대칭 복원.
--    (내장 기본값 재부여 = pg_default_acl 항목 소거. schema 한정이라 신규 함수가
--     생길 수 없는 상태로 직후 DROP 되므로 실권한 확대는 발생하지 않는다.)
ALTER DEFAULT PRIVILEGES IN SCHEMA api_web_v1  GRANT EXECUTE ON FUNCTIONS TO PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA core_private GRANT EXECUTE ON FUNCTIONS TO PUBLIC;

-- ② schema DROP — 비어 있지 않으면 실패해야 한다 (CASCADE 금지)
DROP SCHEMA api_web_v1 RESTRICT;
DROP SCHEMA core_private RESTRICT;

commit;
