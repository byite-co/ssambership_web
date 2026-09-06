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
# 기대치는 123본 pack(생성기 122 + PR60 1) 기준
# (tables=84 functions=230 policies=175 buckets=13)이며, PG16 스크래치 재생 실측
# (scripts/verify/local_db5_batch_check.sh [7])과 일치한다.
# (프로덕션 원장은 118본 — 20260906100100~100500 미적용 상태다. DB-4 6본은 2026-09-05 적용 완료.)
# 118본→123본(DB-5 배포 전 서버 객체 배치 + 후속 a·b·d · 2026-09-06) 델타:
#   functions +2 = plan_price_stats (20260906100100 — 요금제 평균가 · anon/authenticated 읽기)
#                + user_profile_completed (20260906100200 — 완성 전 사용자 RLS 조건 헬퍼)
#   policies  불변 — 20260906100200 은 auth.uid() 만 보는 쓰기 정책 18종을 같은 이름으로 재생성(원문 + AND user_profile_completed()).
#   (20260906100200 의 handle_new_auth_user·enforce_users_role_guard·core_private.user_profile_update_self_impl 은 본문 치환,
#    users.profile_completed_at 컬럼·CHECK 추가는 위 4개 카운트를 바꾸지 않는다. 20260906100400 의 check_review_eligibility 도 본문 치환.)
#   (20260906100200 후속 a 는 handle_new_auth_user_consent_records 본문 위임 치환, 20260906100300 후속 b 는 v2 본문 치환(계정 검사 1곳),
#    20260906100500 후속 d 는 api_web_v1.user_marketing_consent_set_self 본문 치환 — 카운트 불변.)
#   api_app_v1 +3(complete_profile · create_individual_question_as_student_v3 · review_eligibility_self) · core_private +4
#   (user_signup_provision_impl · user_consent_signup_impl · review_eligibility_impl · account_blocked_state) — 아래 [4c] census 16→19 · 8→12.
# 112본→118본(DB-4 `api_app_v1` 래퍼 배치 · 2026-09-05) 델타: 위 public 4개 카운트 **불변** —
#   신규 객체는 전부 api_app_v1(함수 +10: subscribe_with_cash · subscription_cancel_at_period_end · subscription_cancel_undo ·
#   refund_estimate · refund_request_create · mentor_activity_set · mentor_plan_active_set · user_profile_update_self_v2 ·
#   mentor_student_id_document_set_self · create_individual_question_as_student_v2)와 core_private(함수 +1:
#   subscription_refund_estimate_impl)에 만들어진다. 아래 [4c]에서 두 스키마 census 를 따로 센다(6→16 · 7→8).
# 109본→112본(DB-3 운영 DB 정리 배치 · 2026-09-03) 델타:
#   functions +2 = soft_delete_own_content (20260903230100 — 작성자 본인 소프트 삭제 RPC)
#                + ugc_block_hard_delete (20260903230300 — 세 표 BEFORE DELETE 트리거 함수)
#   policies  불변 — 20260903230200 의 정책 2종은 realtime.messages(realtime 스키마)에 붙는다.
#                public 정책 수는 세지 않는 스키마라 175 그대로(realtime 정책은 아래 [4b]에서 따로 센다).
# 106본→109본(DB-2 운영 DB 정리 배치 · 2026-09-03) 델타:
#   tables    -1 = school_tier_mappings DROP (20260903200300)
#   functions +1 = comments_sync_deleted_flag (20260903200200 — school_tier_suggest·RPC·
#                브리지·가드·RPC 4종은 본문 치환이라 카운트 불변 · 하드 DELETE 차단 트리거는 오너 결정으로 미포함)
#   policies  -1 = school_tier_mappings_admin_all 이 테이블과 함께 사라짐 (20260903200300 —
#                20260903200200 의 SELECT 정책 3종은 같은 이름으로 재생성이라 불변)
# 103본→106본(DB-1 운영 DB 정리 배치 · 2026-09-03) 델타:
#   functions +3 = school_tier_suggest + major_category_suggest
#                + school_verification_reassess_on_academic_change (20260903100300)
#                (tmp_auto_school_verification → auto_school_verification 은 drop+create 라 카운트 불변.
#                 20260903100100 은 함수 본문 치환·기본값·트리거 재생성, 20260903100200 은 본문 치환이라
#                 위 4개 카운트를 바꾸지 않는다.)
# 100본→103본(원장 화해 2본 역수입 + iM뱅크 allowlist) 델타:
#   functions +1 = tmp_auto_school_verification (20260830150838 hotfix 역수입 —
#                트리거 부착 자체는 카운트 불변)
#   (20260830140804 는 app_notices 컬럼+CHECK 추가, 20260831100100 은 F13 본문
#    치환(allowlist 16→17)이라 위 4개 카운트를 바꾸지 않는다.)
# 99본→100본(페이싱크 무통장입금 m1) 델타:
#   tables   +1 = paysync_invoices (20260830100100)
#   policies +1 = paysync_invoices_select_own — 본인 row SELECT 만 여는 정책.
#                 (billing_keys·portone_webhook_events 같은 service_role 전용
#                  테이블은 정책 0 이라 policies 를 안 바꿨지만, 이 표는 학생이
#                  '진행 중 무통장 주문'을 조회해야 해서 SELECT 정책이 1개 붙는다.)
#                 functions·buckets 는 불변(트리거는 기존 adg 함수 재사용).
# 96본→99본(TZ-FIX) 델타: 전부 함수 본문 치환이라 위 4개 카운트 불변.
# 92본→96본(정산 원천징수 hotfix 역수입) 델타:
#   functions +3 = calc_withholding_cents + mentor_settlement_lines
#                + mentor_settlement_summary (20260827100200~100300 —
#                pay_due_payouts_for_run·payout_reconciliation_report 는
#                본문 치환이라 카운트 불변)
#   (20260821100100 kind guardian 은 제약 변경, 20260827100100 은 GRANT 뿐이라
#    위 4개 카운트를 바꾸지 않는다.)
# 81본→92본(S-B sprint-pay) 델타:
#   tables   +4 = nice_auth_tokens + identity_verifications + billing_keys
#                + portone_webhook_events (20260820100100~100500 — 전부
#                RLS on·정책 0·클라이언트 GRANT 0 이라 policies 불변)
#   functions+1 = account_deletion_purge_identity_payment_artifacts (20260820100700)
#   (컬럼 추가 3본(users/payments/refunds/subscriptions)·pg_cron 스윕·adg 트리거
#    부착은 위 4개 카운트를 바꾸지 않는다. 버킷 신설 0 — buckets 불변.)
# 79본→81본 델타:
#   functions +1 = my_blocked_users(S5-1/QA-C7 — 차단 목록 닉네임 정의자 RPC)
#   (S3-1/QA-B6 의 list_open_individual_questions_for_mentor 는 반환 컬럼이 늘어
#    drop 후 재생성한 것이라 함수 수는 변하지 않는다 — 20260807010000)
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
count_check tables 84 "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
                       where n.nspname='public' and c.relkind='r'"
