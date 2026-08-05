#!/usr/bin/env bash
# parent_schema_fingerprint.sh — 대상 DB 의 schema 지문을 읽기 전용으로 뽑는다.
#
# 용도: migration history repair 처럼 "추적 테이블만 바꾸고 schema 는 건드리지 않는" 작업의
#       전후를 대조해, schema 가 실제로 변하지 않았음을 강제하기 위한 것이다.
#
# 성질:
#   * SELECT 뿐이다. 어떤 DDL/DML 도 실행하지 않는다.
#   * 출력은 결정론적이다(모든 집계에 order by 고정).
#   * 포착하는 축만 비교 대상이다 — 전후 동일해도 "schema 가 전혀 안 변했다"가 아니라
#     "포착한 축에서 변화가 관측되지 않았다"로 읽어야 한다.
#
# 사용: parent_schema_fingerprint.sh <db_url>
set -euo pipefail

URL="${1:?usage: parent_schema_fingerprint.sh <db_url>}"
EXPECT_AXES=15

out="$(psql "$URL" -At -v ON_ERROR_STOP=1 <<'SQL'
select 'tables='||count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='r';
select 'columns='||count(*) from information_schema.columns where table_schema='public';
select 'constraints='||count(*) from pg_constraint c join pg_namespace n on n.oid=c.connamespace
  where n.nspname='public';
select 'indexes='||count(*) from pg_indexes where schemaname='public';
select 'views='||count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind in ('v','m');
select 'functions='||count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public';
select 'triggers='||count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid
  join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal;
select 'policies='||count(*) from pg_policies where schemaname='public';
select 'buckets='||count(*) from storage.buckets;
select 'md5_tables='||md5(string_agg(c.relname,',' order by c.relname))
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='r';
select 'md5_functions='||md5(string_agg(p.proname||':'||md5(p.prosrc),',' order by p.proname, p.oid))
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public';
select 'md5_function_acl='||md5(coalesce(string_agg(p.proname||':'||coalesce(p.proacl::text,'-'),
       ',' order by p.proname, p.oid),''))
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public';
select 'md5_policies='||md5(coalesce(string_agg(schemaname||'.'||tablename||'.'||policyname,
       ',' order by schemaname, tablename, policyname),''))
  from pg_policies where schemaname='public';
select 'md5_columns='||md5(string_agg(table_name||'.'||column_name||':'||data_type,
       ',' order by table_name, column_name))
  from information_schema.columns where table_schema='public';
select 'md5_default_acl='||md5(coalesce(string_agg(
       coalesce(n.nspname,'-')||':'||d.defaclobjtype::text||':'||coalesce(d.defaclacl::text,'-'),
       ',' order by n.nspname, d.defaclobjtype::text),''))
  from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace;
SQL
)"
n=$(printf '%s\n' "$out" | grep -c .)
if [ "$n" != "$EXPECT_AXES" ]; then
  echo "FINGERPRINT_AXIS_COUNT_MISMATCH: $n != $EXPECT_AXES" >&2
  printf '%s\n' "$out" >&2
  exit 1
fi
printf '%s\n' "$out"
