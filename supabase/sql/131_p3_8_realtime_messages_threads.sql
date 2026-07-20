-- 131_p3_8_realtime_messages_threads.sql
-- P3-8: 질문방 실시간 — supabase_realtime publication 에 question_messages / question_threads 추가.
--
-- 배경: 117 은 question_attachments 만 publication 에 추가했다. 그 결과 채팅 메시지 신규/스레드
--       상태 전이(answered/confirmed)는 실시간 반영되지 않고 재조회 폴백에 의존했다.
-- 안전성: 두 테이블 모두 SELECT RLS(qm_select / qt_select_via_room)가 있어 realtime 브로드캐스트도
--         행 단위 권한을 따른다(당사자만 수신). replica identity 는 기존 attachments 와 동일하게 default(PK).
-- 멱등: 이미 멤버이면 건너뛴다.
-- 선행: P1-8A(130) 이후. 038/117(실시간 계보).

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='question_messages'
  ) then
    execute 'alter publication supabase_realtime add table public.question_messages';
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='question_threads'
  ) then
    execute 'alter publication supabase_realtime add table public.question_threads';
  end if;
end$$;

-- §V: select tablename from pg_publication_tables
--      where pubname='supabase_realtime' and schemaname='public'
--        and tablename in ('question_messages','question_threads','question_attachments');
--     → 3행 기대.
