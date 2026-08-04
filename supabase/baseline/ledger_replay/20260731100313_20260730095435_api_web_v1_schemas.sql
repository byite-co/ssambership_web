-- =============================================================================
-- 20260730095435_api_web_v1_schemas.sql (S2 M1)
-- =============================================================================
-- api_web_v1(외부 노출)·core_private(내부 전용) schema 2종 생성 + 권한 경계.
-- 정본 계약: docs/contracts/api_web_v1_contract_v1_1.md §5.1~§5.3 · §10.1 · §20.2 M1.
--   - 생성 schema 는 정확히 2개다. 이 단계에서 함수·view·테이블은 0건 생성한다.
--   - api_web_v1 : PUBLIC 권한 전면 회수 → anon·authenticated·service_role USAGE.
--   - core_private: PUBLIC 권한 전면 회수. PUBLIC·anon·authenticated·service_role
--     어디에도 USAGE 를 주지 않는다(§10.1 — rev 8 A-2·A-6: 내부 구현부는 api_web_v1
--     SECDEF wrapper 의 소유자 권한 문맥으로만 호출. service_role USAGE 부여 폐기).
--   - 두 schema 모두 default privileges 에서 신규 함수의 PUBLIC EXECUTE 를 회수한다
--     (§5.3.3 — migration 실행 역할(= 함수 소유 역할)이 앞으로 만드는 함수에 적용).
--   - Data API(Exposed schemas)·PostgREST 설정은 변경하지 않는다 — D-API-W 는
--     Batch B 이후 별도 플랫폼 단계다(§20.6). core_private 는 절대 노출 금지.
--   - 부분 생성 상태 은닉 금지: CREATE SCHEMA 에 IF NOT EXISTS 를 쓰지 않고,
--     사전 게이트에서 기존 동명 schema 발견 시 UNEXPECTED_EXISTING_CONTRACT_OBJECT
--     로 수정 0건 중단한다(Batch B 지시 §7).
-- 선행조건: M0(20260729211929) 적용 완료(§20.2.1 — M1 : M0).
-- rollback 정본: supabase/rollback/20260730095435_api_web_v1_schemas_rollback.sql
--   (M4 rollback 으로 schema 가 빈 뒤에만 실행 — DROP SCHEMA ... RESTRICT · CASCADE 금지)
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- A. 사전 게이트 — 동명 schema 선재 시 수정 0건 중단 (IF NOT EXISTS 은닉 금지)
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'api_web_v1') THEN
    RAISE EXCEPTION 'UNEXPECTED_EXISTING_CONTRACT_OBJECT: schema api_web_v1 already exists';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'core_private') THEN
    RAISE EXCEPTION 'UNEXPECTED_EXISTING_CONTRACT_OBJECT: schema core_private already exists';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- B. 외부 노출 schema — api_web_v1 (§5.3.1)
-- -----------------------------------------------------------------------------
CREATE SCHEMA api_web_v1;
REVOKE ALL ON SCHEMA api_web_v1 FROM PUBLIC;
GRANT USAGE ON SCHEMA api_web_v1 TO anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- C. 내부 전용 schema — core_private (§5.3.2 — 외부 역할 완전 봉인)
-- -----------------------------------------------------------------------------
CREATE SCHEMA core_private;
REVOKE ALL ON SCHEMA core_private FROM PUBLIC;
-- PUBLIC·anon·authenticated·service_role 어디에도 USAGE 를 주지 않는다.
-- (v1.0 의 GRANT USAGE ... TO service_role 은 폐기 — 계약 §5.3.2 주석 그대로)

