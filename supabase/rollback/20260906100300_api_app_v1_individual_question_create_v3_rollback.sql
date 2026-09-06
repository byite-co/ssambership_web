-- =============================================================================
-- 20260906100300_api_app_v1_individual_question_create_v3_rollback.sql  (DB-5 묶음 D 롤백)
-- =============================================================================
-- forward: supabase/sql/207_api_app_v1_individual_question_create_v3.sql
-- 되돌리는 것: api_app_v1.create_individual_question_as_student_v3(text,text,text,int,uuid,text,text,text,text,text) DROP.
--   v1(public)·v2(api_app_v1)·코어 v2·카탈로그·CHECK 는 forward 가 만지지 않았다.
-- 데이터: forward 기간에 v3 로 만든 개별질문(topic·자격 조건 포함)·에스크로 홀드는 그대로 남는다(코어·정산 경로 불변).
-- =============================================================================

begin;

drop function if exists api_app_v1.create_individual_question_as_student_v3(text, text, text, int, uuid, text, text, text, text, text);

do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api_app_v1' and p.proname = 'create_individual_question_as_student_v3') then
    raise exception '207_ROLLBACK_SELFCHECK: 함수 잔존';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api_app_v1' and p.proname = 'create_individual_question_as_student_v2') then
    raise exception '207_ROLLBACK_SELFCHECK: v2 소실(이 롤백은 건드리지 않는다)';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'create_individual_question_as_student') then
    raise exception '207_ROLLBACK_SELFCHECK: v1 소실(이 롤백은 건드리지 않는다)';
  end if;
end $$;

commit;
