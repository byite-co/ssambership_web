#!/usr/bin/env bash
# local_db4_batch_check.sh — DB-4 `api_app_v1` 래퍼 배치(199 구독 결제·해지 예약 · 200 환불 · 201 활동 상태 · 202 요금제 활성 · 203 재학 상태·학생증 · 204 개별질문 과목)를
#   오프라인 스크래치 PG16 에서 실구동 검증한다. 운영·staging 에는 접속하지 않는다.
#
# 흐름:
#   [0] platform stub → [1] pack 적용(DB-4 = 20260905100100~100600 제외 전부 = 운영 원장 112본 상태)
#   → [2] pre fixture(운영 형태 재현 + §6 사전 실측 + **앱 현재 불가 7종 실측**(구독 UPDATE 0행 · refunds RLS 거부 · F12 42501 · users/mentor_plans/mentor_profiles 권한 거부))
#   → [3] 199 → 204 순 적용 → [4] post fixture(A 구독 결제·멱등·해지 예약 · B 환불(별표 4 경계값 8종 TS 대조) · C 활동 상태 · D 요금제 활성 · E 재학 상태·학생증 · F 개별질문 v2 · G 불변, 전부 rollback)
#   → [4b] forward 기간 데이터(S4 가 앱 래퍼로 M1 라이트 구독 · COMMIT) → [4c] 2세션 동시 같은 키 재시도(S5 · advisory lock → 두 번째는 재생 · 차감 1회)
#   → [4d] 환불 계산 TS 대조(node 로 웹 정본 실행 → PARITY_TSV 줄 단위 diff · node 없으면 SKIP · SQL 픽스처의 내장 기대값은 항상 검증)
#   → [5] rollback 204 → 199 → rollback fixture → [6] 199~204 재적용 → post fixture 재실행 → [7] 구조 카운트.
#
# 사용: scripts/verify/local_db4_batch_check.sh   (EVIDENCE_DIR 로 증적 경로 지정 가능)
set -uo pipefail

PGBIN=/usr/lib/postgresql/16/bin
[[ -x "$PGBIN/initdb" ]] || { echo "SKIP: PostgreSQL 16 서버 바이너리 없음($PGBIN)" >&2; exit 0; }

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PACK="$REPO/supabase/migrations"
FX="$REPO/scripts/verify/fixtures"
RB="$REPO/supabase/rollback"
DB4_VERSIONS=(20260905100100 20260905100200 20260905100300 20260905100400 20260905100500 20260905100600)
EV="${EVIDENCE_DIR:-$(mktemp -d /tmp/db4-evidence-XXXX)}"
mkdir -p "$EV"

WORK="$(mktemp -d /tmp/db4check-XXXX)"
if id postgres >/dev/null 2>&1; then AS=postgres; else AS=nobody; fi
chown -R $AS "$WORK"
RUN=(setpriv --reuid $AS --regid $AS --clear-groups env \
     PGOPTIONS="-csearch_path=\"\$user\",public,extensions,pg17shim,pg_catalog -cclient_min_messages=notice")
cleanup(){ "${RUN[@]}" $PGBIN/pg_ctl -D "$WORK/data" stop -m immediate >/dev/null 2>&1; rm -rf "$WORK"; }
trap cleanup EXIT

# 운영(Supabase)과 같은 UTF8 로 초기화한다 — DB-1~3 스크립트의 기본 initdb 는 이 컨테이너에서 SQL_ASCII 가 되어
# char_length('짧다') = 6 처럼 한글 길이 규칙(사유 5자 · 재학 상태 20자)을 잘못 통과시킨다(DB-4 에서 발견 · 이전 배치 결과에는 영향 없음).
"${RUN[@]}" $PGBIN/initdb -D "$WORK/data" -A trust -U postgres -E UTF8 --locale=C.utf8 >/dev/null 2>&1 \
  || "${RUN[@]}" $PGBIN/initdb -D "$WORK/data" -A trust -U postgres -E UTF8 --no-locale >/dev/null
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
run_sql(){ # run_sql <label> <sql-text>
  printf '%s\n' "$2" > "$WORK/r.sql"; chown $AS "$WORK/r.sql"
  if "${PSQL[@]}" -f "$WORK/r.sql" >"$EV/$1.log" 2>&1; then echo "  ok  $1"; else echo "FAIL: $1 — $EV/$1.log"; grep -m6 -E "ERROR|DETAIL|CONTEXT|FAIL" "$EV/$1.log"; exit 2; fi
}

