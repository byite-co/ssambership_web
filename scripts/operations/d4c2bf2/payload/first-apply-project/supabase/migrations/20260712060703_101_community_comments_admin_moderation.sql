-- 101_community_comments_admin_moderation.sql
-- community_comments 모더레이션 활성화 — RLS only (파일 본문 그대로, begin/commit 래퍼는 마이그레이션 원자 실행이 대체)

-- SELECT 정책 교체 — visible 댓글 누구나 / 본인 댓글 + admin 은 hidden 도 조회
drop policy if exists "community_comments_select_visible" on public.community_comments;
create policy "community_comments_select_visible"
  on public.community_comments
  for select
  to anon, authenticated
  using (
    status = 'visible'
    or author_id = (select auth.uid())
    or (select public.is_admin()) = true
  );

-- UPDATE 정책 — admin 전용
drop policy if exists "community_comments_update_admin" on public.community_comments;
create policy "community_comments_update_admin"
  on public.community_comments
  for update
  to authenticated
  using ((select public.is_admin()) = true)
  with check ((select public.is_admin()) = true);

-- DELETE 정책 — admin 전용
drop policy if exists "community_comments_delete_admin" on public.community_comments;
create policy "community_comments_delete_admin"
  on public.community_comments
  for delete
  to authenticated
  using ((select public.is_admin()) = true);

comment on policy "community_comments_select_visible" on public.community_comments is
  'community_comments: visible 댓글은 누구나 / 본인 댓글 또는 admin 은 hidden 도 조회';
comment on policy "community_comments_update_admin" on public.community_comments is
  'community_comments: admin 만 status 등 변경(모더레이션) 가능';
comment on policy "community_comments_delete_admin" on public.community_comments is
  'community_comments: admin 만 행 삭제 가능';