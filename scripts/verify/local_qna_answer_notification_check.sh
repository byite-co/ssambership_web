#!/usr/bin/env bash
# local_qna_answer_notification_check.sh — 오프라인 스크래치 PG16 에서 F2(D-12) 질문방
# 답변 알림 계약(행 단위 exactly-once)을 실구동 검증.
#
# 하는 일:
#   1) 임시 클러스터 initdb/start (unix socket 전용 — 네트워크 미개방, 종료 시 전부 삭제)
#   2) 스텁 스키마(qna_stub_schema.sql) 적용
#   3) 기준선 정본 SQL 적용: 132 → 136 → 139 → 141 → 142 → 144
#   4) [D-12 재현] 기준선에서 두 번째 멘토 답변이 알림을 못 만드는 결함을 실측
#   5) 기준선 카탈로그 서명(함수 def md5·ACL·트리거) 채취
#   6) F2 forward(20260801040844) 적용 → rollback-only fixture 실행 → FIXTURE PASS 기대
#   7) [동시성] 독립 psql 2세션이 같은 스레드에 멘토 메시지 동시 제출
#      → message 2·notification 2·outbox 2·전이 1회·중복 키 0 실측
#   8) rollback SQL 적용 → 카탈로그 서명 재채취 → 기준선과 완전 일치 확인(helper 부재 포함)
#   9) forward 재적용 → fixture 재실행 → FIXTURE PASS 재확인
#
# 주의: 스텁은 로컬 전용 골격이므로 이 검증은 "RPC·트리거·helper 의 실구동/원자성/멱등/키 계약"
#   검증이다. RLS·실스키마 공존 검증은 staging fixture 실행으로 대체한다.
# 사용: scripts/verify/local_qna_answer_notification_check.sh

set -euo pipefail

PGBIN=/usr/lib/postgresql/16/bin
[[ -x "$PGBIN/initdb" ]] || { echo "SKIP: PostgreSQL 16 서버 바이너리 없음($PGBIN)" >&2; exit 0; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/ssambership-qna-notif-XXXXXX")"
PORT=54331
FORWARD="$ROOT/supabase/sql/20260801040844_qna_answer_notification_per_event.sql"
ROLLBACK="$ROOT/supabase/rollback/20260801040844_qna_answer_notification_per_event_rollback.sql"

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

# 카탈로그 서명: 대상 함수 def md5 + ACL + 트리거 def md5 (rollback 왕복 대조용)
SIG_SQL="
select 'fn|' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')|'
       || md5(pg_get_functiondef(p.oid)) || '|' || coalesce(p.proacl::text, '-')
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('qna_append_message','qna_register_attachment','qna_apply_answered_transition',
                    'qm_direct_answered_after','qa_direct_answered_after','qna_emit_answer_notification',
                    'qm_answer_notification_after','qa_answer_notification_after',
                    'record_domain_notification','qna_is_direct_untrusted_writer')
union all
select 'trg|' || c.relname || '.' || t.tgname || '|' || md5(pg_get_triggerdef(t.oid)) || '|-'
from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('question_messages','question_attachments') and not t.tgisinternal
order by 1;
"

echo "1/9 스텁 스키마 적용"
"${PSQL[@]}" -f "$ROOT/scripts/verify/fixtures/qna_stub_schema.sql"

echo "2/9 기준선 정본 SQL 적용: 132, 136, 139, 141, 142, 144"
for f in 132_notification_outbox_foundation 136_p1_8a_question_room_atomic_rpc \
         139_p1_8a_attachment_storage_contract 141_p1_8a_direct_write_guards \
         142_p1_8a_pending_refund_lock 144_p1_8a_direct_write_eligibility; do
  "${PSQL[@]}" -f "$ROOT/supabase/sql/$f.sql"
done

echo "3/9 [D-12 재현] 기준선: 두 번째 멘토 답변 알림 미생성 실측"
REPRO_OUT="$("${PSQL[@]}" -At <<'SQL'
begin;
insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-9000-0000000000a1','authenticated','authenticated','repro-s@test.local'),
  ('00000000-0000-4000-9000-0000000000b1','authenticated','authenticated','repro-m@test.local');
insert into public.users (id, role, full_name) values
  ('00000000-0000-4000-9000-0000000000a1','student','재현학생'),
  ('00000000-0000-4000-9000-0000000000b1','mentor','재현멘토');
insert into public.mentor_profiles (user_id, university_name, department_name, verification_status)
values ('00000000-0000-4000-9000-0000000000b1','대학','학과','approved');
insert into public.mentor_student_rooms (id, student_id, mentor_id)
values ('00000000-0000-4000-9000-0000000000d1','00000000-0000-4000-9000-0000000000a1','00000000-0000-4000-9000-0000000000b1');
select set_config('request.fixture_uid','00000000-0000-4000-9000-0000000000a1', true);
create temp table repro_t as
select (public.qna_create_question_thread('00000000-0000-4000-9000-0000000000d1','재현 질문',null,null,'본문')->>'thread_id')::uuid as tid;
select set_config('request.fixture_uid','00000000-0000-4000-9000-0000000000b1', true);
select public.qna_append_message((select tid from repro_t),'첫 답변');
select 'after_first=' || count(*) from public.notifications
 where recipient_user_id='00000000-0000-4000-9000-0000000000a1' and type='question_answered';
select public.qna_append_message((select tid from repro_t),'두 번째 답변');
select 'after_second=' || count(*) from public.notifications
 where recipient_user_id='00000000-0000-4000-9000-0000000000a1' and type='question_answered';
rollback;
SQL
)"
echo "$REPRO_OUT" | grep -E 'after_(first|second)='
grep -q 'after_first=1' <<<"$REPRO_OUT" || { echo "FAIL: 재현 전제(첫 답변 알림 1) 불일치" >&2; exit 1; }
grep -q 'after_second=1' <<<"$REPRO_OUT" || { echo "FAIL: D-12 재현 실패(기준선에서 두 번째 답변 알림이 증가함?)" >&2; exit 1; }
echo "OK: D-12 재현 — 기준선에서 두 번째 답변 알림 +0 (after_second=1)"

