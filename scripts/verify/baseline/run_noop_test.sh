#!/usr/bin/env bash
# baseline 2회 연속 적용 → 구조 불변(no-op) 검증
set -uo pipefail
PGBIN=/usr/lib/postgresql/16/bin
BW=/workspace/baseline-work
WORK="$(mktemp -d /tmp/bl-noop-XXXX)"
AS=postgres; chown -R $AS "$WORK"
RUN=(setpriv --reuid $AS --regid $AS --clear-groups env PGOPTIONS="-csearch_path=\"\$user\",public,extensions,pg17shim,pg_catalog -cclient_min_messages=warning")
cleanup(){ "${RUN[@]}" $PGBIN/pg_ctl -D "$WORK/data" stop -m immediate >/dev/null 2>&1; }
trap cleanup EXIT
"${RUN[@]}" $PGBIN/initdb -D "$WORK/data" -A trust -U postgres >/dev/null
"${RUN[@]}" $PGBIN/pg_ctl -D "$WORK/data" -o "-k $WORK -c listen_addresses=''" -w start >/dev/null
mkdir -p "$WORK/logs"; chown $AS "$WORK/logs"
PSQL=("${RUN[@]}" $PGBIN/psql -h "$WORK" -U postgres -d postgres -v ON_ERROR_STOP=1 -q)
apply_all(){
  local round=$1 i=0
  while IFS= read -r f; do
    [ -z "$f" ] && continue; i=$((i+1))
    sed 's/\xEF\xBB\xBF//g' "$f" > "$WORK/c.sql"; chown $AS "$WORK/c.sql"
    "${PSQL[@]}" -f "$WORK/c.sql" >"$WORK/logs/r${round}_$(printf %03d $i).log" 2>&1 || { echo "ROUND${round}_FAIL at $f"; grep -m3 ERROR "$WORK/logs/r${round}_$(printf %03d $i).log"; exit 1; }
  done < "$BW/baseline/apply_order.txt"
  echo "round $round: $i steps OK"
}
sed 's/\xEF\xBB\xBF//g' "$BW/scratch/platform_stub.sql" > "$WORK/c.sql"; chown $AS "$WORK/c.sql"
"${PSQL[@]}" -f "$WORK/c.sql" >"$WORK/logs/stub.log" 2>&1 || { echo STUB_FAIL; grep -m3 ERROR "$WORK/logs/stub.log"; exit 1; }
apply_all 1
"${RUN[@]}" $PGBIN/psql -h "$WORK" -U postgres -d postgres -v ON_ERROR_STOP=1 -At -f "$BW/scratch/local_inventory.sql" > "$WORK/inv1.json" 2>"$WORK/inv1.err" || { echo INV1_FAIL; head "$WORK/inv1.err"; exit 1; }
apply_all 2
"${RUN[@]}" $PGBIN/psql -h "$WORK" -U postgres -d postgres -v ON_ERROR_STOP=1 -At -f "$BW/scratch/local_inventory.sql" > "$WORK/inv2.json" 2>"$WORK/inv2.err" || { echo INV2_FAIL; head "$WORK/inv2.err"; exit 1; }
if cmp -s "$WORK/inv1.json" "$WORK/inv2.json"; then echo "NOOP_TEST_PASS (구조 인벤토리 byte-identical)"; else echo "NOOP_TEST_FAIL"; exit 1; fi
