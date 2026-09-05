-- =============================================================================
-- 20260905100300_api_app_v1_mentor_activity_set_rollback.sql  (DB-4 묶음 C 롤백)
-- =============================================================================
-- forward: supabase/sql/201_api_app_v1_mentor_activity_set.sql
-- 되돌리는 것: api_app_v1.mentor_activity_set(text,timestamptz,timestamptz,text) DROP.
-- 데이터: forward 기간의 활동 상태 전이·구독 기간 연장·mentor_activity_events 행·알림은 그대로 남는다(웹 콘솔이 같은 표를 읽는다).
-- =============================================================================

begin;

drop function if exists api_app_v1.mentor_activity_set(text, timestamptz, timestamptz, text);

do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api_app_v1' and p.proname = 'mentor_activity_set') then
    raise exception '201_ROLLBACK_SELFCHECK: 함수 잔존';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_mp_notify_activity') then
    raise exception '201_ROLLBACK_SELFCHECK: 158 트리거 소실(이 롤백은 건드리지 않는다)';
  end if;
end $$;

commit;
