#!/usr/bin/env bash
# local_iq_attachment_author_guard_check.sh — 오프라인 스크래치 PG16 에서
# 20260804113000(첨부 메시지 작성자 가드) forward/rollback 계약을 실구동 검증.
#
# 하는 일:
#   1) 임시 클러스터 initdb/start (unix socket 전용 — 네트워크 미개방, 종료 시 전부 삭제)
#   2) 스텁 스키마(iq_attachment_stub_schema.sql) 적용
#   3) 기준선 함수 = rollback SQL 의 CREATE OR REPLACE 본문(배포 정본 사본) 적용
#      + 운영 동형 ACL(revoke public/anon · grant authenticated/service_role)
#      → prosrc md5 가 배포 실측(58f0c2411d40b2ce3bcec23efa0c88a1)과 일치해야 함
#   4) [가드 부재 재현] 기준선에서 상대방 메시지 연결이 '허용'되는 결함을 실측
#   5) forward(20260804113000) 적용(사전 게이트·자가 검증 포함)
#   6) 계약 fixture 실행 → 'IQ_ATTACHMENT_AUTHOR_GUARD FIXTURE PASS' 기대
#   7) rollback 적용(내장 md5 자가 검증 = 기준선 완전 복원 증명)
#   8) forward 재적용 → fixture 재실행 → PASS 재확인
#
# 주의: 스텁 검증이므로 "RPC 가드/멱등/봉투/ACL 계약" 실구동 검증이다.
#   RLS·실스키마 공존 검증은 staging fixture 실행으로 대체한다(local_stub 규약 동일).
# 사용: scripts/verify/local_iq_attachment_author_guard_check.sh

set -euo pipefail

PGBIN=/usr/lib/postgresql/16/bin
[[ -x "$PGBIN/initdb" ]] || { echo "SKIP: PostgreSQL 16 서버 바이너리 없음($PGBIN)" >&2; exit 0; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/ssambership-iqa-guard-XXXXXX")"
STUB="$ROOT/scripts/verify/fixtures/iq_attachment_stub_schema.sql"
FIXTURE="$ROOT/scripts/verify/fixtures/iq_attachment_author_guard_fixture.sql"
FORWARD="$ROOT/supabase/sql/20260804113000_iq_attachment_message_author_guard.sql"
ROLLBACK="$ROOT/supabase/rollback/20260804113000_iq_attachment_message_author_guard_rollback.sql"
BASELINE_MD5="58f0c2411d40b2ce3bcec23efa0c88a1"

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
"${RUN_AS[@]}" "$PGBIN/pg_ctl" -D "$WORK/data" -o "-k $WORK -c listen_addresses=''" -w start >/dev/null
PSQL=("${RUN_AS[@]}" "$PGBIN/psql" -h "$WORK" -U postgres -d postgres -v ON_ERROR_STOP=1 -q)

echo "[1/8] 스텁 스키마 적용"
"${PSQL[@]}" -f "$STUB"

echo "[2/8] 기준선 함수 적용(rollback 정의부 추출 — 배포 정본 사본)"
# rollback SQL 에서 CREATE OR REPLACE FUNCTION ... $function$; 블록만 추출한다
# (사본 3중화 방지 — rollback 파일이 기준선의 단일 정본).
awk '/^create or replace function public.add_individual_question_attachment/,/^\$function\$;$/' \
  "$ROLLBACK" > "$WORK/baseline_fn.sql"
[[ -s "$WORK/baseline_fn.sql" ]] || { echo "FAIL: rollback 에서 기준선 정의 추출 실패"; exit 1; }
[[ "$(id -u)" == "0" ]] && chown "$AS_USER" "$WORK/baseline_fn.sql"
"${PSQL[@]}" -f "$WORK/baseline_fn.sql"
"${PSQL[@]}" -c "revoke all on function public.add_individual_question_attachment(uuid,text,text,text,uuid) from public, anon;
grant execute on function public.add_individual_question_attachment(uuid,text,text,text,uuid) to authenticated, service_role;"

echo "[3/8] 기준선 본문 md5 = 배포 실측 일치 확인"
GOT_MD5="$("${PSQL[@]}" -At -c "select md5(prosrc) from pg_proc where oid = to_regprocedure('public.add_individual_question_attachment(uuid,text,text,text,uuid)')::oid")"
if [[ "$GOT_MD5" != "$BASELINE_MD5" ]]; then
  echo "FAIL: 기준선 md5 불일치 (expected $BASELINE_MD5, got $GOT_MD5)"; exit 1
fi

echo "[4/8] [결함 재현] 기준선: 상대방 메시지 연결이 허용됨을 실측"
"${PSQL[@]}" <<'SQL'
begin;
insert into public.users (id, role) values
  ('90000000-0000-4000-8000-000000000001','student'),
  ('90000000-0000-4000-8000-000000000002','mentor');
insert into public.individual_questions (id, student_id, claimed_mentor_id, status)
  values ('91000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000002','claimed');
insert into public.individual_question_messages (id, question_id, author_id, body)
  values ('92000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000002','멘토 메시지');
insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('individual-question-attachments','91000000-0000-4000-8000-000000000001/spoof.png',
          '90000000-0000-4000-8000-000000000001','{"mimetype":"image/png","size":"10"}');
do $$
declare v jsonb;
begin
  perform set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000001', true);
  v := public.add_individual_question_attachment(
    '91000000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000001/spoof.png','s.png','image/png',
    '92000000-0000-4000-8000-000000000001');
  if v->>'status' <> 'created' then
    raise exception 'baseline repro unexpected: %', v;
  end if;
  raise notice 'BASELINE DEFECT REPRODUCED: student attachment linked to mentor message';
end $$;
rollback;
SQL

echo "[5/8] forward 적용"
"${PSQL[@]}" -f "$FORWARD"

echo "[6/8] 계약 fixture 실행"
OUT="$("${PSQL[@]}" -f "$FIXTURE" 2>&1)" || { echo "$OUT"; exit 1; }
grep -q "IQ_ATTACHMENT_AUTHOR_GUARD FIXTURE PASS" <<<"$OUT" || { echo "FAIL: fixture PASS 마커 없음"; echo "$OUT"; exit 1; }

echo "[7/8] rollback 적용(내장 md5 자가 검증 = 기준선 복원 증명)"
"${PSQL[@]}" -f "$ROLLBACK"

echo "[8/8] forward 재적용 + fixture 재실행"
"${PSQL[@]}" -f "$FORWARD"
OUT="$("${PSQL[@]}" -f "$FIXTURE" 2>&1)" || { echo "$OUT"; exit 1; }
grep -q "IQ_ATTACHMENT_AUTHOR_GUARD FIXTURE PASS" <<<"$OUT" || { echo "FAIL: 재적용 fixture PASS 마커 없음"; echo "$OUT"; exit 1; }

echo "PASS: iq attachment message-author guard forward/rollback roundtrip verified"
