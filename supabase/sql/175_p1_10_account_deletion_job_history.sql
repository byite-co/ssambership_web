-- 175_p1_10_account_deletion_job_history.sql
-- ⚠️ 기능 플래그 OFF 기본 · worker kill switch OFF 고정. 실제 사용자·객체 삭제 없음.
--    기존 SQL 151/154/161 파일은 **수정하지 않는다** — 여기서 재정의만 한다.
--
-- W5 §3-5-A(e)(f): 취소 후 재요청 수명주기 + "사용자당 job 1행" 가정 제거.
--
-- ── 문제(기준 HEAD a6e9183 실측) ──────────────────────────────────────────────
--   `account_deletion_jobs.user_id` 가 UNIQUE 라서
--   request → pending → cancel → canceled → request 에서 **새 pending job 을 만들 수 없다**.
--   151 raw request 는 상태와 무관하게 기존 행을 그대로 돌려주므로 재요청이 영구 차단된다.
--
--   그런데 제약만 부분 UNIQUE 로 바꾸면 기존 함수들이 **조용히 깨진다**. 현행 SQL 은
--   사용자당 행이 정확히 하나라는 가정 위에 쓰여 있어, 다중 행에서는
--     · plpgsql `select … into` 가 에러 없이 **임의의 한 행**을 집고,
--     · state 조건 없는 `update … where user_id = …` 가 **그 사용자의 과거 이력 행까지 전부**
--       덮어쓴다(151행 140 cancel · 151행 183/187 record_error).
--   이력을 보존하려고 만든 구조가 이력을 파괴한다.
--
-- ── 채택안 ────────────────────────────────────────────────────────────────────
--   (e) 권장안 = **활성 job 에만 걸리는 부분 UNIQUE + job 행별 이력 보존**.
--       기존 canceled 행을 pending 으로 덮어쓰는 차선은 취소 이력을 잃으므로 쓰지 않는다.
--   (f) 그래서 아래 함수를 **전부 job_id 지정 또는 활성 상태 한정 술어로 재정의**한다.
--       `where user_id = …` 단독 UPDATE 를 0 으로 만든다(§7 게이트).
--
-- 선행: 151(jobs·상태기계), 154(lease·forfeit), 161(self RPC), 115(anonymize).

begin;
set local lock_timeout='5s';

-- ── 0) 활성 상태 정의 헬퍼 ────────────────────────────────────────────────────
-- 활성 = 아직 진행 중이라 사용자당 하나만 존재해야 하는 상태.
-- 종료 상태(completed·canceled·failed)는 이력으로 여러 행 남을 수 있다.
create or replace function public.account_deletion_active_states()
returns text[] language sql immutable set search_path to 'public' as $$
  select array['pending','locked','purging','storage_purged','finalized','auth_soft_deleted']::text[];
$$;

-- ── 1) user_id UNIQUE → 활성 job 부분 UNIQUE ─────────────────────────────────
-- 활성 job 중복 0 은 유지하면서, 종료된 이력 행은 얼마든지 쌓일 수 있게 한다.
alter table public.account_deletion_jobs
  drop constraint if exists account_deletion_jobs_user_id_key;

create unique index if not exists uq_adj_active_user
  on public.account_deletion_jobs (user_id)
  where state in ('pending','locked','purging','storage_purged','finalized','auth_soft_deleted');

-- 이력 조회·정렬용(결정적 최신 1행 선택).
create index if not exists idx_adj_user_requested
  on public.account_deletion_jobs (user_id, requested_at desc, id desc);

comment on index public.uq_adj_active_user is
  '175: 활성 job 은 사용자당 1행. 종료(completed/canceled/failed) 이력 행은 다중 허용.';

-- ── 2) job 해석 헬퍼 ─────────────────────────────────────────────────────────
-- 활성 job 1행을 결정적으로 고른다(부분 UNIQUE 로 0 또는 1행이지만 정렬을 명시해 둔다).
create or replace function public.account_deletion_active_job_id(p_user_id uuid)
returns uuid language sql stable security definer set search_path to 'public' as $$
  select j.id
  from public.account_deletion_jobs j
  where j.user_id = p_user_id
    and j.state in ('pending','locked','purging','storage_purged','finalized','auth_soft_deleted')
  order by j.requested_at desc, j.id desc
  limit 1;
