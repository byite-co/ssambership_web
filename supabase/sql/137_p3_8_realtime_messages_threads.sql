-- 137_p3_8_realtime_messages_threads.sql
-- P3-8: 질문방 실시간 — supabase_realtime publication 에 question_messages / question_threads 추가.
--
-- 계보: PR #43 에서 staging 선적용(파일 131). 131 은 정본 브랜치에서 P1-13 예약 번호라 137 로 수렴.
-- 배경: 117 은 question_attachments 만 추가 → 메시지 신규/스레드 상태전이 실시간 미반영(재조회 폴백).
-- 안전: 두 테이블 모두 SELECT RLS(qm_select/qt_select_via_room) → 브로드캐스트도 당사자만 수신.
--       replica identity 는 attachments 와 동일 default(PK). 멱등.
-- 선행: 136(P1-8A) 이후. 038/117(실시간 계보).

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='question_messages') then
    execute 'alter publication supabase_realtime add table public.question_messages';
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='question_threads') then
    execute 'alter publication supabase_realtime add table public.question_threads';
  end if;
end$$;

-- §V: select tablename from pg_publication_tables where pubname='supabase_realtime' and schemaname='public'
--       and tablename in ('question_messages','question_threads','question_attachments'); → 3행.
