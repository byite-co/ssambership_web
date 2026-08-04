#!/usr/bin/env bash
# validate_replay_manifest.sh — baseline/replay manifest 정적 검증 (DB 불필요).
#
# 검증 대상(현재 정본):
#   supabase/baseline/apply_order.txt            — baseline apply stages
#   supabase/baseline/replay_order_augmented.txt — augmented replay stages
#   supabase/baseline/ledger_manifest.tsv        — 부모 원장 56본 정본(version/name/bytes/md5)
#
# 용어 고정(문서·보고서와 동일하게 쓸 것):
#   BASELINE_SOURCE_PARTS        = 188  (번들 77조각 + 보충 5 + 번호 SQL 106)
#                                        번들 77 = 섹션 74 + 파일별 주석 전용 선두 조각 3
#   BASELINE_APPLY_STAGES        = 114  (apply_order.txt 유효 행)
#   ORIGINAL_LEDGER_ENTRIES      = 56   (부모 원장 그대로)
#   INTERLEAVE_ENTRIES           = 6    (재구성이 추가한 이력 항목)
#   CURRENT_AUGMENTED_REPLAY_STAGES = 62 (= 56 + 6)
#
# 종료코드: 0 = 전 검증 통과, 1 = 검증 실패, 2 = 사용법/입력 오류.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
APPLY="$REPO/supabase/baseline/apply_order.txt"
REPLAY="$REPO/supabase/baseline/replay_order_augmented.txt"
LEDGER_MANIFEST="$REPO/supabase/baseline/ledger_manifest.tsv"

EXP_APPLY_STAGES=114
EXP_LEDGER=56
EXP_INTERLEAVE=6
EXP_REPLAY=62
EXP_SOURCE_PARTS=188

fail=0
say(){ printf '%s\n' "$*"; }
bad(){ printf 'FAIL: %s\n' "$*"; fail=1; }

for f in "$APPLY" "$REPLAY" "$LEDGER_MANIFEST"; do
  [ -f "$f" ] || { say "USAGE_ERROR: missing $f"; exit 2; }
done

# 유효 행 = 공백/주석(#) 제외
valid(){ grep -v -E '^[[:space:]]*(#|$)' "$1"; }

say "=== manifest cardinality ==="
apply_n=$(valid "$APPLY" | wc -l | tr -d ' ')
replay_n=$(valid "$REPLAY" | wc -l | tr -d ' ')
ledger_n=$(valid "$REPLAY" | grep -c 'supabase/baseline/ledger_replay/')
inter_n=$(valid "$REPLAY" | grep -c 'supabase/baseline/interleaves/')
say "BASELINE_APPLY_STAGES: $apply_n (expected $EXP_APPLY_STAGES)"
say "ORIGINAL_LEDGER_ENTRIES: $ledger_n (expected $EXP_LEDGER)"
say "INTERLEAVE_ENTRIES: $inter_n (expected $EXP_INTERLEAVE)"
say "CURRENT_AUGMENTED_REPLAY_STAGES: $replay_n (expected $EXP_REPLAY)"
[ "$apply_n" = "$EXP_APPLY_STAGES" ] || bad "apply stages $apply_n != $EXP_APPLY_STAGES"
[ "$ledger_n" = "$EXP_LEDGER" ]      || bad "ledger entries $ledger_n != $EXP_LEDGER"
[ "$inter_n" = "$EXP_INTERLEAVE" ]   || bad "interleave entries $inter_n != $EXP_INTERLEAVE"
[ "$replay_n" = "$EXP_REPLAY" ]      || bad "replay stages $replay_n != $EXP_REPLAY"
[ $((ledger_n + inter_n)) = "$replay_n" ] || bad "ledger+interleave != replay total"

say
say "=== baseline source parts (번들 전개 기준) ==="
sections=$(cat "$REPO"/supabase/bundles/bundle_*.sql | grep -c -E '^-- ===== [0-9]{3}[a-z]?_.*\.sql =====')
bundles=$(valid "$APPLY" | grep -c 'supabase/bundles/')
supplements=$(valid "$APPLY" | grep -c 'supabase/baseline/supplements/')
numbered=$(valid "$APPLY" | grep -c 'supabase/sql/')
parts=$(( sections + bundles + supplements + numbered ))
say "bundle sections: $sections · bundle files(주석 전용 선두 조각): $bundles · supplements: $supplements · numbered: $numbered"
say "BASELINE_SOURCE_PARTS: $parts (expected $EXP_SOURCE_PARTS)"
[ "$parts" = "$EXP_SOURCE_PARTS" ] || bad "source parts $parts != $EXP_SOURCE_PARTS"

say
say "=== file existence ==="
missing=0
while IFS= read -r p; do [ -f "$REPO/$p" ] || { bad "missing file: $p"; missing=$((missing+1)); }; done < <(valid "$REPLAY")
say "replay files present: $((replay_n - missing))/$replay_n"
amissing=0
while IFS= read -r p; do [ -f "$REPO/$p" ] || { bad "missing file: $p"; amissing=$((amissing+1)); }; done < <(valid "$APPLY")
say "apply files present: $((apply_n - amissing))/$apply_n"

say
say "=== duplicates ==="
duppath=$(valid "$REPLAY" | sort | uniq -d)
[ -z "$duppath" ] || bad "duplicate replay paths:\n$duppath"
say "CURRENT_REPLAY_DUPLICATE_PATHS: $( [ -z "$duppath" ] && echo 0 || echo "$duppath" | wc -l )"
dupver=$(valid "$REPLAY" | sed 's#.*/##; s/_.*//' | sort | uniq -d)
[ -z "$dupver" ] || bad "duplicate versions:\n$dupver"
say "CURRENT_REPLAY_DUPLICATE_VERSIONS: $( [ -z "$dupver" ] && echo 0 || echo "$dupver" | wc -l )"
dupapply=$(valid "$APPLY" | sort | uniq -d)
[ -z "$dupapply" ] || bad "duplicate apply paths:\n$dupapply"

