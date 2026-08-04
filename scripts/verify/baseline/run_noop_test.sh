#!/usr/bin/env bash
# run_noop_test.sh — baseline 재적용 안전성 검사.
#
# 검증하는 성질(문서 §4 '알려진 한계' 와 일치):
#   * baseline 세트의 **end-to-end 재적용은 멱등이 아니다** — 후기 파일이 앞선 함수의
#     반환 타입을 drop+create 로 바꾸는 등의 이유로 일부 단계가 실패한다(예: 078 ↔ 112).
#     따라서 "2회 적용 전부 성공" 을 기대하지 않는다.
#   * 대신 **재적용이 무엇을 바꾸는지 성격을 고정**한다. 실측 결과 전체 재적용은
#     구조(테이블·컬럼·제약·인덱스·뷰·트리거·정책·grant·버킷·타입·기본권한)를 바꾸지
#     않지만, **함수 ACL 을 넓힌다**: 078 이 반환타입 충돌로 abort 하면서 자기 REVOKE 를
#     실행하지 못해, 앞선 파일이 부여한 anon/authenticated EXECUTE 가 남는다.
#     → 이것이 '전체 재실행 금지, 실패 지점부터 재개' 규칙의 실증 근거다.
#   * 허용 변화는 functions 축의 ACL 뿐이며, 그 외 변화가 나타나면 실질 결함으로 실패한다.
#   * 재적용 불가 단계 목록과 ACL drift 목록을 산출물로 남긴다(회귀 감시용).
#
# 종료코드: 0 = 특성 고정 성공(ACL 외 변화 0), 1 = ACL 외 구조 변화 또는 준비 단계 실패.
set -uo pipefail

PGBIN=/usr/lib/postgresql/16/bin
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
WORK="$(mktemp -d /tmp/bl-noop-XXXX)"
if id postgres >/dev/null 2>&1; then AS=postgres; else AS=nobody; fi
chown -R $AS "$WORK"
RUN=(setpriv --reuid $AS --regid $AS --clear-groups env PGOPTIONS="-csearch_path=\"\$user\",public,extensions,pg17shim,pg_catalog -cclient_min_messages=warning")
cleanup(){ "${RUN[@]}" $PGBIN/pg_ctl -D "$WORK/data" stop -m immediate >/dev/null 2>&1; }
trap cleanup EXIT

"${RUN[@]}" $PGBIN/initdb -D "$WORK/data" -A trust -U postgres >/dev/null
"${RUN[@]}" $PGBIN/pg_ctl -D "$WORK/data" -o "-k $WORK -c listen_addresses=''" -w start >/dev/null
mkdir -p "$WORK/logs"; chown $AS "$WORK/logs"
PSQL=("${RUN[@]}" $PGBIN/psql -h "$WORK" -U postgres -d postgres -v ON_ERROR_STOP=1 -q)

run_sql(){ # run_sql <logname> <file> → 0/1 (중단하지 않는다)
  sed 's/\xEF\xBB\xBF//g' "$2" > "$WORK/c.sql"; chown $AS "$WORK/c.sql"
  "${PSQL[@]}" -f "$WORK/c.sql" >"$WORK/logs/$1.log" 2>&1
}

inventory(){ # inventory <outfile>
  "${RUN[@]}" $PGBIN/psql -h "$WORK" -U postgres -d postgres -v ON_ERROR_STOP=1 -At \
    -f "$REPO/scripts/verify/baseline/local_inventory.sql" > "$1" 2>"$1.err"
}

echo "[0] platform stub"
run_sql stub "$REPO/scripts/verify/baseline/platform_stub.sql" || { echo "STUB_FAIL"; grep -m3 ERROR "$WORK/logs/stub.log"; exit 1; }

echo "[1] baseline 1회차 (모든 단계 성공해야 함)"
i=0
while IFS= read -r f; do
  [ -z "$f" ] && continue; i=$((i+1))
  run_sql "$(printf 'r1_%03d' $i)" "$REPO/$f" || {
    echo "ROUND1_FAIL at $f"; grep -m3 ERROR "$WORK/logs/$(printf 'r1_%03d' $i).log"; exit 1; }
done < "$REPO/supabase/baseline/apply_order.txt"
echo "round 1: $i/$i steps OK"
inventory "$WORK/inv1.json" || { echo "INV1_FAIL"; head "$WORK/inv1.json.err"; exit 1; }

