-- 161_p1_10_account_deletion_self_rpc.sql
-- [적용됨 — ssambership-staging 에 2026-07-21 적용(MCP execute_sql 단일 트랜잭션,
--   DDL 커밋 + fixture 는 savepoint 안 ROLLBACK). T1~T4 + S1~S5 + baseline 전부 PASS.
--   fixture 보정: public.users.role NOT NULL → (id, role='student') 로 upsert(1차 시도는
--   이 제약으로 전체 롤백·함수 미적용, 2차 성공). 적용 이력: docs/audit/sql_apply_manifest.md]
-- P1-10 후속 — 계정 탈퇴 self RPC 3종(요청/취소/상태).
-- 배경: 151/154 의 raw `account_deletion_request(p_user_id,…)`/`account_deletion_cancel(p_user_id)` 는
--   호출자와 p_user_id 일치 검사가 없어(worker/service_role 전제) authenticated 에 GRANT 만 추가하면
--   타인의 탈퇴 job 을 생성·취소할 수 있다. → GRANT 금지, 본인 ID 를 서버(auth.uid())에서만 도출하는
--   self wrapper 를 신설하고 raw 는 service_role 전용으로 유지한다.
-- 조치:
--   1) account_deletion_request_self(p_cancelable_minutes int=30, p_dry_run bool=false) → jsonb
--      - auth.uid() 필수(미로그인 AUTH_REQUIRED). 사용자 인자로 타인 ID 를 받지 않음.
--      - 동일 사용자 동시 요청은 pg_advisory_xact_lock 으로 직렬화(1 job 보장, raw upsert 와 이중 방어).
--      - 내부에서 raw request 호출(기존 job 이면 멱등 성공) 후 job 행을 읽어
--        {ok, existing, job_id, state, cancelable_until, dry_run} 반환.
--   2) account_deletion_cancel_self() → jsonb — auth.uid() 만. raw cancel 위임
--      (pending + cancelable_until 이내만 ok, locked/purging 이후 NOT_CANCELABLE).
--   3) account_deletion_status_self() → jsonb — {ok, exists, state, cancelable_until,
--      write_blocked, can_cancel}. worker 내부 정보(last_error/lease/purge 타임스탬프) 미반환.
-- 권한: self 3종 = authenticated·service_role EXECUTE(public/anon revoke).
--   raw request/cancel/advance/claim/worker 계열 ACL 은 변경하지 않는다(service_role 전용 유지 — §V 에서 확인만).
-- 선행: 151, 154.

begin;

-- ── 1. 요청 ────────────────────────────────────────────────────────────────
create or replace function public.account_deletion_request_self(
  p_cancelable_minutes integer default 30,
  p_dry_run boolean default false
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := (select auth.uid());
  v_raw jsonb;
  v_job_id uuid;
  v_state text;
  v_cancelable timestamptz;
  v_dry boolean;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  -- 동일 사용자 요청 직렬화(트랜잭션 종료 시 자동 해제).
  perform pg_advisory_xact_lock(hashtextextended('account_deletion_self:' || v_uid::text, 0));

  v_raw := public.account_deletion_request(
    v_uid, greatest(0, coalesce(p_cancelable_minutes, 30)), coalesce(p_dry_run, false));

  select j.id, j.state, j.cancelable_until, j.dry_run
    into v_job_id, v_state, v_cancelable, v_dry
  from public.account_deletion_jobs j
  where j.user_id = v_uid;

  return jsonb_build_object(
    'ok', true,
    'existing', coalesce((v_raw ->> 'existing')::boolean, true),
    'job_id', v_job_id,
    'state', v_state,
    'cancelable_until', v_cancelable,
    'dry_run', v_dry
  );
end;
$$;

-- ── 2. 취소 ────────────────────────────────────────────────────────────────
create or replace function public.account_deletion_cancel_self()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('account_deletion_self:' || v_uid::text, 0));
  -- raw cancel 이 pending + cancelable_until 이내만 ok 를 준다
  -- (locked/purging 등은 NOT_CANCELABLE, 창 경과는 CANCEL_WINDOW_PASSED).
  return public.account_deletion_cancel(v_uid);
end;
$$;

-- ── 3. 상태 조회 ────────────────────────────────────────────────────────────
create or replace function public.account_deletion_status_self()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := (select auth.uid());
  v_job record;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  select j.state, j.cancelable_until into v_job
  from public.account_deletion_jobs j
  where j.user_id = v_uid;
  if not found then
    return jsonb_build_object(
      'ok', true, 'exists', false, 'state', null,
      'cancelable_until', null, 'write_blocked', false, 'can_cancel', false);
  end if;
  -- 민감한 worker 오류·purge 내부 정보는 반환하지 않는다.
  return jsonb_build_object(
    'ok', true,
    'exists', true,
    'state', v_job.state,
    'cancelable_until', v_job.cancelable_until,
    'write_blocked', v_job.state in
      ('locked','purging','storage_purged','finalized','auth_soft_deleted'),
    'can_cancel', v_job.state = 'pending'
      and (v_job.cancelable_until is null or now() <= v_job.cancelable_until)
  );
end;
$$;

-- ── 권한: self 3종 = authenticated/service_role 만 ─────────────────────────
revoke all on function public.account_deletion_request_self(integer, boolean) from public, anon;
revoke all on function public.account_deletion_cancel_self() from public, anon;
revoke all on function public.account_deletion_status_self() from public, anon;
grant execute on function public.account_deletion_request_self(integer, boolean) to authenticated, service_role;
grant execute on function public.account_deletion_cancel_self() to authenticated, service_role;
grant execute on function public.account_deletion_status_self() to authenticated, service_role;

comment on function public.account_deletion_request_self(integer, boolean) is
  'P1-10: 본인(auth.uid) 탈퇴 요청 self wrapper. raw request 는 service_role 전용 유지.';
comment on function public.account_deletion_cancel_self() is
  'P1-10: 본인 탈퇴 취소(pending+취소창 이내만). raw cancel 은 service_role 전용 유지.';
comment on function public.account_deletion_status_self() is
  'P1-10: 본인 탈퇴 상태(민감 worker 정보 미반환).';

commit;

-- §V(적용 시 함께 실행한 검증 요약):
--   T1 self 3종 존재·SECURITY DEFINER·search_path=public·owner=postgres
--   T2 self 3종 ACL = authenticated/service_role 만(anon/public 없음)
--   T3 raw request/cancel ACL 불변(postgres/service_role 전용 — authenticated 없음)
--   T4 request_self 본문에 advisory lock sentinel 존재(동시성 직렬화 —
--      독립 2세션 실측은 단일 트랜잭션 검증 한계로 PENDING, 124 선례와 동일)
--   S1 미로그인(claims 없음) → AUTH_REQUIRED
--   S2 사용자 A request_self(dry_run=true) → 신규 pending job + cancelable_until 반환,
--      재호출 → existing=true·같은 job_id(멱등·1 job)
--   S3 A status_self → exists·pending·can_cancel=true / A cancel_self → ok=true
--   S4 job 을 locked 로 강제 후 cancel_self → NOT_CANCELABLE, status_self →
--      write_blocked=true·can_cancel=false
--   S5 authenticated 로 raw account_deletion_request(B.id,…) 직접 호출 → permission denied
--      (A 가 B 의 job 을 생성·취소할 수 없음 — self 는 인자 자체가 없음)
--   fixture(auth.users 2명·jobs)는 전부 savepoint 안 → ROLLBACK(잔여 0, dry_run=true 만 사용,
--   실계정·실탈퇴 없음)
