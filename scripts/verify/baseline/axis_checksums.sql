-- axis_checksums.sql — 축별 개수 + 정규 문자열 집계 md5 (compact 동등성 지표).
-- 부모 인벤토리 JSON 에서 동일 규칙으로 계산한 값과 대조한다(scratch/parent_axis_checksums.py).
with app_schemas as (select nspname from pg_namespace where nspname in ('public','api_web_v1','api_app_v1','core_private')),
t as (select n.nspname||'|'||c.relname||'|'||c.relrowsecurity::text||'|'||c.relforcerowsecurity::text as s
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in (select nspname from app_schemas) and c.relkind='r'),
c as (select ic.table_schema||'|'||ic.table_name||'|'||ic.column_name||'|'||coalesce(ic.domain_name,ic.udt_name)||'|'||ic.is_nullable||'|'||coalesce(ic.column_default,'') as s
      from information_schema.columns ic
      where ic.table_schema in (select nspname from app_schemas)
        and exists (select 1 from pg_class pc join pg_namespace pn on pn.oid=pc.relnamespace
                    where pn.nspname=ic.table_schema and pc.relname=ic.table_name and pc.relkind='r')),
k as (select n.nspname||'|'||cl.relname||'|'||con.conname||'|'||pg_get_constraintdef(con.oid) as s
      from pg_constraint con join pg_class cl on cl.oid=con.conrelid
      join pg_namespace n on n.oid=cl.relnamespace where n.nspname in (select nspname from app_schemas)),
i as (select schemaname||'|'||tablename||'|'||indexname||'|'||indexdef as s
      from pg_indexes where schemaname in (select nspname from app_schemas)),
v as (select n.nspname||'|'||cl.relname||'|'||md5(regexp_replace(pg_get_viewdef(cl.oid,false),'\s+',' ','g')) as s
      from pg_class cl join pg_namespace n on n.oid=cl.relnamespace
      where n.nspname in (select nspname from app_schemas) and cl.relkind='v'),
f as (select n.nspname||'|'||p.proname||'|'||pg_get_function_identity_arguments(p.oid)||'|'||md5(replace(p.prosrc,chr(13),''))||'|'||p.prosecdef::text||'|'||coalesce(array_to_string(p.proconfig,','),'') as s
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in (select nspname from app_schemas)),
g as (select n.nspname||'|'||cl.relname||'|'||tg.tgname||'|'||md5(pg_get_triggerdef(tg.oid)) as s
      from pg_trigger tg join pg_class cl on cl.oid=tg.tgrelid join pg_namespace n on n.oid=cl.relnamespace
      where n.nspname in (select nspname from app_schemas) and not tg.tgisinternal),
p as (select schemaname||'|'||tablename||'|'||policyname||'|'||cmd||'|'||coalesce(array_to_string(roles,','),'')||'|'||md5(coalesce(regexp_replace(qual,'\s+',' ','g'),''))||'|'||md5(coalesce(regexp_replace(with_check,'\s+',' ','g'),'')) as s
      from pg_policies where schemaname in (select nspname from app_schemas) or schemaname='storage'),
gr as (select table_schema||'|'||table_name||'|'||grantee||'|'||privilege_type as s
       from information_schema.role_table_grants
       where (table_schema in (select nspname from app_schemas) or (table_schema='storage' and table_name in ('objects','buckets')))
         and grantee in ('anon','authenticated','service_role','PUBLIC')),
b as (select id||'|'||public::text||'|'||coalesce(file_size_limit::text,'')||'|'||coalesce(array_to_string(allowed_mime_types,','),'') as s from storage.buckets),
ty as (select n.nspname||'|'||ty.typname||'|'||coalesce((select string_agg(a.attname||' '||format_type(a.atttypid,a.atttypmod),', ' order by a.attnum) from pg_attribute a where a.attrelid=ty.typrelid and a.attnum>0 and not a.attisdropped),'') as s
       from pg_type ty join pg_namespace n on n.oid=ty.typnamespace
       where n.nspname in (select nspname from app_schemas)
         and (ty.typtype='e' or (ty.typtype='c' and exists (select 1 from pg_class pc where pc.oid=ty.typrelid and pc.relkind='c'))))
select json_build_object(
 'tables',       json_build_object('n',(select count(*) from t), 'md5',(select md5(string_agg(s,E'\n' order by s)) from t)),
 'columns',      json_build_object('n',(select count(*) from c), 'md5',(select md5(string_agg(s,E'\n' order by s)) from c)),
 'constraints',  json_build_object('n',(select count(*) from k), 'md5',(select md5(string_agg(s,E'\n' order by s)) from k)),
 'indexes',      json_build_object('n',(select count(*) from i), 'md5',(select md5(string_agg(s,E'\n' order by s)) from i)),
 'views',        json_build_object('n',(select count(*) from v), 'md5',(select md5(string_agg(s,E'\n' order by s)) from v)),
 'functions',    json_build_object('n',(select count(*) from f), 'md5',(select md5(string_agg(s,E'\n' order by s)) from f)),
 'triggers',     json_build_object('n',(select count(*) from g), 'md5',(select md5(string_agg(s,E'\n' order by s)) from g)),
 'policies',     json_build_object('n',(select count(*) from p), 'md5',(select md5(string_agg(s,E'\n' order by s)) from p)),
 'table_grants', json_build_object('n',(select count(*) from gr),'md5',(select md5(string_agg(s,E'\n' order by s)) from gr)),
 'buckets',      json_build_object('n',(select count(*) from b), 'md5',(select md5(string_agg(s,E'\n' order by s)) from b)),
 'types',        json_build_object('n',(select count(*) from ty),'md5',(select md5(string_agg(s,E'\n' order by s)) from ty))
) as axes;
