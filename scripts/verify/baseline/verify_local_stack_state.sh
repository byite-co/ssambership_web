#!/usr/bin/env bash
# verify_local_stack_state.sh — `supabase start` 로 뜬 로컬 스택(PostgreSQL 17)에서
# migration runner 가 실제로 pack 을 적용했는지, 결과 구조·ACL 이 기대와 같은지 검증한다.
#
# 전제: 호출 전에 `supabase start` 가 성공했고 DB 가 127.0.0.1:54322 에 있다.
# 대상: 로컬 컨테이너 DB 뿐이다. 부모/원격 프로젝트에는 접속하지 않는다.
#
# 증거는 pg17-evidence/ 에 남긴다(워크플로가 artifact 로 올린다).
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
EV="${EVIDENCE_DIR:-$REPO/pg17-evidence}"
DB_URL="${LOCAL_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
mkdir -p "$EV"

fail=0
say(){ printf '  ok  %s\n' "$*"; }
bad(){ printf 'FAIL: %s\n' "$*"; fail=1; }
q(){ psql "$DB_URL" -At -v ON_ERROR_STOP=1 -c "$1"; }

command -v psql >/dev/null 2>&1 || { echo "FAIL: psql 이 없다"; exit 1; }
q 'select 1' >/dev/null 2>&1 || { echo "FAIL: 로컬 스택 DB 에 접속할 수 없다 ($DB_URL)"; exit 1; }

echo "=== [1] 서버 버전"
SRV="$(q 'show server_version')"
echo "server_version=$SRV" | tee "$EV/server_version.txt"
case "$SRV" in
  17*) say "PostgreSQL 17 (config.toml major_version=17 과 일치)";;
  *)   bad "server_version=$SRV — 17 이어야 한다";;
esac

