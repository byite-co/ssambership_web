begin;
set local lock_timeout='5s';

create table if not exists public.device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  token text not null unique,
  platform text not null default 'unknown' check (platform in ('ios','android','web','unknown')),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_device_tokens_user on public.device_tokens (user_id) where revoked_at is null;
alter table public.device_tokens enable row level security;
revoke all on public.device_tokens from anon;
drop policy if exists device_tokens_select_own on public.device_tokens;
create policy device_tokens_select_own on public.device_tokens for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists device_tokens_modify_own on public.device_tokens;
create policy device_tokens_modify_own on public.device_tokens for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.device_tokens to authenticated, service_role;

create or replace function public.register_device_token(p_token text, p_platform text default 'unknown')
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_id uuid; v_plat text;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_token is null or btrim(p_token)='' then raise exception 'TOKEN_REQUIRED'; end if;
  v_plat := case when p_platform in ('ios','android','web') then p_platform else 'unknown' end;
  insert into public.device_tokens (user_id, token, platform)
    values (v_uid, btrim(p_token), v_plat)
  on conflict (token) do update set user_id = v_uid, platform = v_plat, revoked_at = null, updated_at = now()
  returning id into v_id;
  return jsonb_build_object('ok', true, 'device_token_id', v_id);
end $$;
revoke all on function public.register_device_token(text,text) from public, anon;
grant execute on function public.register_device_token(text,text) to authenticated, service_role;

create or replace function public.revoke_device_token(p_device_token_id uuid)
returns boolean language sql security definer set search_path to 'public' as $$
  update public.device_tokens set revoked_at = now(), updated_at = now()
  where id = p_device_token_id and revoked_at is null returning true;
$$;
revoke all on function public.revoke_device_token(uuid) from public, anon, authenticated;
grant execute on function public.revoke_device_token(uuid) to service_role;

