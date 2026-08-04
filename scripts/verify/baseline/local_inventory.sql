-- local_inventory.sql — scratch/branch DB 의 앱 관리 스키마 구조 인벤토리(JSON 1행).
-- 부모 인벤토리와 같은 축으로 정규화: OID·시퀀스 현재값·통계·데이터 제외.
with app_schemas as (
  select n.oid, n.nspname from pg_namespace n
  where n.nspname in ('public','api_web_v1','api_app_v1','core_private')
),
tbl as (
  select ns.nspname as sch, c.relname as tbl, c.relrowsecurity as rls, c.relforcerowsecurity as rls_forced
  from pg_class c join app_schemas ns on ns.oid=c.relnamespace
  where c.relkind='r' order by 1,2
),
cols as (
  select c.table_schema as sch, c.table_name as tbl, c.column_name as col, c.ordinal_position as ord,
         coalesce(c.domain_name, c.udt_name) as typ, c.is_nullable, c.column_default,
         c.is_identity, c.is_generated
  from information_schema.columns c
  where c.table_schema in (select nspname from app_schemas)
    and exists (select 1 from pg_class pc join pg_namespace pn on pn.oid=pc.relnamespace
                where pn.nspname=c.table_schema and pc.relname=c.table_name and pc.relkind='r')
  order by 1,2,4
),
cons as (
  select ns.nspname as sch, cl.relname as tbl, con.conname, con.contype::text as typ,
         pg_get_constraintdef(con.oid) as def
  from pg_constraint con
  join pg_class cl on cl.oid=con.conrelid
  join app_schemas ns on ns.oid=cl.relnamespace
  order by 1,2,3
),
idx as (
  select schemaname as sch, tablename as tbl, indexname as name, indexdef as def
  from pg_indexes where schemaname in (select nspname from app_schemas)
  order by 1,2,3
),
vws as (
  select schemaname as sch, viewname as name, md5(regexp_replace(definition, '\s+', ' ', 'g')) as def_md5
  from pg_views where schemaname in (select nspname from app_schemas)
  order by 1,2
),
fns as (
  select ns.nspname as sch, p.proname as name, pg_get_function_identity_arguments(p.oid) as args,
         p.prosecdef as secdef, coalesce(array_to_string(p.proconfig,','),'') as config,
         l.lanname as lang, md5(p.prosrc) as src_md5,
         case when p.proacl is null then '(implicit)'
              else coalesce((select string_agg(coalesce(g.rolname,'PUBLIC')||':'||a.privilege_type, ',' order by 1)
                 from aclexplode(p.proacl) a left join pg_roles g on g.oid=a.grantee
                 where coalesce(g.rolname,'PUBLIC') in ('PUBLIC','anon','authenticated','service_role')), '(none)') end as acl
  from pg_proc p
  join app_schemas ns on ns.oid=p.pronamespace
  join pg_language l on l.oid=p.prolang
  order by 1,2,3
),
trg as (
  select ns.nspname as sch, cl.relname as tbl, t.tgname as name,
         md5(pg_get_triggerdef(t.oid)) as def_md5, t.tgenabled::text as enabled
  from pg_trigger t
  join pg_class cl on cl.oid=t.tgrelid
  join app_schemas ns on ns.oid=cl.relnamespace
  where not t.tgisinternal
  order by 1,2,3
),
auth_trg as (
  select 'auth' as sch, cl.relname as tbl, t.tgname as name
  from pg_trigger t join pg_class cl on cl.oid=t.tgrelid
  join pg_namespace n on n.oid=cl.relnamespace and n.nspname='auth'
  where not t.tgisinternal
  order by 2,3
),
pol as (
  select schemaname as sch, tablename as tbl, policyname as name, cmd,
         coalesce(array_to_string(roles,','),'') as roles,
         md5(coalesce(regexp_replace(qual,'\s+',' ','g'),'')) as qual_md5,
         md5(coalesce(regexp_replace(with_check,'\s+',' ','g'),'')) as check_md5
  from pg_policies
  where schemaname in (select nspname from app_schemas) or (schemaname='storage')
  order by 1,2,3
),
tgrants as (
  select table_schema as sch, table_name as tbl, grantee, privilege_type as priv
  from information_schema.role_table_grants
  where (table_schema in (select nspname from app_schemas)
         or (table_schema='storage' and table_name in ('objects','buckets')))
    and grantee in ('anon','authenticated','service_role','PUBLIC')
  order by 1,2,3,4
),
bkt as (
  select id, public, file_size_limit, coalesce(array_to_string(allowed_mime_types,','),'') as mime
  from storage.buckets order by id
),
typs as (
  select ns.nspname as sch, t.typname as name,
         case when t.typtype='e' then 'enum' else 'composite' end as kind,
         case when t.typtype='e'
              then (select string_agg(enumlabel, ', ' order by enumsortorder) from pg_enum e where e.enumtypid=t.oid)
              else (select string_agg(a.attname||' '||format_type(a.atttypid,a.atttypmod), ', ' order by a.attnum)
                    from pg_attribute a where a.attrelid=t.typrelid and a.attnum>0 and not a.attisdropped) end as definition
  from pg_type t
  join app_schemas ns on ns.oid=t.typnamespace
  where t.typtype='e'
     or (t.typtype='c' and exists (select 1 from pg_class c where c.oid=t.typrelid and c.relkind='c'))
  order by 1,2
),
pubs as (
  select p.pubname,
         coalesce((select string_agg(pt.schemaname||'.'||pt.tablename, ',' order by pt.schemaname||'.'||pt.tablename)
                   from pg_publication_tables pt where pt.pubname=p.pubname), '') as tbls
  from pg_publication p order by 1
)
select json_build_object(
  'tables', (select json_agg(row_to_json(x)) from tbl x),
  'columns', (select json_agg(row_to_json(x)) from cols x),
  'constraints', (select json_agg(row_to_json(x)) from cons x),
  'indexes', (select json_agg(row_to_json(x)) from idx x),
  'views', (select json_agg(row_to_json(x)) from vws x),
  'functions', (select json_agg(row_to_json(x)) from fns x),
  'triggers', (select json_agg(row_to_json(x)) from trg x),
  'auth_triggers', (select json_agg(row_to_json(x)) from auth_trg x),
  'policies', (select json_agg(row_to_json(x)) from pol x),
  'table_grants', (select json_agg(row_to_json(x)) from tgrants x),
  'buckets', (select json_agg(row_to_json(x)) from bkt x),
  'types', (select json_agg(row_to_json(x)) from typs x),
  'publications', (select json_agg(row_to_json(x)) from pubs x)
);