$$;

-- 상태 무관 최신 1행(활성 job 이 없을 때 사용자에게 보여줄 마지막 시도).
create or replace function public.account_deletion_latest_job_id(p_user_id uuid)
returns uuid language sql stable security definer set search_path to 'public' as $$
  select j.id
  from public.account_deletion_jobs j
  where j.user_id = p_user_id
  order by j.requested_at desc, j.id desc
  limit 1;
$$;

revoke all on function public.account_deletion_active_states() from public, anon, authenticated;
revoke all on function public.account_deletion_active_job_id(uuid) from public, anon, authenticated;
revoke all on function public.account_deletion_latest_job_id(uuid) from public, anon, authenticated;
grant execute on function public.account_deletion_active_states() to service_role;
grant execute on function public.account_deletion_active_job_id(uuid) to service_role;
grant execute on function public.account_deletion_latest_job_id(uuid) to service_role;

-- ── 3) request — 재요청 시 **새 실행 단위**를 만든다 ─────────────────────────
-- 활성 job 이 있으면 멱등 반환. 없으면 canceled·failed 이력이 있어도 새 행을 insert 한다.
-- 새 행은 attempts=0 · last_error/next_attempt_at/lease/파괴 타임스탬프 전부 NULL 로
-- 시작하므로 과거 실행 상태가 섞이지 않는다(§3-5-A(e)).
-- completed 사용자의 재요청은 **명시적 거부**로 계약을 고정한다 — 계정은 이미 익명화·
-- soft-delete 된 상태라 새 삭제 실행 단위가 의미를 갖지 못한다.
create or replace function public.account_deletion_request(
  p_user_id uuid, p_cancelable_minutes int default 30, p_dry_run boolean default true)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid; v_state text; v_latest uuid; v_latest_state text;
begin
  v_id := public.account_deletion_active_job_id(p_user_id);
  if v_id is not null then
    select j.state into v_state from public.account_deletion_jobs j where j.id = v_id;
    return jsonb_build_object('ok',true,'existing',true,'job_id',v_id,'state',v_state);
  end if;

  select j.id, j.state into v_latest, v_latest_state
    from public.account_deletion_jobs j
    where j.user_id = p_user_id
    order by j.requested_at desc, j.id desc
    limit 1;
  if v_latest_state = 'completed' then
    return jsonb_build_object('ok',false,'code','ALREADY_COMPLETED','job_id',v_latest,'state','completed');
  end if;

  insert into public.account_deletion_jobs (user_id, state, cancelable_until, dry_run)
    values (p_user_id, 'pending',
            now() + make_interval(mins => greatest(0, coalesce(p_cancelable_minutes,30))),
            coalesce(p_dry_run,true))
    returning id into v_id;
  return jsonb_build_object('ok',true,'existing',false,'job_id',v_id,'state','pending');
end $$;

