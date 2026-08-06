-- [backfill 2026-08-06] ssambership-app 전수조사 후속 — staging 에 2026-08-06
-- 03:34 직접 적용된 변경의 정본 역반영(원장 version 20260806033409).
--
-- N25: post_reactions SELECT 가 anon 포함 전체공개(USING true)였다 — 전
-- 사용자의 좋아요·스크랩(user_id, post_id) 쌍이 익명 열람 가능. 표시용
-- 카운트는 community_posts.like_count(트리거 정본) 경유라 행 노출이 필요
-- 없고, 앱·웹 모두 본인 행만 조회한다. 숏폼 쌍둥이 테이블
-- (shortform_reactions_select_own)과 동일 규약으로 정렬한다.
drop policy if exists post_reactions_select_all on public.post_reactions;
-- roles 가 비어 있어 아무에게도 적용되지 않던 고아 정책 정리.
drop policy if exists "본인 반응만 조회" on public.post_reactions;
create policy post_reactions_select_own on public.post_reactions
  for select to authenticated
  using (user_id = (select auth.uid()));
