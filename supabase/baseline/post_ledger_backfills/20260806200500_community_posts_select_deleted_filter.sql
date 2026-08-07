-- [S1-2 2026-08-06] QA-A4 — 삭제한 글이 서버 권한상 계속 조회 가능.
--
-- 증상: 게시글을 삭제해도 `deleted_at` 만 찍히고 `status` 는 published 로 남는다.
--       목록에서 안 보이는 것은 앱·웹이 뷰(api_web_v1.community_posts_v1)를
--       쓰기 때문일 뿐, 베이스 테이블에 직접 요청하면 삭제한 글이 그대로 응답된다.
--       DB 실측: deleted_at 이 찍힌 published 글 1건 존재.
--
-- 원인: public.community_posts 의 SELECT 정책 3개가 **전부 deleted_at 을 보지
--       않는다**. RLS 정책은 permissive OR 결합이라 가장 느슨한 하나만 통과해도
--       행이 나간다.
--         · "누구나 게시글 읽기" (public)            : status='published'
--         · cp_select_own       (public)             : author_id=auth.uid() OR is_admin()
--         · cp_select_published (anon,authenticated) : published OR author OR admin
--       합집합 = published OR 본인 OR admin — 즉 cp_select_published 는 다른
--       둘의 합집합에 완전히 포함되는 중복이다. 필터를 한 곳에만 추가하면
--       나머지가 그대로 새기 때문에, 이번 결함이 재발하지 않도록 **하나로 통합**한다.
--
-- 수정 후 가시성:
--   일반 사용자·비로그인 : deleted_at IS NULL AND (published OR 본인 글)
--   admin                : 제한 없음(검수·모더레이션 목적으로 삭제분도 조회 가능)
--   service_role         : BYPASSRLS 라 정책 무관(실측 rolbypassrls=true)
-- 앱·웹이 쓰는 뷰의 조건(deleted_at IS NULL AND (published OR 본인))과 정확히
-- 일치시켜, 뷰 경유와 직접 조회의 결과가 어긋나지 않게 한다.
--
-- 적용 범위: deleted_at 컬럼을 가진 public 테이블은 community_posts 하나뿐이므로
--            (실측) 다른 테이블에 동일 결함은 없다.
--
-- 정책 이름이 바뀌므로 이름을 하드 어설트하던 과거 검증 스크립트
-- (scripts/verify/s2_2_batch_f_verify.sql F-03·R-02)를 통합본도 통과하도록 함께 고쳤다.

drop policy if exists "누구나 게시글 읽기" on public.community_posts;
drop policy if exists cp_select_own on public.community_posts;
drop policy if exists cp_select_published on public.community_posts;
-- 재적용 안전(멱등): CREATE POLICY 에는 OR REPLACE 가 없다. 이 줄이 없으면
-- 두 번째 적용이 42710 duplicate_object 로 실패해 pack 재생·부분 재적용이 깨진다
-- — 이 배치에서 유일하게 멱등하지 않던 파일이었다.
drop policy if exists cp_select_visible on public.community_posts;

create policy cp_select_visible on public.community_posts
  for select
  using (
    (deleted_at is null
      and (status = 'published' or author_id = (select auth.uid())))
    or (select public.is_admin()) = true
  );

comment on policy cp_select_visible on public.community_posts is
  'S1-2/QA-A4: 삭제(soft-delete)된 글은 작성자에게도 보이지 않는다. admin 은 '
  '검수 목적으로 제한 없이 조회한다. 종전 3중 중복 정책(누구나 게시글 읽기 · '
  'cp_select_own · cp_select_published)을 하나로 통합 — 필터가 한 정책에만 '
  '추가돼 나머지로 새는 재발을 막는다.';
