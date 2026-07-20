-- 153_p2_25_pay_due_payouts_convergence.sql
-- P2-25 내부지갑 지급 스택 수렴 — 108(DRAFT 미적용) 정본화 + 114 원천징수 컬럼 + 전역 UNIQUE.
--
-- 배경(staging 실측): payout_runs·payout_run_items·due_payouts·per-run UNIQUE 는 적용됨(out-of-band).
--   그러나 108 RPC(pay_due_payouts_for_run) 미적용, 114 원천징수 컬럼(withholding/net) 미적용,
--   전역 (source_type,source_id) UNIQUE 미존재. → 이 수렴 파일이 정본.
-- 결함 수정(108 대비):
--   (1) 전역 UNIQUE(source_type,source_id) — 다른 배치 재실행에도 동일 source 이중지급 불가.
--   (2) ON CONFLICT (source_type,source_id) + RETURNING id INTO v_item_id — 실제 신규 행일 때만.
--   (3) 신규 성공행만 합계(v_paid/v_total) 반영 — 기존 108 은 conflict(중복)에도 카운트 증가하는 버그.
--   (4) p_dry_run(기본 true) — 돈 이동 0(원장·지갑·상태·행 삽입 없음), 예상 지급건·합계만 산출.
--   (5) 원천징수 3.3% 컬럼 스냅샷(net_paid_cents) — 적립 후 공제 라인으로 순액화(append-only 원장).
-- scheduler 는 기본 OFF(이 RPC 는 배치 프리미티브일 뿐 — cron 미설정. 실행은 명시 호출).
-- payout_run_items staging 0행(전역 UNIQUE 안전). 105/106/107/109/110/111/114 정의는 무수정.
-- 선행: 106(payout_runs/items)·107/111(due_payouts)·109/110(primitive)·105(gating).

begin;
set local lock_timeout='5s';

-- (114) 원천징수·실지급 스냅샷 컬럼(불변 원장성 추적).
alter table public.payout_run_items add column if not exists withholding_cents bigint not null default 0;
alter table public.payout_run_items add column if not exists net_paid_cents bigint;

-- (전역 UNIQUE) 동일 source 는 전 배치 통틀어 1회만 지급 스냅샷(다른 배치 재실행 이중지급 차단).
do $$
begin
  if not exists (select 1 from pg_constraint where conname='payout_run_items_source_global_uq' and conrelid='public.payout_run_items'::regclass) then
    alter table public.payout_run_items add constraint payout_run_items_source_global_uq unique (source_type, source_id);
  end if;
end $$;

create or replace function public.pay_due_payouts_for_run(
  p_run_date date,
  p_idempotency_key text default null,
  p_dry_run boolean default true
)
returns table (
  run_id uuid,
  paid_count integer,
  skipped_no_account integer,
  total_mentor_cents bigint,
  total_withholding_cents bigint,
  total_net_cents bigint,
  dry_run boolean
)
language plpgsql security definer set search_path = public
as $function$
declare
  v_idem text := coalesce(p_idempotency_key, 'payout:' || to_char(p_run_date, 'YYYY-MM'));
  v_cutoff timestamptz := date_trunc('month', p_run_date::timestamp) - interval '1 second';
  v_run public.payout_runs%rowtype;
  v_run_id uuid;
  rec record;
  v_ledger_id uuid; v_item_id uuid; v_has_account boolean;
  v_paid int := 0; v_skipped int := 0;
  v_total bigint := 0; v_total_wh bigint := 0; v_total_net bigint := 0;
  v_withholding bigint; v_net bigint; v_wh_ledger_id uuid;