create table if not exists public.notification_settings (
  user_id uuid primary key references public.users(id) on delete cascade,
  push_enabled boolean not null default true,
  groups jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.notification_settings enable row level security;
revoke all on public.notification_settings from anon;
drop policy if exists notif_settings_select_own on public.notification_settings;
create policy notif_settings_select_own on public.notification_settings for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists notif_settings_modify_own on public.notification_settings;
create policy notif_settings_modify_own on public.notification_settings for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update on public.notification_settings to authenticated, service_role;

create or replace function public.notification_event_group(p_event_type text)
returns text language sql immutable set search_path to 'public' as $$
  select case
    when p_event_type like 'question_%' or p_event_type like 'qna_%' or p_event_type like 'connection_note%' then 'qna'
    when p_event_type like 'custom_%' or p_event_type like 'order_%' or p_event_type like 'individual_question%' then 'order'
    when p_event_type like '%subscription%' then 'subscription'
    when p_event_type like '%refund%' then 'refund'
    else 'system'
  end;
$$;

create or replace function public.notification_delivery_allowed(p_user_id uuid, p_event_type text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce(
    (select s.push_enabled and coalesce((s.groups ->> public.notification_event_group(p_event_type))::boolean, true)
       from public.notification_settings s where s.user_id = p_user_id),
    true
  );
$$;
revoke all on function public.notification_delivery_allowed(uuid,text) from public, anon;
grant execute on function public.notification_delivery_allowed(uuid,text) to authenticated, service_role;

create table if not exists public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  outbox_id uuid not null references public.notification_outbox(id) on delete cascade,
  device_token_id uuid not null references public.device_tokens(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','sent','failed','dead','skipped')),
  attempt_count int not null default 0,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_deliveries_uq unique (outbox_id, device_token_id)
);
create index if not exists idx_notif_deliveries_outbox on public.notification_deliveries (outbox_id);
alter table public.notification_deliveries enable row level security;
revoke all on public.notification_deliveries from anon, authenticated;
grant select, insert, update, delete on public.notification_deliveries to service_role;

create or replace function public.notification_outbox_claim(p_owner text, p_limit int default 10, p_lease_seconds int default 60)
returns setof public.notification_outbox language plpgsql security definer set search_path to 'public' as $$
begin
  return query
  with cte as (
    select o.id from public.notification_outbox o
    where o.status in ('pending','failed') and o.next_attempt_at <= now()
    order by o.next_attempt_at asc
    limit greatest(1, p_limit)
    for update skip locked
  )
  update public.notification_outbox o
    set status='leased', lease_owner=p_owner, leased_until=now() + make_interval(secs => greatest(1,p_lease_seconds)), updated_at=now()
    from cte where o.id = cte.id
    returning o.*;
end $$;

create or replace function public.notification_outbox_reclaim_expired()
returns int language plpgsql security definer set search_path to 'public' as $$
declare v_n int;
begin
  update public.notification_outbox set status='pending', lease_owner=null, leased_until=null, updated_at=now()
    where status='leased' and leased_until is not null and leased_until < now();
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create or replace function public.notification_outbox_mark_sent(p_id uuid)
returns boolean language sql security definer set search_path to 'public' as $$
  update public.notification_outbox set status='sent', lease_owner=null, leased_until=null, updated_at=now()
  where id=p_id returning true;
$$;

create or replace function public.notification_outbox_mark_failed(p_id uuid, p_error text, p_backoff_seconds int default 60)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_attempt int; v_max int; v_dead boolean;
begin
  update public.notification_outbox
    set attempt_count = attempt_count + 1, last_error = left(coalesce(p_error,''),1000),
        lease_owner=null, leased_until=null,
        next_attempt_at = now() + make_interval(secs => greatest(1,p_backoff_seconds)), updated_at=now()
    where id=p_id
    returning attempt_count, max_attempts into v_attempt, v_max;
  if v_attempt is null then return jsonb_build_object('ok',false,'code','NOT_FOUND'); end if;
  v_dead := v_attempt >= v_max;
  update public.notification_outbox set status = case when v_dead then 'dead' else 'failed' end where id=p_id;
  return jsonb_build_object('ok',true,'attempt',v_attempt,'dead',v_dead);
end $$;

create or replace function public.notification_create_deliveries(p_outbox_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_recipient uuid; v_etype text; v_allowed boolean; v_created int := 0;
begin
  select recipient_user_id, event_type into v_recipient, v_etype from public.notification_outbox where id=p_outbox_id;
  if v_recipient is null then return jsonb_build_object('ok',false,'code','OUTBOX_NOT_FOUND'); end if;
  v_allowed := public.notification_delivery_allowed(v_recipient, v_etype);
  if not v_allowed then
    return jsonb_build_object('ok',true,'created',0,'suppressed',true);
  end if;
  insert into public.notification_deliveries (outbox_id, device_token_id)
    select p_outbox_id, dt.id from public.device_tokens dt
    where dt.user_id = v_recipient and dt.revoked_at is null
  on conflict (outbox_id, device_token_id) do nothing;
  get diagnostics v_created = row_count;
  return jsonb_build_object('ok',true,'created',v_created,'suppressed',false);
end $$;

create or replace function public.notification_delivery_mark_sent(p_id uuid)
returns boolean language sql security definer set search_path to 'public' as $$
  update public.notification_deliveries set status='sent', sent_at=now(), updated_at=now() where id=p_id returning true;
$$;

create or replace function public.notification_delivery_mark_failed(p_id uuid, p_error text, p_invalid_token boolean default false)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_token_id uuid;
begin
  update public.notification_deliveries
    set attempt_count = attempt_count + 1, last_error = left(coalesce(p_error,''),1000),
        status = case when p_invalid_token then 'dead' else 'failed' end, updated_at=now()
    where id=p_id returning device_token_id into v_token_id;
  if v_token_id is null then return jsonb_build_object('ok',false,'code','NOT_FOUND'); end if;
  if p_invalid_token then perform public.revoke_device_token(v_token_id); end if;
  return jsonb_build_object('ok',true,'invalid_token',p_invalid_token);
end $$;

revoke all on function public.notification_outbox_claim(text,int,int) from public, anon, authenticated;
revoke all on function public.notification_outbox_reclaim_expired() from public, anon, authenticated;
revoke all on function public.notification_outbox_mark_sent(uuid) from public, anon, authenticated;
revoke all on function public.notification_outbox_mark_failed(uuid,text,int) from public, anon, authenticated;
revoke all on function public.notification_create_deliveries(uuid) from public, anon, authenticated;
revoke all on function public.notification_delivery_mark_sent(uuid) from public, anon, authenticated;
revoke all on function public.notification_delivery_mark_failed(uuid,text,boolean) from public, anon, authenticated;
grant execute on function public.notification_outbox_claim(text,int,int) to service_role;
grant execute on function public.notification_outbox_reclaim_expired() to service_role;
grant execute on function public.notification_outbox_mark_sent(uuid) to service_role;
grant execute on function public.notification_outbox_mark_failed(uuid,text,int) to service_role;
grant execute on function public.notification_create_deliveries(uuid) to service_role;
grant execute on function public.notification_delivery_mark_sent(uuid) to service_role;
grant execute on function public.notification_delivery_mark_failed(uuid,text,boolean) to service_role;

commit;