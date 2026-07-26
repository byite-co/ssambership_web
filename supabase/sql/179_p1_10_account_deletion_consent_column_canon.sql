-- 179_p1_10_account_deletion_consent_column_canon.sql
-- ⚠️ 기능 플래그 OFF 기본 · worker kill switch OFF 고정. 실제 사용자·객체 삭제 없음.
--    기존 SQL 151/154/161/175/176 파일은 **수정하지 않는다** — 여기서 재정의만 한다.
--
-- W5-c §3-1: `consented_balance_cents` 정본화 — "기록 없음(NULL)"을 폐기한다.
--
-- ── 문제(기준 HEAD c4ce3e8 · staging 실측 2026-07-26) ────────────────────────
--   176 은 잔액 0 경로에서 `v_consented := null` 로 두어, 같은 컬럼의 NULL 이
--   "동의 없이 생성된 구(151/161 시대) 행"과 "잔액 0 이라 동의가 불요했던 행"의
--   두 의미를 겸했다. 가드는 전부 coalesce(v_consented, 0) 로 방어하고 있어
--   동작 차이는 없지만, 컬럼을 읽는 쪽마다 NULL 해석을 다시 해야 하는 편차다.
--   실측: account_deletion_jobs 총 1행 · consented_balance_cents NULL 1행.
--
-- ── 실측 — job 생성(insert) 경로 전수(pg_proc 본문 검사, staging) ─────────────
--   insert 를 직접 수행하는 함수는 **account_deletion_request_consented 단 하나**다.
--     account_deletion_request(uuid,int,boolean)                  → consented 로 위임(false,null)
--     account_deletion_request_self(integer,boolean)              → consented 로 위임(false,null)
--     account_deletion_request_self_consented(integer,boolean,bigint) → consented 로 위임(true,ack)
--   따라서 NULL 을 만드는 함수도 하나뿐이고, 재정의 범위도 그 하나다.
--
-- ── 계약 ─────────────────────────────────────────────────────────────────────
--   (a) 기존 NULL 행 backfill = 0 (동작 의미 불변: 가드는 이미 coalesce 0 이었다)
--   (b) default 0 · not null — 이후 어떤 경로도 NULL 을 만들 수 없다
--   (c) 잔액 0 경로는 0 을 **명시 기록**, forfeit_consent_at 은 null 유지
--       (의미 있는 NULL 은 "몰수 동의 자체가 없었음" = forfeit_consent_at 하나로 수렴).
--       잔액 > 0 동의 경로는 동의 당시 잔액을 기록하되, 그 읽기를 FOR UPDATE 로
--       정본화한다(176 실측: 일반 읽기였다 — 기록 트랜잭션 동안 충전이 끼어들어
--       기록값과 실잔액이 어긋난 채 커밋되는 창을 닫는다. 2층 begin_locked 의
--       STALE 가드는 불변 — 방어 계층은 줄지 않는다).
--   (d) 기존 STALE·REQUIRED 가드의 coalesce(v_consented, 0) 은 **유지**한다
--       (NOT NULL 이후에도 방어적 중복으로 남긴다 — 176/180 쪽 함수는 건드리지 않는다).
--   (e) 위 외 로직 변경 0. 175~178 파일 자체는 건드리지 않는다.
--
-- 선행: 151, 154, 161, 175, 176.

begin;
set local lock_timeout='5s';

-- ── 1) 기존 NULL 행 backfill ─────────────────────────────────────────────────
update public.account_deletion_jobs
  set consented_balance_cents = 0
  where consented_balance_cents is null;

-- ── 2) 컬럼 정본화: default 0 · not null ─────────────────────────────────────
alter table public.account_deletion_jobs
  alter column consented_balance_cents set default 0;
alter table public.account_deletion_jobs
  alter column consented_balance_cents set not null;

comment on column public.account_deletion_jobs.consented_balance_cents is
  '176/179: 동의 당시 서버가 잠그고 읽은 잔액(cents). 잔액 0 경로는 0 을 명시 기록(NULL 불가 — 179). '
  '현재 잔액이 이보다 크면 FORFEIT_CONSENT_STALE. 동의 유무 자체는 forfeit_consent_at 로만 판정한다.';

-- ── 3) 유일한 insert 경로 재정의 — 잔액 0 도 명시 기록 ──────────────────────
-- 위임 3종(request / request_self / request_self_consented)은 값을 직접 쓰지 않으므로
-- 재정의하지 않는다(본문 불변 — 이 함수 하나가 전 생성 경로의 기록을 결정한다).
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

  -- 잔액은 **서버가 잠그고 읽는다**(179 (c): FOR UPDATE 정본화 — 동의 금액이 기록되는
  -- 트랜잭션과 충전이 서로 끼어들지 못한다). 지갑 행이 없으면 0.
  select coalesce(w.balance_cents, 0) into v_balance
    from public.cash_wallets w where w.user_id = p_user_id for update;
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
    -- 잔액 0 사용자는 별도 몰수 동의 없이 진행한다.
    -- 179 (c): 0 을 명시 기록 — "동의 없음"은 forfeit_consent_at IS NULL 하나로만 표현한다.
    v_consent_at := null;
    v_consented := 0;
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

-- ── 4) ACL 재확인(재정의로 초기화되지 않도록 명시 — 176 §7 과 동일) ─────────
revoke all on function public.account_deletion_request_consented(uuid,int,boolean,boolean,bigint) from public, anon, authenticated;
grant execute on function public.account_deletion_request_consented(uuid,int,boolean,boolean,bigint) to service_role;

commit;

-- ── §V 검증(적용 후 실행 — T27~T30, 별도 begin; … rollback; 배치) ───────────
-- T27 잔액 0 사용자 job 생성 → consented_balance_cents = 0 (NULL 아님) · forfeit_consent_at null
-- T28 T27 job 에 지갑 +100 후 begin_locked → FORFEIT_CONSENT_STALE · pending 유지
-- T29 information_schema: is_nullable = NO · column_default = 0
-- T30 backfill 후 consented_balance_cents IS NULL 0행
--
-- ── ROLLBACK ────────────────────────────────────────────────────────────────
--   alter table public.account_deletion_jobs alter column consented_balance_cents drop not null;
--   alter table public.account_deletion_jobs alter column consented_balance_cents drop default;
--   -- 함수는 176 원문(account_deletion_request_consented)을 다시 실행해 복원한다.
--   -- backfill(0) 은 되돌리지 않는다 — NULL 과 0 은 가드 상 동일 의미였다(coalesce 0).