echo "4/9 기준선 카탈로그 서명 채취"
"${PSQL[@]}" -At -c "$SIG_SQL" > "$WORK/sig_baseline.txt"

echo "5/9 F2 forward 적용: 20260801040844_qna_answer_notification_per_event.sql"
"${PSQL[@]}" -f "$FORWARD"

echo "6/9 rollback-only fixture 실행 (11-1 ~ 11-9 + 회귀 + 직접쓰기 경로)"
OUT="$("${PSQL[@]}" -f "$ROOT/scripts/verify/fixtures/qna_answer_notification_per_event_fixture.sql" 2>&1)" || {
  echo "$OUT"; echo "FAIL: fixture 실행 실패" >&2; exit 1
}
echo "$OUT" | tail -5
grep -q "FIXTURE PASS" <<<"$OUT" || { echo "$OUT"; echo "FAIL: FIXTURE PASS 미확인" >&2; exit 1; }

echo "7/9 [11-10 동시성] 독립 2세션 같은 스레드 멘토 메시지 동시 제출"
"${PSQL[@]}" <<'SQL'
insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-9100-0000000000a1','authenticated','authenticated','cc-s@test.local'),
  ('00000000-0000-4000-9100-0000000000b1','authenticated','authenticated','cc-m@test.local');
insert into public.users (id, role, full_name) values
  ('00000000-0000-4000-9100-0000000000a1','student','동시학생'),
  ('00000000-0000-4000-9100-0000000000b1','mentor','동시멘토');
