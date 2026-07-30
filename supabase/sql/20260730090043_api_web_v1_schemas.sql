-- =============================================================================
-- 20260730090043_api_web_v1_schemas.sql (S2 M1)
-- =============================================================================
-- api_web_v1·core_private schema/권한 경계 생성.
-- 정본 계약: docs/contracts/api_web_v1_contract_v1_1.md §5.1~§5.3, §10.1, §20.2 M1.
--   - 생성 schema 는 정확히 2개: api_web_v1(외부 노출), core_private(내부 전용).
--   - api_web_v1: PUBLIC 권한 전면 회수 후 anon·authenticated·service_role 에 USAGE.
--   - core_private: PUBLIC·anon·authenticated·service_role 어디에도 USAGE 0
--     (rev 8 A-2 — service_role 도 직접 호출하지 않는다. 내부 구현부는
--      api_web_v1 SECDEF wrapper 가 소유자 권한으로만 호출).
--   - 신규 함수의 PUBLIC 기본 EXECUTE 차단: ALTER DEFAULT PRIVILEGES (§5.3.3).
--   - 이 단계에서 함수·View·테이블 생성 0. Data API/PostgREST 설정 변경 0
--     (D-API-W 는 Batch B 이후 별도 플랫폼 단계 — §20.6).
--   - 부분 생성 상태 발견 시 UNEXPECTED_EXISTING_CONTRACT_OBJECT 로 중단한다
--     (IF NOT EXISTS 로 숨기지 않는다 — 물리 정책 §11).
-- 선행조건: M0 (§20.2.1 — M1 : M0).
-- rollback 정본: supabase/rollback/20260730090043_api_web_v1_schemas_rollback.sql
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- A. 사전 게이트 — 계약 대상 schema 가 이미(부분) 존재하면 수정 0건 중단
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname IN ('api_web_v1', 'core_private')) THEN
    RAISE EXCEPTION 'UNEXPECTED_EXISTING_CONTRACT_OBJECT: schema api_web_v1/core_private already present';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- B. api_web_v1 — 외부 노출 스키마 (계약 §5.3.1)
-- -----------------------------------------------------------------------------
CREATE SCHEMA api_web_v1;
REVOKE ALL ON SCHEMA api_web_v1 FROM PUBLIC;
GRANT USAGE ON SCHEMA api_web_v1 TO anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- C. core_private — 내부 전용 스키마 (계약 §5.3.2 — 외부 역할 완전 봉인)
-- -----------------------------------------------------------------------------
CREATE SCHEMA core_private;
REVOKE ALL ON SCHEMA core_private FROM PUBLIC;
-- PUBLIC·anon·authenticated·service_role 어디에도 USAGE 를 주지 않는다.

-- -----------------------------------------------------------------------------
-- D. 신규 함수의 PUBLIC 기본 EXECUTE 차단 (계약 §5.3.3 — 필수)
--    ALTER DEFAULT PRIVILEGES 는 실행 역할이 앞으로 만드는 객체에만 적용된다.
--    각 함수 생성 마이그레이션은 명시적 REVOKE 를 함께 쓴다(이중 방어 — §5.3 주의 1).
-- -----------------------------------------------------------------------------
ALTER DEFAULT PRIVILEGES IN SCHEMA api_web_v1  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA core_private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON SCHEMA api_web_v1 IS
  'S2 M1(계약 §5): 웹 표면 전용 노출 스키마 — view·RPC 만 배치. PUBLIC 권한 0, anon/authenticated/service_role USAGE.';
COMMENT ON SCHEMA core_private IS
  'S2 M1(계약 §5): 내부 구현부 전용 스키마 — 외부 역할 USAGE 0. Data API 노출 금지. SECDEF wrapper 소유자 권한으로만 호출.';

commit;
