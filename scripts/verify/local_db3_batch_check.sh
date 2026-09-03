#!/usr/bin/env bash
# local_db3_batch_check.sh — DB-3 운영 DB 정리 배치(196 작성자 본인 삭제 RPC · 197 Realtime 관리자 채널 비공개 · 198 하드 DELETE 차단)를
#   오프라인 스크래치 PG16 에서 실구동 검증한다. 운영·staging 에는 접속하지 않는다.
#
# 흐름:
#   [0] platform stub(+ realtime.messages 대역) → [1] pack 적용(DB-3 = 20260903230100~230300 제외 전부 — DB-1·DB-2 포함 = 운영 원장 상태)
#   → [2] pre fixture(운영 형태 재현 + §6 사전 실측 + **현재 버그 재현**: 게시판 댓글 본인 삭제 UPDATE 가 RLS 로 실패)
#   → [3] 196 → 197 → 198 순 적용 → [4] post fixture(A RPC · B Realtime · C 하드 DELETE · D 194 불변 assertion, 전부 rollback)
#   → [4b] forward 기간 데이터(작성자 S1 이 RPC 로 게시판 댓글 C1 삭제 · COMMIT) → [5] rollback 198 → 197 → 196 → rollback fixture
#   → [6] 196/197/198 재적용 → post fixture 재실행 → [7] 구조 카운트.
#
# 사용: scripts/verify/local_db3_batch_check.sh   (EVIDENCE_DIR 로 증적 경로 지정 가능)
set -uo pipefail

PGBIN=/usr/lib/postgresql/16/bin
[[ -x "$PGBIN/initdb" ]] || { echo "SKIP: PostgreSQL 16 서버 바이너리 없음($PGBIN)" >&2; exit 0; }

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PACK="$REPO/supabase/migrations"
FX="$REPO/scripts/verify/fixtures"
RB="$REPO/supabase/rollback"
DB3_VERSIONS=(20260903230100 20260903230200 20260903230300)
EV="${EVIDENCE_DIR:-$(mktemp -d /tmp/db3-evidence-XXXX)}"
mkdir -p "$EV"

WORK="$(mktemp -d /tmp/db3check-XXXX)"
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

is_db3(){ local v; v="$(basename "$1" | cut -c1-14)"; for d in "${DB3_VERSIONS[@]}"; do [ "$v" = "$d" ] && return 0; done; return 1; }
db3_file(){ ls "$PACK"/"$1"_*.sql; }
rb_file(){ ls "$RB"/"$1"_*_rollback.sql; }

echo "[0] platform stub"
apply 00_stub "$REPO/scripts/verify/baseline/platform_stub.sql"

echo "[1] pack 적용 — DB-3(20260903230100~230300) 이전 전부(DB-1·DB-2 포함 = 운영 원장 2026-09-03 상태)"
n=0
for f in $(ls "$PACK"/*.sql | sort); do
  is_db3 "$f" && continue
  n=$((n+1)); apply "$(printf 'mig_%03d_%s' $n "$(basename "$f" | cut -c1-14)")" "$f" >/dev/null || exit 2
done
echo "  ok  pre-DB3 migrations applied: $n"

echo "[2] pre fixture (운영 형태 재현 + §6 사전 실측 + 현재 버그 재현)"
apply 10_pre_fixture "$FX/db3_batch_pre_fixture.sql"
grep -E "^(PRE|NOTICE)" "$EV/10_pre_fixture.log" | sed 's/^/     /' || true

echo "[3] DB-3 적용: 196 → 197 → 198"
for v in "${DB3_VERSIONS[@]}"; do apply "20_forward_$v" "$(db3_file "$v")"; done
grep -h -E "NOTICE" "$EV"/20_forward_*.log | sed 's/^/     /' || true

echo "[4] post fixture (A · B · C · D assertion — 전부 rollback)"
apply 30_post_fixture "$FX/db3_batch_post_fixture.sql"
grep -E "^(POST|NOTICE)" "$EV/30_post_fixture.log" | sed 's/^/     /' || true
grep -q "DB3 POST FIXTURE PASS" "$EV/30_post_fixture.log" || { echo "FAIL: POST FIXTURE PASS 미확인"; exit 3; }

echo "[4b] forward 기간 데이터 — 작성자 S1 이 RPC 로 게시판 댓글 C1 삭제 (COMMIT · rollback 후 유지 검증용)"
cat > "$WORK/fwd.sql" <<'SQL'
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000d3b1', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d3b1","role":"authenticated"}', true);
select public.soft_delete_own_content('board_comment', '00000000-0000-4000-8000-00000000d3e1');
reset role;
commit;
SQL
chown $AS "$WORK/fwd.sql"
"${PSQL[@]}" -f "$WORK/fwd.sql" >"$EV/35_forward_data.log" 2>&1 \
  && echo "  ok  35_forward_data" || { echo "FAIL: 35_forward_data"; cat "$EV/35_forward_data.log"; exit 2; }

echo "[5] rollback: 198 → 197 → 196 + 복원 assertion"
for v in 20260903230300 20260903230200 20260903230100; do apply "40_rollback_$v" "$(rb_file "$v")"; done
grep -h -E "NOTICE" "$EV"/40_rollback_*.log | sed 's/^/     /' || true
apply 50_rollback_fixture "$FX/db3_batch_rollback_fixture.sql"
grep -E "^(RB|NOTICE)" "$EV/50_rollback_fixture.log" | sed 's/^/     /' || true
grep -q "DB3 ROLLBACK FIXTURE PASS" "$EV/50_rollback_fixture.log" || { echo "FAIL: ROLLBACK FIXTURE PASS 미확인"; exit 4; }

echo "[6] 재적용 196 → 197 → 198 + post fixture 재실행"
for v in "${DB3_VERSIONS[@]}"; do apply "60_reapply_$v" "$(db3_file "$v")"; done
apply 70_post_fixture_again "$FX/db3_batch_post_fixture.sql"
grep -q "DB3 POST FIXTURE PASS" "$EV/70_post_fixture_again.log" || { echo "FAIL: 재적용 후 POST FIXTURE PASS 미확인"; exit 5; }

echo "[7] 구조 카운트 (verify_local_stack_state.sh 기대치 대조용)"
"${RUN[@]}" $PGBIN/psql -h "$WORK" -U postgres -d postgres -At -c \
 "select 'tables='||(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r')
   ||' functions='||(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public')
   ||' policies='||(select count(*) from pg_policies where schemaname='public')
   ||' buckets='||(select count(*) from storage.buckets)
   ||' realtime_policies='||(select count(*) from pg_policies where schemaname='realtime' and tablename='messages')" | tee "$EV/structure_counts.txt"

echo
echo "DB3_LOCAL_CHECK_OK evidence=$EV"
