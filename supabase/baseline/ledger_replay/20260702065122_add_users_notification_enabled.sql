alter table public.users
  add column if not exists notification_enabled boolean not null default true;