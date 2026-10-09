-- [S5-1 2026-08-07] QA-C7 — 차단 목록에 상대가 "사용자"로만 표시된다.
--
-- 현상: 차단 관리 화면에서 누구를 차단했는지 식별할 수 없어 해제 대상을 고를 수 없다.
--
-- 원인: 앱은 이미 표시명 조회와 폴백을 구현해 뒀다
--       (user_blocks_repository: users(id, nickname, full_name) 조회 → 실패 시 '사용자').
--       그런데 public.users 의 SELECT 정책이 **본인 + admin** 뿐이라 타인 행이
--       0건으로 돌아온다. 앱 결함이 아니라 서버가 표시명을 내줄 경로가 없다.
--
-- 결정(오너 판단 2026-08-06 → 노출 경로 2026-08-07): **내가 차단한 사람에 한해
--   닉네임만**, **뷰가 아니라 SECURITY DEFINER RPC 로** 제공한다.
--   · users 테이블 정책은 넓히지 않는다(이메일·상태 등 전체 행 노출 금지).
--   · api_web_v1 의 "정의자 뷰는 mentor_directory_v1 하나" 계약을 건드리지 않는다 —
--     함수는 뷰 인구조사 대상이 아니라 계약 검증 스크립트 수정이 필요 없다.
--
-- 노출 범위(엄격):
--   · blocker_id = auth.uid() 인 행만 — 인자를 받지 않으므로 타인 목록을 물을 수 없다.
--   · 반환 컬럼은 blocked_id · nickname · created_at 뿐(email·full_name·role 제외).
--   · 세션이 없으면 빈 결과(예외 대신 조용한 빈 목록 — 목록 화면이 오류로 깨지지 않게).
--
-- 알려진 성질(수용): 차단→조회→해제로 임의 uuid 의 닉네임을 확인할 수 있다.
--   차단 자체가 사용자 행위이고 닉네임은 커뮤니티 글·댓글에서 이미 보이는 값이라
--   새 정보를 주지는 않는다. 그래도 확대되지 않도록 반환 컬럼을 닉네임으로 좁혔다.
--
-- 멱등: create or replace + 명시 ACL 재설정.

create or replace function public.my_blocked_users()
returns table(blocked_id uuid, nickname text, created_at timestamptz)
language sql
stable
security definer
set search_path to ''
as $function$
  select
    b.blocked_id,
    coalesce(nullif(btrim(u.nickname), ''), '사용자') as nickname,
    b.created_at
  from public.user_blocks b
  join public.users u on u.id = b.blocked_id
  where b.blocker_id = (select auth.uid())
    and (select auth.uid()) is not null
  order by b.created_at desc;
$function$;

comment on function public.my_blocked_users() is
  'S5-1/QA-C7: 본인이 차단한 사용자의 닉네임만 돌려준다. 인자가 없어 타인 목록을 '
  '물을 수 없고, blocker_id = auth.uid() 로 스코프가 고정된다. email·full_name·role 은 '
  '내보내지 않는다. users 테이블 정책은 변경하지 않았고, api_web_v1 정의자 뷰 계약도 '
  '건드리지 않는다(함수는 뷰 인구조사 대상이 아니다).';

revoke all on function public.my_blocked_users() from public;
revoke all on function public.my_blocked_users() from anon;
grant execute on function public.my_blocked_users() to authenticated;
