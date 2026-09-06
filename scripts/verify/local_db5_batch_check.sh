#!/usr/bin/env bash
# local_db5_batch_check.sh — DB-5 배포 전 서버 객체 배치(205 요금제 평균가 · 206 가입 트리거 소셜 대응+프로필 완성 RPC · 207 개별질문 v3 · 208 리뷰 자격 정본화)를
#   오프라인 스크래치 PG16(UTF8)에서 실구동 검증한다. 운영·staging 에는 접속하지 않는다.
#
# 흐름:
#   [0] platform stub → [1] pack 적용(DB-5 = 20260906100100~100400 제외 전부 = 운영 원장 118본 상태)
#   → [2] pre fixture(운영 형태 재현 + 현재 동작 실측: app_role 없는 가입의 student 폴백 · 170 느슨한 자격 · v2 banned 결과)
#   → [3] 205 → 208 순 적용 → [4] post fixture(A 평균가 3값·fallback · B 소셜/이메일 가입·완성 전 RLS · C 완성 RPC · D v3 · E 자격 · G 불변, 전부 rollback)
#   → [4b] forward 기간 데이터(D1 소셜 가입 → complete_profile 완성 · 찜 1건 · D2 소셜 가입만 · COMMIT)
#   → [5] rollback 208 → 207 → **206 은 D2(미완성 · role NULL)가 있어 게이트에서 중단**돼야 한다 → D2 완성 → 206 → 205 → rollback fixture
#   → [6] 205~208 재적용 → post fixture 재실행 → [7] 구조 카운트.
#
# 사용: scripts/verify/local_db5_batch_check.sh   (EVIDENCE_DIR 로 증적 경로 지정 가능)
set -uo pipefail

PGBIN=/usr/lib/postgresql/16/bin
[[ -x "$PGBIN/initdb" ]] || { echo "SKIP: PostgreSQL 16 서버 바이너리 없음($PGBIN)" >&2; exit 0; }

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PACK="$REPO/supabase/migrations"
FX="$REPO/scripts/verify/fixtures"
RB="$REPO/supabase/rollback"
DB5_VERSIONS=(20260906100100 20260906100200 20260906100300 20260906100400)
EV="${EVIDENCE_DIR:-$(mktemp -d /tmp/db5-evidence-XXXX)}"
mkdir -p "$EV"

WORK="$(mktemp -d /tmp/db5check-XXXX)"
if id postgres >/dev/null 2>&1; then AS=postgres; else AS=nobody; fi
chown -R $AS "$WORK"
RUN=(setpriv --reuid $AS --regid $AS --clear-groups env \
     PGOPTIONS="-csearch_path=\"\$user\",public,extensions,pg17shim,pg_catalog -cclient_min_messages=notice")
cleanup(){ "${RUN[@]}" $PGBIN/pg_ctl -D "$WORK/data" stop -m immediate >/dev/null 2>&1; rm -rf "$WORK"; }
trap cleanup EXIT

# 운영(Supabase)과 같은 UTF8 로 초기화한다(DB-4 에서 확립 — 한글 길이 규칙 검증에 필요).
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
apply_expect_fail(){ # apply_expect_fail <label> <file> <expected-substring>
  cp "$2" "$WORK/c.sql"; chown $AS "$WORK/c.sql"
  if "${PSQL[@]}" -f "$WORK/c.sql" >"$EV/$1.log" 2>&1; then
    echo "FAIL: $1 — 실패해야 하는데 성공했다"; exit 3
  fi
  if grep -q "$3" "$EV/$1.log"; then echo "  ok  $1 (기대대로 중단: $3)"; else echo "FAIL: $1 — 기대 메시지($3) 없음"; grep -m4 -E "ERROR|DETAIL" "$EV/$1.log"; exit 3; fi
}
run_sql(){ # run_sql <label> <sql-text>
  printf '%s\n' "$2" > "$WORK/r.sql"; chown $AS "$WORK/r.sql"
  if "${PSQL[@]}" -f "$WORK/r.sql" >"$EV/$1.log" 2>&1; then echo "  ok  $1"; else echo "FAIL: $1 — $EV/$1.log"; grep -m6 -E "ERROR|DETAIL|CONTEXT|FAIL" "$EV/$1.log"; exit 2; fi
}

is_db5(){ local v; v="$(basename "$1" | cut -c1-14)"; for d in "${DB5_VERSIONS[@]}"; do [ "$v" = "$d" ] && return 0; done; return 1; }
db5_file(){ ls "$PACK"/"$1"_*.sql; }
rb_file(){ ls "$RB"/"$1"_*_rollback.sql; }

echo "[0] platform stub"
apply 00_stub "$REPO/scripts/verify/baseline/platform_stub.sql"

