-- =============================================================================
-- 20260905100600_api_app_v1_individual_question_create_v2_rollback.sql  (DB-4 묶음 F 롤백)
-- =============================================================================
-- forward: supabase/sql/204_api_app_v1_individual_question_create_v2.sql
-- 되돌리는 것: api_app_v1.create_individual_question_as_student_v2(text,text,text,int,uuid,text,text) DROP. v1(public)·코어 v2 는 forward 가 만지지 않았다.
-- 데이터: forward 기간에 v2 로 만든 개별질문(과목 포함)·에스크로 홀드는 그대로 남는다(코어·정산 경로 불변).
-- =============================================================================

begin;

drop function if exists api_app_v1.create_individual_question_as_student_v2(text, text, text, int, uuid, text, text);

do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api_app_v1' and p.proname = 'create_individual_question_as_student_v2') then
    raise exception '204_ROLLBACK_SELFCHECK: 함수 잔존';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'create_individual_question_as_student') then
    raise exception '204_ROLLBACK_SELFCHECK: v1 소실(이 롤백은 건드리지 않는다)';
  end if;
end $$;

commit;
