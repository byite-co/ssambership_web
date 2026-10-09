-- 성격: 조회 전용 — 이름의 rollback 은 "롤백되었음을 확인"한다는 뜻이며 이 파일은 어떤 변경도 하지 않는다. READ ONLY 트랜잭션·ROLLBACK 종료.
-- 읽기 전용. 적용 실패(42501·guard·취소·응답 유실) 직후 "아무것도 남지 않았음" 확인. 모든 값이 기대와 같아야 한다.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path=pg_catalog,public;
SELECT count(*) AS history_rows, max(version) AS latest FROM supabase_migrations.schema_migrations;        -- 기대: 127 | 20261008021536
SELECT count(*) AS new_row FROM supabase_migrations.schema_migrations WHERE version='20261009070000';     -- 기대: 0
SELECT to_regclass('core_private.integration_release_state') IS NULL AS release_state_absent;           -- 기대: t
SELECT to_regclass('public.voucher_campaigns') IS NULL AS voucher_tables_absent;                           -- 기대: t
SELECT count(*) AS new_rpcs_present FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE (n.nspname,p.proname) IN (('api_web_v1','mentor_directory_by_ids'),('api_web_v1','mentor_directory_count'),
       ('api_web_v1','mentor_directory_page'),('api_app_v1','subscription_funding_context'));                -- 기대: 0
SELECT count(*) AS policy_rows FROM pg_policy WHERE polrelid='storage.objects'::regclass AND polname='qra_storage_insert_party'; -- 기대: 1
ROLLBACK;
-- 이어서 policy_check.sql(적용 전 정의와 동일), §5-3 의 catalog 대조(기준선과 동일)를 다시 실행한다.