count_check functions 230 "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                           where n.nspname='public'"
count_check policies 175 "select count(*) from pg_policies where schemaname='public'"
count_check buckets 13 "select count(*) from storage.buckets"

echo "=== [4b] realtime.messages 정책 (20260903230200 — admin:* 토픽 관리자 전용 2종)"
count_check realtime_messages_policies 2 "select count(*) from pg_policies where schemaname='realtime' and tablename='messages'
                                          and policyname in ('realtime_admin_topic_select','realtime_admin_topic_insert')"

echo "=== [4c] api_app_v1 · core_private 함수 census (DB-4 20260905100100~100600 앱 래퍼 10 + 환불 impl 1 · DB-5 20260906100200/100300/100400 +3 · core_private impl +4)"
count_check api_app_v1_functions 19 "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='api_app_v1'"
count_check core_private_functions 12 "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='core_private'"
q "select p.proname||'|anon='||has_function_privilege('anon',p.oid,'EXECUTE')::text
     ||'|auth='||has_function_privilege('authenticated',p.oid,'EXECUTE')::text
     ||'|svc='||has_function_privilege('service_role',p.oid,'EXECUTE')::text
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='api_app_v1' order by 1" | tee "$EV/api_app_v1_fn_acl.txt"
if grep -qE 'anon=true|svc=true' "$EV/api_app_v1_fn_acl.txt" || grep -qv 'auth=true' "$EV/api_app_v1_fn_acl.txt"; then
  bad "api_app_v1 함수 ACL 은 authenticated 만이어야 한다(anon 0 · service_role 0)"
else
  say "api_app_v1 함수 19/19: authenticated 만 · anon/service_role 없음"
fi

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