echo "[2] baseline 2회차 (실패 단계는 기록만 하고 계속 — 멱등성 기대 안 함)"
j=0; failed=0; : > "$WORK/not_reappliable.txt"
while IFS= read -r f; do
  [ -z "$f" ] && continue; j=$((j+1))
  if ! run_sql "$(printf 'r2_%03d' $j)" "$REPO/$f"; then
    failed=$((failed+1))
    printf '%s\t%s\n' "$f" "$(grep -m1 -E '^psql.*ERROR' "$WORK/logs/$(printf 'r2_%03d' $j).log" | sed 's/.*ERROR:  //')" >> "$WORK/not_reappliable.txt"
  fi
done < "$REPO/supabase/baseline/apply_order.txt"
echo "round 2: $((j - failed))/$j 재적용 성공 · 재적용 불가 $failed 단계"
[ "$failed" -gt 0 ] && { echo "재적용 불가 단계(선두 5):"; head -5 "$WORK/not_reappliable.txt" | sed 's/^/  /'; }
cp "$WORK/not_reappliable.txt" "$WORK/logs/not_reappliable.txt" 2>/dev/null || true

echo "[3] 구조 인벤토리 대조 (재적용 위험의 성격을 고정한다)"
inventory "$WORK/inv2.json" || { echo "INV2_FAIL"; head "$WORK/inv2.json.err"; exit 1; }

# 전체 재적용은 멱등이 아니다(문서화된 한계). 이 검사는 "재적용이 무엇을 바꾸는가" 를
# 고정한다: 허용되는 변화는 오직 functions 축의 **ACL 차이**뿐이며, 그 외 축(테이블·컬럼·
# 제약·인덱스·뷰·트리거·정책·grant·버킷·타입·기본권한)이 바뀌면 실질 결함으로 실패시킨다.
REPORT="$WORK/reapply_drift.txt"
python3 - "$WORK/inv1.json" "$WORK/inv2.json" "$REPORT" <<'PY'
import json, sys
a = json.load(open(sys.argv[1])); b = json.load(open(sys.argv[2]))
out = open(sys.argv[3], 'w')
unexpected = []
acl_drift = []
for axis in sorted(set(a) | set(b)):
    x = a.get(axis) or []; y = b.get(axis) or []
    if x == y:
        continue
    if axis != 'functions':
        unexpected.append(f'{axis}: {len(x)} -> {len(y)} 행 변화')
        continue
    key = lambda r: (r['sch'], r['name'], r.get('args', ''))
    mx = {key(r): r for r in x}; my = {key(r): r for r in y}
    if set(mx) != set(my):
        unexpected.append(f'functions: 함수 집합 자체가 변함 ({len(mx)} -> {len(my)})')
        continue
    for k in sorted(mx):
        p_, q_ = mx[k], my[k]
        diffs = [f for f in p_ if p_[f] != q_.get(f)]
        if not diffs:
            continue
        if diffs == ['acl']:
            acl_drift.append(f"{k[0]}.{k[1]}({k[2]}): {p_['acl']}  ->  {q_['acl']}")
        else:
            unexpected.append(f"{k[0]}.{k[1]}({k[2]}): ACL 외 변화 {diffs}")
out.write('== 재적용으로 넓어진 함수 ACL (%d건)\n' % len(acl_drift))
for l in acl_drift: out.write('  ' + l + '\n')
if unexpected:
    out.write('== 예상 밖 변화 (%d건)\n' % len(unexpected))
    for l in unexpected: out.write('  ' + l + '\n')
out.close()
print(f'ACL_DRIFT_FUNCTIONS={len(acl_drift)}')
print(f'UNEXPECTED_DRIFT={len(unexpected)}')
sys.exit(1 if unexpected else 0)
PY
rc=$?
sed -n '1,12p' "$REPORT"
echo "산출물: $REPORT · $WORK/not_reappliable.txt"
if [ $rc -ne 0 ]; then
  echo "BASELINE_REAPPLY_CHARACTERIZATION: FAIL — ACL 외 구조 변화 발생(실질 결함)"
  exit 1
fi
echo "BASELINE_END_TO_END_IDEMPOTENCY: NOT_IDEMPOTENT (재적용 불가 $failed 단계 — 문서화된 한계)"
echo "BASELINE_FULL_REAPPLY: UNSAFE_BY_DESIGN — 구조 변화 0, 그러나 함수 ACL 이 넓어진다"
echo "  (078 이 반환타입 충돌로 abort 하면서 자신의 REVOKE 가 실행되지 않아,"
echo "   앞선 파일이 부여한 anon/authenticated EXECUTE 가 그대로 남는다.)"
echo "  → 복구는 반드시 '실패 지점부터 재개'. 전체 재실행 금지(문서 §4)."
echo "BASELINE_REAPPLY_CHARACTERIZATION: PASS"
trap - EXIT; cleanup; exit 0
