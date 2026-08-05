#!/usr/bin/env bash
# run_local_stack_emulation.sh — verify_local_stack_state.sh 자체를 검증하기 위한 로컬 에뮬레이션.
#
# `supabase start` 를 쓸 수 없는 환경에서, 로컬 스택이 만들어 내는 최소 조건
#   (TCP 로 접속 가능한 DB + pack 전부 적용 + supabase_migrations.schema_migrations 채워짐)
# 을 PostgreSQL 16 으로 재현해 verify_local_stack_state.sh 의 판정 논리를 실행한다.
#
# 한계(중요): 여기서 얻는 것은 "검사 스크립트가 올바로 판정하는가" 뿐이다.
#   * 서버는 PostgreSQL 16 이므로 [1] server_version 검사는 반드시 FAIL 로 나오는 것이 정상이다.
#   * migration history 는 CLI 가 아니라 이 스크립트가 채운다 — 실제 Supabase CLI runner 검증이 아니다.
#   PostgreSQL 17 + 실제 CLI runner 검증은 .github/workflows/db-migration-pack-verify.yml 담당이다.
#
# 사용: run_local_stack_emulation.sh [pack_dir]
set -uo pipefail

PGBIN=/usr/lib/postgresql/16/bin
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
PACK="${1:-$REPO/supabase/migrations}"
PORT="${EMU_PORT:-54322}"

WORK="$(mktemp -d /tmp/stackemu-XXXX)"
if id postgres >/dev/null 2>&1; then AS=postgres; else AS=nobody; fi
chown -R $AS "$WORK"
RUN=(setpriv --reuid $AS --regid $AS --clear-groups env \
     PGOPTIONS="-csearch_path=\"\$user\",public,extensions,pg17shim,pg_catalog -cclient_min_messages=notice")
cleanup(){ "${RUN[@]}" $PGBIN/pg_ctl -D "$WORK/data" stop -m immediate >/dev/null 2>&1; }
trap cleanup EXIT

"${RUN[@]}" $PGBIN/initdb -D "$WORK/data" -A trust -U postgres >/dev/null
"${RUN[@]}" $PGBIN/pg_ctl -D "$WORK/data" \
  -o "-k $WORK -c listen_addresses=127.0.0.1 -p $PORT" -w start >/dev/null || {
    echo "PG_START_FAIL (port $PORT 사용 중일 수 있다)"; exit 1; }
mkdir -p "$WORK/logs"; chown $AS "$WORK/logs"
PSQL=("${RUN[@]}" $PGBIN/psql -h "$WORK" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q)

apply(){ cp "$2" "$WORK/c.sql"; chown $AS "$WORK/c.sql"; "${PSQL[@]}" -f "$WORK/c.sql" >"$WORK/logs/$1.log" 2>&1; }

echo "[0] platform stub"
apply 00_stub "$REPO/scripts/verify/baseline/platform_stub.sql" || {
  echo "STUB_FAIL"; grep -m3 ERROR "$WORK/logs/00_stub.log"; exit 1; }