-- ── 4) cancel — 대상 job 1행만 canceled. 과거 이력 행 불변 ───────────────────
create or replace function public.account_deletion_cancel(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid; v_state text; v_cancelable timestamptz; v_rows int;
begin
  v_id := public.account_deletion_active_job_id(p_user_id);
  if v_id is null then return jsonb_build_object('ok',false,'code','NOT_FOUND'); end if;

  select j.state, j.cancelable_until into v_state, v_cancelable
    from public.account_deletion_jobs j where j.id = v_id for update;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND'); end if;
  -- purging 이후(=pending 아님) 취소 금지.
  if v_state <> 'pending' then return jsonb_build_object('ok',false,'code','NOT_CANCELABLE','state',v_state); end if;
  if v_cancelable is not null and now() > v_cancelable then
    return jsonb_build_object('ok',false,'code','CANCEL_WINDOW_PASSED');
  end if;

  -- ★ where id = <대상 job> — 151행 140 의 `where user_id=…` 단독 UPDATE 를 대체한다.
  update public.account_deletion_jobs
    set state='canceled', canceled_at=now(), updated_at=now()
    where id = v_id and state = 'pending';
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return jsonb_build_object('ok',false,'code','NOT_CANCELABLE'); end if;
  return jsonb_build_object('ok',true,'state','canceled','job_id',v_id);
end $$;

-- ── 5) advance — 활성 job 1행만 전이 ────────────────────────────────────────
create or replace function public.account_deletion_advance(p_user_id uuid, p_from text, p_to text)
returns boolean language plpgsql security definer set search_path to 'public' as $$
declare v_rows int := 0; v_col text; v_id uuid;
begin
  v_id := public.account_deletion_active_job_id(p_user_id);
  if v_id is null then return false; end if;

  -- pending→locked 은 cancelable_until 경과 후에만(취소 기회 보장).
  -- ※ 176 에서 이 분기는 거부로 바뀐다(동의 검증과 원자 결합 — account_deletion_begin_locked).
  if p_from='pending' and p_to='locked' then
    update public.account_deletion_jobs
      set state='locked', locked_at=now(), updated_at=now()
      where id = v_id and state='pending' and (cancelable_until is null or now() >= cancelable_until);
    get diagnostics v_rows = row_count;
    return v_rows > 0;
  end if;

  if not (
    (p_from='locked' and p_to='purging') or
    (p_from='purging' and p_to='storage_purged') or
    (p_from='storage_purged' and p_to='finalized') or
    (p_from='finalized' and p_to='auth_soft_deleted') or
    (p_from='auth_soft_deleted' and p_to='completed')
  ) then
    raise exception 'INVALID_TRANSITION % -> %', p_from, p_to;
  end if;

  v_col := p_to || '_at';
  execute format(
    'update public.account_deletion_jobs set state=$2, %I=now(), updated_at=now() where id=$1 and state=$3',
    v_col
  ) using v_id, p_to, p_from;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end $$;

-- ── 6) record_error — 대상 job 1행만 attempts 증가. 과거 이력 행 불변 ────────
create or replace function public.account_deletion_record_error(
  p_user_id uuid, p_error text, p_backoff_seconds int default 60, p_max_attempts int default 8)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_attempts int; v_id uuid;
begin
  v_id := public.account_deletion_active_job_id(p_user_id);
  if v_id is null then return jsonb_build_object('ok',false,'code','NOT_FOUND'); end if;

  -- ★ where id = <대상 job> — 151행 183 의 `where user_id=…` 단독 UPDATE 를 대체한다.
  update public.account_deletion_jobs
    set attempts = attempts + 1, last_error = left(coalesce(p_error,''),1000),
        next_attempt_at = now() + make_interval(secs => greatest(1, coalesce(p_backoff_seconds,60))),
        updated_at = now()
    where id = v_id
    returning attempts into v_attempts;
  if v_attempts is null then return jsonb_build_object('ok',false,'code','NOT_FOUND'); end if;

  if v_attempts >= p_max_attempts then
    -- ★ 151행 187 의 `where user_id=…` 단독 UPDATE 를 대체한다.
    update public.account_deletion_jobs
      set state='failed', failed_at=now(), updated_at=now()
      where id = v_id;
    return jsonb_build_object('ok',true,'state','failed','attempts',v_attempts,'job_id',v_id);
  end if;
  return jsonb_build_object('ok',true,'attempts',v_attempts,'job_id',v_id);
end $$;