-- -----------------------------------------------------------------------------
-- D. [필수] 신규 함수의 PUBLIC 기본 EXECUTE 차단 (§5.3.3 — 계약 DDL 원문 그대로)
--    [PG17.6 로컬 실측 기록 — Batch B] per-schema default privilege 는 전역
--    기본값에 「추가」되는 구조라, 선행 per-schema GRANT 가 없는 상태의 이
--    REVOKE 는 pg_default_acl 행을 만들지 않으며(저장 no-op), 새 함수의
--    proacl 은 NULL(= hardwired default, PUBLIC EXECUTE 포함)로 생성됨을
--    프로브로 확인했다. 따라서 실효 방어선은 계약 §5.3 주의 1·§10.3 이 이미
--    의무화한 「함수 생성과 같은 트랜잭션의 명시 REVOKE ALL ... FROM PUBLIC」
--    (이중 방어의 2층)이다. 이 문장은 계약 DDL 원문 준수 + 전역 default 항목이
--    생기는 미래 상태 대비로 유지한다. Batch B 는 두 schema 에 함수를 0건
--    생성하므로 노출 표면이 없고, 함수를 만드는 후속 Batch(M5~)는 §10.3 의
--    함수별 명시 REVOKE 를 반드시 동반해야 한다.
-- -----------------------------------------------------------------------------
ALTER DEFAULT PRIVILEGES IN SCHEMA api_web_v1  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA core_private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- -----------------------------------------------------------------------------
-- E. 적용 직후 자가 검증 (§20.3 「M4 이전」 게이트 상당 — PUBLIC 권한 0건 실측)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_acl text;
BEGIN
  -- api_web_v1: 3 role USAGE + PUBLIC 항목 0
  IF NOT (has_schema_privilege('anon', 'api_web_v1', 'USAGE')
          AND has_schema_privilege('authenticated', 'api_web_v1', 'USAGE')
          AND has_schema_privilege('service_role', 'api_web_v1', 'USAGE')) THEN
    RAISE EXCEPTION 'S2_M1_SELFCHECK: api_web_v1 role USAGE missing';
  END IF;
  SELECT nspacl::text INTO v_acl FROM pg_namespace WHERE nspname = 'api_web_v1';
  IF v_acl LIKE '{=%' OR v_acl LIKE '%,=%' THEN
    RAISE EXCEPTION 'S2_M1_SELFCHECK: api_web_v1 retains PUBLIC acl entry: %', v_acl;
  END IF;
  -- core_private: 외부 role USAGE 0 + PUBLIC 항목 0
  IF has_schema_privilege('anon', 'core_private', 'USAGE')
     OR has_schema_privilege('authenticated', 'core_private', 'USAGE')
     OR has_schema_privilege('service_role', 'core_private', 'USAGE') THEN
    RAISE EXCEPTION 'S2_M1_SELFCHECK: core_private must have zero external USAGE';
  END IF;
  SELECT nspacl::text INTO v_acl FROM pg_namespace WHERE nspname = 'core_private';
  IF v_acl LIKE '{=%' OR v_acl LIKE '%,=%' THEN
    RAISE EXCEPTION 'S2_M1_SELFCHECK: core_private retains PUBLIC acl entry: %', v_acl;
  END IF;
  -- default privileges: 두 schema 의 default ACL 이 PUBLIC 에 무언가를 부여하는
  -- 행을 갖지 않아야 한다(PG17.6 실측 — 위 REVOKE 는 저장 no-op 이므로 행 0 이
  -- 정상이며, 행이 있다면 PUBLIC 부여가 없어야 한다. 섹션 D 주석 참조).
  IF (SELECT count(*)
        FROM pg_default_acl d JOIN pg_namespace n ON n.oid = d.defaclnamespace
       WHERE n.nspname IN ('api_web_v1', 'core_private')
         AND (d.defaclacl::text LIKE '{=%' OR d.defaclacl::text LIKE '%,=%')) > 0 THEN
    RAISE EXCEPTION 'S2_M1_SELFCHECK: default ACL grants PUBLIC';
  END IF;
  -- 이 단계에서 두 schema 는 비어 있어야 한다(함수·view·테이블 0)
  IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname IN ('api_web_v1', 'core_private')) > 0
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname IN ('api_web_v1', 'core_private')) > 0 THEN
    RAISE EXCEPTION 'S2_M1_SELFCHECK: schemas must be empty at M1';
  END IF;
END $$;

commit;
