-- db3_batch_rollback_fixture.sql — DB-3 rollback(198 → 197 → 196) 후 복원 assertion (오프라인 스크래치 PG 전용).
begin;
set local search_path to public;
create or replace function pg_temp.ok(p_cond boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_cond, false) then raise notice 'RB ok   %', p_label;
  else raise exception 'RB FAIL %', p_label; end if;
end $$;
create or replace function pg_temp.snap(p_key text) returns text language sql as $$ select val from db3_check.snapshot where key = p_key $$;

-- A
select pg_temp.ok(not exists (select 1 from pg_proc where proname = 'soft_delete_own_content'), 'A soft_delete_own_content 부재');
select pg_temp.ok(exists (select 1 from pg_proc where proname = 'community_comment_soft_delete_self')
                  and md5(pg_get_functiondef('public.community_comment_soft_delete_self(uuid)'::regprocedure)) = pg_temp.snap('fn_self_del'), 'A 기존 본인 삭제 RPC(앱 계약) 불변');
-- B
select pg_temp.ok((select count(*) from pg_policies where schemaname = 'realtime' and tablename = 'messages')::text = pg_temp.snap('rt_policies'), 'B realtime.messages 정책 0(적용 전과 동일)');
select pg_temp.ok((select relrowsecurity from pg_class where oid = 'realtime.messages'::regclass), 'B realtime.messages RLS 유지');
-- C
select pg_temp.ok(not exists (select 1 from pg_trigger where tgname in ('trg_shortform_posts_no_delete', 'trg_comments_no_delete', 'trg_community_comments_no_delete')) and not exists (select 1 from pg_proc where proname = 'ugc_block_hard_delete'), 'C no_delete 트리거 3종·함수 부재(다른 표의 *_no_delete 트리거는 대상 아님)');
select pg_temp.ok((select string_agg(tgname, ',' order by tgname) from pg_trigger where tgrelid = 'public.comments'::regclass and not tgisinternal) = pg_temp.snap('trg_comments')
                  and (select string_agg(tgname, ',' order by tgname) from pg_trigger where tgrelid = 'public.shortform_posts'::regclass and not tgisinternal) = pg_temp.snap('trg_sf')
                  and (select string_agg(tgname, ',' order by tgname) from pg_trigger where tgrelid = 'public.community_comments'::regclass and not tgisinternal) = pg_temp.snap('trg_cc'),
                  'C 세 테이블 트리거 목록이 적용 전과 동일');
-- 194 불변
select pg_temp.ok(md5(pg_get_functiondef('public.comments_write_guard()'::regprocedure)) = pg_temp.snap('fn_cwg')
                  and md5(pg_get_functiondef('public.shortform_posts_protected_guard()'::regprocedure)) = pg_temp.snap('fn_spg')
                  and md5(pg_get_functiondef('public.comments_sync_deleted_flag()'::regprocedure)) = pg_temp.snap('fn_sync_flag'), '194 가드·동기화 함수 md5 불변');
select pg_temp.ok((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public')::text = pg_temp.snap('fn_count'), 'public 함수 수 적용 전과 동일');
-- 데이터: forward 기간에 RPC 로 지운 행은 그대로 남는다(작성자 삭제 경로만 사라진다)
select pg_temp.ok((select deleted_at is not null and deleted_by = '00000000-0000-4000-8000-00000000d3b1' and is_deleted from public.comments where id = '00000000-0000-4000-8000-00000000d3e1'),
                  '데이터: forward 기간 작성자 삭제(C1) 유지 — deleted_by = 작성자');
select pg_temp.ok((select count(*) from public.shortform_posts) = 4 and (select count(*) from public.comments) = 4 and (select count(*) from public.community_comments) = 7, '행 수 불변');
\echo DB3 ROLLBACK FIXTURE PASS
rollback;
