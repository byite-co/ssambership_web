-- Run only through the intended migration connection/role-switch context.
-- Read-only evidence; do not infer Hosted values from the local result.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path=pg_catalog,public;
SET LOCAL TimeZone='UTC';
SET LOCAL DateStyle='ISO,YMD';
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='2s';
SELECT jsonb_build_object(
 'observed_at_utc',clock_timestamp(),
 'session_user',session_user,'current_user',current_user,
 'read_only',current_setting('transaction_read_only'),
 'isolation',current_setting('transaction_isolation'),
 'server',version(),'server_version_num',current_setting('server_version_num'),
 'database',current_database(),
 'ssl',(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()),
 'role_setting',current_setting('role',true),
 'settings_access',jsonb_build_object('source','privilege-filtered pg_settings',
    'read_all_settings',pg_has_role(current_user,'pg_read_all_settings','USAGE'),
    'observations',(SELECT jsonb_object_agg(w.name,jsonb_build_object('visible',s.name IS NOT NULL,'value',s.setting))
      FROM (VALUES ('session_preload_libraries'),('shared_preload_libraries'),('supautils.policy_grants'),('supautils.privileged_role')) w(name)
      LEFT JOIN pg_settings s ON s.name=w.name),
    'limitation','Absent rows may be permission-filtered or unregistered; not disabled or empty.'),
 'migration_history',(SELECT jsonb_build_object('count',count(*),'latest_version',max(version)) FROM supabase_migrations.schema_migrations),
 'session_preload_libraries',(SELECT setting FROM pg_settings WHERE name='session_preload_libraries'),
 'shared_preload_libraries',(SELECT setting FROM pg_settings WHERE name='shared_preload_libraries'),
 'supautils_policy_grants',(SELECT setting FROM pg_settings WHERE name='supautils.policy_grants'),
 'supautils_privileged_role',(SELECT setting FROM pg_settings WHERE name='supautils.privileged_role'),
 'role',(SELECT jsonb_build_object('superuser',rolsuper,'bypass_rls',rolbypassrls,
    'inherit',rolinherit,'create_role',rolcreaterole,'create_db',rolcreatedb)
    FROM pg_roles WHERE rolname=current_user),
 'database_collation',(SELECT jsonb_build_object('collate',datcollate,'ctype',datctype,
    'provider',datlocprovider,'locale',datlocale,'recorded_version',datcollversion,
    'actual_version',pg_database_collation_actual_version(oid)) FROM pg_database WHERE datname=current_database()),
 'event_triggers',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',evtname,
    'event',evtevent,'owner',pg_get_userbyid(evtowner),'enabled',evtenabled,
    'tags',evttags,'function',evtfoid::regprocedure::text) ORDER BY evtname),'[]'::jsonb)
    FROM pg_event_trigger),
 'application_composite_types',(SELECT coalesce(jsonb_agg(jsonb_build_object(
    'schema',n.nspname,'name',t.typname,'owner',pg_get_userbyid(t.typowner),
    'acl',t.typacl::text,'attributes',(SELECT jsonb_agg(jsonb_build_object(
       'position',a.attnum,'name',a.attname,'type',format_type(a.atttypid,a.atttypmod),
       'dropped',a.attisdropped,'collation',a.attcollation::regcollation::text)
       ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid=t.typrelid AND a.attnum>0))
    ORDER BY n.nspname,t.typname),'[]'::jsonb)
    FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
    JOIN pg_class c ON c.oid=t.typrelid
    WHERE n.nspname IN ('public','core_private','api_web_v1','api_app_v1') AND c.relkind='c'),
 'storage_native_privileges',(SELECT jsonb_agg(jsonb_build_object('relation',c.oid::regclass::text,
    'owner',pg_get_userbyid(c.relowner),'owner_member',pg_has_role(current_user,c.relowner,'MEMBER'),
    'select',has_table_privilege(current_user,c.oid,'SELECT'),
    'update',has_table_privilege(current_user,c.oid,'UPDATE'),
    'delete',has_table_privilege(current_user,c.oid,'DELETE'),
    'truncate',has_table_privilege(current_user,c.oid,'TRUNCATE')) ORDER BY c.relname)
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='storage' AND c.relkind='r'),
 'limitation','Native privileges do not prove Supautils behavior or authorize execution; null settings remain unverified.'
);
ROLLBACK;
