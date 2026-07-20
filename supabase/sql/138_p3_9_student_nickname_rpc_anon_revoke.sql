-- 138_p3_9_student_nickname_rpc_anon_revoke.sql
-- P3-9(부분): 학생 PII 반환 RPC 의 anon/public 실행권 회수(심층방어).
--
-- 계보: PR #43 에서 staging 선적용(파일 132). 132 는 정본 브랜치에서 notification_outbox_foundation 과
--       충돌하므로 138 로 수렴.
-- get_mentor_student_nicknames(uuid[]) 는 SECURITY DEFINER 로 users.nickname/full_name(PII)을 반환한다.
-- 본문은 이미 (a) auth.uid() not null (b) 호출자가 custom_request_orders 의 해당 학생 멘토일 때만 반환하도록
-- 제한하지만, Supabase 기본 권한으로 anon 에도 EXECUTE 가 부여돼 있었다. anon 은 결과가 비지만 PII 정의함수를
-- anon 이 호출 가능한 상태 자체를 제거한다.
--
-- P3-9 나머지(활성구독/질문방 당사자 기준으로 노출 인가 재정의)는 현행 custom_request_orders 기준과
-- 다른 인가 집합으로의 기능 변경이라 제품 결정 필요 = DEFERRED_PRODUCT_DECISION.

revoke all on function public.get_mentor_student_nicknames(uuid[]) from anon, public;

-- §V: select grantee from information_schema.routine_privileges
--     where specific_schema='public' and routine_name='get_mentor_student_nicknames'; → {authenticated, service_role}(및 owner).