insert into public.mentor_profiles (user_id, university_name, department_name, verification_status)
values ('00000000-0000-4000-9100-0000000000b1','대학','학과','approved');
insert into public.mentor_student_rooms (id, student_id, mentor_id)
values ('00000000-0000-4000-9100-0000000000d1','00000000-0000-4000-9100-0000000000a1','00000000-0000-4000-9100-0000000000b1');
insert into public.question_threads (id, mentor_student_room_id, title, status)
values ('00000000-0000-4000-9100-0000000000e1','00000000-0000-4000-9100-0000000000d1','동시성 질문','pending');
SQL
PID1=$("${PSQL[@]}" -Atc 'select pg_backend_pid()')
PID2=$("${PSQL[@]}" -Atc 'select pg_backend_pid()')
[[ "$PID1" != "$PID2" ]] || { echo "FAIL: 두 세션 backend pid 동일 — 세션 독립성 불충족" >&2; exit 1; }
CC_SQL_A="select set_config('request.fixture_uid','00000000-0000-4000-9100-0000000000b1', false);
select public.qna_append_message('00000000-0000-4000-9100-0000000000e1','동시 답변 A');"
CC_SQL_B="select set_config('request.fixture_uid','00000000-0000-4000-9100-0000000000b1', false);
select public.qna_append_message('00000000-0000-4000-9100-0000000000e1','동시 답변 B');"
"${PSQL[@]}" -c "$CC_SQL_A" > "$WORK/cc_a.out" 2>&1 &
CPID1=$!
"${PSQL[@]}" -c "$CC_SQL_B" > "$WORK/cc_b.out" 2>&1 &
CPID2=$!
wait "$CPID1" || { cat "$WORK/cc_a.out"; echo "FAIL: 동시 세션 A 실패" >&2; exit 1; }
wait "$CPID2" || { cat "$WORK/cc_b.out"; echo "FAIL: 동시 세션 B 실패" >&2; exit 1; }
CC_OUT="$("${PSQL[@]}" -At <<'SQL'
select 'cc_messages=' || count(*) from public.question_messages where thread_id='00000000-0000-4000-9100-0000000000e1';
select 'cc_notifs=' || count(*) from public.notifications
 where recipient_user_id='00000000-0000-4000-9100-0000000000a1' and event_key like 'question_answer_message:%';
select 'cc_outbox=' || count(*) from public.notification_outbox
 where recipient_user_id='00000000-0000-4000-9100-0000000000a1' and dedup_key like 'question_answer_message:%';
select 'cc_dupkeys=' || (count(*) - count(distinct event_key)) from public.notifications
 where recipient_user_id='00000000-0000-4000-9100-0000000000a1';
select 'cc_transition=' || count(*) from public.question_threads
 where id='00000000-0000-4000-9100-0000000000e1' and status='answered' and first_answered_at is not null;
SQL
)"
echo "$CC_OUT"
for expect in cc_messages=2 cc_notifs=2 cc_outbox=2 cc_dupkeys=0 cc_transition=1; do
  grep -q "$expect" <<<"$CC_OUT" || { echo "FAIL: 동시성 기대값 미충족($expect)" >&2; exit 1; }
done
"${PSQL[@]}" <<'SQL'
delete from public.notification_outbox where recipient_user_id='00000000-0000-4000-9100-0000000000a1';
delete from public.notifications where recipient_user_id='00000000-0000-4000-9100-0000000000a1';
delete from public.question_threads where id='00000000-0000-4000-9100-0000000000e1';
delete from public.mentor_student_rooms where id='00000000-0000-4000-9100-0000000000d1';
delete from public.mentor_profiles where user_id='00000000-0000-4000-9100-0000000000b1';
delete from public.users where id in ('00000000-0000-4000-9100-0000000000a1','00000000-0000-4000-9100-0000000000b1');
delete from auth.users where id in ('00000000-0000-4000-9100-0000000000a1','00000000-0000-4000-9100-0000000000b1');
SQL
echo "OK: 동시성 — message 2 · notification 2 · outbox 2 · 전이 1회 · 중복 키 0"

echo "8/9 rollback 적용 → 카탈로그 기준선 완전 복원 확인"
"${PSQL[@]}" -f "$ROLLBACK"
"${PSQL[@]}" -At -c "$SIG_SQL" > "$WORK/sig_rollback.txt"
if ! diff -u "$WORK/sig_baseline.txt" "$WORK/sig_rollback.txt"; then
  echo "FAIL: rollback 후 카탈로그가 기준선과 다름" >&2; exit 1
fi
echo "OK: rollback 카탈로그 diff 0 (helper 부재 포함)"

echo "9/9 forward 재적용 → fixture 재실행"
"${PSQL[@]}" -f "$FORWARD"
OUT2="$("${PSQL[@]}" -f "$ROOT/scripts/verify/fixtures/qna_answer_notification_per_event_fixture.sql" 2>&1)" || {
  echo "$OUT2"; echo "FAIL: 재적용 후 fixture 실행 실패" >&2; exit 1
}
grep -q "FIXTURE PASS" <<<"$OUT2" || { echo "$OUT2"; echo "FAIL: 재적용 후 FIXTURE PASS 미확인" >&2; exit 1; }

echo "OK: F2(D-12) 질문방 답변 알림 행 단위 계약 로컬 실구동 검증 전체 통과"
