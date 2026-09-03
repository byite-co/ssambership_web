-- =============================================================================
-- 20260903230300_ugc_block_hard_delete_rollback.sql  (DB-3 묶음 C 롤백)
-- =============================================================================
-- forward: supabase/sql/198_ugc_block_hard_delete.sql
-- 되돌리는 것(역순): *_no_delete 트리거 3종 DROP → ugc_block_hard_delete() DROP. 하드 DELETE 는 194 이전 경로로 돌아간다
--   (comments_write_guard 가 비관리자 DELETE 거부 · shortform_posts 는 sf_delete_own 정책 · community_comments 는 admin DELETE 정책).
-- 데이터 무접촉. 역순 최선두(C → B → A).
-- =============================================================================

begin;

drop trigger if exists trg_shortform_posts_no_delete on public.shortform_posts;
drop trigger if exists trg_comments_no_delete on public.comments;
drop trigger if exists trg_community_comments_no_delete on public.community_comments;
drop function if exists public.ugc_block_hard_delete();

-- 복원 검증
do $$
begin
  if exists (select 1 from pg_trigger where tgname in ('trg_shortform_posts_no_delete', 'trg_comments_no_delete', 'trg_community_comments_no_delete'))
     or exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'ugc_block_hard_delete') then
    raise exception '198_ROLLBACK_SELFCHECK: 트리거/함수 잔존';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_comments_write_guard' and tgrelid = 'public.comments'::regclass) then
    raise exception '198_ROLLBACK_SELFCHECK: trg_comments_write_guard 소실';
  end if;
end $$;

commit;
