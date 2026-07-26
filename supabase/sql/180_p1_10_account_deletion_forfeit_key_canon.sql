-- 180_p1_10_account_deletion_forfeit_key_canon.sql
-- ⚠️ 기능 플래그 OFF 기본 · worker kill switch OFF 고정. 실제 사용자·객체 삭제 없음.
--    기존 SQL 151/154/161/175/176 파일은 **수정하지 않는다** — 여기서 재정의만 한다.
--
-- W5-c §3-2: 몰수 멱등키 정본 확정 + 레거시 키 이중 몰수 **구조적** 차단.
--
-- ── 정본 확정(문서화) ─────────────────────────────────────────────────────────
--   멱등키 정본  acct_del_forfeit:{uid}
--   reason 정본  account_deletion_forfeit
--   레거시 키    forfeit_on_deletion:{uid} / reason forfeit_on_deletion
--                — 웹 즉시 몰수 경로(64c4eb8 에서 폐지)가 쓰던 키. 경로 폐지로 신규 발생 0.
--                기존 원장 행은 **소급 수정 0** (append-only 불변).
--
-- ── 왜 가드가 필요한가 ────────────────────────────────────────────────────────
--   staging 실측(2026-07-26 재확인)은 양 키 모두 0행이지만, production 원장은 아직
--   실측 전이다. 두 키는 서로 다른 문자열이라 UNIQUE(idempotency_key)·on conflict 가
--   교차 중복을 막지 못한다 — 레거시 키로 이미 몰수된 사용자가 saga 경로에 들어오면
--   정본 키로 **한 번 더** 차감될 수 있다. 측정에 기대지 않고 구조로 0 을 만든다:
--   잔액 > 0 분기에서 신규 원장 insert 전에 레거시 키 존재를 검사하고, 있으면
--   insert·지갑 차감·익명화 **모두** 진행하지 않고 fail-closed 반환 + record_error 로
--   운영자 검토 대상으로 남긴다(레거시 행 존재 = 과거 이중 상태 — 사람이 원장을 보고
--   정리해야 할 사안이지 코드가 추측으로 이어갈 사안이 아니다).
--
-- ── 가드 위치·순서 ────────────────────────────────────────────────────────────
--   잔액 > 0 분기의 **첫 검사**로 둔다(동의 재검증보다 앞). 레거시 행 존재는 동의
--   상태와 무관한 하드 스톱이므로, 어떤 동의 상태에서도 결정적으로 같은 코드가
--   나오게 한다. 잔액 0/지갑 없음이면 몰수 분기 자체가 없으므로 가드 대상이 아니다
--   (레거시 행이 있어도 새 차감이 없어 이중 몰수가 성립하지 않는다 — 익명화는 진행).
--
-- 선행: 151, 154, 161, 175, 176, 179. 본문 기준은 176 §6(현행 정의) — 가드 외 불변.

begin;
set local lock_timeout='5s';

-- ── 1) 몰수 RPC 재정의 — 176 본문 + 레거시 키 가드 ──────────────────────────
create or replace function public.account_deletion_forfeit_and_anonymize(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_id uuid; v_state text; v_balance bigint; v_ledger_id uuid;
  v_consent_at timestamptz; v_consented bigint;
  v_legacy_key text;
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
    -- 180: 레거시 이중 몰수 가드 — 신규 원장 insert 전, 동의 재검증보다 먼저.
    --      insert·지갑 차감·익명화 전부 진행하지 않는다(fail-closed).
    v_legacy_key := 'forfeit_on_deletion:' || p_user_id::text;
    if exists (select 1 from public.cash_ledger l where l.idempotency_key = v_legacy_key) then
      perform public.account_deletion_record_error(
        p_user_id,
        'LEGACY_FORFEIT_LEDGER_PRESENT: legacy forfeit ledger row exists — operator review required');
      return jsonb_build_object('ok',false,'code','LEGACY_FORFEIT_LEDGER_PRESENT',
        'current_balance_cents', v_balance,
        'legacy_idempotency_key', v_legacy_key);
    end if;

    -- 3층 동의 재검증(176 불변) — 여기까지 왔다는 건 2층을 통과했다는 뜻이지만, 그래도 다시 본다.
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

-- ── 2) ACL 재확인(재정의로 초기화되지 않도록 명시 — 175/176 과 동일) ────────
revoke all on function public.account_deletion_forfeit_and_anonymize(uuid) from public, anon, authenticated;
grant execute on function public.account_deletion_forfeit_and_anonymize(uuid) to service_role;

comment on function public.account_deletion_forfeit_and_anonymize(uuid) is
  '154/176/180: storage_purged 에서만 잔액 몰수(정본 키 acct_del_forfeit:{uid} / reason account_deletion_forfeit)'
  ' + 익명화. 레거시 키 forfeit_on_deletion:{uid} 원장 행이 있으면 LEGACY_FORFEIT_LEDGER_PRESENT 로'
  ' fail-closed(이중 몰수 구조적 차단, record_error 로 운영자 검토 대상).';

commit;

-- ── §V 검증(적용 후 실행 — T31~T33, 별도 begin; … rollback; 배치) ───────────
-- T31 레거시 키 원장 행 + 잔액>0 + storage_purged → 신규 원장 0행 · 지갑 불변 ·
--     익명화 미진행 · code=LEGACY_FORFEIT_LEDGER_PRESENT · record_error 기록
-- T32 레거시 행 없음 → 정본 키 정확히 1행 · 재호출 멱등(기존 T11·T12 재확인)
-- T33 레거시 행 + 잔액 0 → 몰수 분기 미진입(가드 미발동) · 익명화 진행
--
-- ── ROLLBACK ────────────────────────────────────────────────────────────────
--   -- 함수는 176 §6 원문(account_deletion_forfeit_and_anonymize)을 다시 실행해 복원한다.
--   -- 파일 무수정 원칙이므로 176 원문 그대로 재적용 가능. 원장 행 소급 수정은 어떤 경우에도 0.
