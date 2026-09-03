#!/usr/bin/env bash
# local_db1_batch_check.sh — DB-1 운영 DB 정리 배치(190 캡 구조 · 191 분쟁 수수료 · 192 학교 인증 규칙)를
#   오프라인 스크래치 PG16 에서 실구동 검증한다. 운영·staging 에는 접속하지 않는다.
#
# 흐름:
#   [0] platform stub → [1] pack 적용(20260903 미만 = DB-1 이전 상태) → [2] pre fixture
#       (운영 형태 재현: 관리자 1 · 승인 멘토 · 대기 멘토 · 자동 판정 인증 행 · 정산 행 · 에스크로 hold)
#       + §5 사전 실측 → [3] 190 → 191 → 192 순 적용 → [4] post fixture(A·B-1~B-4·C assertion, 전부 rollback)
#   → [5] rollback 192 → 191 → 190 → rollback fixture(복원 assertion) → [6] 190/191/192 재적용 → post fixture 재실행.
#
# 사용: scripts/verify/local_db1_batch_check.sh   (EVIDENCE_DIR 로 증적 경로 지정 가능)
set -uo pipefail

PGBIN=/usr/lib/postgresql/16/bin
[[ -x "$PGBIN/initdb" ]] || { echo "SKIP: PostgreSQL 16 서버 바이너리 없음($PGBIN)" >&2; exit 0; }

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PACK="$REPO/supabase/migrations"
FX="$REPO/scripts/verify/fixtures"
RB="$REPO/supabase/rollback"
DB1_VERSIONS=(20260903100100 20260903100200 20260903100300)
EV="${EVIDENCE_DIR:-$(mktemp -d /tmp/db1-evidence-XXXX)}"
mkdir -p "$EV"

WORK="$(mktemp -d /tmp/db1check-XXXX)"
if id postgres >/dev/null 2>&1; then AS=postgres; else AS=nobody; fi
chown -R $AS "$WORK"
RUN=(setpriv --reuid $AS --regid $AS --clear-groups env \
     PGOPTIONS="-csearch_path=\"\$user\",public,extensions,pg17shim,pg_catalog -cclient_min_messages=notice")
cleanup(){ "${RUN[@]}" $PGBIN/pg_ctl -D "$WORK/data" stop -m immediate >/dev/null 2>&1; rm -rf "$WORK"; }
trap cleanup EXIT

"${RUN[@]}" $PGBIN/initdb -D "$WORK/data" -A trust -U postgres >/dev/null
"${RUN[@]}" $PGBIN/pg_ctl -D "$WORK/data" -o "-k $WORK -c listen_addresses=''" -w start >/dev/null
mkdir -p "$WORK/logs"; chown $AS "$WORK/logs"
PSQL=("${RUN[@]}" $PGBIN/psql -h "$WORK" -U postgres -d postgres -v ON_ERROR_STOP=1 -q)

apply(){ # apply <label> <file>  — 로그는 $EV/<label>.log
  cp "$2" "$WORK/c.sql"; chown $AS "$WORK/c.sql"
  if "${PSQL[@]}" -f "$WORK/c.sql" >"$EV/$1.log" 2>&1; then
    echo "  ok  $1"
  else
    echo "FAIL: $1 — $EV/$1.log"; grep -m6 -E "ERROR|DETAIL|CONTEXT|FAIL" "$EV/$1.log"; exit 2
  fi
}

is_db1(){ local v; v="$(basename "$1" | cut -c1-14)"; for d in "${DB1_VERSIONS[@]}"; do [ "$v" = "$d" ] && return 0; done; return 1; }
db1_file(){ ls "$PACK"/"$1"_*.sql; }
rb_file(){ ls "$RB"/"$1"_*_rollback.sql; }

echo "[0] platform stub"
apply 00_stub "$REPO/scripts/verify/baseline/platform_stub.sql"

echo "[1] pack 적용 — DB-1(20260903*) 이전 전부"
n=0
for f in $(ls "$PACK"/*.sql | sort); do
  is_db1 "$f" && continue
  n=$((n+1)); apply "$(printf 'mig_%03d_%s' $n "$(basename "$f" | cut -c1-14)")" "$f" >/dev/null || exit 2
done
echo "  ok  pre-DB1 migrations applied: $n"

echo "[2] pre fixture (운영 형태 재현 + §5 사전 실측)"
apply 10_pre_fixture "$FX/db1_batch_pre_fixture.sql"
grep -E "^(PRE|NOTICE)" "$EV/10_pre_fixture.log" | sed 's/^/     /' || true

echo "[3] DB-1 적용: 190 → 191 → 192"
for v in "${DB1_VERSIONS[@]}"; do apply "20_forward_$v" "$(db1_file "$v")"; done
grep -E "NOTICE" "$EV/20_forward_20260903100300.log" | sed 's/^/     /' || true

echo "[4] post fixture (A · B-1~B-4 · C assertion — 전부 rollback)"
apply 30_post_fixture "$FX/db1_batch_post_fixture.sql"
grep -E "^(POST|NOTICE)" "$EV/30_post_fixture.log" | sed 's/^/     /' || true
grep -q "DB1 POST FIXTURE PASS" "$EV/30_post_fixture.log" || { echo "FAIL: POST FIXTURE PASS 미확인"; exit 3; }

echo "[5] rollback: 192 → 191 → 190 + 복원 assertion"
for v in 20260903100300 20260903100200 20260903100100; do apply "40_rollback_$v" "$(rb_file "$v")"; done
grep -E "NOTICE" "$EV/40_rollback_20260903100300.log" | sed 's/^/     /' || true
apply 50_rollback_fixture "$FX/db1_batch_rollback_fixture.sql"
grep -E "^(RB|NOTICE)" "$EV/50_rollback_fixture.log" | sed 's/^/     /' || true
grep -q "DB1 ROLLBACK FIXTURE PASS" "$EV/50_rollback_fixture.log" || { echo "FAIL: ROLLBACK FIXTURE PASS 미확인"; exit 4; }

echo "[6] 재적용 190 → 191 → 192 + post fixture 재실행"
for v in "${DB1_VERSIONS[@]}"; do apply "60_reapply_$v" "$(db1_file "$v")"; done
apply 70_post_fixture_again "$FX/db1_batch_post_fixture.sql"
grep -q "DB1 POST FIXTURE PASS" "$EV/70_post_fixture_again.log" || { echo "FAIL: 재적용 후 POST FIXTURE PASS 미확인"; exit 5; }

echo "[7] 구조 카운트 (verify_local_stack_state.sh 기대치 대조용)"
"${RUN[@]}" $PGBIN/psql -h "$WORK" -U postgres -d postgres -At -c \
 "select 'tables='||(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r')
   ||' functions='||(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public')
   ||' policies='||(select count(*) from pg_policies where schemaname='public')
   ||' buckets='||(select count(*) from storage.buckets)" | tee "$EV/structure_counts.txt"

echo
echo "DB1_LOCAL_CHECK_OK evidence=$EV"
