begin;
set local lock_timeout='5s';

alter table public.refunds add column if not exists billing_event_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'refunds_billing_event_id_fkey' and conrelid = 'public.refunds'::regclass
  ) then
    alter table public.refunds
      add constraint refunds_billing_event_id_fkey
      foreign key (billing_event_id) references public.subscription_billing_events(id) on delete set null;
  end if;
end $$;

create index if not exists idx_refunds_billing_event on public.refunds (billing_event_id) where billing_event_id is not null;

create or replace function public.qna_subscription_has_live_refund(p_subscription_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1
    from public.refunds r
    join public.subscriptions s on s.id = r.subscription_id
    where r.subscription_id = p_subscription_id
      and r.status = 'pending'
      and r.request_type in ('subscription_prorated','subscription_mentor_suspended')
      and (r.billing_event_id is null or r.billing_event_id = s.last_billing_event_id)
  );
$$;
revoke all on function public.qna_subscription_has_live_refund(uuid) from public, anon;
grant execute on function public.qna_subscription_has_live_refund(uuid) to authenticated, service_role;

commit;