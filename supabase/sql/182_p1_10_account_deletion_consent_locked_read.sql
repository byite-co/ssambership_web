-- 182_p1_10_account_deletion_consent_locked_read.sql
-- ⚠️ 기능 플래그 OFF 기본 · worker kill switch OFF 고정. 실제 사용자·객체 삭제 없음.
--    기존 SQL 167~181 파일은 **수정하지 않는다** — request_consented 하나만 재정의한다(W5-e E3).
--
-- W5-e E3: 동의 스냅샷 FOR UPDATE 잠금 읽기 재정정.
--
-- ── 문제(W5-e §2-3 실측 — 이중 실행의 후퇴) ──────────────────────────────────
--   01c 가 두 세션에서 실행되며 179 가 A·B 두 판본으로 갈라졌다.
--   A라인(d12hk2)은 동의 잔액을 `cash_wallets ... FOR UPDATE` 로 잠그고 읽었으나,
--   staging 에 나중에 적용된 B라인(cx52cq = 정본)은 무잠금 읽기다 — live prosrc 에
--   'for update' 부재를 2026-07-26 재확인했다(179 파일 머리 주석은 "FOR UPDATE 로 읽은
--   잔액 기록"이라 주장하지만 본문이 따르지 않는다). 무잠금이면 동의 스냅샷을 읽는
--   순간과 job insert 사이에 충전 커밋이 끼어들 수 있고, 그 순간의 동의 금액은
--   실잔액보다 작게 박제된다(begin_locked 의 STALE 가드가 2층에서 잡지만,
--   1층 스냅샷 자체가 정확해야 한다는 것이 A라인 정정의 취지였다).
--
-- ── 조치 ──────────────────────────────────────────────────────────────────────
--   account_deletion_request_consented(uuid,int,boolean,boolean,bigint) 재정의:
--   (a) 동의 잔액을 public.cash_wallets 에서 FOR UPDATE 로 읽어 스냅샷 기록
--       (지갑 행이 없으면 잠글 행도 없다 — v_balance null → 0. begin_locked 가 재검증).
--   (b) 그 외 본문은 B본(179 재정의)과 동일 — 잔액 0 → v_consented := 0 명시 기록 포함.
--   (c) begin_locked 등 다른 함수 변경 0. 이 파일은 이 함수 하나만 담는다.
--
-- 선행: 175, 176, 177, 178, 179, 180, 181.

begin;
set local lock_timeout='5s';

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

  -- 잔액은 **서버가 잠그고 읽는다**(182: FOR UPDATE — 동의 스냅샷이 기록되는 트랜잭션과
  -- 충전 커밋이 서로 끼어들지 못한다. A라인 정정의 정본 이식). 지갑 행이 없으면 0.
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

-- ACL 재확인 — create or replace 는 기존 ACL 을 보존하지만 명시로 고정한다(179 와 동일).
revoke all on function public.account_deletion_request_consented(uuid,int,boolean,boolean,bigint) from public, anon, authenticated;
grant execute on function public.account_deletion_request_consented(uuid,int,boolean,boolean,bigint) to service_role;

comment on function public.account_deletion_request_consented(uuid,int,boolean,boolean,bigint) is
  '182: 동의 스냅샷은 잠금 읽기(cash_wallets FOR UPDATE) — A라인 정정의 정본 이식. '
  '그 외 본문은 179(B본)와 동일: 유일한 job insert 경로 · 잔액>0 은 서버가 잠그고 읽은 '
  '금액으로 동의 박제 · 잔액 0 은 consented_balance_cents=0 명시 기록(forfeit_consent_at 은 null).';

commit;

-- ── §V 검증(적용 후 실행 — T37~T39, 별도 begin; … rollback; 배치) ─────────────
-- T37 pg_proc prosrc 에 'for update' 존재 (재정의 반영 확인)
-- T38 T27 재실행 — 잔액 0 job 생성 → consented_balance_cents = 0 (NULL 아님)
-- T39 T28b 재실행 — 동의 100 기록 → 충전 200 → begin_locked FORFEIT_CONSENT_STALE · pending 유지
--
-- ── ROLLBACK ────────────────────────────────────────────────────────────────
--   179 (c) 절의 함수 정의 재적용(무잠금 읽기로 복귀 — 권장하지 않음).
--   컬럼·다른 함수는 일절 변경하지 않았다.
