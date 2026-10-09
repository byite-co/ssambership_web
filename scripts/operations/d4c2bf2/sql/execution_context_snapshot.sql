-- Run only through the intended migration connection/role-switch context.
-- Read-only evidence; do not infer Hosted values from the local result.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path=pg_catalog,public;
SELECT jsonb_build_object(
 'observed_at_utc',clock_timestamp(),
 'session_user',session_user,'current_user',current_user,
 'read_only',current_setting('transaction_read_only'),
 'isolation',current_setting('transaction_isolation'),
 'server',version(),
 'session_preload_libraries',current_setting('session_preload_libraries',true),
 'shared_preload_libraries',current_setting('shared_preload_libraries',true),
 'supautils_policy_grants',current_setting('supautils.policy_grants',true),
 'supautils_privileged_role',current_setting('supautils.privileged_role',true),
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
