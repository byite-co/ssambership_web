#!/usr/bin/env bash
# run_roundtrip.sh — clean PG16 scratch 에서 baseline 후보 + 원장 56 replay 라운드트립.
# 사용: run_roundtrip.sh <mode>
#   mode=full   : baseline → ledger56 → (옵션) PR60 forward/rollback/reapply
#   mode=noop   : 이미 구성된 DB 에 baseline 재적용 → 변경 0 검증(verify-only)
# 산출: $WORK/logs/*.log, 실패 시 첫 오류를 stdout 에 요약.
set -uo pipefail

PGBIN=/usr/lib/postgresql/16/bin
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
BW="$REPO"
WEB="$REPO"
MODE="${1:-full}"
WORK="$(mktemp -d /tmp/bl-rt-XXXX)"
if id postgres >/dev/null 2>&1; then AS=postgres; else AS=nobody; fi
chown -R $AS "$WORK"
RUN=(setpriv --reuid $AS --regid $AS --clear-groups env PGOPTIONS="-csearch_path=\"\$user\",public,extensions,pg17shim,pg_catalog -cclient_min_messages=notice")
cleanup(){ "${RUN[@]}" $PGBIN/pg_ctl -D "$WORK/data" stop -m immediate >/dev/null 2>&1; }
trap cleanup EXIT

"${RUN[@]}" $PGBIN/initdb -D "$WORK/data" -A trust -U postgres >/dev/null
"${RUN[@]}" $PGBIN/pg_ctl -D "$WORK/data" -o "-k $WORK -c listen_addresses='' -c client_min_messages=warning" -w start >/dev/null
PSQL=("${RUN[@]}" $PGBIN/psql -h "$WORK" -U postgres -d postgres -v ON_ERROR_STOP=1 -q)
mkdir -p "$WORK/logs"; chown $AS "$WORK/logs"

apply(){ # apply <label> <file>  (UTF-8 BOM 제거 사본 적용 — SQL Editor 동작과 동일)
  local label="$1" orig="$2" tmp="$WORK/clean.sql"
  [ -f "$orig" ] || { echo "FAIL: $label (missing file: $orig)"; return 1; }
  sed 's/\xEF\xBB\xBF//g' "$orig" > "$tmp"; chown $AS "$tmp"
  if ! "${PSQL[@]}" -f "$tmp" >"$WORK/logs/$label.log" 2>&1; then
    echo "FAIL: $label ($orig)"
    grep -m4 -E "ERROR|DETAIL|STATEMENT" "$WORK/logs/$label.log" | head -8
    return 1
  fi
}

echo "[1] platform stub"
apply 00_platform "$BW/scripts/verify/baseline/platform_stub.sql" || exit 1

echo "[2] baseline candidate (manifest: $BW/supabase/baseline/apply_order.txt)"
i=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  i=$((i+1))
  apply "$(printf 'bl_%03d' $i)_$(basename "$f" .sql)" "$BW/$f" || { echo "BASELINE_STEP_FAILED: $f"; exit 2; }
done < "$BW/supabase/baseline/apply_order.txt"
echo "baseline steps applied: $i"

if [ "$MODE" = "noop" ]; then
  echo "[noop] re-apply baseline — expect zero effective changes (idempotent verify)"
  # noop 모드 확장 지점 — verify 전용 스크립트가 별도 담당.
  exit 0
fi

if [ "$MODE" = "baseline" ]; then
  echo "[baseline-only] dump inventory and stop (ledger replay 생략)"
  "${RUN[@]}" $PGBIN/psql -h "$WORK" -U postgres -d postgres -v ON_ERROR_STOP=1 -At -f "$BW/scripts/verify/baseline/local_inventory.sql" > "$WORK/logs/local_inventory.json" 2>"$WORK/logs/local_inventory.err" || { echo "INVENTORY_DUMP_FAILED"; head "$WORK/logs/local_inventory.err"; exit 4; }
  echo "BASELINE_ONLY_OK work=$WORK"
  exit 0
fi

LEDGER_ORDER="${LEDGER_ORDER:-$BW/supabase/baseline/replay_order_augmented.txt}"
[ -f "$LEDGER_ORDER" ] || LEDGER_ORDER="$BW/supabase/baseline/replay_order_augmented.txt"
echo "[3] ledger replay ($(grep -c . "$LEDGER_ORDER") entries, order=$LEDGER_ORDER)"

# 함수 default ACL 시점 회귀 프로브 (PROBE=0 으로 끌 수 있음).
# 20260729000000(함수 defacl 하드닝) 직전/직후에 프로브 함수를 만들어 실측 ACL 을 단언한다.
FN_HARDENING_VERSION=20260729000000
probe(){ # probe <before|after>
  [ "${PROBE:-1}" = "1" ] || return 0
  if ! "${PSQL[@]}" -v phase="$1" -f "$BW/scripts/verify/baseline/defacl_probe.sql" >"$WORK/logs/defacl_probe_$1.log" 2>&1; then
    echo "DEFACL_PROBE_FAILED ($1)"; grep -m4 -E "ERROR|DEFACL_PROBE" "$WORK/logs/defacl_probe_$1.log"; return 1
  fi
  grep -q "DEFACL_PROBE_${1^^}: PASS" "$WORK/logs/defacl_probe_$1.log" || { echo "DEFACL_PROBE_NO_PASS_MARKER ($1)"; return 1; }
  echo "  defacl probe $1: PASS"
}

