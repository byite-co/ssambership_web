-- =============================================================================
-- contract_snapshot_query.sql — 원격 DB 계약 스냅샷 (단일 JSON 출력)
-- =============================================================================
-- 사용: psql "$SUPABASE_DB_URL" -Atq -f scripts/contracts/contract_snapshot_query.sql
-- 결과: 결정적 정렬의 JSON 1행. contracts/snapshots/staging_contract.json 과 비교한다.
-- 보안 임계 함수(body_md5 포함) 목록은 지시서 §22.2 최소 목록의 실제 존재 함수들이다.
-- =============================================================================
with critical as (
  select unnest(array[
    'community_post_create_impl','community_post_update_impl','community_post_soft_delete_impl',
    'ugc_write_allowed','qna_append_message','qna_register_attachment','qna_create_question_thread',
    'account_deletion_request_self_v2','account_deletion_request_self_consented_v2',
    'account_deletion_claim','account_deletion_begin_locked','account_deletion_advance',
    'record_domain_notification','mark_notification_read','mark_all_notifications_read',
    'notification_unread_count_self','user_profile_update_self','user_profile_update_self_impl',
    'shortform_view_record_v2','community_comment_soft_delete_self','shortform_posts_protected_guard',
    'users_protected_columns_guard','iq_append_message','answer_individual_question',
    'add_individual_question_attachment','refund_individual_question','release_individual_question',
    'check_review_eligibility','get_mentor_review_stats','admin_issue_user_warning'
  ]) as fname
)
select jsonb_pretty(jsonb_build_object(
  'contract_snapshot_version', 1,
  'schemas', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'schema', n.nspname,
      'usage', (select coalesce(jsonb_agg(r order by r), '[]'::jsonb) from (
        select ae.grantee::regrole::text as r
        from aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) ae
        where ae.privilege_type = 'USAGE' and ae.grantee::regrole::text in ('anon','authenticated','service_role')
      ) g)
    ) order by n.nspname), '[]'::jsonb)
    from pg_namespace n where n.nspname in ('api_app_v1','api_web_v1','core_private','public')
  ),
  'functions', (
    select coalesce(jsonb_agg(f order by f->>'schema', f->>'name', f->>'args'), '[]'::jsonb) from (
      select jsonb_build_object(
        'schema', n.nspname,
        'name', p.proname,
        'args', pg_get_function_identity_arguments(p.oid),
        'returns', pg_get_function_result(p.oid),
        'security_definer', p.prosecdef,
        'config', coalesce(p.proconfig::text[], '{}'::text[]),
        'execute', (select coalesce(jsonb_agg(r order by r), '[]'::jsonb) from (
          select distinct ae.grantee::regrole::text as r
          from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) ae
          where ae.privilege_type = 'EXECUTE'
            and ae.grantee::regrole::text in ('anon','authenticated','service_role','-')
        ) g),
        'body_md5', case when p.proname in (select fname from critical) then md5(p.prosrc) else null end
      ) as f
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('api_app_v1','api_web_v1','core_private')
         or (n.nspname = 'public' and (
              p.proname in (select fname from critical)
              or exists (
                select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) ae
                where ae.privilege_type='EXECUTE' and ae.grantee::regrole::text in ('anon','authenticated','-')
              )))
    ) fx
  ),
  'views', (
    select coalesce(jsonb_agg(v order by v->>'schema', v->>'name'), '[]'::jsonb) from (
      select jsonb_build_object(
        'schema', n.nspname,
        'name', c.relname,
        'security_invoker', coalesce((select option_value::boolean from pg_options_to_table(c.reloptions)
                                       where option_name='security_invoker'), false),
        'columns', (select jsonb_agg(a.attname order by a.attnum)
                     from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped),
        'select', (select coalesce(jsonb_agg(r order by r), '[]'::jsonb) from (
          select distinct ae.grantee::regrole::text as r
          from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) ae
          where ae.privilege_type='SELECT' and ae.grantee::regrole::text in ('anon','authenticated','service_role')
        ) g)
      ) as v
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind = 'v' and n.nspname in ('api_app_v1','api_web_v1')
    ) vx
  ),
  'table_grants', (
    select coalesce(jsonb_agg(t order by t->>'table', t->>'grantee'), '[]'::jsonb) from (
      select jsonb_build_object(
        'table', table_name,
        'grantee', grantee,
        'privileges', (
          select jsonb_agg(x order by x) from (
            select distinct g2.privilege_type as x
            from information_schema.role_table_grants g2
            where g2.table_schema='public' and g2.table_name=g.table_name and g2.grantee=g.grantee
          ) p)
      ) as t
      from (select distinct table_name, grantee from information_schema.role_table_grants
             where table_schema='public' and grantee in ('anon','authenticated')) g
    ) gx
  ),
  'policies', (
    select coalesce(jsonb_agg(p order by p->>'table', p->>'name'), '[]'::jsonb) from (
      select jsonb_build_object(
        'table', tablename, 'name', policyname, 'roles', roles::text, 'cmd', cmd,
        'qual_md5', md5(coalesce(qual,'')), 'with_check_md5', md5(coalesce(with_check,''))
      ) as p
      from pg_policies where schemaname = 'public'
    ) px
  ),
  'publication_tables', (
    select coalesce(jsonb_agg(tablename order by tablename), '[]'::jsonb)
    from pg_publication_tables where pubname='supabase_realtime' and schemaname='public'
  ),
  'storage_buckets', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'public', public, 'file_size_limit', file_size_limit,
      'allowed_mime_types', to_jsonb(allowed_mime_types)
    ) order by id), '[]'::jsonb)
    from storage.buckets
  ),
  'migrations', (
    select coalesce(jsonb_agg(jsonb_build_object('version', version, 'name', name) order by version), '[]'::jsonb)
    from supabase_migrations.schema_migrations
  )
));
