#!/usr/bin/env bash
# run_native_pack_replay.sh — 정식 migration pack 을 clean PostgreSQL 에 version 순으로 적용.
#
# 사용: run_native_pack_replay.sh [pack_dir] [--pr60 <forward.sql> <rollback.sql>]
#   pack_dir 기본값: <repo>/supabase/migrations
#
# 주의: 이것은 psql 기반 replay 다. 실제 Supabase CLI migration runner 검증은
#   .github/workflows/db-migration-pack-verify.yml (PostgreSQL 17 + pinned CLI) 가 담당한다.
#   둘을 같은 증거로 취급하지 않는다.
#
# baseline 은 비원자적이다(내부 BEGIN/COMMIT). 실패 시 이 DB 를 폐기하고 새로 만든다.
# 같은 DB 에서 재실행·resume 하지 않는다.
set -uo pipefail

PGBIN=/usr/lib/postgresql/16/bin
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
PACK="${1:-$REPO/supabase/migrations}"
[ "${1:-}" != "" ] && shift || true
PR60_FWD=""; PR60_RB=""
if [ "${1:-}" = "--pr60" ]; then PR60_FWD="${2:-}"; PR60_RB="${3:-}"; fi

WORK="$(mktemp -d /tmp/nativepack-XXXX)"
if id postgres >/dev/null 2>&1; then AS=postgres; else AS=nobody; fi
chown -R $AS "$WORK"
RUN=(setpriv --reuid $AS --regid $AS --clear-groups env \
     PGOPTIONS="-csearch_path=\"\$user\",public,extensions,pg17shim,pg_catalog -cclient_min_messages=notice")
cleanup(){ "${RUN[@]}" $PGBIN/pg_ctl -D "$WORK/data" stop -m immediate >/dev/null 2>&1; }
trap cleanup EXIT

"${RUN[@]}" $PGBIN/initdb -D "$WORK/data" -A trust -U postgres >/dev/null
"${RUN[@]}" $PGBIN/pg_ctl -D "$WORK/data" -o "-k $WORK -c listen_addresses=''" -w start >/dev/null
mkdir -p "$WORK/logs"; chown $AS "$WORK/logs"
PSQL=("${RUN[@]}" $PGBIN/psql -h "$WORK" -U postgres -d postgres -v ON_ERROR_STOP=1 -q)

apply(){ # apply <label> <file>
  cp "$2" "$WORK/c.sql"; chown $AS "$WORK/c.sql"
  "${PSQL[@]}" -f "$WORK/c.sql" >"$WORK/logs/$1.log" 2>&1
}

echo "[0] platform stub"
apply 00_stub "$REPO/scripts/verify/baseline/platform_stub.sql" || {
  echo "STUB_FAIL"; grep -m3 ERROR "$WORK/logs/00_stub.log"; exit 1; }

