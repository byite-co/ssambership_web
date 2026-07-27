-- 179_p1_10_account_deletion_consent_column_canon.sql
-- ⚠️ 기능 플래그 OFF 기본 · worker kill switch OFF 고정. 실제 사용자·객체 삭제 없음.
--    기존 SQL 175~178 파일은 **수정하지 않는다** — 여기서 재정의만 한다(W5-c §3-1).
--
-- W5-c §3-1: `consented_balance_cents` 를 **NOT NULL 정본**으로 확정한다.
--
-- ── 문제(W5 실행 결과와 개정 지시서 사이의 편차) ─────────────────────────────
--   176 은 잔액 0 경로에서 `v_consented := null` 로 두었다(176행 93). STALE·REQUIRED
--   가드는 `coalesce(v_consented, 0)` 으로 방어하고 있어 논리적 구멍은 없지만,
--   "동의 금액" 컬럼에 두 가지 무(無) 표현(NULL/0)이 공존하면 이후 코드가 coalesce 를
--   빠뜨리는 순간 조용히 오판한다. 표현을 하나로 줄인다:
--     · 잔액 > 0 동의 경로 → 동의 당시 FOR UPDATE 로 읽은 잔액 기록(현행 유지)
--     · 잔액 = 0 경로      → `consented_balance_cents = 0` **명시 기록**,
--                            `forfeit_consent_at` 은 null 유지(동의 행위 자체가 없었음)
--   NOT NULL 이후에는 NULL 을 넣는 어떤 신규 경로도 **삽입 시점에 즉시 실패**한다
--   (DEFAULT 0 은 컬럼 생략 경로용 — 명시적 NULL 은 구조적으로 거부된다).
--
-- ── 실측(staging lbeqxarxothkmzqvpudy, 2026-07-26 preflight) ──────────────────
--   account_deletion_jobs: total 1 · consented_balance_cents NULL 0행 → backfill 은
--   멱등 no-op 이지만 (a) 단계로 남겨 어떤 환경에서도 NOT NULL 승격이 실패하지 않게 한다.
--
-- ── job 생성 경로 전수(§2-3 표) ──────────────────────────────────────────────
--   insert 는 단 한 곳 — account_deletion_request_consented(uuid,int,boolean,boolean,bigint).
--   account_deletion_request(uuid,int,boolean) / account_deletion_request_self(integer,boolean)
--   / account_deletion_request_self_consented(integer,boolean,bigint) 은 전부 위 함수로
--   위임하므로 **재정의 대상은 request_consented 하나**다.
--
-- 선행: 151, 154, 161, 175, 176, 177, 178.

begin;
set local lock_timeout='5s';

-- ── (a) 기존 NULL 행 backfill ────────────────────────────────────────────────
update public.account_deletion_jobs
   set consented_balance_cents = 0
 where consented_balance_cents is null;

-- ── (b) DEFAULT 0 + NOT NULL 승격 ───────────────────────────────────────────
alter table public.account_deletion_jobs
  alter column consented_balance_cents set default 0;
alter table public.account_deletion_jobs
  alter column consented_balance_cents set not null;

comment on column public.account_deletion_jobs.consented_balance_cents is
  '179: 동의 당시 서버가 읽은 잔액(cents). NOT NULL — 잔액 0 요청은 0 을 명시 기록한다. '
  '동의 "행위" 유무는 forfeit_consent_at 로만 판정한다(0 과 NULL 의 이중 표현 제거). '
  '현재 잔액이 이 값보다 크면 FORFEIT_CONSENT_STALE.';

-- ── (c) 잔액 0 경로가 NULL 을 방치하던 유일한 insert 함수 재정의 ─────────────
-- 176 본문과의 차이는 잔액 0 분기 한 줄(v_consented := 0)뿐이다. 함수 본문 외 로직 변경 0.
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
    -- 잔액 0 사용자는 별도 몰수 동의 없이 진행한다.
    -- 179: NULL 방치 금지 — 0 을 명시 기록한다. 동의 행위 없음은 forfeit_consent_at null 로만 표현.
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

-- ── (d) ACL 재확인 — create or replace 는 기존 ACL 을 보존하지만 명시로 고정한다 ──
revoke all on function public.account_deletion_request_consented(uuid,int,boolean,boolean,bigint) from public, anon, authenticated;
grant execute on function public.account_deletion_request_consented(uuid,int,boolean,boolean,bigint) to service_role;

comment on function public.account_deletion_request_consented(uuid,int,boolean,boolean,bigint) is
  '179: 탈퇴 요청 정본(유일한 job insert 경로). 잔액>0 은 서버가 읽은 금액으로 동의 박제, '
  '잔액 0 은 consented_balance_cents=0 명시 기록(forfeit_consent_at 은 null). '
  '기존 STALE·REQUIRED 가드의 coalesce(v_consented,0) 은 방어적 중복으로 176/175 정의에 그대로 남는다.';

commit;

-- ── §V 검증(적용 후 실행) ────────────────────────────────────────────────────
-- (1) information_schema.columns: consented_balance_cents is_nullable='NO', column_default='0'
-- (2) 잔액 0 사용자 request → job.consented_balance_cents = 0 (NULL 아님)
-- (3) NULL 행 0: select count(*) from account_deletion_jobs where consented_balance_cents is null;
-- (4) begin_locked / forfeit RPC 의 STALE·REQUIRED 가드는 176 정의(coalesce 유지)가 그대로 동작
--
-- ── ROLLBACK ────────────────────────────────────────────────────────────────
--   alter table public.account_deletion_jobs alter column consented_balance_cents drop not null;
--   alter table public.account_deletion_jobs alter column consented_balance_cents drop default;
--   -- request_consented 는 176 원문 재적용으로 복원(backfill 된 0 은 되돌리지 않는다 — 정보 손실 없음:
--   --  0 이던 NULL 행은 forfeit_consent_at null 로 구분 가능).
