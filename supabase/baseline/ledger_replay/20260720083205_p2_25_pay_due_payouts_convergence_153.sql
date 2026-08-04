begin;
set local lock_timeout='5s';

alter table public.payout_run_items add column if not exists withholding_cents bigint not null default 0;
alter table public.payout_run_items add column if not exists net_paid_cents bigint;

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