echo "[1] native pack replay ($(ls "$PACK"/*.sql | wc -l) files, version order)"
n=0
for f in $(ls "$PACK"/*.sql | sort); do
  n=$((n+1)); ver="$(basename "$f" | cut -c1-14)"
  t0=$(date -u +%s)
  if ! apply "$(printf 'mig_%02d_%s' $n "$ver")" "$f"; then
    echo "MIGRATION_FAILED at #$n version=$ver file=$(basename "$f")"
    grep -m4 -E "ERROR|DETAIL" "$WORK/logs/$(printf 'mig_%02d_%s' $n "$ver").log" | head -6
    echo "→ 이 DB 는 폐기 대상이다. 같은 DB 에서 재실행하지 않는다 (work=$WORK)"
    exit 2
  fi
  printf '  %02d %s  %ss\n' "$n" "$ver" "$(( $(date -u +%s) - t0 ))"
done
echo "migrations applied: $n"

OPEN=$("${RUN[@]}" $PGBIN/psql -h "$WORK" -U postgres -d postgres -At \
  -c "select count(*) from pg_stat_activity where state='idle in transaction'")
echo "open_transactions: $OPEN"
[ "$OPEN" = "0" ] || { echo "OPEN_TRANSACTIONS_NONZERO"; exit 3; }

echo "[2] structure"
"${RUN[@]}" $PGBIN/psql -h "$WORK" -U postgres -d postgres -At -c \
 "select 'tables='||(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r')
   ||' functions='||(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public')
   ||' policies='||(select count(*) from pg_policies where schemaname='public')
   ||' buckets='||(select count(*) from storage.buckets)"

echo "[3] M13 trigger function ACL"
"${RUN[@]}" $PGBIN/psql -h "$WORK" -U postgres -d postgres -At -c \
 "select p.proname||' proacl='||coalesce(p.proacl::text,'(null)')
    ||' anon='||has_function_privilege('anon',p.oid,'EXECUTE')::text
    ||' auth='||has_function_privilege('authenticated',p.oid,'EXECUTE')::text
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in ('comments_set_author_label','community_comments_set_author_label')
  order by 1"

echo "[4] mentor function ACL (anon/auth NO · service_role YES 기대)"
"${RUN[@]}" $PGBIN/psql -h "$WORK" -U postgres -d postgres -At -c \
 "select p.proname||' anon='||has_function_privilege('anon',p.oid,'EXECUTE')::text
    ||' auth='||has_function_privilege('authenticated',p.oid,'EXECUTE')::text
    ||' svc='||has_function_privilege('service_role',p.oid,'EXECUTE')::text
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in
    ('mentor_directory_list','mentor_profiles_for_directory','mentor_user_public') order by 1"

echo "[5] inventory dump"
"${RUN[@]}" $PGBIN/psql -h "$WORK" -U postgres -d postgres -v ON_ERROR_STOP=1 -At \
  -f "$REPO/scripts/verify/baseline/local_inventory.sql" > "$WORK/inventory.json" 2>"$WORK/inventory.err" \
  || { echo "INVENTORY_FAIL"; head -3 "$WORK/inventory.err"; exit 4; }
echo "inventory: $WORK/inventory.json"

if [ -n "$PR60_FWD" ] && [ -f "$PR60_FWD" ]; then
  echo "[6] PR60 roundtrip"
  fnacl(){ "${RUN[@]}" $PGBIN/psql -h "$WORK" -U postgres -d postgres -At -c \
    "select coalesce((select string_agg(coalesce(g.rolname,'PUBLIC')||':'||a.privilege_type,',' order by 1)
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace, aclexplode(p.proacl) a
      left join pg_roles g on g.oid=a.grantee
     where n.nspname='public' and p.proname='add_individual_question_attachment'
       and coalesce(g.rolname,'PUBLIC') in ('PUBLIC','anon','authenticated','service_role')),'(none)')"; }
  fnmd5(){ "${RUN[@]}" $PGBIN/psql -h "$WORK" -U postgres -d postgres -At -c \
    "select md5(prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='add_individual_question_attachment'"; }
  BASE_MD5=$(fnmd5); BASE_ACL=$(fnacl)
  echo "  baseline md5=$BASE_MD5 acl=$BASE_ACL"
  [ "$BASE_MD5" = "58f0c2411d40b2ce3bcec23efa0c88a1" ] || { echo "PR60_BASELINE_MD5_UNEXPECTED"; exit 5; }
  apply pr60_forward "$PR60_FWD" || { echo "PR60_FORWARD_FAIL"; grep -m3 ERROR "$WORK/logs/pr60_forward.log"; exit 5; }
  apply pr60_fixture "$REPO/scripts/verify/baseline/iq_guard_fullschema_fixture.sql" \
    && grep -q "FULLSCHEMA FIXTURE PASS" "$WORK/logs/pr60_fixture.log" \
    || { echo "PR60_FIXTURE_FAIL"; grep -m3 -E "ERROR|FIXTURE" "$WORK/logs/pr60_fixture.log"; exit 6; }
  echo "  fixture: PASS"
  apply pr60_rollback "$PR60_RB" || { echo "PR60_ROLLBACK_FAIL"; exit 7; }
  [ "$(fnmd5)" = "$BASE_MD5" ] || { echo "PR60_MD5_NOT_RESTORED"; exit 7; }
  [ "$(fnacl)" = "$BASE_ACL" ] || { echo "PR60_ACL_NOT_RESTORED"; exit 7; }
  echo "  rollback: md5+acl 정확 복원"
  apply pr60_reapply "$PR60_FWD" || { echo "PR60_REAPPLY_FAIL"; exit 8; }
  apply pr60_fixture2 "$REPO/scripts/verify/baseline/iq_guard_fullschema_fixture.sql" \
    && grep -q "FULLSCHEMA FIXTURE PASS" "$WORK/logs/pr60_fixture2.log" \
    || { echo "PR60_FIXTURE2_FAIL"; exit 8; }
  echo "  reapply + fixture: PASS"
fi

echo "NATIVE_PACK_REPLAY_OK work=$WORK"
trap - EXIT; cleanup
