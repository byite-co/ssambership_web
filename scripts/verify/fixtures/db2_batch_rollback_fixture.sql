-- db2_batch_rollback_fixture.sql — DB-2 rollback(195 → 194 → 193) 후 복원 assertion (오프라인 스크래치 PG 전용).
begin;
set local search_path to public;
create or replace function pg_temp.ok(p_cond boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_cond, false) then raise notice 'RB ok   %', p_label;
  else raise exception 'RB FAIL %', p_label; end if;
end $$;
create or replace function pg_temp.snap(p_key text) returns text language sql as $$ select val from db2_check.snapshot where key = p_key $$;
create or replace function pg_temp.fnmd5(p_sig text) returns text language sql as $$ select md5(pg_get_functiondef(p_sig::regprocedure)) $$;

-- A
select pg_temp.ok(pg_temp.fnmd5('public.school_tier_suggest(text)') = pg_temp.snap('fn_suggest'), 'A school_tier_suggest 192 정의 md5 일치');
select pg_temp.ok(pg_temp.fnmd5('public.approve_mentor_school_verification_admin(uuid,text,text,text,text,text)') = pg_temp.snap('fn_rpc'), 'A RPC 192 정의 md5 일치');
select pg_temp.ok(public.school_tier_suggest('가천대학교') = '미분류' and public.school_tier_suggest(null) = '미분류', 'A 폴백 미분류 복원');
select pg_temp.ok((select count(*) from public.mentor_school_verifications where status = 'approved' and school_tier = '미분류') = 4
                  and (select count(*) from public.mentor_school_verifications where status = 'approved' and school_tier = '그외') = 0, 'A-3 되돌림: 미분류 approved 4 · 그외 0');
select pg_temp.ok((select reviewed_at::text from public.mentor_school_verifications where mentor_id = '00000000-0000-4000-8000-00000000d2a2') = pg_temp.snap('msv_m2_reviewed_at')
                  and (select reviewed_at::text from public.mentor_school_verifications where mentor_id = '00000000-0000-4000-8000-00000000d2a1') = '2026-09-03 02:58:53.752476+00'
                  and (select bool_and(reviewed_by = '9bf48819-1dd2-40dd-96a3-d64bcca2e60c') from public.mentor_school_verifications where mentor_id in ('00000000-0000-4000-8000-00000000d2a1', '00000000-0000-4000-8000-00000000d2a2', '00000000-0000-4000-8000-00000000d2a3')),
                  'A-3 되돌림: 로그 rows 의 이전 reviewed_by/at 복원(M2 개별 확정 시각 포함)');
select pg_temp.ok((select (detail ->> 'count')::int from public.admin_action_logs where action_type = 'school_tier_bulk_reassign_reverted' order by created_at desc limit 1) = 3, 'A-3 되돌림 기록 count 3');
select pg_temp.ok((select school_tier || '|' || reviewed_at::text from public.mentor_school_verifications where mentor_id = '00000000-0000-4000-8000-00000000d2a5') = '서연고|' || pg_temp.snap('msv_m5_reviewed_at'), 'A 확정 서연고(M5) 불변');

-- B
select pg_temp.ok((select count(*) from information_schema.columns where table_schema = 'public'
                    and ((table_name in ('shortform_posts', 'comments', 'community_comments') and column_name in ('deleted_at', 'deleted_by'))
                      or (table_name = 'community_posts' and column_name = 'deleted_by'))) = 0
                  and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'community_posts' and column_name = 'deleted_at'),
                  'B-2 컬럼 7종 제거 · community_posts.deleted_at 유지');
select pg_temp.ok(pg_temp.fnmd5('public.cc_sync_board_to_canonical()') = pg_temp.snap('fn_cc_sync')
                  and pg_temp.fnmd5('public.cc_sync_board_delete_to_canonical()') = pg_temp.snap('fn_cc_sync_del')
                  and pg_temp.fnmd5('public.comments_mirror_to_legacy()') = pg_temp.snap('fn_mirror')
                  and pg_temp.fnmd5('public.comments_mirror_delete_to_legacy()') = pg_temp.snap('fn_mirror_del'), 'B-3c 브리지 함수 4종 정의 md5 일치(163·164)');
select pg_temp.ok(pg_temp.fnmd5('public.comments_write_guard()') = pg_temp.snap('fn_cwg')
                  and pg_temp.fnmd5('public.shortform_posts_protected_guard()') = pg_temp.snap('fn_spg'), 'B-3g 쓰기 가드 2종 정의 md5 일치');
select pg_temp.ok(pg_temp.fnmd5('public.community_refresh_post_comment_count()') = pg_temp.snap('fn_count')
                  and (select pg_get_triggerdef(oid) from pg_trigger where tgname = 'trg_comments_refresh_count' and tgrelid = 'public.comments'::regclass) = pg_temp.snap('trg_count'),
                  'B-3b 댓글 수 함수·트리거 정의 일치(037)');
