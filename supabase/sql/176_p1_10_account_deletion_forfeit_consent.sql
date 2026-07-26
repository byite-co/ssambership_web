-- 176_p1_10_account_deletion_forfeit_consent.sql
-- ⚠️ 기능 플래그 OFF 기본 · worker kill switch OFF 고정. 실제 사용자·객체 삭제 없음.
--    기존 SQL 151/154/161 파일은 **수정하지 않는다** — 여기서 재정의만 한다.
--
-- W5 §3-5-A: 잔액 몰수 동의를 **서버 정본**으로 확정하고 3계층에서 fail-closed 로 강제한다.
--
-- ── 문제(기준 HEAD a6e9183 실측) ──────────────────────────────────────────────
--   · `account_deletion_jobs` 20개 컬럼에 **동의 기록 컬럼이 없다**.
--   · `account_deletion_request_self(int, bool)` 에 동의 인자도 잔액 사전조건도 없다.
--   · 154 `account_deletion_forfeit_and_anonymize` 는 `if v_balance > 0` 이면 **무조건 몰수**한다.
--   · 웹은 클라이언트 boolean(`forfeitConsent`) 만 보고 **자기가 직접** 원장을 넣었다.
--   즉 saga 경로는 지금도 **동의 없이 양수 잔액을 몰수**하도록 되어 있다. 실피해가 없는
--   유일한 이유는 kill switch 가 OFF 라 어떤 job 도 storage_purged 에 도달한 적이 없기 때문이다.
--
-- ── 3계층 방어(동의 검증은 파괴 작업 **전에** 끝나야 한다) ───────────────────
--   1층 요청     : 양수 잔액 + 검증된 동의 없음 → **job 생성 0** (FORFEIT_CONSENT_REQUIRED)
--   2층 worker진입: `pending → locked` **전에** 동의·현재 잔액 재검증
--                   → advance 0 · session revoke 0 · Storage remove 0 · 몰수 0
--   3층 몰수 RPC : 마지막 방어선으로 동의를 다시 검증
--
-- ── TOCTOU 0 (§3-5-A(d)) ─────────────────────────────────────────────────────
--   worker 가 잔액을 SELECT 한 뒤 별도로 advance 를 호출하면 그 사이 충전이 끼어든다.
--   그래서 `account_deletion_begin_locked` 하나가 [job 행 FOR UPDATE → wallet 행 FOR UPDATE
--   → 검증 → 전이] 를 **단일 트랜잭션**으로 수행하고, raw advance 의 pending→locked 분기는
--   아예 **거부**한다(우회 0).
--
-- 선행: 151, 154, 161, 175.

begin;
set local lock_timeout='5s';

-- ── 1) 동의 정본 컬럼 ────────────────────────────────────────────────────────
-- 동의는 **금액에 묶인다**. pending 구간은 write block 대상이 아니라(151행 47)
-- 취소 창 동안 충전이 정상 허용되므로, 동의 시점 금액을 함께 박제해야 stale 판정이 가능하다.
alter table public.account_deletion_jobs add column if not exists forfeit_consent_at timestamptz;
alter table public.account_deletion_jobs add column if not exists consented_balance_cents bigint;

comment on column public.account_deletion_jobs.forfeit_consent_at is
  '176: 잔액 몰수 동의 시각(서버 기록). NULL 이면 동의 없음 — 양수 잔액 사용자는 진행 불가.';
comment on column public.account_deletion_jobs.consented_balance_cents is
  '176: 동의 당시 서버가 읽은 잔액(cents). 현재 잔액이 이보다 크면 FORFEIT_CONSENT_STALE.';

