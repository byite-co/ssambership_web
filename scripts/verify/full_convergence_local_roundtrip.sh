#!/usr/bin/env bash
# =============================================================================
# full_convergence_local_roundtrip.sh — 수렴 M1~M3 forward/rollback 왕복 검증
# =============================================================================
# 오프라인 스크래치 Postgres 전용. 순서(지시서 §24.1):
#   baseline(fixture+Build13+드리프트2+보강) → M1→v1 → M2→v2 → M3→v3
#   → 데이터 불변식 → RB3→RB2→RB1 → rb-verify → M1→M2→M3 재적용 → v1·v2·v3
#   → clean DB: 전체 체인 1회 → v1·v2·v3
# 사용: scripts/verify/full_convergence_local_roundtrip.sh [DB_PREFIX]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PREFIX="${1:-fullconv}"
DB_RT="${PREFIX}_roundtrip"
DB_CLEAN="${PREFIX}_clean"

BASE_FIXTURE="$ROOT/scripts/verify/fixtures/s3_c_build13_contract_baseline_fixture.sql"
B13="$ROOT/supabase/sql/20260802024641_build13_db_contract_convergence.sql"
SUPP="$ROOT/scripts/verify/fixtures/full_convergence_supplement_fixture.sql"
DRIFT1="$ROOT/supabase/sql/20260803142534_iq_append_message_v1.sql"
DRIFT2="$ROOT/supabase/sql/20260803142559_iq_attachment_author_v1.sql"
M1="$ROOT/supabase/sql/20260803162257_security_identity_profile_lockdown.sql"
M2="$ROOT/supabase/sql/20260803162808_domain_contract_convergence.sql"
M3="$ROOT/supabase/sql/20260803163322_realtime_notification_convergence.sql"
RB1="$ROOT/supabase/rollback/20260803162257_security_identity_profile_lockdown_rollback.sql"
RB2="$ROOT/supabase/rollback/20260803162808_domain_contract_convergence_rollback.sql"
RB3="$ROOT/supabase/rollback/20260803163322_realtime_notification_convergence_rollback.sql"
V1="$ROOT/scripts/verify/full_convergence_m1_verify.sql"
V2="$ROOT/scripts/verify/full_convergence_m2_verify.sql"
V3="$ROOT/scripts/verify/full_convergence_m3_verify.sql"
RBV="$ROOT/scripts/verify/full_convergence_rollback_verify.sql"

run() { PGOPTIONS='-c client_min_messages=warning' psql -X -q -v ON_ERROR_STOP=1 -d "$1" -f "$2" >/dev/null; }
verify() {
  local out
  out="$(psql -X -q -v ON_ERROR_STOP=1 -d "$1" -f "$2" 2>&1)" || { printf '%s\n' "$out"; echo "VERIFY FAILED: $2" >&2; return 1; }
  printf '%s\n' "$out" | grep -E 'FAIL\[|ERROR' >&2 && { echo "VERIFY FAILED: $2" >&2; return 1; }
  local n; n="$(printf '%s\n' "$out" | grep -c 'PASS ' || true)"
  printf '  assertions passed: %s\n' "$n"
  printf '%s\n' "$out" | grep -F '===' >/dev/null || { echo "VERIFY FAILED (no summary): $2" >&2; return 1; }
}
counts() {
  psql -X -qAt -d "$1" -c "
    select 'users:'||(select count(*) from public.users)
      ||' community_posts:'||(select count(*) from public.community_posts)
      ||' shortform_posts:'||(select count(*) from public.shortform_posts)
      ||' comments:'||(select count(*) from public.comments)
      ||' reviews:'||(select count(*) from public.reviews)
      ||' favorites:'||(select count(*) from public.favorites)
      ||' iq:'||(select count(*) from public.individual_questions)
      ||' threads:'||(select count(*) from public.question_threads)
      ||' subscriptions:'||(select count(*) from public.subscriptions)
      ||' payments:'||(select count(*) from public.payments)
      ||' cash_ledger:'||(select count(*) from public.cash_ledger)
      ||' cash_wallets:'||(select count(*) from public.cash_wallets)
      ||' notifications:'||(select count(*) from public.notifications)
      ||' outbox:'||(select count(*) from public.notification_outbox)
      ||' deletion_jobs:'||(select count(*) from public.account_deletion_jobs)";
}
step() { printf '\n--- %s\n' "$1"; }

for db in "$DB_RT" "$DB_CLEAN"; do
  dropdb --if-exists "$db"
  createdb "$db"
done

apply_chain_base() {
  run "$1" "$BASE_FIXTURE"
  run "$1" "$B13"
  run "$1" "$SUPP"
  run "$1" "$DRIFT1"
  run "$1" "$DRIFT2"
}

step "1) roundtrip DB: baseline(fixture + Build13 + supplement + drift x2)"
apply_chain_base "$DB_RT"
C_BEFORE="$(counts "$DB_RT")"
echo "  counts(before): $C_BEFORE"

step "2) M1 forward + verify"
run "$DB_RT" "$M1"; verify "$DB_RT" "$V1"

step "3) M2 forward + verify"
run "$DB_RT" "$M2"; verify "$DB_RT" "$V2"

step "4) M3 forward + verify"
run "$DB_RT" "$M3"; verify "$DB_RT" "$V3"

step "5) 데이터 불변식 (허용 변화: notification read backfill · outbox status · config seed)"
C_AFTER="$(counts "$DB_RT")"
echo "  counts(after):  $C_AFTER"
if [ "$C_BEFORE" != "$C_AFTER" ]; then
  echo "DATA INVARIANT FAILED: row counts changed" >&2; exit 1
fi
echo "  business row counts unchanged: OK"

step "6) rollback M3 -> M2 -> M1 + baseline 복원 검증"
run "$DB_RT" "$RB3"
run "$DB_RT" "$RB2"
run "$DB_RT" "$RB1"
verify "$DB_RT" "$RBV"

step "7) re-forward M1 -> M2 -> M3 + 전체 재검증"
run "$DB_RT" "$M1"; run "$DB_RT" "$M2"; run "$DB_RT" "$M3"
verify "$DB_RT" "$V1"; verify "$DB_RT" "$V2"; verify "$DB_RT" "$V3"

step "8) clean DB: 전체 체인 1회 적용 + 검증"
apply_chain_base "$DB_CLEAN"
run "$DB_CLEAN" "$M1"; run "$DB_CLEAN" "$M2"; run "$DB_CLEAN" "$M3"
verify "$DB_CLEAN" "$V1"; verify "$DB_CLEAN" "$V2"; verify "$DB_CLEAN" "$V3"

printf '\n=== full_convergence_local_roundtrip: ALL STEPS PASSED ===\n'