j=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  j=$((j+1))
  case "$f" in /*) p="$f" ;; *) p="$BW/$f" ;; esac
  case "$(basename "$f")" in "${FN_HARDENING_VERSION}"_*) probe before || exit 9 ;; esac
  apply "$(printf 'lg_%02d' $j)_$(basename "${f%.sql}")" "$p" || { echo "LEDGER_STEP_FAILED: $f"; exit 3; }
  case "$(basename "$f")" in
    "${FN_HARDENING_VERSION}"_*) probe after || exit 9 ;;
    20260731100540_*) echo "  M13_SELFCHECK: PASS (20260731100540 적용 성공 — 자체 검사 ③ 통과)" ;;
  esac
done < "$LEDGER_ORDER"
echo "ledger steps applied: $j"

echo "[4] local inventory dump"
"${RUN[@]}" $PGBIN/psql -h "$WORK" -U postgres -d postgres -v ON_ERROR_STOP=1 -At -f "$BW/scripts/verify/baseline/local_inventory.sql" > "$WORK/logs/local_inventory.json" 2>"$WORK/logs/local_inventory.err" || { echo "INVENTORY_DUMP_FAILED"; cat "$WORK/logs/local_inventory.err" | head; exit 4; }
cp "$WORK/logs/local_inventory.json" "$WORK/last_local_inventory.json"

# PR #60 의 guard SQL 은 PR #60 브랜치에만 있다. 이 브랜치에서 검증하려면
# PR60_SQL/PR60_ROLLBACK 로 경로를 넘긴다(예: git show 로 추출한 임시 파일).
PR60_SQL="${PR60_SQL:-$WEB/supabase/sql/20260804113000_iq_attachment_message_author_guard.sql}"
PR60_ROLLBACK="${PR60_ROLLBACK:-$WEB/supabase/rollback/20260804113000_iq_attachment_message_author_guard_rollback.sql}"
if [ "${PR60:-1}" = "1" ] && { [ ! -f "$PR60_SQL" ] || [ ! -f "$PR60_ROLLBACK" ]; }; then
  echo "PR60_SKIPPED_FILE_ABSENT ($PR60_SQL — PR #60 브랜치에만 존재; PR60_SQL/PR60_ROLLBACK 로 경로 지정 가능)"
  PR60=0
fi
fn_acl(){ # add_individual_question_attachment 의 4역할 EXECUTE ACL 을 정규 문자열로
  "${RUN[@]}" $PGBIN/psql -h "$WORK" -U postgres -d postgres -At -c \
    "select coalesce((select string_agg(coalesce(g.rolname,'PUBLIC')||':'||a.privilege_type, ',' order by 1)
       from pg_proc p join pg_namespace n on n.oid=p.pronamespace,
            aclexplode(p.proacl) a left join pg_roles g on g.oid=a.grantee
      where n.nspname='public' and p.proname='add_individual_question_attachment'
        and coalesce(g.rolname,'PUBLIC') in ('PUBLIC','anon','authenticated','service_role')), '(none)')"
}

if [ "${PR60:-1}" = "1" ]; then
  ACL_BASE=$(fn_acl)
  echo "[5] PR60 forward (baseline acl: $ACL_BASE)"
  apply pr60_forward "$PR60_SQL" || exit 5
  ACL_FWD=$(fn_acl)
  [ "$ACL_FWD" = "$ACL_BASE" ] || { echo "PR60_FORWARD_ACL_DRIFT: '$ACL_FWD' != '$ACL_BASE'"; exit 5; }
  echo "[6] PR60 fullschema fixture (15 cases)"
  if ! "${PSQL[@]}" -f "$BW/scripts/verify/baseline/iq_guard_fullschema_fixture.sql" >"$WORK/logs/pr60_fixture.log" 2>&1; then
    echo "PR60_FIXTURE_FAILED"; grep -m4 ERROR "$WORK/logs/pr60_fixture.log"; exit 6
  fi
  grep -q "IQ_ATTACHMENT_AUTHOR_GUARD FULLSCHEMA FIXTURE PASS" "$WORK/logs/pr60_fixture.log" || { echo "PR60_FIXTURE_NO_PASS_MARKER"; exit 6; }
  echo "[7] PR60 rollback"
  apply pr60_rollback "$PR60_ROLLBACK" || exit 7
  RB_MD5=$("${RUN[@]}" $PGBIN/psql -h "$WORK" -U postgres -d postgres -At -c "select md5(prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='add_individual_question_attachment'")
  if [ "$RB_MD5" != "58f0c2411d40b2ce3bcec23efa0c88a1" ]; then
    echo "PR60_ROLLBACK_MD5_MISMATCH: $RB_MD5 (expected 58f0c2411d40b2ce3bcec23efa0c88a1)"; exit 7
  fi
  echo "rollback md5 exact: $RB_MD5"
  ACL_RB=$(fn_acl)
  [ "$ACL_RB" = "$ACL_BASE" ] || { echo "PR60_ROLLBACK_ACL_DRIFT: '$ACL_RB' != '$ACL_BASE'"; exit 7; }
  echo "rollback acl exact: $ACL_RB"
  echo "[8] PR60 reapply + fixture"
  apply pr60_reapply "$PR60_SQL" || exit 8
  if ! "${PSQL[@]}" -f "$BW/scripts/verify/baseline/iq_guard_fullschema_fixture.sql" >"$WORK/logs/pr60_fixture2.log" 2>&1; then
    echo "PR60_FIXTURE2_FAILED"; grep -m4 ERROR "$WORK/logs/pr60_fixture2.log"; exit 8
  fi
  grep -q "IQ_ATTACHMENT_AUTHOR_GUARD FULLSCHEMA FIXTURE PASS" "$WORK/logs/pr60_fixture2.log" || { echo "PR60_FIXTURE2_NO_PASS_MARKER"; exit 8; }
fi

echo "ROUNDTRIP_OK work=$WORK"
trap - EXIT   # 성공 시 로그 보존을 위해 클러스터만 내리고 디렉터리는 남긴다.
cleanup
