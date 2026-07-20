#!/usr/bin/env bash
# two_session_concurrency.sh — 독립 2세션 동시성 검증 harness (psql 2 커넥션).
#
# 목적: 단일 세션(savepoint)으로는 검증할 수 없는 잠금/경쟁 계약을 실제 2개의 DB 세션으로 실측한다.
#   시나리오(각각 rollback-only fixture 사용, 실데이터 무변경):
#     p0-5   개별질문 셀프환불 vs answer 경쟁 (124 상태 게이트)
#     p1-8   질문방 free limit/first-answer 경쟁 (136/141/142 RPC·가드)
#     p1-13  구독 checkout mentor cap/중복 pair 경쟁 (131/143 advisory lock·UNIQUE)
#     p1-10  회원탈퇴 job claim 경쟁 (151/154 lease — 두 worker 중 1만 claim)
#     p1-11  알림 outbox claim 경쟁 (152 SKIP LOCKED — 중복 배달 0)
#     p2-25  지급 run 동일 source 중복 (153/156 — 두 run 이 같은 source 지급 시 1건만)
#
# 실행 조건: DATABASE_URL(staging, 오너 발급 read-write) 필수. 없으면 READY_NOT_EXECUTED 로 종료(성공 코드).
#   production URL 금지 — staging ref(lbeqxarxothkmzqvpudy) 외 호스트면 즉시 중단한다.
#
# 사용: DATABASE_URL=postgres://... scripts/verify/two_session_concurrency.sh [scenario]
#   scenario 생략 시 전체. 각 시나리오는 BEGIN…ROLLBACK 안에서만 fixture 를 만들고 검증한다.

set -euo pipefail

SCENARIOS=(p0-5 p1-8 p1-13 p1-10 p1-11 p2-25)
ONLY="${1:-}"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "READY_NOT_EXECUTED: DATABASE_URL 미설정 — 2세션 실측은 DB secret 확보 후 실행한다." >&2
  exit 0
fi

if [[ "$DATABASE_URL" != *"lbeqxarxothkmzqvpudy"* ]]; then
  echo "ABORT: DATABASE_URL 이 staging(lbeqxarxothkmzqvpudy)이 아니다 — production 접근 금지." >&2
  exit 2
fi

command -v psql >/dev/null || { echo "ABORT: psql 필요" >&2; exit 2; }

# 세션 독립성 사전 검증: 두 커넥션의 pg_backend_pid 가 달라야 한다.
PID1=$(psql "$DATABASE_URL" -Atc 'select pg_backend_pid()')
PID2=$(psql "$DATABASE_URL" -Atc 'select pg_backend_pid()')
if [[ "$PID1" == "$PID2" ]]; then
  echo "ABORT: 두 세션의 backend pid 가 동일($PID1) — 커넥션 풀러가 세션을 공유 중. 직결(5432) URL 로 재시도." >&2
  exit 2
fi
echo "sessions independent: pid1=$PID1 pid2=$PID2"

run_scenario() {
  local name="$1"
  echo "=== scenario $name ==="
  case "$name" in
    # 각 시나리오 본문은 fixture SQL(scripts/verify/fixtures/)에 위임한다.
    # 파일이 아직 없으면 SKIP 으로 정직 보고한다(허위 PASS 금지).
    *)
      local fixture="scripts/verify/fixtures/two_session_${name//-/_}.sql"
      if [[ ! -f "$fixture" ]]; then
        echo "SKIP($name): fixture 미작성 — $fixture"
        return 0
      fi
      # 세션 A 는 fixture 의 준비/블로킹 절, 세션 B 는 경쟁 절을 실행한다.
      # fixture 계약: \set session_role A|B 로 분기, 전 구간 BEGIN…ROLLBACK.
      psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v session_role=A -f "$fixture" &
      local a_pid=$!
      sleep 1
      psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v session_role=B -f "$fixture"
      wait "$a_pid"
      ;;
  esac
}

for s in "${SCENARIOS[@]}"; do
  if [[ -n "$ONLY" && "$ONLY" != "$s" ]]; then continue; fi
  run_scenario "$s"
done

echo "done."
