-- =============================================================================
-- 20260906100100_plan_price_stats_rollback.sql  (DB-5 묶음 A 롤백)
-- =============================================================================
-- forward: supabase/sql/205_plan_price_stats.sql
-- 되돌리는 것: public.plan_price_stats() DROP. 읽기 전용 집계 함수라 데이터 영향 0. mentor_plans·mentor_profiles 는 forward 가 만지지 않았다.
-- =============================================================================

begin;

drop function if exists public.plan_price_stats();

do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'plan_price_stats') then
    raise exception '205_ROLLBACK_SELFCHECK: 함수 잔존';
  end if;
end $$;

commit;
