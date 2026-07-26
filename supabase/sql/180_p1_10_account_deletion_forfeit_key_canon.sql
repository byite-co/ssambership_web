-- 180_p1_10_account_deletion_forfeit_key_canon.sql
-- ⚠️ 기능 플래그 OFF 기본 · worker kill switch OFF 고정. 실제 사용자·객체 삭제 없음.
--    기존 SQL 175~179 파일은 **수정하지 않는다** — 여기서 재정의만 한다(W5-c §3-2).
--
-- W5-c §3-2: 몰수 멱등키 **정본 확정** + 레거시 키 이중 몰수 **구조적 차단**.
--
-- ── 정본(문서화) ─────────────────────────────────────────────────────────────
--   멱등키 정본  acct_del_forfeit:{uid}
--   reason 정본  account_deletion_forfeit
--   레거시 키    forfeit_on_deletion:{uid} / reason forfeit_on_deletion
--                — 웹 즉시 몰수 경로(64c4eb8 에서 폐지) 가 쓰던 키. 신규 발생 경로는 없다.
--                기존 원장 행은 **소급 수정 0** (cash_ledger 는 append-only).
--
-- ── 왜 가드인가 ──────────────────────────────────────────────────────────────
--   staging 은 양 키 0행 실측(2026-07-26 preflight 재확인)이지만 production 원장은
--   아직 실측 전이다. 측정에 기대지 않고 **구조로** 이중 몰수를 0으로 만든다:
--   과거 웹 즉시 경로가 이미 `forfeit_on_deletion:{uid}` 로 몰수한 사용자가 saga 로
--   다시 들어오면, 정본 키 원장은 ON CONFLICT 에 걸리지 않으므로(키가 다르다) 같은
--   지갑이 두 번 몰수될 수 있다. 그 분기를 insert **전에** fail-closed 로 끊는다.
--
-- ── 가드 계약 ────────────────────────────────────────────────────────────────
--   잔액 > 0 분기에서 신규 원장 insert 전에 레거시 키 존재를 확인하고, 존재하면
--   insert·지갑 차감·익명화 **모두 진행하지 않고**
--     jsonb: ok=false, code='LEGACY_FORFEIT_LEDGER_PRESENT',
--            current_balance_cents, legacy_idempotency_key
--   를 반환한다. 운영자 검토 대상으로 record_error 를 남긴다(attempts·backoff 경유 —
--   자동 재시도가 같은 코드로 반복 실패하면 175 계약대로 failed 로 넘어가 사람이 본다).
--   잔액 = 0 이면 몰수 분기 자체에 진입하지 않으므로 가드 대상이 아니다(익명화는 진행).
--
-- 선행: 151, 154, 161, 175, 176, 177, 178, 179.

begin;
set local lock_timeout='5s';

-- ── 몰수 RPC 재정의 — 176 본문 + 잔액>0 분기의 레거시 키 가드 ────────────────
create or replace function public.account_deletion_forfeit_and_anonymize(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_id uuid; v_state text; v_balance bigint; v_ledger_id uuid;
  v_consent_at timestamptz; v_consented bigint; v_legacy_key text;
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

    -- 180: 레거시 이중 몰수 가드 — 정본 키 insert 는 레거시 키와 충돌하지 않으므로
    -- ON CONFLICT 멱등이 이 케이스를 잡지 못한다. insert 전에 fail-closed 로 끊는다.
    v_legacy_key := 'forfeit_on_deletion:' || p_user_id::text;
    if exists (select 1 from public.cash_ledger l where l.idempotency_key = v_legacy_key) then
      perform public.account_deletion_record_error(
        p_user_id, 'LEGACY_FORFEIT_LEDGER_PRESENT: 운영자 검토 필요 — 레거시 몰수 원장 존재, 재몰수 차단');
      return jsonb_build_object('ok',false,'code','LEGACY_FORFEIT_LEDGER_PRESENT',
        'current_balance_cents', v_balance,
        'legacy_idempotency_key', v_legacy_key);
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

-- ── ACL 재확인 ───────────────────────────────────────────────────────────────
revoke all on function public.account_deletion_forfeit_and_anonymize(uuid) from public, anon, authenticated;
grant execute on function public.account_deletion_forfeit_and_anonymize(uuid) to service_role;

comment on function public.account_deletion_forfeit_and_anonymize(uuid) is
  '180: 몰수 멱등키 정본 acct_del_forfeit:{uid} / reason account_deletion_forfeit. '
  '레거시 forfeit_on_deletion:{uid} 원장이 이미 있으면 잔액>0 분기를 '
  'LEGACY_FORFEIT_LEDGER_PRESENT 로 fail-closed(원장 insert·지갑 차감·익명화 0, record_error). '
  '잔액 0 은 가드 대상 아님 — 익명화 진행. 원장 행 소급 수정 0(append-only).';

commit;

-- ── §V 검증(적용 후 실행) ────────────────────────────────────────────────────
-- (1) 레거시 키 원장 + storage_purged + 잔액>0 → 몰수 RPC: 신규 원장 0행, 지갑 불변,
--     익명화 미진행, code=LEGACY_FORFEIT_LEDGER_PRESENT, attempts +1 (record_error)
-- (2) 레거시 없음 → 정본 키 정확히 1행 + 지갑 0. 재호출 멱등(원장 여전히 1행)
-- (3) 레거시 존재 + 잔액 0 → ok=true, 몰수 분기 미진입(원장 신규 0행), 익명화 진행
--
-- ── ROLLBACK ────────────────────────────────────────────────────────────────
--   -- 176 원문 재적용으로 forfeit_and_anonymize 를 복원(가드 제거). 데이터 변경 없음.
