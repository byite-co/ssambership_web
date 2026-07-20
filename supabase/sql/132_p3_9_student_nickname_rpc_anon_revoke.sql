-- 132_p3_9_student_nickname_rpc_anon_revoke.sql
-- P3-9(부분): 학생 PII 반환 RPC 의 anon 권한 회수(심층방어).
--
-- get_mentor_student_nicknames(uuid[]) 는 SECURITY DEFINER 로 users.nickname/full_name(PII)을 반환한다.
-- 이미 본문에서 (a) auth.uid() not null (b) 호출자가 custom_request_orders 의 해당 학생 멘토일 때만 반환하도록
-- 제한하지만, Supabase 기본 권한으로 anon 에도 EXECUTE 가 부여돼 있었다. anon 은 auth.uid()=null 이라
-- 결과가 비지만, PII 반환 정의함수를 anon 이 호출 가능한 상태 자체를 제거한다.
--
-- 참고: P3-9 의 나머지("활성 구독 또는 질문방 당사자 기준으로 학생명 노출 범위 재정의")는
--       현행 custom_request_orders 기준과 다른 인가 집합으로의 기능 변경이라 제품 결정이 필요하다.
--       이 파일은 논쟁의 여지가 없는 anon 회수만 수행한다.

revoke all on function public.get_mentor_student_nicknames(uuid[]) from anon, public;

-- §V: select grantee from information_schema.routine_privileges
--     where specific_schema='public' and routine_name='get_mentor_student_nicknames';
--     → {authenticated, service_role}(및 owner) 만.
