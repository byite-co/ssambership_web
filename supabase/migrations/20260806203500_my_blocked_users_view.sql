-- [S1-8 2026-08-06] QA-C7 — 차단 목록에 상대가 "사용자"로만 표시된다.
--
-- 현상: 차단 관리 화면에서 누구를 차단했는지 식별할 수 없어 해제 대상을 고를 수 없다.
--
-- 원인: 앱은 이미 표시명 조회와 폴백을 구현해 뒀다
--       (user_blocks_repository: users(id, nickname, full_name) 조회 → 실패 시 '사용자').
--       그런데 public.users 의 SELECT 정책이 **본인 + admin** 뿐이라 타인 행이
--       0건으로 돌아온다. 즉 앱 결함이 아니라 서버가 표시명을 내줄 경로가 없다.
--
-- 결정(오너 판단 2026-08-06): **내가 차단한 사람에 한해 닉네임만 공개**한다.
--   users 테이블 정책은 넓히지 않는다(이메일·상태 등 전체 행 노출 금지).
--   차단 목록은 이미 본인이 직접 차단한 상대이므로, 그 닉네임을 되돌려 주는 것은
--   새 정보를 주는 것이 아니라 본인이 한 행위를 식별 가능하게 만드는 것이다.
--
-- 노출 범위(엄격):
--   · blocker_id = auth.uid() 인 행만
--   · 반환 컬럼은 blocked_id · nickname · created_at 뿐 (email·full_name·role 제외)
--   · security_invoker 뷰가 아니라 정의자 권한 뷰 — users 정책을 우회하되
--     WHERE 절이 본인 차단 행으로 스코프를 고정한다.
--
-- ※ 앱 배선: 현재 앱(1.0.0+18)은 users 를 직접 조회하므로 이 뷰를 쓰지 않는다.
--   서버 경로를 먼저 만들어 두고, 앱이 이 뷰를 읽도록 바꾸는 것은 다음 앱
--   버전(S3)에서 처리한다 — 그때까지 차단 목록은 종전대로 '사용자' 폴백이다.

create or replace view api_web_v1.my_blocked_users_v1 as
  select
    b.blocked_id,
    coalesce(nullif(btrim(u.nickname), ''), '사용자') as nickname,
    b.created_at
  from public.user_blocks b
  join public.users u on u.id = b.blocked_id
  where b.blocker_id = (select auth.uid());

comment on view api_web_v1.my_blocked_users_v1 is
  'S1-8/QA-C7: 본인이 차단한 사용자의 닉네임만 돌려주는 최소 노출 뷰. '
  'blocker_id = auth.uid() 로 스코프가 고정되며 email·full_name·role 은 내보내지 '
  '않는다. users 테이블 정책은 변경하지 않았다.';

revoke all on api_web_v1.my_blocked_users_v1 from public;
grant select on api_web_v1.my_blocked_users_v1 to authenticated;