echo "=== [2] migration history ↔ 파일 대조"
# 기대값을 하드코딩하지 않는다. 저장소의 실제 migration 파일에서 유도한다.
ls "$REPO"/supabase/migrations/*.sql | xargs -n1 basename | cut -c1-14 | sort > "$EV/expected_versions.txt"
EXPECT_N=$(wc -l < "$EV/expected_versions.txt")
q "select version from supabase_migrations.schema_migrations order by version" | sort > "$EV/applied_versions.txt"
APPLIED_N=$(wc -l < "$EV/applied_versions.txt")
echo "migration files=$EXPECT_N  applied=$APPLIED_N"
[ "$EXPECT_N" -ge 63 ] || bad "migration 파일 $EXPECT_N 개 — pack(63본) 이상이어야 한다"
if diff -u "$EV/expected_versions.txt" "$EV/applied_versions.txt" > "$EV/version_diff.txt"; then
  say "적용된 version 집합이 파일 집합과 정확히 일치 ($APPLIED_N)"
else
  bad "migration history 가 파일과 다르다 — pg17-evidence/version_diff.txt"
  head -20 "$EV/version_diff.txt"
fi
FIRST="$(head -1 "$EV/applied_versions.txt")"
[ "$FIRST" = "20260701000000" ] && say "첫 version = baseline 20260701000000" \
  || bad "첫 적용 version 이 $FIRST — 20260701000000 이어야 한다"

echo "=== [3] 열린 트랜잭션"
OPEN="$(q "select count(*) from pg_stat_activity where state='idle in transaction'")"
echo "open_transactions=$OPEN"
[ "$OPEN" = "0" ] || bad "idle in transaction $OPEN 건 — baseline 내부 BEGIN/COMMIT 누수 의심"

echo "=== [4] 구조 카운트"
# 기대치는 79본 pack(생성기 78 + PR60 1)의 PG16 로컬 fresh replay 실측
# (tables=80 functions=216 policies=175 buckets=13)이며, PG17 CLI 재생에서도
# 같은 값이 재현된다.
# 72본→79본(S1 배치) 델타:
#   functions +2 = account_deletion_state_blocked(S1-1/QA-A1)
#                + content_reports_dedupe_open(S1-3/QA-B4)
#   policies  -2 = community_posts SELECT 3중 중복 정책을 1개로 통합
#                  (S1-2/QA-A4 — deleted_at 필터 누락 재발 방지)
# ※ S1-1 은 adg_* 가드 트리거 6종을 BEFORE→AFTER 로 옮긴다(탈퇴상태 오라클 차단).
#    트리거 재생성이라 위 4개 카운트는 바뀌지 않는다.
# ※ S1-8(차단 목록 닉네임 뷰)은 오너 판단으로 S3 로 미뤘다 — api_web_v1 의
#    SECURITY DEFINER 뷰는 계약대로 mentor_directory_v1 1종을 유지한다.
# 64본 체계(79/213/178) 대비 델타는 post_ledger_backfill 8본으로 전부 설명된다:
#   tables   +1  community_post_view_events            (20260806033556)
#   functions+1  community_post_view_record_v2          (20260806033556;
#                report_target_content_valid 는 생성(20260806033833) 후
#                rls_private 이동·public drop(20260806075316)으로 상쇄)
#   policies -1  post_reactions select 정책 2본 drop → 1본 통합 (20260806033409)
# 불일치는 즉시 실패로 보고해 사람이 원인을 판정하게 한다(자동 허용 폭 없음).
: > "$EV/structure_counts.txt"
count_check(){ # count_check <label> <expected> <sql>
  local got; got="$(q "$3")"
  echo "$1=$got" >> "$EV/structure_counts.txt"
  [ "$got" = "$2" ] && say "$1=$got" || bad "$1=$got — PG16 replay 실측 기대치 $2 와 다르다"
}
count_check tables 80 "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
                       where n.nspname='public' and c.relkind='r'"
count_check functions 216 "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                           where n.nspname='public'"
count_check policies 175 "select count(*) from pg_policies where schemaname='public'"
count_check buckets 13 "select count(*) from storage.buckets"

echo "=== [5] M13 trigger function ACL (anon/authenticated EXECUTE 불가)"
q "select p.proname||'|'||coalesce(p.proacl::text,'(null)')
     ||'|anon='||has_function_privilege('anon',p.oid,'EXECUTE')::text
     ||'|auth='||has_function_privilege('authenticated',p.oid,'EXECUTE')::text
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public'
     and p.proname in ('comments_set_author_label','community_comments_set_author_label')
   order by 1" | tee "$EV/m13_trigger_fn_acl.txt"
M13_N=$(wc -l < "$EV/m13_trigger_fn_acl.txt")
[ "$M13_N" = "2" ] || bad "M13 trigger function 이 $M13_N 개 조회됐다 (2 기대)"
if grep -qE 'anon=true|auth=true' "$EV/m13_trigger_fn_acl.txt"; then
  bad "M13 trigger function 에 anon/authenticated EXECUTE 가 남아 있다"
else
  say "M13 trigger function: anon/authenticated EXECUTE 없음"
fi

echo "=== [6] mentor function ACL (anon/auth NO · service_role YES)"
q "select p.proname||'|anon='||has_function_privilege('anon',p.oid,'EXECUTE')::text
     ||'|auth='||has_function_privilege('authenticated',p.oid,'EXECUTE')::text
     ||'|svc='||has_function_privilege('service_role',p.oid,'EXECUTE')::text
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname in
     ('mentor_directory_list','mentor_profiles_for_directory','mentor_user_public')
   order by 1" | tee "$EV/mentor_fn_acl.txt"
MN=$(wc -l < "$EV/mentor_fn_acl.txt")
[ "$MN" = "3" ] || bad "mentor function 이 $MN 개 조회됐다 (3 기대)"
if grep -qE 'anon=true|auth=true' "$EV/mentor_fn_acl.txt"; then
  bad "mentor function 에 anon/authenticated EXECUTE 가 남아 있다"
elif [ "$(grep -c 'svc=true' "$EV/mentor_fn_acl.txt")" != "3" ]; then
  bad "mentor function 3개 모두 service_role EXECUTE 여야 한다"
else
  say "mentor function 3/3: anon·authenticated 없음 · service_role 있음"
fi

echo "=== [7] baseline 함수 본문 지문 (PR #60 적용 전 상태)"
FNMD5="$(q "select md5(prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
            where n.nspname='public' and p.proname='add_individual_question_attachment'")"
echo "add_individual_question_attachment md5=$FNMD5" | tee "$EV/iq_attachment_fn_md5.txt"
if ls "$REPO"/supabase/migrations/20260804113000_*.sql >/dev/null 2>&1; then
  say "PR #60 migration 포함 pack — 함수 본문은 guard 적용본이다(md5 기록만 남긴다)"
else
  [ "$FNMD5" = "58f0c2411d40b2ce3bcec23efa0c88a1" ] \
    && say "PR #60 미적용 baseline 본문 md5 일치" \
    || bad "md5=$FNMD5 — PG16 replay 실측 58f0c2411d40b2ce3bcec23efa0c88a1 와 다르다"
fi

echo "=== [8] 전체 인벤토리 덤프"
psql "$DB_URL" -At -v ON_ERROR_STOP=1 -f "$REPO/scripts/verify/baseline/local_inventory.sql" \
  > "$EV/inventory.json" 2>"$EV/inventory.err" \
  && say "inventory.json 기록" || { bad "inventory 덤프 실패"; head -3 "$EV/inventory.err"; }

echo
if [ "$fail" = 0 ]; then echo "LOCAL_STACK_STATE: PASS"; exit 0
else echo "LOCAL_STACK_STATE: FAIL"; exit 1; fi
