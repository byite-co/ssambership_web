#!/usr/bin/env bash
# check_pr60_native_migration_sync.sh — PR #60 guard SQL 의 source ↔ 정식 migration 경로 동기화 검사.
#
# PR #60 은 두 곳에 같은 SQL 을 둔다:
#   supabase/sql/20260804113000_iq_attachment_message_author_guard.sql        (리뷰 정본)
#   supabase/migrations/20260804113000_iq_attachment_message_author_guard.sql (실행 정본)
# 둘은 byte 단위로 동일해야 한다. 한쪽만 고치면 이 검사가 실패한다.
#
# PR #60 branch 에는 이 migration 1개만 있는 것이 정상이다 — 나머지 63개는 PR #61 소유이며
# PR #61 이 main 에 병합된 뒤에야 같은 디렉터리에서 합쳐진다.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VERSION=20260804113000
NAME=iq_attachment_message_author_guard
SRC="$REPO/supabase/sql/${VERSION}_${NAME}.sql"
MIG="$REPO/supabase/migrations/${VERSION}_${NAME}.sql"
RB="$REPO/supabase/rollback/${VERSION}_${NAME}_rollback.sql"

fail=0
say(){ printf '  %s\n' "$*"; }
bad(){ printf 'FAIL: %s\n' "$*"; fail=1; }

[ -f "$SRC" ] && say "source 존재: supabase/sql/${VERSION}_${NAME}.sql" || bad "source 없음: $SRC"
[ -f "$MIG" ] && say "migration 존재: supabase/migrations/${VERSION}_${NAME}.sql" || bad "migration 없음: $MIG"
[ -f "$RB" ]  && say "rollback 존재" || bad "rollback 없음: $RB"

if [ -f "$SRC" ] && [ -f "$MIG" ]; then
  s=$(sha256sum "$SRC" | cut -d' ' -f1)
  m=$(sha256sum "$MIG" | cut -d' ' -f1)
  if [ "$s" = "$m" ]; then say "SHA-256 일치: ${s:0:16}…"; else bad "SHA-256 불일치: source=$s migration=$m"; fi
  ss=$(wc -c <"$SRC"); ms=$(wc -c <"$MIG")
  [ "$ss" = "$ms" ] && say "size 일치: ${ss}B" || bad "size 불일치: $ss vs $ms"
fi

# migration 디렉터리에 같은 version 이 중복 존재하면 안 된다
if [ -d "$REPO/supabase/migrations" ]; then
  cnt=$(ls "$REPO/supabase/migrations"/${VERSION}_*.sql 2>/dev/null | wc -l)
  [ "$cnt" = "1" ] && say "version $VERSION migration 정확히 1개" || bad "version $VERSION migration $cnt 개"
fi

# fixture 존재 (PR #60 계약 검증 harness)
fx=$(ls "$REPO"/scripts/verify/fixtures/iq_attachment*fixture*.sql 2>/dev/null | wc -l)
[ "$fx" -ge 1 ] && say "fixture 존재 ($fx)" || bad "fixture 없음"

# guard 마커가 실제 SQL 에 있는지 (계약 회귀 방지)
if [ -f "$MIG" ]; then
  grep -q "MESSAGE_AUTHOR_MISMATCH" "$MIG" && say "MESSAGE_AUTHOR_MISMATCH 가드 존재" \
    || bad "migration 에 MESSAGE_AUTHOR_MISMATCH 가드가 없다"
fi

echo
if [ "$fail" = 0 ]; then echo "PR60_NATIVE_MIGRATION_SYNC: PASS"; exit 0
else echo "PR60_NATIVE_MIGRATION_SYNC: FAIL"; exit 1; fi
