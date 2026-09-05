-- =============================================================================
-- 20260905100400_api_app_v1_mentor_plan_active_set_rollback.sql  (DB-4 묶음 D 롤백)
-- =============================================================================
-- forward: supabase/sql/202_api_app_v1_mentor_plan_active_set.sql
-- 되돌리는 것: api_app_v1.mentor_plan_active_set(text,boolean) DROP.
-- 데이터: forward 기간에 토글된 mentor_plans.is_active 값은 그대로 남는다(웹·정본 confirm 이 같은 컬럼을 읽는다 — 되돌리려면 멘토 활동 복귀 또는 관리자).
-- =============================================================================

begin;

drop function if exists api_app_v1.mentor_plan_active_set(text, boolean);

do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api_app_v1' and p.proname = 'mentor_plan_active_set') then
    raise exception '202_ROLLBACK_SELFCHECK: 함수 잔존';
  end if;
end $$;

commit;
