-- --------------------------------------------------------------------------
-- 130_shortform_scrap_reaction.sql   (P2-14 · 숏폼 reactions scrap 허용)
-- [적용됨 — ssambership-staging 에 2026-07-19 단일 트랜잭션(lock_timeout 3s) 적용·검증 통과
--   (T1 CHECK like/scrap · T2 RLS WITH CHECK like/scrap · S1 인증 사용자 scrap+like 삽입 성공·잘못된 type 거부).
--   fixture savepoint 롤백·baseline 0행 복원. 원장 미기재 — 적용 이력: docs/audit/sql_apply_manifest.md]
-- 목적: shortform_reactions 의 type 을 like 뿐 아니라 scrap 도 허용한다. **CHECK 제약과 RLS INSERT
--   WITH CHECK 를 함께** 바꿔야 한다(한쪽만 바꾸면 실패). 게시판(post_reactions)은 이미 like/scrap 을
--   지원하나 숏폼은 CHECK·RLS 가 like 만 허용해 scrap 삽입이 거부됐다.
-- 선행: 082(shortform_reactions). 실상태: 0행, `type_check`=CHECK(type='like'), insert 정책 WITH CHECK=type='like'.
-- 보존: UNIQUE(user_id,shortform_id,type)·FK·delete/select 정책 불변. 데이터 백필 불필요(0행).
-- --------------------------------------------------------------------------

alter table public.shortform_reactions drop constraint if exists shortform_reactions_type_check;
alter table public.shortform_reactions
  add constraint shortform_reactions_type_check check (type in ('like', 'scrap'));

drop policy if exists shortform_reactions_insert_own on public.shortform_reactions;
create policy shortform_reactions_insert_own on public.shortform_reactions
  for insert to authenticated
  with check ((user_id = (select auth.uid())) and (type in ('like', 'scrap')));