begin
  -- dry-run: 돈 이동·행 삽입 없이 예상 지급건·합계만 계산(run 헤더도 만들지 않음).
  if not p_dry_run then
    select * into v_run from public.payout_runs where idempotency_key = v_idem;
    if found then
      v_run_id := v_run.id;
      if v_run.status = 'completed' then
        return query select v_run.id, v_run.mentor_count, 0, v_run.total_mentor_cents,
          coalesce((select sum(withholding_cents) from public.payout_run_items where payout_run_id=v_run.id),0),
          coalesce((select sum(net_paid_cents) from public.payout_run_items where payout_run_id=v_run.id),0), false;
        return;
      end if;
    else
      insert into public.payout_runs (run_date, cutoff_end, status, idempotency_key)
      values (p_run_date, v_cutoff, 'executing', v_idem) returning id into v_run_id;
    end if;
  end if;

  for rec in
    select d.* from public.due_payouts d
    where d.completion_ts <= v_cutoff
      and not exists (select 1 from public.payout_run_items i where i.source_type=d.source_type and i.source_id=d.source_id)
    order by d.mentor_id, d.source_type, d.completion_ts
  loop
    select coalesce(nullif(trim(mp.payout_account_number), ''), '') <> '' into v_has_account
      from public.mentor_profiles mp where mp.user_id = rec.mentor_id;
    if coalesce(v_has_account, false) = false then
      v_skipped := v_skipped + 1; continue;
    end if;

    v_withholding := floor(rec.mentor_amount_cents::numeric * 0.033)::bigint;
    v_net := rec.mentor_amount_cents - v_withholding;

    if p_dry_run then
      -- 예상만 집계(돈 이동·삽입 없음).
      v_paid := v_paid + 1; v_total := v_total + rec.mentor_amount_cents;
      v_total_wh := v_total_wh + v_withholding; v_total_net := v_total_net + v_net;
      continue;
    end if;

    v_ledger_id := null;
    if rec.source_type = 'custom_request' then
      perform public.record_custom_order_escrow_payout(rec.source_id);
      select id into v_ledger_id from public.cash_ledger
        where idempotency_key = 'cr_payout_' || rec.source_id::text and reason='custom_order_escrow_payout' limit 1;
    elsif rec.source_type = 'individual_question' then
      perform public.release_individual_question_payout(rec.source_id);
      select id into v_ledger_id from public.cash_ledger
        where idempotency_key = 'iq_payout:' || rec.source_id::text and reason='individual_question_payout' limit 1;
    elsif rec.source_type = 'subscription' then
      insert into public.cash_ledger (user_id, delta_cents, reason, ref_type, ref_id, idempotency_key)
      values (rec.mentor_id, rec.mentor_amount_cents, 'subscription_settlement_payout',
              'subscription_settlement_items', rec.source_id, 'sub_payout:' || rec.source_id::text)
      on conflict (idempotency_key) do nothing returning id into v_ledger_id;
      if v_ledger_id is not null then
        insert into public.cash_wallets (user_id, balance_cents) values (rec.mentor_id, 0) on conflict (user_id) do nothing;
        update public.cash_wallets w set balance_cents = w.balance_cents + rec.mentor_amount_cents where w.user_id = rec.mentor_id;
      else
        select id into v_ledger_id from public.cash_ledger where idempotency_key='sub_payout:' || rec.source_id::text limit 1;
      end if;
      update public.subscription_settlement_items set status='paid', paid_at=coalesce(paid_at, now()), updated_at=now()
        where id = rec.source_id and status <> 'paid';
    else
      continue;
    end if;

    -- 원천징수 3.3%: 적립 후 공제 라인(append-only, 멱등). 신규 라인일 때만 지갑 차감.
    if v_withholding > 0 then
      v_wh_ledger_id := null;
      insert into public.cash_ledger (user_id, delta_cents, reason, ref_type, ref_id, idempotency_key)
      values (rec.mentor_id, -v_withholding, 'payout_withholding_3_3pct', rec.source_type, rec.source_id,
              'wh:' || rec.source_type || ':' || rec.source_id::text)
      on conflict (idempotency_key) do nothing returning id into v_wh_ledger_id;
      if v_wh_ledger_id is not null then
        update public.cash_wallets w set balance_cents = w.balance_cents - v_withholding where w.user_id = rec.mentor_id;
      end if;
    end if;

    -- 불변 스냅샷: 전역 UNIQUE(source_type,source_id) 충돌 시 no-op. RETURNING 으로 신규 여부 판정.
    insert into public.payout_run_items (
      payout_run_id, mentor_id, source_type, source_id,
      gross_cents, platform_fee_cents, mentor_amount_cents, fee_rate, ledger_id,
      withholding_cents, net_paid_cents
    ) values (
      v_run_id, rec.mentor_id, rec.source_type, rec.source_id,
      rec.gross_cents, rec.platform_fee_cents, rec.mentor_amount_cents, rec.fee_rate, v_ledger_id,
      v_withholding, v_net
    )
    on conflict (source_type, source_id) do nothing
    returning id into v_item_id;

    -- 신규 성공행일 때만 합계 반영(중복은 카운트/합계 미반영 — 108 버그 수정).
    if v_item_id is not null then
      v_paid := v_paid + 1;
      v_total := v_total + rec.mentor_amount_cents;
      v_total_wh := v_total_wh + v_withholding;
      v_total_net := v_total_net + v_net;
    end if;
  end loop;

  if not p_dry_run then
    update public.payout_runs
    set status='completed',
        mentor_count=(select count(distinct mentor_id) from public.payout_run_items where payout_run_id=v_run_id),
        total_mentor_cents=(select coalesce(sum(mentor_amount_cents),0) from public.payout_run_items where payout_run_id=v_run_id),
        executed_at=now(), updated_at=now()
    where id=v_run_id;
  end if;

  return query select v_run_id, v_paid, v_skipped, v_total, v_total_wh, v_total_net, p_dry_run;
end;
$function$;

revoke all on function public.pay_due_payouts_for_run(date, text, boolean) from public, anon, authenticated;
grant execute on function public.pay_due_payouts_for_run(date, text, boolean) to service_role;

commit;

-- §V(rollback-only): 전역 UNIQUE(source_type,source_id) 존재 · withholding/net 컬럼 존재 ·
--   동일 source 다른 배치 재삽입 UNIQUE 위반→ON CONFLICT no-op(합계 미반영) · 원천징수=floor(amount*0.033) ·
--   net=amount-withholding · 0원/홀수 금액 정확 · dry_run=true 는 payout_run_items/원장/지갑 변화 0 ·
--   신규 성공행만 v_paid/v_total 증가. 독립 2세션 동시성 실측 = CONCURRENCY_DEBT.
