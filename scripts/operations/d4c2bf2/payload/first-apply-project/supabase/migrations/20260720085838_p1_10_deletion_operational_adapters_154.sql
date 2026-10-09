begin;
set local lock_timeout='5s';

drop policy if exists adg_storage_block_insert_when_deleting on storage.objects;
create policy adg_storage_block_insert_when_deleting on storage.objects
  as restrictive for insert to authenticated
  with check (not public.account_deletion_write_blocked(auth.uid()));

drop policy if exists adg_storage_block_update_when_deleting on storage.objects;
create policy adg_storage_block_update_when_deleting on storage.objects
  as restrictive for update to authenticated
  using (not public.account_deletion_write_blocked(auth.uid()))
  with check (not public.account_deletion_write_blocked(auth.uid()));

alter table public.account_deletion_jobs add column if not exists lease_owner text;
alter table public.account_deletion_jobs add column if not exists leased_until timestamptz;

create or replace function public.account_deletion_claim(p_owner text, p_limit int default 5, p_lease_seconds int default 300)
returns setof public.account_deletion_jobs language plpgsql security definer set search_path to 'public' as $$
begin
  return query
  with cte as (
    select j.id from public.account_deletion_jobs j
    where j.state in ('pending','locked','purging','storage_purged','finalized','auth_soft_deleted')
      and (j.next_attempt_at is null or j.next_attempt_at <= now())
      and (j.leased_until is null or j.leased_until < now())
    order by j.requested_at asc
    limit greatest(1, p_limit)
    for update skip locked
  )
  update public.account_deletion_jobs j
    set lease_owner = p_owner, leased_until = now() + make_interval(secs => greatest(1, p_lease_seconds)), updated_at = now()
    from cte where j.id = cte.id
    returning j.*;
end $$;

create or replace function public.account_deletion_reclaim_expired()
returns int language plpgsql security definer set search_path to 'public' as $$
declare v_n int;
begin
  update public.account_deletion_jobs set lease_owner=null, leased_until=null, updated_at=now()
    where leased_until is not null and leased_until < now()
      and state not in ('completed','canceled','failed');
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create or replace function public.account_deletion_forfeit_and_anonymize(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_state text; v_balance bigint; v_ledger_id uuid;
begin
  select state into v_state from public.account_deletion_jobs where user_id = p_user_id for update;
  if v_state is null then return jsonb_build_object('ok',false,'code','JOB_NOT_FOUND'); end if;
  if v_state <> 'storage_purged' then return jsonb_build_object('ok',false,'code','WRONG_STATE','state',v_state); end if;

  select balance_cents into v_balance from public.cash_wallets where user_id = p_user_id for update;
  if v_balance is not null and v_balance > 0 then
    insert into public.cash_ledger (user_id, delta_cents, reason, ref_type, ref_id, idempotency_key)
    values (p_user_id, -v_balance, 'account_deletion_forfeit', 'account_deletion', p_user_id, 'acct_del_forfeit:'||p_user_id::text)
    on conflict (idempotency_key) do nothing
    returning id into v_ledger_id;
    if v_ledger_id is not null then
      update public.cash_wallets set balance_cents = 0 where user_id = p_user_id;
    end if;
  end if;

  perform public.anonymize_user_for_deletion(p_user_id, 'account_deletion');
  return jsonb_build_object('ok',true,'forfeited_cents',coalesce(v_balance,0),'ledger_id',v_ledger_id);
end $$;

revoke all on function public.account_deletion_claim(text,int,int) from public, anon, authenticated;
revoke all on function public.account_deletion_reclaim_expired() from public, anon, authenticated;
revoke all on function public.account_deletion_forfeit_and_anonymize(uuid) from public, anon, authenticated;
grant execute on function public.account_deletion_claim(text,int,int) to service_role;
grant execute on function public.account_deletion_reclaim_expired() to service_role;
grant execute on function public.account_deletion_forfeit_and_anonymize(uuid) to service_role;

commit;