echo "[1] pack 적용 — DB-5(20260906100100~100400) 이전 전부(DB-1~4 포함 = 운영 원장 118본 상태)"
n=0
for f in $(ls "$PACK"/*.sql | sort); do
  is_db5 "$f" && continue
  n=$((n+1)); apply "$(printf 'mig_%03d_%s' $n "$(basename "$f" | cut -c1-14)")" "$f" >/dev/null || exit 2
done
echo "  ok  pre-DB5 migrations applied: $n"
[ "$n" = 118 ] || { echo "FAIL: pre-DB5 pack 이 118본이 아니다($n)"; exit 2; }

echo "[2] pre fixture (운영 형태 재현 + 현재 동작 실측)"
apply 10_pre_fixture "$FX/db5_batch_pre_fixture.sql"
grep -E "^(PRE|NOTICE)" "$EV/10_pre_fixture.log" | sed 's/^/     /' || true

echo "[3] DB-5 적용: 205 → 206 → 207 → 208"
for v in "${DB5_VERSIONS[@]}"; do apply "20_forward_$v" "$(db5_file "$v")"; done

echo "[4] post fixture (A~G assertion — 전부 rollback)"
apply 30_post_fixture "$FX/db5_batch_post_fixture.sql"
grep -E "^(POST|NOTICE)" "$EV/30_post_fixture.log" | sed 's/^/     /' || true
grep -q "DB5 POST FIXTURE PASS" "$EV/30_post_fixture.log" || { echo "FAIL: POST FIXTURE PASS 미확인"; exit 3; }
echo "  assertions: $(grep -c 'POST ok' "$EV/30_post_fixture.log")"

echo "[4b] forward 기간 데이터 — D1 소셜 가입 → complete_profile(학생) → 찜 1건 · D2 소셜 가입만(미완성) · COMMIT"
run_sql 35_forward_data "$(cat <<'SQL'
begin;
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-00000000d5d1', 'authenticated', 'authenticated', 'fwd-d1@test.local',
   '{"iss":"https://accounts.google.com","sub":"g1","name":"포워드원","email":"fwd-d1@test.local","email_verified":true,"provider_id":"g1"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-00000000d5d2', 'authenticated', 'authenticated', 'fwd-d2@test.local',
   '{"iss":"https://kauth.kakao.com","sub":"k2","name":"포워드투","email":"fwd-d2@test.local","provider_id":"k2"}'::jsonb, now(), now());
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000d5d1', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d5d1","role":"authenticated"}', true);
do $$ declare r jsonb; begin
  r := api_app_v1.complete_profile('student', '포워드닉', '2008-02-02', true, false, '고3', null, null);
  if not coalesce((r->>'ok')::boolean, false) then raise exception 'FORWARD_DATA_FAIL %', r; end if;
  raise notice 'FWD D1 %', r;
end $$;
insert into public.favorites (user_id, mentor_id) values ('00000000-0000-4000-8000-00000000d5d1', '00000000-0000-4000-8000-00000000d5a1');
reset role;
do $$ begin
  if (select role from public.users where id = '00000000-0000-4000-8000-00000000d5d2') is not null then raise exception 'FWD D2 는 role NULL 이어야 한다'; end if;
  raise notice 'FWD D2 role NULL · profile_completed_at NULL (미완성 유지)';
end $$;
commit;
SQL
)"
grep -E "NOTICE:  FWD" "$EV/35_forward_data.log" | sed 's/^/     /' | cut -c1-200 || true

echo "[5] rollback: 208 → 207 → 206(게이트 중단 기대) → D2 완성 → 206 → 205 + 복원 assertion"
apply 40_rollback_20260906100400 "$(rb_file 20260906100400)"
apply 40_rollback_20260906100300 "$(rb_file 20260906100300)"
apply_expect_fail 41_rollback_206_blocked "$(rb_file 20260906100200)" "206_ROLLBACK_GATE"
run_sql 42_complete_d2 "$(cat <<'SQL'
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000d5d2', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d5d2","role":"authenticated"}', true);
do $$ declare r jsonb; begin
  r := api_app_v1.complete_profile('mentor', '포워드멘토', '1998-07-07', true, false, null, '고려대학교', '경제학과');
  if not coalesce((r->>'ok')::boolean, false) then raise exception 'D2_COMPLETE_FAIL %', r; end if;
  raise notice 'FWD D2 완성 %', r;
end $$;
reset role;
commit;
SQL
)"
apply 43_rollback_20260906100200 "$(rb_file 20260906100200)"
apply 43_rollback_20260906100100 "$(rb_file 20260906100100)"
apply 50_rollback_fixture "$FX/db5_batch_rollback_fixture.sql"
grep -E "^(RB|NOTICE)" "$EV/50_rollback_fixture.log" | sed 's/^/     /' || true
grep -q "DB5 ROLLBACK FIXTURE PASS" "$EV/50_rollback_fixture.log" || { echo "FAIL: ROLLBACK FIXTURE PASS 미확인"; exit 4; }

echo "[6] 재적용 205 → 208 + post fixture 재실행"
for v in "${DB5_VERSIONS[@]}"; do apply "60_reapply_$v" "$(db5_file "$v")"; done
apply 70_post_fixture_again "$FX/db5_batch_post_fixture.sql"
grep -q "DB5 POST FIXTURE PASS" "$EV/70_post_fixture_again.log" || { echo "FAIL: 재적용 후 POST FIXTURE PASS 미확인"; exit 5; }

echo "[7] 구조 카운트 (verify_local_stack_state.sh 기대치 대조용)"
"${RUN[@]}" $PGBIN/psql -h "$WORK" -U postgres -d postgres -At -c \
 "select 'tables='||(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r')
   ||' functions='||(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public')
   ||' policies='||(select count(*) from pg_policies where schemaname='public')
   ||' buckets='||(select count(*) from storage.buckets)
   ||' api_app_v1_functions='||(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='api_app_v1')
   ||' core_private_functions='||(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='core_private')" | tee "$EV/structure_counts.txt"

echo
echo "DB5_LOCAL_CHECK_OK evidence=$EV"