say
say "=== ordering (version ascending, 역전 0) ==="
inversions=$(valid "$REPLAY" | sed 's#.*/##; s/_.*//' | awk 'NR>1 && $0 < prev {print NR": "prev" -> "$0} {prev=$0}')
if [ -n "$inversions" ]; then bad "version order inversions:\n$inversions"; fi
say "CURRENT_REPLAY_ORDER_INVERSIONS: $( [ -z "$inversions" ] && echo 0 || echo "$inversions" | wc -l )"

say
say "=== gaps (원장 56본이 manifest 에 전수 존재하는가) ==="
gaps=0
while IFS=$'\t' read -r ver name rest; do
  [ -z "${ver:-}" ] && continue
  grep -q "ledger_replay/${ver}_" "$REPLAY" || { bad "ledger version missing from replay manifest: $ver $name"; gaps=$((gaps+1)); }
done < "$LEDGER_MANIFEST"
say "CURRENT_REPLAY_GAPS: $gaps"

say
say "=== ledger content md5 (manifest 대조) ==="
ok=0; bad_md5=0
while IFS=$'\t' read -r ver name bytes want; do
  [ -z "${ver:-}" ] && continue
  f="$REPO/supabase/baseline/ledger_replay/${ver}_${name}.sql"
  if [ ! -f "$f" ]; then bad "ledger file missing: ${ver}_${name}.sql"; bad_md5=$((bad_md5+1)); continue; fi
  got=$(md5sum "$f" | cut -d' ' -f1)
  if [ "$got" = "$want" ]; then ok=$((ok+1)); else bad "md5 mismatch ${ver}_${name}: $got != $want"; bad_md5=$((bad_md5+1)); fi
done < "$LEDGER_MANIFEST"
say "LEDGER_MD5_VERIFIED: $ok/$EXP_LEDGER (mismatch $bad_md5)"
[ "$ok" = "$EXP_LEDGER" ] || bad "ledger md5 verified $ok != $EXP_LEDGER"

say
say "=== adoption repair plan (Strategy A history records) ==="
PLAN="$REPO/supabase/baseline/adoption_repair_plan.tsv"
if [ ! -f "$PLAN" ]; then
  bad "missing $PLAN"
else
  plan_rows=$(tail -n +2 "$PLAN" | grep -c .)
  plan_baseline=$(tail -n +2 "$PLAN" | awk -F'\t' '$3=="baseline"' | grep -c .)
  plan_inter=$(tail -n +2 "$PLAN" | awk -F'\t' '$3=="interleave"' | grep -c .)
  say "STRATEGY_A_TOTAL_HISTORY_RECORDS: $plan_rows"
  say "STRATEGY_A_BASELINE_RECORDS: $plan_baseline"
  say "STRATEGY_A_INTERLEAVE_RECORDS: $plan_inter"
  [ "$plan_baseline" = 1 ] || bad "expected exactly 1 baseline record, got $plan_baseline"
  [ "$plan_inter" = "$EXP_INTERLEAVE" ] || bad "plan interleave rows $plan_inter != manifest interleave $EXP_INTERLEAVE"
  [ "$plan_rows" = $((plan_baseline + plan_inter)) ] || bad "plan row total mismatch"
  # 계획의 interleave version 집합 == manifest interleave version 집합
  planv=$(tail -n +2 "$PLAN" | awk -F'\t' '$3=="interleave"{print $2}' | sort)
  manv=$(valid "$REPLAY" | grep 'supabase/baseline/interleaves/' | sed 's#.*/##; s/_.*//' | sort)
  [ "$planv" = "$manv" ] || bad "plan interleave versions != manifest interleave versions"
  # baseline version 은 원장 최초보다 과거여야 한다
  bver=$(tail -n +2 "$PLAN" | awk -F'\t' '$3=="baseline"{print $2}')
  fledger=$(valid "$REPLAY" | grep 'ledger_replay/' | head -1 | sed 's#.*/##; s/_.*//')
  say "baseline version $bver vs first ledger $fledger"
  [ "$bver" \< "$fledger" ] || bad "baseline version $bver must sort before first ledger $fledger"
  # 모든 행이 history-only 여야 한다
  ddl=$(tail -n +2 "$PLAN" | awk -F'\t' '$7!="no"' | grep -c .)
  sch=$(tail -n +2 "$PLAN" | awk -F'\t' '$8!="no"' | grep -c .)
  say "STRATEGY_A_EXPECTED_DDL: $ddl"
  say "STRATEGY_A_EXPECTED_SCHEMA_DIFF: $sch"
  [ "$ddl" = 0 ] || bad "plan declares DDL execution on $ddl row(s) — Strategy A must be history-only"
  [ "$sch" = 0 ] || bad "plan declares schema change on $sch row(s) — Strategy A must be history-only"
fi

say
say "=== manifest checksums ==="
say "CURRENT_REPLAY_MANIFEST_SHA256: $(sha256sum "$REPLAY" | cut -d' ' -f1)"
say "BASELINE_APPLY_MANIFEST_SHA256: $(sha256sum "$APPLY" | cut -d' ' -f1)"
say "LEDGER_MANIFEST_SHA256: $(sha256sum "$LEDGER_MANIFEST" | cut -d' ' -f1)"

say
if [ "$fail" = 0 ]; then say "MANIFEST_VALIDATION: PASS"; exit 0; else say "MANIFEST_VALIDATION: FAIL"; exit 1; fi
