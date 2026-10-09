-- 성격: 조회 전용 — READ ONLY 트랜잭션 안의 SELECT 만, ROLLBACK 종료. LOCK·DDL·DML 없음. 적용 전에는 두 번째 SELECT 가 테이블 부재로 실패한다(적용 전에는 §6 S3 의 preconditions 한 줄을 쓴다).
-- 읽기 전용. 실행: PGSERVICE=<service> psql -X -qAt -v ON_ERROR_STOP=1 -f release_state.sql
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path=pg_catalog,public;
-- 적용 전 기대: f  /  적용 후 기대: t
SELECT to_regclass('core_private.integration_release_state') IS NOT NULL AS release_state_exists;
-- 적용 후 기대(1행): t | 20261009070000 | 2 | 170006 | 290 | 99 | 89 | 98 | t | 신규 9 테이블 | (digest 변동 테이블은 행 존재에 따라 다름: 로컬 채움 fixture 는 subscriptions·subscription_billing_events, 빈 clone 은 NULL, staging 은 question_threads 가 추가될 수 있음 — 기대값 아님 · 기록만 · 수정 금지)
SELECT singleton, release_version,
       baseline_catalog->>'format_version' AS baseline_format_version,
       baseline_catalog->>'server_version_num' AS baseline_server_version_num,
       jsonb_array_length(baseline_catalog->'functions') AS baseline_functions,
       jsonb_array_length(baseline_catalog->'relations') AS baseline_relations,
       (SELECT count(*) FROM jsonb_object_keys(data_before)) AS data_before_tables,
       (SELECT count(*) FROM jsonb_object_keys(data_after)) AS data_after_tables,
       data_after IS NOT NULL AS data_after_recorded,
       (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(data_after) k WHERE NOT data_before ? k) AS new_tables_in_data_after,
       (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(data_before) k WHERE data_before->k IS DISTINCT FROM data_after->k) AS tables_whose_digest_changed_during_apply
FROM core_private.integration_release_state;
-- 기대: rls=t, anon/authenticated/service_role SELECT 모두 f
SELECT c.relrowsecurity AS rls, pg_get_userbyid(c.relowner) AS owner,
       has_table_privilege('anon','core_private.integration_release_state','SELECT') AS anon_select,
       has_table_privilege('authenticated','core_private.integration_release_state','SELECT') AS authenticated_select,
       has_table_privilege('service_role','core_private.integration_release_state','SELECT') AS service_role_select
FROM pg_class c WHERE c.oid='core_private.integration_release_state'::regclass;
ROLLBACK;