echo "[1] pack 적용 ($(ls "$PACK"/*.sql | wc -l) files)"
n=0
for f in $(ls "$PACK"/*.sql | sort); do
  n=$((n+1)); ver="$(basename "$f" | cut -c1-14)"
  apply "$(printf 'mig_%02d' $n)" "$f" || {
    echo "MIGRATION_FAILED #$n $ver"; grep -m4 -E "ERROR|DETAIL" "$WORK/logs/$(printf 'mig_%02d' $n).log"; exit 2; }
done
echo "applied: $n"

echo "[2] migration history 채우기 (CLI runner 가 하는 일을 흉내낸다)"
{
  echo "create schema if not exists supabase_migrations;"
  echo "create table if not exists supabase_migrations.schema_migrations(version text primary key, statements text[], name text);"
  for f in $(ls "$PACK"/*.sql | sort); do
    b="$(basename "$f" .sql)"
    echo "insert into supabase_migrations.schema_migrations(version,name) values ('${b:0:14}','${b:15}') on conflict do nothing;"
  done
} > "$WORK/hist.sql"
apply 99_hist "$WORK/hist.sql" || { echo "HIST_FAIL"; cat "$WORK/logs/99_hist.log"; exit 3; }

echo "[3] verify_local_stack_state.sh 실행"
echo "    (server_version 검사는 PG16 이므로 FAIL 이 정상이다)"
echo "------------------------------------------------------------"
LOCAL_DB_URL="postgresql://postgres@127.0.0.1:$PORT/postgres" \
EVIDENCE_DIR="$WORK/evidence" \
PGOPTIONS='-csearch_path="$user",public,extensions,pg17shim,pg_catalog' \
  bash "$REPO/scripts/verify/baseline/verify_local_stack_state.sh" 2>&1 | tee "$WORK/verify.out"
rc=${PIPESTATUS[0]}
echo "------------------------------------------------------------"
echo "verify_local_stack_state.sh exit=$rc  evidence=$WORK/evidence"

echo "[4] parent_schema_fingerprint.sh 결정론 확인 (같은 DB 2회 → 동일 출력)"
FPURL="postgresql://postgres@127.0.0.1:$PORT/postgres"
fp(){ PGOPTIONS='-csearch_path="$user",public,extensions,pg17shim,pg_catalog' \
        bash "$REPO/scripts/verify/baseline/parent_schema_fingerprint.sh" "$FPURL" > "$1" \
      || { echo "FAIL: parent_schema_fingerprint.sh 실행 실패 → $1"; exit 4; }; }
fp "$WORK/fp1.txt"
fp "$WORK/fp2.txt"
if diff -q "$WORK/fp1.txt" "$WORK/fp2.txt" >/dev/null && [ -s "$WORK/fp1.txt" ]; then
  echo "  ok  fingerprint 결정론 ($(wc -l < "$WORK/fp1.txt") 축)"
  sed 's/^/    /' "$WORK/fp1.txt"
else
  echo "FAIL: fingerprint 가 비결정론이거나 비었다"; diff "$WORK/fp1.txt" "$WORK/fp2.txt"; exit 4
fi

# migration history 만 바꿨을 때 fingerprint 가 변하지 않아야 한다 (repair 무해성 모델)
echo "[5] history-only 변경 후 fingerprint 무변경 확인 (repair 모델)"
echo "insert into supabase_migrations.schema_migrations(version,name)
      values ('19990101000000','emulation_probe') on conflict do nothing;" > "$WORK/probe.sql"
apply 98_probe "$WORK/probe.sql" || { echo "PROBE_FAIL"; exit 5; }
fp "$WORK/fp3.txt"
if diff -u "$WORK/fp1.txt" "$WORK/fp3.txt"; then
  echo "  ok  history 행 추가로 schema 지문이 변하지 않았다"
else
  echo "FAIL: history-only 변경인데 지문이 변했다"; exit 5
fi
echo "delete from supabase_migrations.schema_migrations where version='19990101000000';" > "$WORK/unprobe.sql"
apply 97_unprobe "$WORK/unprobe.sql" || true

if [ -n "${PR60_FORWARD:-}" ] && [ -f "${PR60_FORWARD}" ]; then
  echo "[6] PR #60 적용 시 db-apply-pr60.yml 이 강제할 '불변 축' 검증"
  apply 96_pr60 "$PR60_FORWARD" || { echo "PR60_APPLY_FAIL"; grep -m3 ERROR "$WORK/logs/96_pr60.log"; exit 6; }
  fp "$WORK/fp_pr60.txt"
  # 워크플로가 실제로 비교하는 축 목록과 같아야 한다
  STRICT="tables columns constraints indexes views functions triggers policies buckets md5_tables md5_columns md5_policies md5_default_acl"
  bad60=0
  for axis in $STRICT; do
    b=$(grep -m1 "^${axis}=" "$WORK/fp1.txt"); a=$(grep -m1 "^${axis}=" "$WORK/fp_pr60.txt")
    [ "$b" = "$a" ] || { echo "FAIL: 불변 축 $axis 이 변했다: '$b' → '$a'"; bad60=1; }
  done
  bm=$(grep -m1 '^md5_functions=' "$WORK/fp1.txt"); am=$(grep -m1 '^md5_functions=' "$WORK/fp_pr60.txt")
  [ "$bm" != "$am" ] || { echo "FAIL: guard 적용 후에도 md5_functions 가 그대로다"; bad60=1; }
  [ "$bad60" = 0 ] && echo "  ok  불변 축 13개 무변경 · md5_functions 만 변화 (워크플로 사후 검증 모델과 일치)" \
                   || { echo "PR60_AXIS_MODEL_MISMATCH"; exit 6; }
fi

# 기대 결과: server_version 검사 1건만 FAIL, 나머지 전부 통과.
FAILS=$(grep -c '^FAIL: ' "$WORK/verify.out")
SVFAIL=$(grep -c '^FAIL: server_version=' "$WORK/verify.out")
echo "FAIL 라인 $FAILS 건 (server_version $SVFAIL 건)"
if [ "$FAILS" = "1" ] && [ "$SVFAIL" = "1" ] && [ "$rc" = "1" ]; then
  echo "STACK_EMULATION: PASS — PG16 에서 예상된 단 하나의 불일치(server_version)만 검출됐다"
  echo "  (PostgreSQL 17 + 실제 CLI runner 검증은 db-migration-pack-verify.yml 담당)"
  echo "STACK_EMULATION_DONE work=$WORK"
  exit 0
fi
echo "STACK_EMULATION: FAIL — 예상 밖의 결과다"
grep '^FAIL: ' "$WORK/verify.out"
echo "STACK_EMULATION_DONE work=$WORK"
exit 1
