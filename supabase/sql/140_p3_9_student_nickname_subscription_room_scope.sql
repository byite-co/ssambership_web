-- 140_p3_9_student_nickname_subscription_room_scope.sql
-- P3-9 완결 — `get_mentor_student_nicknames` 노출 인가를 v16(1) 정책으로 재정의.
--
-- 정책: 호출 멘토는 다음 관계의 학생 이름만 조회할 수 있다.
--   (a) 호출 멘토와 **활성 구독** 관계, 또는
--   (b) 호출 멘토와 **실제 질문방(mentor_student_rooms) 당사자** 관계.
-- custom_request_orders 만 존재하는 관계는 (a)/(b) 를 충족하지 않으면 반환 근거가 아니다.
--
-- 138(anon/public revoke)을 수정하지 않고 다음 고유 번호로 본문을 재정의한다.
-- - 호출 멘토는 auth.uid() 에서 서버가 도출(클라이언트 mentor ID 신뢰 금지).
-- - 타 멘토의 학생 열거 금지(관계는 mentor_id = auth.uid() 로만 성립).
-- - anon/public 실행 금지 유지, SECURITY DEFINER + 고정 search_path, service_role 허용.

create or replace function public.get_mentor_student_nicknames(p_student_ids uuid[])
returns table(id uuid, nickname text, full_name text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select u.id, u.nickname, u.full_name
  from public.users u
  where p_student_ids is not null
    and array_length(p_student_ids, 1) is not null
    and u.id = any (p_student_ids)
    and (select auth.uid()) is not null
    and (
      exists (
        select 1 from public.subscriptions s
        where s.mentor_id = (select auth.uid())
          and s.student_id = u.id
          and lower(coalesce(s.status, '')) = 'active'
      )
      or exists (
        select 1 from public.mentor_student_rooms r
        where r.mentor_id = (select auth.uid())
          and r.student_id = u.id
      )
    );
$$;

revoke all on function public.get_mentor_student_nicknames(uuid[]) from public, anon;
grant execute on function public.get_mentor_student_nicknames(uuid[]) to authenticated, service_role;

-- §V(rollback-only): 활성구독 학생→반환 · 질문방 학생→반환 · custom_order만/무관계 학생→미반환 ·
--   타 멘토가 호출→미반환. grantee={authenticated,service_role}.
