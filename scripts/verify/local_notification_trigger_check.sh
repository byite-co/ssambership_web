#!/usr/bin/env bash
# local_notification_trigger_check.sh — 오프라인 스크래치 PG16 에서 알림 원자화 스택을 실구동 검증.
#
# 하는 일:
#   1) 임시 클러스터 initdb/start (unix socket 전용 — 네트워크 미개방, 종료 시 전부 삭제)
#   2) 스텁 스키마(local_stub_schema.sql) 적용
#   3) 실제 정본 SQL 132 → 155 무관(개별질문 테이블 스텁 없음) → 157 → 158 → 159 적용
#   4) rollback-only fixture(notification_atomization_157_159_fixture.sql) 실행 → FIXTURE PASS 기대
#
# 주의: 스텁은 로컬 전용 골격이므로 이 검증은 "트리거·helper 의 실구동/원자성/멱등" 검증이다.
#   staging 실스키마(RLS·레거시 컬럼·타 트리거 공존)에 대한 최종 검증은 staging fixture 실행으로 대체한다.
# 사용: scripts/verify/local_notification_trigger_check.sh

set -euo pipefail

PGBIN=/usr/lib/postgresql/16/bin
[[ -x "$PGBIN/initdb" ]] || { echo "SKIP: PostgreSQL 16 서버 바이너리 없음($PGBIN)" >&2; exit 0; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/ssambership-notif-check-XXXXXX")"
PORT=54329

# initdb 는 root 실행을 거부한다 — root 면 postgres(또는 nobody) 사용자로 서버 프로세스만 강등.
RUN_AS=()
if [[ "$(id -u)" == "0" ]]; then
  if id postgres >/dev/null 2>&1; then AS_USER=postgres; else AS_USER=nobody; fi
  chown -R "$AS_USER" "$WORK"
  RUN_AS=(setpriv --reuid "$AS_USER" --regid "$AS_USER" --clear-groups)
fi

cleanup() {
  set +e
  "${RUN_AS[@]}" "$PGBIN/pg_ctl" -D "$WORK/data" stop -m immediate >/dev/null 2>&1
  rm -rf "$WORK"
}
trap cleanup EXIT

"${RUN_AS[@]}" "$PGBIN/initdb" -D "$WORK/data" -A trust -U postgres >/dev/null
"${RUN_AS[@]}" "$PGBIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=''" -l "$WORK/pg.log" start >/dev/null

PSQL=("$PGBIN/psql" -h "$WORK" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q)

echo "1/3 스텁 스키마 적용"
"${PSQL[@]}" -f "$ROOT/scripts/verify/fixtures/local_stub_schema.sql"

echo "2/3 정본 SQL 적용: 132, 157, 158, 159"
"${PSQL[@]}" -f "$ROOT/supabase/sql/132_notification_outbox_foundation.sql"
"${PSQL[@]}" -f "$ROOT/supabase/sql/157_p1_11_subscription_notification_atomization.sql"
"${PSQL[@]}" -f "$ROOT/supabase/sql/158_p1_11_mentor_notification_atomization.sql"
"${PSQL[@]}" -f "$ROOT/supabase/sql/159_p1_11_custom_request_notification_atomization.sql"

echo "3/3 rollback-only fixture 실행"
OUT="$("${PSQL[@]}" -f "$ROOT/scripts/verify/fixtures/notification_atomization_157_159_fixture.sql" 2>&1)" || {
  echo "$OUT"
  echo "FAIL: fixture 실행 실패" >&2
  exit 1
}
echo "$OUT"

if grep -q "FIXTURE PASS" <<<"$OUT"; then
  echo "OK: 157~159 알림 원자화 트리거 로컬 실구동 검증 통과"
else
  echo "FAIL: FIXTURE PASS 미확인" >&2
  exit 1
fi
