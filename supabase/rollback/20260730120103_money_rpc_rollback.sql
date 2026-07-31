-- =============================================================================
-- 20260730120103_money_rpc_rollback.sql (S2 M9 rollback)
-- =============================================================================
-- M9 역적용 — 계약 §22 #3(F11 롤백은 코드 우선 — 웹 호출점을 레거시로 되돌린 뒤
-- 실행한다 · 레거시 함수의 내부 구현 교체분은 구 본문 복원 migration 으로) · #4(웹
-- 코드 롤백이 DB 롤백보다 먼저) · #5(레거시는 계속 살아 있으므로 안전).
-- 순서: ① 신규 진입점 2종 DROP → ② 레거시 record_cash_topup 020 구 본문 문자
--       그대로 복원(다시 공용 구현부를 참조하지 않게) → ③ 공용 구현부 DROP.
-- cash_ledger 에 신규 DDL 이 없으므로(rev 8 A-6 — ref_text 폐기) 데이터 소실
-- 시나리오가 없다(§22 #3). F11·F12·레거시가 만든 원장·지갑·구독·결제 행은 정상
-- 업무 데이터이므로 되돌리지 않는다(§22 #8 — 데이터 롤백은 없다).
-- ACL: 레거시 함수의 proacl 은 forward·rollback 모두 건드리지 않는다(024/072 상태
--      유지). CREATE OR REPLACE 는 기존 proacl 을 보존한다.
-- =============================================================================

begin;

-- 사전 확인: M9 적용 상태
DO $$
BEGIN
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE (n.nspname = 'api_web_v1' AND p.proname IN ('record_cash_topup_v2','subscription_checkout_confirm_v2'))
          OR (n.nspname = 'core_private' AND p.proname = 'record_cash_topup_impl')) <> 3 THEN
    RAISE EXCEPTION 'S2_M9_ROLLBACK: M9 objects not in expected state';
  END IF;
END $$;

-- ① 신규 진입점 DROP (RESTRICT — 의존 객체가 있으면 실패해야 한다)
DROP FUNCTION api_web_v1.subscription_checkout_confirm_v2(uuid, uuid, integer, text) RESTRICT;
DROP FUNCTION api_web_v1.record_cash_topup_v2(uuid, bigint, text) RESTRICT;

-- ② 레거시 public.record_cash_topup — 020_p0_cash_topup_charge.sql 구 본문 문자
--    그대로 복원(§22 #3). 시그니처·void·SECDEF·search_path·ACL 불변.
create or replace function public.record_cash_topup(
  p_user_id uuid,
  p_amount_cents bigint,
  p_idempotency_key text
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_new_ledger_id uuid;
  v_wu int;
  v_idem text;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;
  v_idem := nullif(trim(coalesce(p_idempotency_key, '')), '');
  if v_idem is null or length(v_idem) = 0 then
    raise exception 'p_idempotency_key is required';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'p_amount_cents must be positive';
  end if;
  if p_amount_cents > 1000000000 then
    raise exception 'p_amount_too_large';
  end if;

  insert into public.cash_ledger (user_id, delta_cents, reason, ref_type, ref_id, idempotency_key)
  values (
    p_user_id,
    p_amount_cents,
    'cash_topup',
    'topup',
    null,
    v_idem
  )
  on conflict (idempotency_key) do nothing
  returning id into v_new_ledger_id;

  if v_new_ledger_id is null then
    return;
  end if;

  insert into public.cash_wallets (user_id, balance_cents)
  values (p_user_id, 0)
  on conflict (user_id) do nothing;

  update public.cash_wallets w
  set balance_cents = w.balance_cents + p_amount_cents
  where w.user_id = p_user_id;
  get diagnostics v_wu = row_count;
  if coalesce(v_wu, 0) = 0 then
    raise exception 'CASH_WALLET_UPSERT_FAILED' using errcode = 'P0001';
  end if;
end;
$function$;

-- ③ 공용 구현부 DROP (레거시 복원 후 — 참조 0 상태에서 제거)
DROP FUNCTION core_private.record_cash_topup_impl(uuid, bigint, text) RESTRICT;

-- 자가 검증: M9 이전 상태 복원 확인
DO $$
DECLARE
  v_oid oid;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE (n.nspname = 'api_web_v1' AND p.proname IN ('record_cash_topup_v2','subscription_checkout_confirm_v2'))
                 OR (n.nspname = 'core_private' AND p.proname = 'record_cash_topup_impl')) THEN
    RAISE EXCEPTION 'S2_M9_ROLLBACK_SELFCHECK: M9 objects must be absent';
  END IF;
  SELECT p.oid INTO v_oid
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'record_cash_topup'
     AND pg_get_function_identity_arguments(p.oid) = 'p_user_id uuid, p_amount_cents bigint, p_idempotency_key text'
     AND p.prorettype = 'void'::regtype AND p.prosecdef
     AND p.prosrc NOT LIKE '%core_private%';
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'S2_M9_ROLLBACK_SELFCHECK: legacy record_cash_topup restore mismatch';
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'S2_M9_ROLLBACK_SELFCHECK: legacy record_cash_topup ACL drift';
  END IF;
  -- census 복원: api_web_v1 12(M6 6+M7 3+M8 2+M14 1) · core_private 5(F10+B 4종)
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'api_web_v1') <> 12 THEN
    RAISE EXCEPTION 'S2_M9_ROLLBACK_SELFCHECK: api_web_v1 census must be 12';
  END IF;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'core_private') <> 5 THEN
    RAISE EXCEPTION 'S2_M9_ROLLBACK_SELFCHECK: core_private census must be 5';
  END IF;
END $$;

commit;
