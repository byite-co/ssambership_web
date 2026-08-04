-- axis_checksums_v2.sql — 13축 개수 + 정규 문자열 집계 md5 (단일 JSON 1행).
--
-- v1(axis_checksums.sql) 대비 변경:
--   * 함수 축에 proacl(4역할 EXECUTE)을 포함 — 권한 회귀를 축 자체로 검출한다.
--   * publications 축 추가.
--   * default_privileges 축 추가(pg_default_acl, app 스키마).
--   → 13축: tables · columns · constraints · indexes · views · functions ·
--            triggers · policies · table_grants · buckets · types ·
--            publications · default_privileges
--
-- 사용처: 부모(읽기 전용)와 Preview Branch 에 **같은 파일**을 실행해 직접 대조한다.
--   동일 엔진(PG17↔PG17) 비교에서는 view deparse 허용 규칙을 적용하지 않는다.
-- 주의: md5 는 구조 문자열의 정규화 지문이다(파일 무결성용 SHA-256 과 목적이 다르다).
--   사용자 데이터·행 내용은 추출하지 않는다.
with app_schemas as (
  select nspname from pg_namespace where nspname in ('public','api_web_v1','api_app_v1','core_private')),
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
-- 함수: 본문 md5(CR 무시) + secdef + config + 4역할 EXECUTE ACL
f as (select n.nspname||'|'||p.proname||'|'||pg_get_function_identity_arguments(p.oid)||'|'
             ||md5(replace(p.prosrc,chr(13),''))||'|'||p.prosecdef::text||'|'
             ||coalesce(array_to_string(p.proconfig,','),'')||'|'
             ||case when p.proacl is null then '(implicit)'
                    else coalesce((select string_agg(coalesce(g.rolname,'PUBLIC')||':'||a.privilege_type, ',' order by 1)
                          from aclexplode(p.proacl) a left join pg_roles g on g.oid=a.grantee
                          where coalesce(g.rolname,'PUBLIC') in ('PUBLIC','anon','authenticated','service_role')), '(none)') end as s
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in (select nspname from app_schemas)),
g as (select n.nspname||'|'||cl.relname||'|'||tg.tgname||'|'||md5(pg_get_triggerdef(tg.oid)) as s
      from pg_trigger tg join pg_class cl on cl.oid=tg.tgrelid join pg_namespace n on n.oid=cl.relnamespace
      where n.nspname in (select nspname from app_schemas) and not tg.tgisinternal),
p as (select schemaname||'|'||tablename||'|'||policyname||'|'||cmd||'|'||coalesce(array_to_string(roles,','),'')||'|'
             ||md5(coalesce(regexp_replace(qual,'\s+',' ','g'),''))||'|'
             ||md5(coalesce(regexp_replace(with_check,'\s+',' ','g'),'')) as s
      from pg_policies where schemaname in (select nspname from app_schemas) or schemaname='storage'),
gr as (select table_schema||'|'||table_name||'|'||grantee||'|'||privilege_type as s
       from information_schema.role_table_grants
       where (table_schema in (select nspname from app_schemas) or (table_schema='storage' and table_name in ('objects','buckets')))
         and grantee in ('anon','authenticated','service_role','PUBLIC')),
b as (select id||'|'||public::text||'|'||coalesce(file_size_limit::text,'')||'|'||coalesce(array_to_string(allowed_mime_types,','),'') as s
      from storage.buckets),
ty as (select n.nspname||'|'||ty.typname||'|'||coalesce((select string_agg(a.attname||' '||format_type(a.atttypid,a.atttypmod),', ' order by a.attnum)
                from pg_attribute a where a.attrelid=ty.typrelid and a.attnum>0 and not a.attisdropped),'') as s
       from pg_type ty join pg_namespace n on n.oid=ty.typnamespace
       where n.nspname in (select nspname from app_schemas)
         and (ty.typtype='e' or (ty.typtype='c' and exists (select 1 from pg_class pc where pc.oid=ty.typrelid and pc.relkind='c')))),
pb as (select pub.pubname||'|'||coalesce((select string_agg(pt.schemaname||'.'||pt.tablename, ',' order by pt.schemaname||'.'||pt.tablename)
                from pg_publication_tables pt where pt.pubname=pub.pubname),'') as s
       from pg_publication pub),
dp as (select pg_get_userbyid(d.defaclrole)||'|'||n.nspname||'|'||d.defaclobjtype::text||'|'
              ||coalesce(array_to_string(d.defaclacl::text[],','),'') as s
       from pg_default_acl d join pg_namespace n on n.oid=d.defaclnamespace
       where n.nspname in (select nspname from app_schemas))
select json_build_object(
 'norm_rule_version', 'v2',
 'captured_at_utc', to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
 'server_version', current_setting('server_version'),
 'tables',        json_build_object('n',(select count(*) from t), 'md5',(select md5(string_agg(s,E'\n' order by s)) from t)),
 'columns',       json_build_object('n',(select count(*) from c), 'md5',(select md5(string_agg(s,E'\n' order by s)) from c)),
 'constraints',   json_build_object('n',(select count(*) from k), 'md5',(select md5(string_agg(s,E'\n' order by s)) from k)),
 'indexes',       json_build_object('n',(select count(*) from i), 'md5',(select md5(string_agg(s,E'\n' order by s)) from i)),
 'views',         json_build_object('n',(select count(*) from v), 'md5',(select md5(string_agg(s,E'\n' order by s)) from v)),
 'functions',     json_build_object('n',(select count(*) from f), 'md5',(select md5(string_agg(s,E'\n' order by s)) from f)),
 'triggers',      json_build_object('n',(select count(*) from g), 'md5',(select md5(string_agg(s,E'\n' order by s)) from g)),
 'policies',      json_build_object('n',(select count(*) from p), 'md5',(select md5(string_agg(s,E'\n' order by s)) from p)),
 'table_grants',  json_build_object('n',(select count(*) from gr),'md5',(select md5(string_agg(s,E'\n' order by s)) from gr)),
 'buckets',       json_build_object('n',(select count(*) from b), 'md5',(select md5(string_agg(s,E'\n' order by s)) from b)),
 'types',         json_build_object('n',(select count(*) from ty),'md5',(select md5(string_agg(s,E'\n' order by s)) from ty)),
 'publications',  json_build_object('n',(select count(*) from pb),'md5',(select md5(string_agg(s,E'\n' order by s)) from pb)),
 'default_privileges', json_build_object('n',(select count(*) from dp),'md5',(select md5(string_agg(s,E'\n' order by s)) from dp))
) as axes;
