-- =============================================================================
-- full_convergence_rollback_verify.sql — RB3→RB2→RB1 후 baseline 복원 검증
-- =============================================================================
\set ON_ERROR_STOP on
do $$ begin
  -- M1 원복: users UPDATE grant 복원 · 트리거/CHECK/RPC 부재
  if not exists (select 1 from information_schema.role_table_grants
                  where table_schema='public' and table_name='users'
                    and grantee='authenticated' and privilege_type='UPDATE') then
    raise exception 'FAIL[RB-1a] users UPDATE grant not restored';
  end if;
  if exists (select 1 from pg_trigger where tgrelid='public.users'::regclass and tgname='trg_users_protected_columns')
     or exists (select 1 from pg_constraint where conrelid='public.users'::regclass and conname='users_status_allowed')
     or exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                 where (n.nspname,p.proname) in (('api_app_v1','user_profile_update_self'),
                                                 ('api_web_v1','user_profile_update_self'))) then
    raise exception 'FAIL[RB-1b] M1 objects remain';
  end if;
  raise notice 'PASS RB-1 M1 rollback restored baseline';

  -- M2 원복: legacy RPC 재허용 · 신규 객체 부재 · favorites 6정책 · allowlist 원복
  if not has_function_privilege('anon', 'public.mentor_directory_list_v2(integer)', 'EXECUTE') then
    raise exception 'FAIL[RB-2a] legacy mentor RPC not restored';
  end if;
  if to_regclass('public.shortform_view_events') is not null
     or exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                 where n.nspname='public' and p.proname in
                   ('shortform_view_record_v2','community_comment_soft_delete_self','admin_issue_user_warning')) then
    raise exception 'FAIL[RB-2b] M2 objects remain';
  end if;
  if (select count(*) from pg_policies where schemaname='public' and tablename='favorites') <> 6 then
    raise exception 'FAIL[RB-2c] favorites policies not restored';
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='content_reports'
                  and policyname='content_reports_insert_reporter' and with_check like '%''shortform''%') then
    raise exception 'FAIL[RB-2d] report allowlist not restored';
  end if;
  if not has_function_privilege('anon', 'public.increment_shortform_post_view(uuid)', 'EXECUTE') then
    raise exception 'FAIL[RB-2e] legacy view increment not restored';
  end if;
  raise notice 'PASS RB-2 M2 rollback restored baseline';

  -- M3 원복: publication 3테이블 · pending 복원 · 컬럼 복원 · 신규 객체 부재
  if (select count(*) from pg_publication_tables where pubname='supabase_realtime' and schemaname='public') <> 3 then
    raise exception 'FAIL[RB-3a] publication not restored';
  end if;
  if (select count(*) from public.notification_outbox where status='pending') <> 3
     or exists (select 1 from public.notification_outbox where status='suppressed') then
    raise exception 'FAIL[RB-3b] outbox pending not restored';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='users' and column_name='notification_enabled') then
    raise exception 'FAIL[RB-3c] notification_enabled not restored';
  end if;
  if to_regclass('public.notification_transport_config') is not null
     or exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                 where n.nspname='public' and p.proname in ('notification_unread_count_self','mark_notification_read')) then
    raise exception 'FAIL[RB-3d] M3 objects remain';
  end if;
  raise notice 'PASS RB-3 M3 rollback restored baseline';
end $$;
select '=== full_convergence_rollback_verify: ALL PASS' as result;
