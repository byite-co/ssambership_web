-- =============================================================================
-- 20260905100500_api_app_v1_student_status_student_id_document_rollback.sql  (DB-4 묶음 E 롤백)
-- =============================================================================
-- forward: supabase/sql/203_api_app_v1_student_status_student_id_document.sql
-- 되돌리는 것: api_app_v1.user_profile_update_self_v2(text,text,text) · api_app_v1.mentor_student_id_document_set_self(text) DROP.
--   v1 user_profile_update_self · core_private impl · Storage 정책은 forward 가 만지지 않았다.
-- 데이터: forward 기간에 바뀐 users.student_status · mentor_profiles.student_id_image_url 값은 그대로 남는다.
-- =============================================================================

begin;

drop function if exists api_app_v1.user_profile_update_self_v2(text, text, text);
drop function if exists api_app_v1.mentor_student_id_document_set_self(text);

do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'api_app_v1' and p.proname in ('user_profile_update_self_v2', 'mentor_student_id_document_set_self')) then
    raise exception '203_ROLLBACK_SELFCHECK: 함수 잔존';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'api_app_v1' and p.proname = 'user_profile_update_self') then
    raise exception '203_ROLLBACK_SELFCHECK: v1 소실(이 롤백은 건드리지 않는다)';
  end if;
end $$;

commit;
