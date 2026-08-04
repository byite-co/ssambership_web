#!/usr/bin/env bash
# =============================================================================
# s3_c_local_roundtrip.sh — S3-C forward/rollback 왕복 로컬 검증 러너
# =============================================================================
# 오프라인 스크래치 Postgres 전용. 운영·staging 접속 정보를 쓰지 않는다.
#
#   1) 새 DB 생성 → baseline fixture 적용(= 2026-08-02 운영 실측 재현)
#   2) forward 적용 → 행위 검증
#   3) forward 재적용(재실행 안전성) → 행위 재검증
#   4) rollback 적용 → 복원 검증
#   5) rollback 재적용(재실행 안전성)
#   6) forward 재적용(rollback 후 재수렴) → 행위 재검증
#   7) clean install: 새 DB 에 fixture + forward 를 처음부터 1회 적용 → 행위 검증
#
# 사용: scripts/verify/s3_c_local_roundtrip.sh [DB_PREFIX]
# 전제: psql 이 PATH 에 있고 현재 OS 사용자가 로컬 클러스터에 superuser 로 접속 가능.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PREFIX="${1:-s3c_verify}"
DB_ROUNDTRIP="${PREFIX}_roundtrip"
DB_CLEAN="${PREFIX}_clean"

FIXTURE="$ROOT/scripts/verify/fixtures/s3_c_build13_contract_baseline_fixture.sql"
FORWARD="$ROOT/supabase/sql/20260802024641_build13_db_contract_convergence.sql"
ROLLBACK="$ROOT/supabase/rollback/20260802024641_build13_db_contract_convergence_rollback.sql"
VERIFY="$ROOT/scripts/verify/s3_c_build13_db_contract_convergence_verify.sql"
RB_VERIFY="$ROOT/scripts/verify/s3_c_build13_db_contract_convergence_rollback_verify.sql"

run() { PGOPTIONS='-c client_min_messages=warning' psql -X -q -v ON_ERROR_STOP=1 -d "$1" -f "$2" >/dev/null; }
# 검증 스크립트는 통과 시 NOTICE PASS 를, 실패 시 ERROR 로 중단한다.
# 통과 건수를 집계해 함께 출력한다(무증상 통과 방지).
verify() {
  local out
  out="$(psql -X -q -v ON_ERROR_STOP=1 -d "$1" -f "$2" 2>&1)" || true
  printf '%s\n' "$out" | grep -E 'ERROR|FAIL\[' >&2 || true
  local n
  n="$(printf '%s\n' "$out" | grep -c 'PASS ' || true)"
  printf '  assertions passed: %s\n' "$n"
  printf '%s\n' "$out" | grep -E '^===' || { echo "VERIFY FAILED: $2" >&2; return 1; }
}
step() { printf '\n--- %s\n' "$1"; }

for db in "$DB_ROUNDTRIP" "$DB_CLEAN"; do
  dropdb --if-exists "$db"
  createdb "$db"
done

step "1) baseline fixture"
run "$DB_ROUNDTRIP" "$FIXTURE"

step "2) forward apply + verify"
run "$DB_ROUNDTRIP" "$FORWARD"
verify "$DB_ROUNDTRIP" "$VERIFY"

step "3) forward re-apply (재실행 안전) + verify"
run "$DB_ROUNDTRIP" "$FORWARD"
verify "$DB_ROUNDTRIP" "$VERIFY"

step "4) rollback apply + verify"
run "$DB_ROUNDTRIP" "$ROLLBACK"
verify "$DB_ROUNDTRIP" "$RB_VERIFY"

step "5) rollback re-apply (재실행 안전)"
run "$DB_ROUNDTRIP" "$ROLLBACK"

step "6) forward re-apply after rollback + verify"
run "$DB_ROUNDTRIP" "$FORWARD"
verify "$DB_ROUNDTRIP" "$VERIFY"

step "7) clean install (fixture + forward 1회) + verify"
run "$DB_CLEAN" "$FIXTURE"
run "$DB_CLEAN" "$FORWARD"
verify "$DB_CLEAN" "$VERIFY"

printf '\n=== S3-C LOCAL ROUNDTRIP: ALL STEPS PASS ===\n'
