-- local_stub_schema.sql — 오프라인 스크래치 Postgres 전용 최소 스텁.
-- 목적: 실제 132/157/158/159 SQL 과 notification fixture 를 로컬 PG16 에서 그대로 구동하기 위한
--   선행 객체(role/auth 스키마/도메인 테이블 골격)를 만든다.
-- ⚠️ staging/production 에 절대 적용 금지 — 실 DB 에는 이 객체들이 이미 정본 마이그레이션으로 존재한다.
-- 스키마 골격은 저장소 정본(001/002/003/004/064/067/069/103/150)에서 트리거·fixture 가 참조하는
--   컬럼만 발췌했다(FK 일부 생략).

-- Supabase 기본 role 스텁
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;

-- auth 스키마 스텁(fixture 의 auth.users FK 용)
create schema if not exists auth;
create table if not exists auth.users (
  instance_id uuid,
  id uuid primary key,
  aud text,
  role text,
  email text,
  created_at timestamptz,
  updated_at timestamptz
);

-- 공용 updated_at 트리거 함수(001 동형)
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- users (001 발췌)
create table if not exists public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('student', 'mentor', 'admin')),
  status text not null default 'active',
  full_name text,
  nickname text,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- mentor_profiles (001 + 103 발췌)
create table if not exists public.mentor_profiles (
  user_id uuid primary key references public.users (id) on delete cascade,
  university_name text not null,
  department_name text not null,
  high_school_name text not null,
  verification_status text not null default 'pending',
  activity_status text not null default 'active',
  termination_requested_at timestamptz,
  termination_effective_at timestamptz,
  pause_started_at timestamptz,
  pause_until timestamptz,
  pause_reason text,
  last_pause_at timestamptz,
  abandonment_flagged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- subscriptions (002 + 064 발췌)
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.users (id) on delete cascade,
  mentor_id uuid not null references public.users (id) on delete cascade,
  payment_id uuid,
  plan_tier text,
  plan_id uuid,
  status text not null default 'pending' check (status in ('pending', 'active', 'past_due', 'canceled', 'expired')),
  started_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  next_billing_at timestamptz,
  billing_cycle text default 'monthly',
  cancel_at_period_end boolean not null default false,
  cancel_requested_at timestamptz,
  canceled_at timestamptz,
  expired_at timestamptz,
  last_renewed_at timestamptz,
  last_billing_event_id uuid,
  last_payment_id uuid,
  grace_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- subscription_billing_events (064 발췌 — payments/cash_ledger FK 생략)
create table if not exists public.subscription_billing_events (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  student_id uuid not null references public.users(id) on delete cascade,
  mentor_id uuid not null references public.users(id) on delete cascade,
  event_type text not null check (
    event_type in ('initial', 'renewal', 'renewal_failed', 'expired', 'cancel_scheduled', 'canceled', 'refund')
  ),
  status text not null check (
    status in ('pending', 'processing', 'succeeded', 'failed', 'skipped', 'refunded')
  ),
  period_start timestamptz,
  period_end timestamptz,
  billing_at timestamptz,
  amount_cents int,
  plan_tier text,
  plan_id uuid,
  idempotency_key text unique,
  ledger_id uuid,
  payment_id uuid,
  failure_code text,
  failure_message text,
  attempt_count int not null default 0,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

-- mentor_plans (002/004 + 067 발췌)
create table if not exists public.mentor_plans (
  id uuid primary key default gen_random_uuid(),
  mentor_id uuid not null references public.users (id) on delete cascade,
  plan_tier text,
  amount_cents int,
  is_active boolean not null default true,
  price_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

-- refunds (004 + 030 + 069 + 150 발췌)
create table if not exists public.refunds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  amount_cents bigint,
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'rejected', 'canceled')),
  payment_id uuid,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  billing_event_id uuid,
  request_type text,
  reason text,
  created_at timestamptz not null default now()
);

-- custom request 스택 (003 발췌)
create table if not exists public.custom_request_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.users (id) on delete cascade,
  title text,
  body text,
  status text not null default 'open',
  created_at timestamptz not null default now()
);

create table if not exists public.custom_request_applications (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.custom_request_posts (id) on delete cascade,
  mentor_id uuid not null references public.users (id) on delete cascade,
  message text,
  status text not null default 'submitted',
  created_at timestamptz not null default now()
);

create table if not exists public.custom_request_orders (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.custom_request_posts (id) on delete restrict,
  application_id uuid references public.custom_request_applications (id) on delete set null,
  student_id uuid not null references public.users (id) on delete restrict,
  mentor_id uuid not null references public.users (id) on delete restrict,
  status text,
  created_at timestamptz not null default now()
);

create table if not exists public.custom_order_messages (
  id uuid primary key default gen_random_uuid(),
  custom_request_order_id uuid not null references public.custom_request_orders (id) on delete cascade,
  author_id uuid not null references public.users (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

-- notifications 레거시 골격(132 이전 상태 — 132 가 recipient_user_id/event_key 를 추가한다)
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  type text,
  body text,
  metadata jsonb default '{}'::jsonb,
  data jsonb default '{}'::jsonb,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);
