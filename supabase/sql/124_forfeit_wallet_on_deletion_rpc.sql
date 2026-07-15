-- =============================================================================
-- 124: 계정 탈퇴 잔액 소멸 원자화 RPC — forfeit_wallet_on_deletion (XV-CASH-FORFEIT)
-- =============================================================================
-- 배경(XV-CASH-FORFEIT): accountDeletionActions.ts 의 잔액 소멸이 두 단계로 쪼개져
--   있었다 — ① cash_ledger 에 -스냅샷잔액 상계 라인 insert, ② cash_wallets 를
--   balance_cents=0 로 update. 두 문제:
--     (a) 비원자적: ①과 ② 사이 크래시 시 원장은 소멸했는데 지갑 잔액은 남음(불변식
--         '지갑 = 원장 합계' 깨짐).
--     (b) 스냅샷 경합: 상계액이 사전조건 조회 시점의 walletBalanceCents 이고, 이후
--         지갑을 무조건 0 으로 덮어써서 그 사이 동시 충전/환불이 있으면 (i) 그 금액이
--         소리 없이 소멸되고 (ii) 원장 delta 와 실제 지갑 감소분이 어긋난다.
-- 조치: 단일 트랜잭션·행잠금 RPC 로 원자화한다. 지갑 행을 FOR UPDATE 로 잠그고 '실제
--   현재 잔액'을 읽어 그 값만큼만 상계 라인을 남기고 지갑을 감액(→0)한다. 멱등키
--   forfeit_on_deletion:<uid> + FOR UPDATE 직렬화 + on conflict 로 이중 실행/경합에
--   모두 안전. 소멸할 잔액이 없으면(지갑 없음·0) no-op(0 반환).
-- 성격: 재실행 안전(create or replace). service_role 전용(돈 경로 규약, 019 등과 동일).
-- 사전 조건: 004(cash_wallets, cash_ledger.idempotency_key unique).
-- 검증: 파일 하단 §V.
-- =============================================================================

create or replace function public.forfeit_wallet_on_deletion(p_user_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_balance bigint;
  v_idem text := 'forfeit_on_deletion:' || p_user_id::text;
  v_ledger_id uuid;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;

  -- 멱등: 이미 소멸 라인이 있으면 재계산 없이 종료(지갑은 이미 0화됨)
  if exists (
    select 1 from public.cash_ledger
    where idempotency_key = v_idem
      and reason = 'forfeit_on_deletion'
  ) then
    return 0;
  end if;

  -- 지갑 행 잠금 + 현재 실잔액 (동시 충전/환불과의 경합 차단, 스냅샷 오차 방지)
  select balance_cents into v_balance
  from public.cash_wallets
  where user_id = p_user_id
  for update;

  if not found or coalesce(v_balance, 0) <= 0 then
    return 0; -- 소멸할 잔액 없음(지갑 없음 또는 0)
  end if;

  -- append-only 상계 라인 — 반드시 '잠근 실잔액' 기준(스냅샷 아님)
  insert into public.cash_ledger (user_id, delta_cents, reason, ref_type, ref_id, idempotency_key)
  values (p_user_id, -v_balance, 'forfeit_on_deletion', 'account_deletion', p_user_id, v_idem)
  on conflict (idempotency_key) do nothing
  returning id into v_ledger_id;

  if v_ledger_id is null then
    return 0; -- 경합으로 이미 삽입됨(멱등)
  end if;

  -- 원장과 정확히 상계되도록 잠근 잔액만큼 감액(→ 0). FOR UPDATE 하에 balance=v_balance.
  update public.cash_wallets
  set balance_cents = balance_cents - v_balance
  where user_id = p_user_id;

  return v_balance;
end;
$function$;

comment on function public.forfeit_wallet_on_deletion(uuid) is
  'XV-CASH-FORFEIT: 탈퇴 잔액 소멸 원자화 — 지갑 잠금·실잔액 상계 라인·0화 단일 tx(멱등). service_role only.';

revoke all on function public.forfeit_wallet_on_deletion(uuid) from public;
revoke all on function public.forfeit_wallet_on_deletion(uuid) from anon;
revoke all on function public.forfeit_wallet_on_deletion(uuid) from authenticated;
grant execute on function public.forfeit_wallet_on_deletion(uuid) to service_role;

-- =============================================================================
-- §V. 적용 직후 검증 (Supabase SQL Editor 에서 수동 실행 — rollback 권장)
-- =============================================================================
-- §V-a. 잔액 있음 → 소멸 1회:
--   begin;
--     select public.forfeit_wallet_on_deletion('<uid>'::uuid);  -- 기대: 소멸액
--     select balance_cents from public.cash_wallets where user_id='<uid>'::uuid; -- 기대 0
--     select delta_cents, reason from public.cash_ledger
--       where idempotency_key = 'forfeit_on_deletion:<uid>';    -- 기대 -소멸액
--   rollback;
-- §V-b. 멱등: 같은 tx 에서 두 번째 호출은 0 반환, 원장 라인 1건 유지.
-- =============================================================================