is_db4(){ local v; v="$(basename "$1" | cut -c1-14)"; for d in "${DB4_VERSIONS[@]}"; do [ "$v" = "$d" ] && return 0; done; return 1; }
db4_file(){ ls "$PACK"/"$1"_*.sql; }
rb_file(){ ls "$RB"/"$1"_*_rollback.sql; }

echo "[0] platform stub"
apply 00_stub "$REPO/scripts/verify/baseline/platform_stub.sql"

echo "[1] pack 적용 — DB-4(20260905100100~100600) 이전 전부(DB-1·2·3 포함 = 운영 원장 112본 상태)"
n=0
for f in $(ls "$PACK"/*.sql | sort); do
  is_db4 "$f" && continue
  n=$((n+1)); apply "$(printf 'mig_%03d_%s' $n "$(basename "$f" | cut -c1-14)")" "$f" >/dev/null || exit 2
done
echo "  ok  pre-DB4 migrations applied: $n"

echo "[2] pre fixture (운영 형태 재현 + §6 사전 실측 + 앱 현재 불가 7종)"
apply 10_pre_fixture "$FX/db4_batch_pre_fixture.sql"
grep -E "^(PRE|NOTICE)" "$EV/10_pre_fixture.log" | sed 's/^/     /' || true

echo "[3] DB-4 적용: 199 → 200 → 201 → 202 → 203 → 204"
for v in "${DB4_VERSIONS[@]}"; do apply "20_forward_$v" "$(db4_file "$v")"; done

echo "[4] post fixture (A~G assertion — 전부 rollback)"
apply 30_post_fixture "$FX/db4_batch_post_fixture.sql"
grep -E "^(POST|NOTICE)" "$EV/30_post_fixture.log" | sed 's/^/     /' || true
grep -q "DB4 POST FIXTURE PASS" "$EV/30_post_fixture.log" || { echo "FAIL: POST FIXTURE PASS 미확인"; exit 3; }
echo "  assertions: $(grep -c 'POST ok' "$EV/30_post_fixture.log")"

echo "[4b] forward 기간 데이터 — S4 가 앱 래퍼로 M1 라이트 구독 (COMMIT · rollback 후 유지 검증용)"
run_sql 35_forward_data "$(cat <<'SQL'
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000d4b4', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d4b4","role":"authenticated"}', true);
do $$ declare r jsonb; begin
  r := api_app_v1.subscribe_with_cash('00000000-0000-4000-8000-00000000d4a1', 'limited', 'K-fwd-s4');
  if not coalesce((r->>'ok')::boolean, false) then raise exception 'FORWARD_DATA_FAIL %', r; end if;
  raise notice 'FWD %', r;
end $$;
reset role;
commit;
SQL
)"
grep -E "NOTICE:  FWD" "$EV/35_forward_data.log" | sed 's/^/     /' | cut -c1-200 || true

echo "[4c] 2세션 동시 같은 멱등 키 재시도 — S5 → M1 라이트 (advisory lock: 두 번째는 첫 결과 재생 · 차감 1회)"
for i in A B; do
  cat > "$WORK/conc_$i.sql" <<SQL
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000d4b5', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d4b5","role":"authenticated"}', true);
select api_app_v1.subscribe_with_cash('00000000-0000-4000-8000-00000000d4a1', 'limited', 'K-conc') as result_$i;
$( [ "$i" = A ] && echo "select pg_sleep(3);" )
reset role;
commit;
SQL
  chown $AS "$WORK/conc_$i.sql"
done
"${RUN[@]}" $PGBIN/psql -h "$WORK" -U postgres -d postgres -v ON_ERROR_STOP=1 -At -f "$WORK/conc_A.sql" >"$EV/36_conc_A.log" 2>&1 &
PA=$!
sleep 1
"${RUN[@]}" $PGBIN/psql -h "$WORK" -U postgres -d postgres -v ON_ERROR_STOP=1 -At -f "$WORK/conc_B.sql" >"$EV/36_conc_B.log" 2>&1 &
PB=$!
wait $PA; RA=$?; wait $PB; RB_=$?
[ "$RA" = 0 ] && [ "$RB_" = 0 ] || { echo "FAIL: 동시성 세션 오류 (A=$RA B=$RB_)"; cat "$EV/36_conc_A.log" "$EV/36_conc_B.log"; exit 2; }
grep -q '"idempotent": false' "$EV/36_conc_A.log" && grep -q '"idempotent": true' "$EV/36_conc_B.log" \
  && echo "  ok  36_conc: A 최초(idempotent false) · B 재생(idempotent true)" \
  || { echo "FAIL: 동시성 결과 불일치"; cat "$EV/36_conc_A.log" "$EV/36_conc_B.log"; exit 3; }
CONC="$("${RUN[@]}" $PGBIN/psql -h "$WORK" -U postgres -d postgres -At -c \
  "select (select count(*) from public.cash_ledger where user_id='00000000-0000-4000-8000-00000000d4b5' and reason='subscription_payment')
       ||'|'||(select balance_cents from public.cash_wallets where user_id='00000000-0000-4000-8000-00000000d4b5')
       ||'|'||(select count(*) from public.payments where external_id='sub_app_K-conc')
       ||'|'||(select count(*) from public.subscriptions where student_id='00000000-0000-4000-8000-00000000d4b5' and mentor_id='00000000-0000-4000-8000-00000000d4a1' and status='active')")"
[ "$CONC" = "1|2010000|1|1" ] && echo "  ok  36_conc: 원장 1 · 잔액 2,010,000 · 결제 1 · 구독 1 (이중 차감 0)" || { echo "FAIL: 동시성 상태 $CONC (기대 1|2010000|1|1)"; exit 3; }

echo "[4d] 환불 계산 웹 TS 대조 (node --experimental-strip-types 로 정본 실행 → PARITY_TSV 대조)"
grep -o 'PARITY_TSV .*' "$EV/30_post_fixture.log" | sed 's/^PARITY_TSV //' | sort > "$EV/parity_sql.tsv"
if command -v node >/dev/null 2>&1 && (cd "$REPO" && node --experimental-strip-types scripts/verify/db4_refund_parity_expected.mjs 2>/dev/null | sort > "$EV/parity_ts.tsv"); then
  if diff -u "$EV/parity_ts.tsv" "$EV/parity_sql.tsv" > "$EV/parity_diff.txt"; then
    echo "  ok  parity: SQL ↔ TS $(wc -l < "$EV/parity_sql.tsv")/8 케이스 일치"
  else
    echo "FAIL: 환불 계산 SQL ↔ TS 불일치 — $EV/parity_diff.txt"; cat "$EV/parity_diff.txt"; exit 3
  fi
else
  echo "  SKIP parity(node 없음) — SQL 픽스처의 내장 기대값 8종은 [4]에서 검증됨"
fi

echo "[5] rollback: 204 → 203 → 202 → 201 → 200 → 199 + 복원 assertion"
for v in 20260905100600 20260905100500 20260905100400 20260905100300 20260905100200 20260905100100; do apply "40_rollback_$v" "$(rb_file "$v")"; done
apply 50_rollback_fixture "$FX/db4_batch_rollback_fixture.sql"
grep -E "^(RB|NOTICE)" "$EV/50_rollback_fixture.log" | sed 's/^/     /' || true
grep -q "DB4 ROLLBACK FIXTURE PASS" "$EV/50_rollback_fixture.log" || { echo "FAIL: ROLLBACK FIXTURE PASS 미확인"; exit 4; }

echo "[6] 재적용 199 → 204 + post fixture 재실행"
for v in "${DB4_VERSIONS[@]}"; do apply "60_reapply_$v" "$(db4_file "$v")"; done
apply 70_post_fixture_again "$FX/db4_batch_post_fixture.sql"
grep -q "DB4 POST FIXTURE PASS" "$EV/70_post_fixture_again.log" || { echo "FAIL: 재적용 후 POST FIXTURE PASS 미확인"; exit 5; }

echo "[7] 구조 카운트 (verify_local_stack_state.sh 기대치 대조용)"
"${RUN[@]}" $PGBIN/psql -h "$WORK" -U postgres -d postgres -At -c \
 "select 'tables='||(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r')
   ||' functions='||(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public')
   ||' policies='||(select count(*) from pg_policies where schemaname='public')
   ||' buckets='||(select count(*) from storage.buckets)
   ||' api_app_v1_functions='||(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='api_app_v1')
   ||' core_private_functions='||(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='core_private')" | tee "$EV/structure_counts.txt"

echo
echo "DB4_LOCAL_CHECK_OK evidence=$EV"
