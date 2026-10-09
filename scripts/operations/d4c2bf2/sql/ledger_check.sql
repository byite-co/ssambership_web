-- 성격: 조회 전용 — READ ONLY 트랜잭션 안의 SELECT 만, ROLLBACK 종료. LOCK·DDL·DML 없음.
-- 읽기 전용. 실행: PGSERVICE=<service> psql -X -qAt -v ON_ERROR_STOP=1 -f ledger_check.sql
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path=pg_catalog,public;
-- (1) 적용 전 기대: 127 | 0 | 20261008021536 | a459ac7fce2076d6ef1fba540868fa37ebbdc53fcf7b93859cb5b3643e42ded9
--     적용 후 기대: 128 | 1 | 20261009070000 | (같은 값)
SELECT count(*) AS history_count,
       count(*) FILTER (WHERE version='20261009070000') AS new_row_present,
       max(version) AS latest_version,
       encode(sha256(convert_to(string_agg(version, ',' ORDER BY version) FILTER (WHERE version <> '20261009070000'),'UTF8')),'hex') AS baseline_versions_sha256
FROM supabase_migrations.schema_migrations;
-- (2) 적용 후 기대: 정확히 1행 — 20261009070000|staging_integration|213||t  (-A 모드에서 NULL created_by 는 빈 칸)   (적용 전: 0행)
SELECT version, name, cardinality(statements) AS statements, created_by, created_by IS NULL AS created_by_is_null
FROM supabase_migrations.schema_migrations WHERE version='20261009070000';
-- (3) 070100/070200 은 최초 적용 뒤에도 없어야 한다
SELECT version FROM supabase_migrations.schema_migrations
 WHERE version IN ('20261009070000','20261009070100','20261009070200') ORDER BY 1;
ROLLBACK;
