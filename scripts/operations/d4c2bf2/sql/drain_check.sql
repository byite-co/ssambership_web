-- 성격: 조회 전용 — READ ONLY 트랜잭션 안의 SELECT 만. LOCK·DDL·DML 없음. (e) 는 pg_cron 필요.
-- 읽기 전용. postgres 로그인으로 실행(psql -X -qAt -e -v ON_ERROR_STOP=1 -f). 5분 이상 간격으로 2회 실행해 결과가 동일(쓰기 0·카운트 불변)해야 drain 완료로 본다. 순간 0건은 인정하지 않는다.
-- (a)=업무 세션(authenticator·postgres·anon·authenticated·service_role)만 판정. (a2) 플랫폼 역할 세션은 기록만. (e) 는 pg_cron 이 필요하며 로컬 랩(pg_cron 없음)에서는 검증되지 않았다 — Hosted 에 cron.job 이 없으면 중단.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path=pg_catalog,public;
SELECT now() AS observed_at;
-- (a) 업무 세션: 비idle 0, idle in transaction 0 (자기 세션 제외) — 판정 대상
SELECT usename, application_name, state, wait_event_type, now() - xact_start AS xact_age, left(query, 80) AS query
  FROM pg_stat_activity
 WHERE backend_type = 'client backend' AND pid <> pg_backend_pid()
   AND usename IN ('authenticator','postgres','anon','authenticated','service_role')
   AND (state <> 'idle' OR xact_start IS NOT NULL)
 ORDER BY xact_start;
SELECT count(*) AS business_idle_in_transaction FROM pg_stat_activity
 WHERE usename IN ('authenticator','postgres','anon','authenticated','service_role') AND state LIKE 'idle in transaction%';
-- (a2) 플랫폼 역할 세션(중지 수단 없음): 기록만, 판정은 (d) 로
SELECT usename, state, count(*) FROM pg_stat_activity
 WHERE backend_type = 'client backend' AND pid <> pg_backend_pid()
   AND usename NOT IN ('authenticator','postgres','anon','authenticated','service_role')
 GROUP BY 1,2 ORDER BY 1,2;
-- (b) PostgREST 풀은 전부 idle 이어야 한다
SELECT state, count(*) FROM pg_stat_activity WHERE usename = 'authenticator' GROUP BY 1 ORDER BY 1;
-- (c) 다른 postgres 세션(운영자 SQL·workflow)이 없어야 한다 (자기 세션 제외)
SELECT pid, application_name, client_addr IS NOT NULL AS remote, state, xact_start
  FROM pg_stat_activity WHERE usename = 'postgres' AND pid <> pg_backend_pid();
-- (d) Storage · 큐 · 작업 테이블 카운트 (2회 동일해야 함)
SELECT count(*) AS storage_objects, max(created_at) AS last_created, max(updated_at) AS last_updated FROM storage.objects;
SELECT count(*) AS multipart_uploads FROM storage.s3_multipart_uploads;
SELECT status, count(*) FROM public.notification_outbox GROUP BY 1 ORDER BY 1;          -- leased 는 0 이어야 함
SELECT status, count(*) FROM public.paysync_invoices GROUP BY 1 ORDER BY 1;
SELECT count(*) AS cash_ledger_rows, max(created_at) AS last_cash_ledger FROM public.cash_ledger;
SELECT count(*) AS public_users, max(created_at) AS last_user_created FROM public.users;   -- Auth 가입 트리거 유입 감시
SELECT count(*) AS deletion_jobs_total FROM public.account_deletion_jobs;                      -- 삭제 작업 유입 감시(lease 열 이름은 운영 catalog 로 확인)
-- (e) pg_cron: 두 작업 비활성, 실행 중 0 (로컬 미검증 · Hosted 전용)
SELECT jobid, jobname, active, username, schedule FROM cron.job ORDER BY jobid;
SELECT count(*) AS cron_running FROM cron.job_run_details WHERE status = 'running';
SELECT jobid, status, start_time, end_time FROM cron.job_run_details ORDER BY start_time DESC LIMIT 5;
ROLLBACK;
