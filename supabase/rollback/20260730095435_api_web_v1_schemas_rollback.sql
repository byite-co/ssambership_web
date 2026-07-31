-- =============================================================================
-- 20260730095435_api_web_v1_schemas_rollback.sql (S2 M1 rollback)
-- =============================================================================
-- forward: supabase/sql/20260730095435_api_web_v1_schemas.sql
-- 정본: 물리 정책 §6·§7 / 계약 §20.2 M1("스키마 DROP(비어 있을 때)") · §22 #2
--   (역의존: M4 rollback 이 먼저 — api_web_v1 객체가 남아 있으면 실행 금지).
-- 제거 대상은 M1 이 만든 상태뿐이다:
--   1) DROP SCHEMA api_web_v1 RESTRICT
--   2) DROP SCHEMA core_private RESTRICT
--   (default privileges 복원 조치는 불요 — forward 의 per-schema REVOKE 는
--    PG17.6 실측상 pg_default_acl 행을 만들지 않는 저장 no-op 이었다.
--    본문 B 주석 참조. GRANT 로 「복원」하면 오히려 새 항목이 생겨 금지.)
-- 금지: CASCADE(생성 객체가 남아 있으면 RESTRICT 실패가 정본 동작) ·
--   rollback 편의 목적의 기존 role 권한 확대 · public 스키마 객체 접촉.
-- 실행: 장애 시 오너 승인 후 apply_migration 으로 이 파일 1건을 명시 선택,
--   ledger name = 20260730095435_api_web_v1_schemas_rollback
--   (원장 새 행 append — forward 행 삭제·수정·reverted 처리 금지).
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- A. 사전 게이트 — M4 rollback 선행(스키마 비어 있음) 확인
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'api_web_v1')
     OR NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'core_private') THEN
    RAISE EXCEPTION 'S2_M1_ROLLBACK_GATE: M1 schemas not present — nothing to roll back';
  END IF;
  IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname IN ('api_web_v1', 'core_private')) > 0
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname IN ('api_web_v1', 'core_private')) > 0 THEN
    RAISE EXCEPTION 'S2_M1_ROLLBACK_GATE: schemas not empty — roll back M4(및 후속) first (RESTRICT 원칙)';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- B. default privileges — 복원 조치 불요 (PG17.6 실측, forward 섹션 D 기록 참조)
--    forward 의 per-schema REVOKE 는 선행 per-schema GRANT 가 없는 상태에서
--    pg_default_acl 행을 만들지 않는 저장 no-op 이었다(실측). 따라서 forward 전
--    상태(항목 0)가 이미 유지되고 있으며, 여기서 GRANT ... TO PUBLIC 을 실행하면
--    오히려 forward 전에 없던 새 default ACL 항목(권한 확대)을 만들게 되므로
--    금지한다. schema 에 귀속된 default ACL 항목이 만약 존재하더라도 아래
--    DROP SCHEMA 가 함께 제거한다 — 사후 검증(D)에서 항목 0 을 확인한다.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  -- PUBLIC 에 무언가를 부여하는 항목이 있다면 forward 상태가 아니다 — 중단.
  IF (SELECT count(*) FROM pg_default_acl d JOIN pg_namespace n ON n.oid = d.defaclnamespace
       WHERE n.nspname IN ('api_web_v1', 'core_private')
         AND (d.defaclacl::text LIKE '{=%' OR d.defaclacl::text LIKE '%,=%')) <> 0 THEN
    RAISE EXCEPTION 'S2_M1_ROLLBACK_GATE: unexpected PUBLIC-granting default ACL entry';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- C. schema 제거 — RESTRICT (CASCADE 금지)
-- -----------------------------------------------------------------------------
DROP SCHEMA api_web_v1 RESTRICT;
DROP SCHEMA core_private RESTRICT;

-- -----------------------------------------------------------------------------
-- D. 사후 자가 검증 — forward 전 상태 복원
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname IN ('api_web_v1', 'core_private')) THEN
    RAISE EXCEPTION 'S2_M1_ROLLBACK_SELFCHECK: schemas still present';
  END IF;
  -- forward 전 상태 = 두 schema 관련 default ACL 항목 0
  IF (SELECT count(*) FROM pg_default_acl d
       WHERE d.defaclnamespace <> 0
         AND NOT EXISTS (SELECT 1 FROM pg_namespace n WHERE n.oid = d.defaclnamespace)) <> 0 THEN
    RAISE EXCEPTION 'S2_M1_ROLLBACK_SELFCHECK: orphan default ACL entries remain';
  END IF;
END $$;

commit;