select pg_temp.ok(pg_temp.fnmd5('public.shortform_view_record_v2(uuid,uuid)') = pg_temp.snap('fn_view_v2')
                  and pg_temp.fnmd5('public.increment_shortform_post_view(uuid)') = pg_temp.snap('fn_inc')
                  and pg_temp.fnmd5('public.community_comment_soft_delete_self(uuid)') = pg_temp.snap('fn_self_del')
                  and pg_temp.fnmd5('rls_private.report_target_content_valid(text,uuid)') = pg_temp.snap('fn_report_valid'), 'B-3f RPC 4종 정의 md5 일치');
select pg_temp.ok((select pg_get_viewdef('api_web_v1.community_comments_v1'::regclass)) = pg_temp.snap('view_cc_v1')
                  and (select coalesce(reloptions::text, '') from pg_class where oid = 'api_web_v1.community_comments_v1'::regclass) = pg_temp.snap('view_cc_v1_opts')
                  and (select coalesce(relacl::text, '') from pg_class where oid = 'api_web_v1.community_comments_v1'::regclass) = pg_temp.snap('view_cc_v1_acl'),
                  'B-3d 뷰 정의·security_invoker·ACL 일치(M4)');
select pg_temp.ok((select roles::text || '|' || qual from pg_policies where tablename = 'shortform_posts' and policyname = 'sf_select_published') = pg_temp.snap('pol_sf')
                  and (select roles::text || '|' || qual from pg_policies where tablename = 'comments' and policyname = 'comments_select_visible') = pg_temp.snap('pol_c')
                  and (select roles::text || '|' || qual from pg_policies where tablename = 'community_comments' and policyname = 'community_comments_select_visible') = pg_temp.snap('pol_cc'),
                  'B-3e SELECT 정책 3종 roles·qual 일치');
select pg_temp.ok(not exists (select 1 from pg_proc where proname in ('comments_sync_deleted_flag', 'ugc_block_hard_delete'))
                  and not exists (select 1 from pg_trigger where tgname in ('trg_comments_sync_deleted_flag', 'trg_shortform_posts_no_delete', 'trg_comments_no_delete', 'trg_community_comments_no_delete')),
                  'B-3a/B-4 신규 함수·트리거 부재');
select pg_temp.ok((select status from public.shortform_posts where id = '00000000-0000-4000-8000-00000000d2f2') = 'hidden'
                  and (select (detail ->> 'shortform_posts_hidden')::int from public.admin_action_logs where action_type = 'community_soft_delete_rollback' order by created_at desc limit 1) = 1,
                  'B 데이터: forward 기간 soft delete 행 → 숨김 전환 + 기록');
select pg_temp.ok((select count(*) from public.shortform_posts) = 2 and (select count(*) from public.comments) = 2 and (select count(*) from public.community_comments) = 4, 'B 행 수 불변');

-- C
select pg_temp.ok(to_regclass('public.school_tier_mappings') is not null, 'C school_tier_mappings 재생성');
select pg_temp.ok((select string_agg(column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '-'), ',' order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'school_tier_mappings') = pg_temp.snap('stm_columns'), 'C 컬럼 정의 일치');
select pg_temp.ok((select string_agg(conname || ':' || pg_get_constraintdef(oid), ',' order by conname) from pg_constraint where conrelid = 'public.school_tier_mappings'::regclass) = pg_temp.snap('stm_constraints'), 'C 제약(PK·CHECK·FK) 일치');
select pg_temp.ok((select string_agg(indexdef, ',' order by indexname) from pg_indexes where schemaname = 'public' and tablename = 'school_tier_mappings') = pg_temp.snap('stm_indexes'), 'C 인덱스 일치');
select pg_temp.ok((select roles::text || '|' || cmd || '|' || qual || '|' || with_check from pg_policies where tablename = 'school_tier_mappings') = pg_temp.snap('stm_policy'), 'C 정책 일치');
select pg_temp.ok((select string_agg(grantee || ':' || privilege_type, ',' order by grantee, privilege_type) from information_schema.role_table_grants where table_schema = 'public' and table_name = 'school_tier_mappings' and grantee in ('anon', 'authenticated', 'service_role')) = pg_temp.snap('stm_grants'), 'C GRANT 일치');
select pg_temp.ok(exists (select 1 from pg_trigger where tgname = 'trg_school_tier_mappings_set_updated_at' and tgrelid = 'public.school_tier_mappings'::regclass), 'C updated_at 트리거 복원');
\echo DB2 ROLLBACK FIXTURE PASS
rollback;