-- ── 2) 요청 정본 — 동의를 사용자·job 과 결합해 기록한다 ──────────────────────
-- 클라이언트 boolean 을 그대로 믿지 않는다: 잔액은 **서버가 읽고**, 동의 시각·금액을
-- job 행에 박제한다. 호출자가 화면에서 본 금액을 echo 하면(p_acknowledged_balance_cents)
-- 그 시점에 이미 어긋난 동의를 요청 단계에서 걸러낸다.
create or replace function public.account_deletion_request_consented(
  p_user_id uuid,
  p_cancelable_minutes int default 30,
  p_dry_run boolean default true,
  p_forfeit_consent boolean default false,
  p_acknowledged_balance_cents bigint default null
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_id uuid; v_state text; v_latest uuid; v_latest_state text;
  v_balance bigint; v_consent_at timestamptz; v_consented bigint;
begin
  -- 활성 job 이 있으면 멱등 반환(중복 요청에도 동의 기록·원장 중복 0).
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

  -- 잔액은 **서버가 읽는다**. 지갑 행이 없으면 0.
  select coalesce(w.balance_cents, 0) into v_balance
    from public.cash_wallets w where w.user_id = p_user_id;
  v_balance := coalesce(v_balance, 0);

  if v_balance > 0 then
    if not coalesce(p_forfeit_consent, false) then
      -- 1층: job 자체를 만들지 않는다.
      return jsonb_build_object('ok',false,'code','FORFEIT_CONSENT_REQUIRED','balance_cents',v_balance);
    end if;
    if p_acknowledged_balance_cents is not null and p_acknowledged_balance_cents <> v_balance then
      return jsonb_build_object('ok',false,'code','FORFEIT_CONSENT_STALE',
        'acknowledged_balance_cents', p_acknowledged_balance_cents, 'current_balance_cents', v_balance);
    end if;
    v_consent_at := now();
    v_consented := v_balance;
  else
    -- 잔액 0 사용자는 별도 몰수 동의 없이 진행할 수 있다.
    v_consent_at := null;
    v_consented := null;
  end if;

  insert into public.account_deletion_jobs
      (user_id, state, cancelable_until, dry_run, forfeit_consent_at, consented_balance_cents)
    values (p_user_id, 'pending',
            now() + make_interval(mins => greatest(0, coalesce(p_cancelable_minutes,30))),
            coalesce(p_dry_run,true), v_consent_at, v_consented)
    returning id into v_id;

  return jsonb_build_object('ok',true,'existing',false,'job_id',v_id,'state','pending',
                            'forfeit_consent_at', v_consent_at,
                            'consented_balance_cents', v_consented);
end $$;

-- raw 2·3인자 request 는 **동의 없는 경로**다 → 양수 잔액이면 job 생성 0.
create or replace function public.account_deletion_request(
  p_user_id uuid, p_cancelable_minutes int default 30, p_dry_run boolean default true)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  return public.account_deletion_request_consented(
    p_user_id, p_cancelable_minutes, p_dry_run, false, null);
end $$;

-- ── 3) self RPC ─────────────────────────────────────────────────────────────
-- self 응답 정형화 — 실패 코드는 그대로 전달하고, 성공 시에만 job 정보를 붙인다.
create or replace function public.account_deletion_self_response(p_user_id uuid, p_raw jsonb)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_job_id uuid; v_state text; v_cancelable timestamptz; v_dry boolean;
begin
  if coalesce((p_raw ->> 'ok')::boolean, false) is not true then
    return p_raw;
  end if;
  v_job_id := nullif(p_raw ->> 'job_id','')::uuid;
  select j.state, j.cancelable_until, j.dry_run into v_state, v_cancelable, v_dry
    from public.account_deletion_jobs j where j.id = v_job_id;
  return jsonb_build_object(
    'ok', true,
    'existing', coalesce((p_raw ->> 'existing')::boolean, true),
    'job_id', v_job_id,
    'state', v_state,
    'cancelable_until', v_cancelable,
    'dry_run', v_dry
  );
end $$;