-- ── 7) forfeit_and_anonymize — 활성 job 상태로만 게이트 판정 ─────────────────
-- (몰수 동의 재검증은 176 에서 이 함수에 다시 얹는다.)
create or replace function public.account_deletion_forfeit_and_anonymize(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid; v_state text; v_balance bigint; v_ledger_id uuid;
begin
  perform set_config('ssambership.deletion_worker', 'on', true);

  v_id := public.account_deletion_active_job_id(p_user_id);
  if v_id is null then return jsonb_build_object('ok',false,'code','JOB_NOT_FOUND'); end if;
  select j.state into v_state from public.account_deletion_jobs j where j.id = v_id for update;
  if v_state is null then return jsonb_build_object('ok',false,'code','JOB_NOT_FOUND'); end if;
  if v_state <> 'storage_purged' then
    return jsonb_build_object('ok',false,'code','WRONG_STATE','state',v_state);
  end if;

  select w.balance_cents into v_balance from public.cash_wallets w
    where w.user_id = p_user_id for update;
  if v_balance is not null and v_balance > 0 then
    insert into public.cash_ledger (user_id, delta_cents, reason, ref_type, ref_id, idempotency_key)
    values (p_user_id, -v_balance, 'account_deletion_forfeit', 'account_deletion', p_user_id,
            'acct_del_forfeit:'||p_user_id::text)
    on conflict (idempotency_key) do nothing
    returning id into v_ledger_id;
    if v_ledger_id is not null then
      update public.cash_wallets set balance_cents = 0 where user_id = p_user_id;
    end if;
  end if;

  perform public.anonymize_user_for_deletion(p_user_id, 'account_deletion');
  return jsonb_build_object('ok',true,'forfeited_cents',coalesce(v_balance,0),'ledger_id',v_ledger_id,'job_id',v_id);
end $$;

-- ── 8) self 상태 조회 — 활성 job, 없으면 최신 1행을 결정적으로 반환 ──────────
create or replace function public.account_deletion_status_self()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid;
  v_job record;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode = '28000'; end if;

  v_id := coalesce(public.account_deletion_active_job_id(v_uid), public.account_deletion_latest_job_id(v_uid));
  if v_id is null then
    return jsonb_build_object(
      'ok', true, 'exists', false, 'state', null,
      'cancelable_until', null, 'write_blocked', false, 'can_cancel', false);
  end if;

  select j.state, j.cancelable_until into v_job
    from public.account_deletion_jobs j where j.id = v_id;

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
end $$;

-- ── 9) ACL 재확인(재정의로 초기화되지 않도록 명시) ──────────────────────────
revoke all on function public.account_deletion_request(uuid,int,boolean) from public, anon, authenticated;
revoke all on function public.account_deletion_cancel(uuid) from public, anon, authenticated;
revoke all on function public.account_deletion_advance(uuid,text,text) from public, anon, authenticated;
revoke all on function public.account_deletion_record_error(uuid,text,int,int) from public, anon, authenticated;
revoke all on function public.account_deletion_forfeit_and_anonymize(uuid) from public, anon, authenticated;
revoke all on function public.account_deletion_status_self() from public, anon;
grant execute on function public.account_deletion_request(uuid,int,boolean) to service_role;
grant execute on function public.account_deletion_cancel(uuid) to service_role;
grant execute on function public.account_deletion_advance(uuid,text,text) to service_role;
grant execute on function public.account_deletion_record_error(uuid,text,int,int) to service_role;
grant execute on function public.account_deletion_forfeit_and_anonymize(uuid) to service_role;
grant execute on function public.account_deletion_status_self() to authenticated, service_role;

commit;

-- ── §V 검증(적용 후 실행) ────────────────────────────────────────────────────
-- (1) 활성 job 부분 UNIQUE 존재 · user_id 전체 UNIQUE 부재
--     select indexname, indexdef from pg_indexes
--      where schemaname='public' and tablename='account_deletion_jobs';
--     select conname from pg_constraint where conrelid='public.account_deletion_jobs'::regclass and contype='u';
--     기대: uq_adj_active_user 존재 · account_deletion_jobs_user_id_key 부재
-- (2) `where user_id = …` 단독 UPDATE 0 증명
--     select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--      where n.nspname='public' and p.proname like 'account_deletion%'
--        and pg_get_functiondef(p.oid) ~* 'update\s+public\.account_deletion_jobs[^;]*where\s+(j\.)?id\s*='
--     기대: cancel · record_error · advance 가 전부 id 기준
-- (3) request → cancel → request 로 새 pending job 생성(이력 2행)
-- (4) 이력 2행 사용자의 cancel/record_error 가 대상 1행만 바꾸는지
--
-- ── ROLLBACK ────────────────────────────────────────────────────────────────
--   drop index if exists public.uq_adj_active_user;
--   drop index if exists public.idx_adj_user_requested;
--   alter table public.account_deletion_jobs add constraint account_deletion_jobs_user_id_key unique (user_id);
--   -- 함수는 151/154/161 원문을 다시 실행해 복원한다(파일 무수정이므로 그대로 재적용 가능).
--   ※ 부분 UNIQUE 를 되돌리려면 사용자당 이력 행이 1행이어야 한다(다중 행이면 제약 추가 실패).
