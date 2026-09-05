-- =============================================================================
-- 20260905100200_api_app_v1_refund_request_rollback.sql  (DB-4 묶음 B 롤백)
-- =============================================================================
-- forward: supabase/sql/200_api_app_v1_refund_request.sql
-- 되돌리는 것: api_app_v1.refund_estimate(uuid) · refund_request_create(uuid,text) · core_private.subscription_refund_estimate_impl(uuid,timestamptz) DROP.
-- 데이터: forward 기간에 접수된 refunds(pending · subscription_prorated) 행은 그대로 남는다(관리자 승인/거절 경로 불변).
-- =============================================================================

begin;

drop function if exists api_app_v1.refund_request_create(uuid, text);
drop function if exists api_app_v1.refund_estimate(uuid);
drop function if exists core_private.subscription_refund_estimate_impl(uuid, timestamptz);

do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where (n.nspname = 'api_app_v1' and p.proname in ('refund_estimate', 'refund_request_create'))
                 or (n.nspname = 'core_private' and p.proname = 'subscription_refund_estimate_impl')) then
    raise exception '200_ROLLBACK_SELFCHECK: 함수 잔존';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'refunds' and policyname = 'refund_ins') then
    raise exception '200_ROLLBACK_SELFCHECK: refund_ins 소실(이 롤백은 건드리지 않는다)';
  end if;
end $$;

commit;
