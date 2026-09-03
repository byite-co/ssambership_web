-- =============================================================================
-- 20260903230100_soft_delete_own_content_rpc_rollback.sql  (DB-3 묶음 A 롤백)
-- =============================================================================
-- forward: supabase/sql/196_soft_delete_own_content_rpc.sql
-- 되돌리는 것: public.soft_delete_own_content(text, uuid) DROP. 다른 객체는 만지지 않았다.
-- 데이터: 이 RPC 로 지워진 행(deleted_by = 작성자)은 그대로 남는다 — 되돌리면 "지운 것이 다시 보이는" 것이 아니라
--   작성자 삭제 경로만 사라진다(게시판 댓글 본인 삭제는 다시 실패 상태로 돌아간다). 복원은 관리자 콘솔(PR-W2)로.
-- 순서: 198(하드 DELETE 차단)이 적용돼 있으면 198 롤백을 먼저 한다(198 게이트가 196 을 전제한다 — 역순 C → B → A).
-- =============================================================================

begin;

do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'ugc_block_hard_delete') then
    raise exception '196_ROLLBACK_GATE: 198(ugc_block_hard_delete)이 아직 있다 — 198 롤백을 먼저';
  end if;
end $$;

drop function if exists public.soft_delete_own_content(text, uuid);

-- 복원 검증
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'soft_delete_own_content') then
    raise exception '196_ROLLBACK_SELFCHECK: soft_delete_own_content 잔존';
  end if;
  -- 194 객체 불변(이 롤백은 건드리지 않는다)
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'community_comment_soft_delete_self')
     or not exists (select 1 from pg_trigger where tgname = 'trg_comments_sync_deleted_flag' and tgrelid = 'public.comments'::regclass) then
    raise exception '196_ROLLBACK_SELFCHECK: 194 객체 소실';
  end if;
end $$;

commit;
