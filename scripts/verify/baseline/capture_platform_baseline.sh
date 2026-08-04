#!/usr/bin/env bash
# capture_platform_baseline.sh — pack 적용 **전** 로컬 스택의 플랫폼 초기 상태를 실측한다.
#
# 왜 필요한가: `platform_stub.sql` 은 부모 프로젝트/Preview Branch 의 초기 상태를 PG16 에서
# 흉내 내기 위한 모델이다. 그 모델이 실제 Supabase 스택과 같은지는 지금까지 확인된 적이 없다.
# 이 스크립트가 그 차이를 처음으로 기록한다.
#
# 특히 default privilege 는 pack 의 여러 자체 검사가 전제로 삼는 값이다
# (예: BATCH_F_M11 은 public.mentor_profiles 에 anon/authenticated 7개 권한이 모두 있어야 통과).
# default ACL 은 **객체를 만든 role 별로** 적용되므로, migration 을 실행하는 role 기준으로 봐야 한다.
#
# 쓰기: probe 테이블 1개를 만들고 즉시 지운다(throwaway 컨테이너 전용). 그 외는 SELECT 다.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
EV="${EVIDENCE_DIR:-$REPO/pg17-evidence}"
DB_URL="${LOCAL_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
mkdir -p "$EV"
q(){ psql "$DB_URL" -At -v ON_ERROR_STOP=1 -c "$1"; }

command -v psql >/dev/null 2>&1 || { echo "FAIL: psql 이 없다"; exit 1; }
q 'select 1' >/dev/null 2>&1 || { echo "FAIL: 로컬 스택 DB 에 접속할 수 없다"; exit 1; }

{
  echo "=== connection identity"
  q "select 'current_user='||current_user||' session_user='||session_user
       ||' server_version='||current_setting('server_version')"

  echo
  echo "=== roles (플랫폼 기본 role 존재 여부)"
  q "select rolname||' super='||rolsuper::text||' bypassrls='||rolbypassrls::text
       from pg_roles where rolname in
       ('postgres','anon','authenticated','service_role','supabase_admin','supabase_auth_admin',
        'supabase_storage_admin','authenticator') order by 1"

  echo
  echo "=== pg_default_acl 전량 (grantor role · schema · objtype · acl)"
  q "select coalesce(g.rolname,'?')||' | '||coalesce(n.nspname,'-')||' | '||d.defaclobjtype::text
       ||' | '||coalesce(d.defaclacl::text,'(null)')
       from pg_default_acl d
       left join pg_namespace n on n.oid=d.defaclnamespace
       left join pg_roles g on g.oid=d.defaclrole
       order by coalesce(g.rolname,'?'), coalesce(n.nspname,'-'), d.defaclobjtype::text"

  echo
  echo "=== schema 목록"
  q "select nspname from pg_namespace where nspname not like 'pg_%' and nspname<>'information_schema' order by 1"

  echo
  echo "=== public schema 사용 권한"
  q "select r.rolname||' usage='||has_schema_privilege(r.rolname,'public','USAGE')::text
       ||' create='||has_schema_privilege(r.rolname,'public','CREATE')::text
       from (values ('anon'),('authenticated'),('service_role')) r(rolname)
       where exists (select 1 from pg_roles p where p.rolname=r.rolname) order by 1"
} > "$EV/platform_baseline.txt" 2>&1
cat "$EV/platform_baseline.txt"

echo
echo "=== probe: 지금 이 role 로 public 에 테이블을 만들면 어떤 ACL 이 붙는가"
# 이것이 결정적 증거다. M11 류의 자체 검사는 정확히 이 값을 전제한다.
psql "$DB_URL" -At -v ON_ERROR_STOP=1 >"$EV/platform_probe.txt" 2>&1 <<'SQL'
-- 반드시 새로 만든 테이블이어야 한다. default privilege 는 생성 시점에만 적용되므로,
-- 앞선 실행이 남긴 테이블을 재사용하면 그 시점의 낡은 ACL 을 측정하게 된다(실제로 겪었다).
drop table if exists public._pack_precondition_probe;
create table public._pack_precondition_probe(id int);
select 'probe_owner='||pg_get_userbyid(c.relowner)
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relname='_pack_precondition_probe';
select 'probe_acl='||coalesce(c.relacl::text,'(null)')
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relname='_pack_precondition_probe';
select r.rolname||' '||p.priv||'='||
       has_table_privilege(r.rolname,'public._pack_precondition_probe',p.priv)::text
  from (values ('anon'),('authenticated'),('service_role')) r(rolname)
 cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),
                    ('TRUNCATE'),('REFERENCES'),('TRIGGER')) p(priv)
 order by r.rolname, p.priv;
drop table public._pack_precondition_probe;
SQL
cat "$EV/platform_probe.txt"

# 침묵을 성공으로 읽지 않는다. probe 가 실제로 3 role × 7 권한 = 21 줄을 냈는지 먼저 확인한다.
# (질의가 깨져 0 줄이 나오면 '=false' 도 0 건이라 permissive 로 오판된다 — 실제로 겪었다.)
LINES=$(grep -cE '^(anon|authenticated|service_role) [A-Z]+=(true|false)$' "$EV/platform_probe.txt" || true)
echo
echo "PROBE_PRIVILEGE_LINES: $LINES (기대 21)"
if [ "$LINES" != "21" ]; then
  echo "PLATFORM_PROBE_FAILED: probe 질의가 21줄을 내지 못했다 — 이 실행의 판정은 무효다"
  exit 2
fi
MISSING=$(grep -c '=false' "$EV/platform_probe.txt" || true)
echo "PROBE_MISSING_PRIVILEGES: $MISSING"
if [ "$MISSING" != "0" ]; then
  echo "PLATFORM_DEFAULT_PRIVILEGES: RESTRICTIVE"
  echo "  → 이 스택에서 새로 만든 public 테이블에는 anon/authenticated 권한이 자동 부여되지 않는다."
  echo "  → 부모 프로젝트·Preview Branch 실측(permissive)과 다르다. pack 의 자체 검사가"
  echo "     전제하는 초기 상태를 별도로 확립해야 한다(local_stack_preconditions.sql)."
else
  echo "PLATFORM_DEFAULT_PRIVILEGES: PERMISSIVE (부모/Preview Branch 실측과 동일)"
fi
echo "PLATFORM_BASELINE_CAPTURED: $EV/platform_baseline.txt · $EV/platform_probe.txt"