-- 기존 2인자 시그니처를 **그 자리에서 안전하게** 재정의한다.
-- 동의 인자를 더한 오버로드를 신설하고 2인자를 남기면 앱이 안전장치를 우회한다 → 금지.
-- 그래서 2인자 함수 자체가 fail-closed 가 되게 만든다:
--   잔액 0  → 정상 job 생성
--   잔액 >0 → FORFEIT_CONSENT_REQUIRED, job 생성 0
create or replace function public.account_deletion_request_self(
  p_cancelable_minutes integer default 30,
  p_dry_run boolean default false
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := (select auth.uid());
  v_raw jsonb;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode = '28000'; end if;
  perform pg_advisory_xact_lock(hashtextextended('account_deletion_self:' || v_uid::text, 0));

  v_raw := public.account_deletion_request_consented(
    v_uid, greatest(0, coalesce(p_cancelable_minutes, 30)), coalesce(p_dry_run, false), false, null);
  return public.account_deletion_self_response(v_uid, v_raw);
end $$;

-- 동의를 수반하는 self 경로 — **별도 이름**이다(2인자 함수의 오버로드가 아니다).
-- 이 함수를 호출하는 행위 자체가 동의이며, 금액은 서버가 읽어 job 에 박제한다.
create or replace function public.account_deletion_request_self_consented(
  p_cancelable_minutes integer default 30,
  p_dry_run boolean default false,
  p_acknowledged_balance_cents bigint default null
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := (select auth.uid());
  v_raw jsonb;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode = '28000'; end if;
  perform pg_advisory_xact_lock(hashtextextended('account_deletion_self:' || v_uid::text, 0));

  v_raw := public.account_deletion_request_consented(
    v_uid, greatest(0, coalesce(p_cancelable_minutes, 30)), coalesce(p_dry_run, false),
    true, p_acknowledged_balance_cents);
  return public.account_deletion_self_response(v_uid, v_raw);
end $$;

-- ── 4) 2층 — 동의 검증 + `pending → locked` 원자 전이 ────────────────────────
-- worker 는 잔액을 따로 SELECT 하지 않는다. 이 함수 하나가 전부다.
-- 검증 실패 시 **어떤 행도 수정하지 않고** 반환하므로 job 은 pending 그대로 남는다.
create or replace function public.account_deletion_begin_locked(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_id uuid; v_state text; v_cancelable timestamptz;
  v_consent_at timestamptz; v_consented bigint; v_balance bigint; v_rows int;
begin
  v_id := public.account_deletion_active_job_id(p_user_id);
  if v_id is null then return jsonb_build_object('ok',false,'code','JOB_NOT_FOUND'); end if;

  -- ① 대상 deletion job 행 FOR UPDATE
  select j.state, j.cancelable_until, j.forfeit_consent_at, j.consented_balance_cents
    into v_state, v_cancelable, v_consent_at, v_consented
    from public.account_deletion_jobs j where j.id = v_id for update;
  if not found then return jsonb_build_object('ok',false,'code','JOB_NOT_FOUND'); end if;
  if v_state <> 'pending' then
    return jsonb_build_object('ok',false,'code','NOT_PENDING','state',v_state);
  end if;
  if v_cancelable is not null and now() < v_cancelable then
    return jsonb_build_object('ok',false,'code','CANCEL_WINDOW_OPEN','cancelable_until',v_cancelable);
  end if;

  -- ② 대상 cash_wallets 행 FOR UPDATE
  --    이 잠금을 먼저 잡으면, 뒤따르는 충전은 잠금 해제(=locked 커밋) 후
  --    151/154 write gate(adg_cash_wallets·adg_cash_ledger)에 의해 거부된다.
  select coalesce(w.balance_cents, 0) into v_balance
    from public.cash_wallets w where w.user_id = p_user_id for update;
  v_balance := coalesce(v_balance, 0);

  -- ③ 동의 시각·동의 금액·현재 잔액 검증
  if v_balance > 0 then
    if v_consent_at is null then
      return jsonb_build_object('ok',false,'code','FORFEIT_CONSENT_REQUIRED','current_balance_cents',v_balance);
    end if;
    -- 증가 → 재동의 요구(파괴 단계 0회). 감소·동일 → 현재 잔액만 몰수(권장 정책).
    if v_balance > coalesce(v_consented, 0) then
      return jsonb_build_object('ok',false,'code','FORFEIT_CONSENT_STALE',
        'consented_balance_cents', v_consented, 'current_balance_cents', v_balance);
    end if;
  end if;

  -- ④ 검증 성공 시에만 pending → locked
  update public.account_deletion_jobs
    set state='locked', locked_at=now(), updated_at=now()
    where id = v_id and state='pending';
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return jsonb_build_object('ok',false,'code','NOT_PENDING'); end if;

  return jsonb_build_object('ok',true,'state','locked','job_id',v_id,'balance_cents',v_balance);
end $$;

-- ── 5) raw advance 의 pending→locked 우회 차단 ──────────────────────────────
create or replace function public.account_deletion_advance(p_user_id uuid, p_from text, p_to text)
returns boolean language plpgsql security definer set search_path to 'public' as $$
declare v_rows int := 0; v_col text; v_id uuid;
begin
  -- 동의 검증을 건너뛰는 경로를 남기지 않는다 — 정본은 account_deletion_begin_locked 하나다.
  if p_from='pending' and p_to='locked' then
    raise exception 'USE_BEGIN_LOCKED: pending->locked must go through account_deletion_begin_locked'
      using errcode = '42501';
  end if;

  v_id := public.account_deletion_active_job_id(p_user_id);
  if v_id is null then return false; end if;

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

-- ── 6) 3층 — 몰수 RPC 의 동의 재검증(마지막 방어선) ─────────────────────────
-- 멱등키·reason 정본: `acct_del_forfeit:{uid}` / `account_deletion_forfeit`.
--   웹 즉시 경로가 쓰던 `forfeit_on_deletion:{uid}` / `forfeit_on_deletion` 은 그 경로 자체를
--   폐지하면서 함께 사라진다. 기존 원장 행은 **소급 수정하지 않는다**(append-only).
create or replace function public.account_deletion_forfeit_and_anonymize(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_id uuid; v_state text; v_balance bigint; v_ledger_id uuid;
  v_consent_at timestamptz; v_consented bigint;
begin
  perform set_config('ssambership.deletion_worker', 'on', true);

  v_id := public.account_deletion_active_job_id(p_user_id);
  if v_id is null then return jsonb_build_object('ok',false,'code','JOB_NOT_FOUND'); end if;
  select j.state, j.forfeit_consent_at, j.consented_balance_cents
    into v_state, v_consent_at, v_consented
    from public.account_deletion_jobs j where j.id = v_id for update;
  if v_state is null then return jsonb_build_object('ok',false,'code','JOB_NOT_FOUND'); end if;
  if v_state <> 'storage_purged' then
    return jsonb_build_object('ok',false,'code','WRONG_STATE','state',v_state);
  end if;

  select w.balance_cents into v_balance from public.cash_wallets w
    where w.user_id = p_user_id for update;

  if v_balance is not null and v_balance > 0 then
    -- 3층 동의 재검증 — 여기까지 왔다는 건 2층을 통과했다는 뜻이지만, 그래도 다시 본다.
    if v_consent_at is null then
      return jsonb_build_object('ok',false,'code','FORFEIT_CONSENT_REQUIRED','current_balance_cents',v_balance);
    end if;
    if v_balance > coalesce(v_consented, 0) then
      return jsonb_build_object('ok',false,'code','FORFEIT_CONSENT_STALE',
        'consented_balance_cents', v_consented, 'current_balance_cents', v_balance);
    end if;

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

-- ── 7) ACL ──────────────────────────────────────────────────────────────────
revoke all on function public.account_deletion_request_consented(uuid,int,boolean,boolean,bigint) from public, anon, authenticated;
revoke all on function public.account_deletion_request(uuid,int,boolean) from public, anon, authenticated;
revoke all on function public.account_deletion_begin_locked(uuid) from public, anon, authenticated;
revoke all on function public.account_deletion_advance(uuid,text,text) from public, anon, authenticated;
revoke all on function public.account_deletion_forfeit_and_anonymize(uuid) from public, anon, authenticated;
revoke all on function public.account_deletion_self_response(uuid,jsonb) from public, anon, authenticated;
revoke all on function public.account_deletion_request_self(integer, boolean) from public, anon;
revoke all on function public.account_deletion_request_self_consented(integer, boolean, bigint) from public, anon;

