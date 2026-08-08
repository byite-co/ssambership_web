-- =============================================================================
-- 20260808032000_mavp_store_url_platform_host_chk_rollback.sql
-- =============================================================================
-- ADV-F2-3 후속 제약 롤백 — 기존 mavp_store_url_chk(https+스토어 호스트)는 유지된다.
-- =============================================================================

begin;

ALTER TABLE public.mobile_app_version_policies
  DROP CONSTRAINT IF EXISTS mavp_store_url_platform_chk;

commit;
