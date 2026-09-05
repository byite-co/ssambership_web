-- =============================================================================
-- 20260905100100_api_app_v1_subscribe_with_cash_rollback.sql  (DB-4 묶음 A 롤백)
-- =============================================================================
-- forward: supabase/sql/199_api_app_v1_subscribe_with_cash.sql
-- 되돌리는 것: api_app_v1.subscribe_with_cash(uuid,text,text) · subscription_cancel_at_period_end(uuid) · subscription_cancel_undo(uuid) DROP.
--   다른 객체(F12 · 정본 confirm · 테이블)는 forward 가 만지지 않았다.
-- 데이터: forward 기간에 이 래퍼로 만든 구독·payments(external_id 'sub_app_%')·원장·방·billing event·해지 예약 값은 그대로 남는다
--   (자금 데이터 롤백 없음 — 앱 경로만 사라지고 웹 경로는 그대로 읽는다).
-- 순서: 200~204 는 199 객체를 참조하지 않으므로 단독 롤백 가능. DB-4 전체 롤백은 역순 F → A.
-- =============================================================================

begin;

drop function if exists api_app_v1.subscribe_with_cash(uuid, text, text);
drop function if exists api_app_v1.subscription_cancel_at_period_end(uuid);
drop function if exists api_app_v1.subscription_cancel_undo(uuid);

do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'api_app_v1' and p.proname in ('subscribe_with_cash', 'subscription_cancel_at_period_end', 'subscription_cancel_undo')) then
    raise exception '199_ROLLBACK_SELFCHECK: 함수 잔존';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'api_web_v1' and p.proname = 'subscription_checkout_confirm_v2') then
    raise exception '199_ROLLBACK_SELFCHECK: F12 소실(이 롤백은 건드리지 않는다)';
  end if;
end $$;

commit;