grant execute on function public.account_deletion_request_consented(uuid,int,boolean,boolean,bigint) to service_role;
grant execute on function public.account_deletion_request(uuid,int,boolean) to service_role;
grant execute on function public.account_deletion_begin_locked(uuid) to service_role;
grant execute on function public.account_deletion_advance(uuid,text,text) to service_role;
grant execute on function public.account_deletion_forfeit_and_anonymize(uuid) to service_role;
grant execute on function public.account_deletion_self_response(uuid,jsonb) to service_role;
grant execute on function public.account_deletion_request_self(integer, boolean) to authenticated, service_role;
grant execute on function public.account_deletion_request_self_consented(integer, boolean, bigint) to authenticated, service_role;

comment on function public.account_deletion_begin_locked(uuid) is
  '176: 동의·잔액·취소창 검증과 pending→locked 를 단일 트랜잭션으로. raw advance 의 pending→locked 는 거부된다.';
comment on function public.account_deletion_request_self(integer, boolean) is
  'P1-10/176: 본인 탈퇴 요청(동의 없음 경로). 양수 잔액이면 FORFEIT_CONSENT_REQUIRED 로 job 생성 0.';
comment on function public.account_deletion_request_self_consented(integer, boolean, bigint) is
  '176: 본인 탈퇴 요청 + 잔액 몰수 동의. 금액은 서버가 읽어 job 에 박제한다(오버로드 아님 — 별도 이름).';

commit;

-- ── §V 검증(적용 후 실행) ────────────────────────────────────────────────────
-- (1) 우회 가능한 레거시 오버로드 0
--     select p.oid::regprocedure::text, array_to_string(p.proacl,' | ')
--       from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--      where n.nspname='public' and p.proname like 'account_deletion_request%';
--     기대: request_self 는 (integer,boolean) 단 1종 · request 는 (uuid,int,boolean) 단 1종
-- (2) raw advance 우회 0 — select public.account_deletion_advance(<uid>,'pending','locked') → 42501
-- (3) 잔액>0 · 동의 없음 → job 생성 0 / 잔액>0 · 동의 → 몰수 원장 정확히 1행
-- (4) 동의 후 잔액 증가 → begin_locked 가 FORFEIT_CONSENT_STALE, state 는 pending 유지
--
-- ── ROLLBACK ────────────────────────────────────────────────────────────────
--   drop function if exists public.account_deletion_begin_locked(uuid);
--   drop function if exists public.account_deletion_request_self_consented(integer, boolean, bigint);
--   drop function if exists public.account_deletion_request_consented(uuid,int,boolean,boolean,bigint);
--   drop function if exists public.account_deletion_self_response(uuid,jsonb);
--   alter table public.account_deletion_jobs drop column if exists forfeit_consent_at;
--   alter table public.account_deletion_jobs drop column if exists consented_balance_cents;
--   -- request/advance/forfeit_and_anonymize/request_self 는 175(및 151/154/161) 원문 재적용으로 복원.
