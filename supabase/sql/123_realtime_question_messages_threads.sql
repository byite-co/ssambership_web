-- =============================================================================
-- 123: 질문방 실시간 — question_messages / question_threads publication 추가 (XV-REALTIME)
-- =============================================================================
-- 배경(XV-REALTIME): 117 이 supabase_realtime publication 에 question_attachments
--   만 추가했다. 정작 채팅 본문 테이블 question_messages 와 스레드 상태 테이블
--   question_threads 는 publication 에 없어, 상대방이 보낸 새 메시지·스레드 상태
--   변경이 실시간으로 반영되지 않는다(현재 앱은 재조회 폴백으로만 갱신). 첨부는
--   실시간인데 정작 메시지는 아니라 사용자 체감이 어긋난다.
-- 조치: 두 테이블을 supabase_realtime publication 에 추가한다. INSERT(새 메시지·새
--   스레드)·UPDATE(스레드 상태) 이벤트가 방 참여자에게 전달된다. 실시간 전달 시
--   RLS 는 새 레코드(INSERT) 기준으로 평가되며 방 참여자 정책이 그대로 적용된다.
--   replica identity 는 117(question_attachments)과 동일하게 기본(PK) 유지 —
--   채팅은 INSERT 중심이라 기본 식별자로 충분하다.
-- 성격: 재실행 안전(이미 포함 시 duplicate_object 무시). 스키마/데이터 변경 없음.
-- 사전 조건: question_threads / question_messages 존재(002·070 계열),
--   supabase_realtime publication 존재(Supabase 기본 제공).
-- 검증: 파일 하단 §V.
-- =============================================================================

-- question_messages: 새 메시지 실시간 수신
do $$
begin
  alter publication supabase_realtime add table public.question_messages;
exception
  when duplicate_object then null;
end $$;

-- question_threads: 새 스레드/상태 변경 실시간 수신
do $$
begin
  alter publication supabase_realtime add table public.question_threads;
exception
  when duplicate_object then null;
end $$;

-- =============================================================================
-- §V. 적용 직후 검증 (Supabase SQL Editor 에서 수동 실행)
-- =============================================================================
-- §V-0. publication 멤버십 확인 — 3행(attachments/messages/threads) 기대:
--   select tablename from pg_publication_tables
--    where pubname = 'supabase_realtime'
--      and tablename in ('question_attachments','question_messages','question_threads')
--    order by tablename;
-- =============================================================================
