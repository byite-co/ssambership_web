-- =============================================================================
-- DRAFT P0 (004) — 캐시(지갑/원장/충전패키지) · 분쟁/환불 · 커뮤니티(숏폼/게시) · 멘토플랜/리뷰
--   • 미적용. 001 이후 실행(002,003 과 순서: 보통 002→003→004 ; cash 는 users만 의존)
--   • cash_ledger: append-only (authenticated UPDATE/INSERT/DELETE policy 없음) — service_role
--   • P0 compatibility(002,003): 002/003 적용은 본 파일 `custom_request_orders`/`payments`/`subscriptions` FK 전제
--   • cash_wallets 잔액: 클라이언트 update 금지(서비스/원장 누적)
--   • disputes/refunds: 당사자 + admin( users.role=admin, is_admin() 003에서 정의 시 재사용 권장)
-- [불확실] 003 is_admin() 미정의 DB 단독 실행, 공개 콘텐츠 읽기 범위
-- =============================================================================

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $t$
begin
  new.updated_at = now();
  return new;
end;
$t$;

-- 003을 안 돌렸다면: 동일 is_admin
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $f$
  select coalesce((
    select u.role = 'admin' from public.users u where u.id = auth.uid()
  ), false);
$f$;

-- -----------------------------------------------------------------------------
-- cash_wallets
-- -----------------------------------------------------------------------------
create table if not exists public.cash_wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users (id) on delete cascade,
  balance_cents bigint not null default 0,
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_cw_set_updated on public.cash_wallets;
create trigger trg_cw_set_updated
  before update on public.cash_wallets
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- cash_ledger — append-only; delta_cents(+) 충전 (-) 사용
-- -----------------------------------------------------------------------------
create table if not exists public.cash_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  delta_cents bigint not null,
  reason text,
  ref_type text,
  ref_id uuid,
  idempotency_key text unique,
  created_at timestamptz not null default now()
);
create index if not exists idx_cl_user_created on public.cash_ledger (user_id, created_at desc);
create index if not exists idx_cl_idem on public.cash_ledger (idempotency_key);

-- -----------------------------------------------------------------------------
-- cash_topup_packages
-- -----------------------------------------------------------------------------
create table if not exists public.cash_topup_packages (
  id uuid primary key default gen_random_uuid(),
  amount_cents int not null,
  price_cents int,
  display_order int default 0,
  active boolean not null default true,
  label text,
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- disputes, refunds
-- status: [검토] 코드에서 enum 미고정 — 보수적 check 생략 또는 open|resolved|rejected|… 정할 것
-- -----------------------------------------------------------------------------
create table if not exists public.disputes (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references public.users (id) on delete set null,
  mentor_id uuid references public.users (id) on delete set null,
  custom_request_order_id uuid references public.custom_request_orders (id) on delete set null,
  payment_id uuid references public.payments (id) on delete set null,
  subscription_id uuid references public.subscriptions (id) on delete set null,
  status text not null default 'open' check (status in ('open', 'under_review', 'resolved', 'dismissed', 'escalated')),
  body text,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create table if not exists public.refunds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  amount_cents bigint,
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'rejected', 'canceled')),
  payment_id uuid references public.payments (id) on delete set null,
  custom_request_order_id uuid references public.custom_request_orders (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_refunds_user on public.refunds (user_id, created_at desc);

-- -----------------------------------------------------------------------------
-- shortform_posts, community_posts — public list(읽기) + 작성자 쓰기; 상세: 운영에서 끌릴지 검토
-- visibility: [불확실] public 전체 공개
-- -----------------------------------------------------------------------------
create table if not exists public.shortform_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.users (id) on delete cascade,
  title text,
  body text,
  category text,
  source text,
  created_at timestamptz not null default now()
);

create table if not exists public.community_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.users (id) on delete cascade,
  title text,
  body text,
  category text,
  created_at timestamptz not null default now()
);
create index if not exists idx_sf_cat on public.shortform_posts (category, created_at desc);
create index if not exists idx_cp_cat on public.community_posts (category, created_at desc);

-- -----------------------------------------------------------------------------
-- mentor_plans, reviews
-- -----------------------------------------------------------------------------
create table if not exists public.mentor_plans (
  id uuid primary key default gen_random_uuid(),
  mentor_id uuid not null references public.users (id) on delete cascade,
  plan_tier text not null,
  amount_cents int,
  label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
create index if not exists idx_mp_mentor on public.mentor_plans (mentor_id, plan_tier);
drop trigger if exists trg_mp_set_updated on public.mentor_plans;
create trigger trg_mp_set_updated
  before update on public.mentor_plans
  for each row execute function public.set_updated_at();

-- superseded by 042 (see 120) — BUG-C(2026-07-12): 아래 draft 블록이 신규 환경에서
-- 042 정본과 create table if not exists 로 경합한다(002 주석 참조). 정본은 042,
-- 기존 DB 수렴 보정은 120. (무력화 주석 — 이동·분할 아님. author_id 는 이미 고착된
-- 운영 DB 계보에 존재하며 045·앱이 사용 — 신규 생성만 042 로 일원화)
-- create table if not exists public.reviews (
--   id uuid primary key default gen_random_uuid(),
--   mentor_id uuid not null references public.users (id) on delete cascade,
--   author_id uuid not null references public.users (id) on delete cascade,
--   rating smallint not null check (rating between 1 and 5),
--   body text,
--   created_at timestamptz not null default now()
-- );
-- create index if not exists idx_rev_mentor on public.reviews (mentor_id, created_at desc);

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------

alter table public.cash_wallets enable row level security;
create policy "cwal_select" on public.cash_wallets
  for select to authenticated
  using ( user_id = (select auth.uid()) );
-- write 없음(서비스/원장 반영) — service_role

alter table public.cash_ledger enable row level security;
create policy "cled_select" on public.cash_ledger
  for select to authenticated
  using ( user_id = (select auth.uid()) );
-- insert / update / delete: policy 없음 = RLS 기본 거부(원장·클라이언트 직접 조작 방지) — service_role/서버

alter table public.cash_topup_packages enable row level security;
-- 패키지 목록은 공개 읽기(캐시 UI)
create policy "pkg_select_public" on public.cash_topup_packages
  for select
  to anon, authenticated
  using ( coalesce(active, true) = true );
-- 쓰기: admin( insert/update/delete 분리)
create policy "pkg_insert_admin" on public.cash_topup_packages
  for insert to authenticated
  with check ( (select public.is_admin()) = true );
create policy "pkg_update_admin" on public.cash_topup_packages
  for update to authenticated
  using ( (select public.is_admin()) = true )
  with check ( (select public.is_admin()) = true );
create policy "pkg_delete_admin" on public.cash_topup_packages
  for delete to authenticated
  using ( (select public.is_admin()) = true );

alter table public.disputes enable row level security;
create policy "dispute_select" on public.disputes
  for select to authenticated
  using (
    (select auth.uid()) in (student_id, mentor_id) or (select public.is_admin()) = true
  );
-- insert/일반 사용자: [검토] — 필요 시 student만, 여기는 admin+서비스 전제
create policy "dispute_ins" on public.disputes
  for insert to authenticated
  with check ( student_id = (select auth.uid()) or (select public.is_admin()) = true );
create policy "dispute_update_admin" on public.disputes
  for update to authenticated
  using ( (select public.is_admin()) = true )
  with check ( (select public.is_admin()) = true );

alter table public.refunds enable row level security;
create policy "refund_select" on public.refunds
  for select to authenticated
  using ( user_id = (select auth.uid()) or (select public.is_admin()) = true );
create policy "refund_ins" on public.refunds
  for insert to authenticated
  with check ( (select public.is_admin()) = true or user_id = (select auth.uid()) );
-- (환불 요청은 user, 승인은 admin — [불확실])

alter table public.shortform_posts enable row level security;
create policy "sp_select_all" on public.shortform_posts
  for select
  to anon, authenticated
  using ( true );
create policy "sp_write_self" on public.shortform_posts
  for insert to authenticated
  with check ( author_id = (select auth.uid()) or (select public.is_admin()) = true );
create policy "sp_update_self" on public.shortform_posts
  for update to authenticated
  using ( author_id = (select auth.uid()) or (select public.is_admin()) = true );

alter table public.community_posts enable row level security;
create policy "cp_select_all" on public.community_posts
  for select
  to anon, authenticated
  using ( true );
create policy "cp_write_self" on public.community_posts
  for insert to authenticated
  with check ( author_id = (select auth.uid()) or (select public.is_admin()) = true );
create policy "cp_update_self" on public.community_posts
  for update to authenticated
  using ( author_id = (select auth.uid()) or (select public.is_admin()) = true );

alter table public.mentor_plans enable row level security;
create policy "mplan_select" on public.mentor_plans
  for select
  to anon, authenticated
  using ( true );
create policy "mplan_ins" on public.mentor_plans
  for insert to authenticated
  with check ( mentor_id = (select auth.uid()) or (select public.is_admin()) = true );
create policy "mplan_upd" on public.mentor_plans
  for update to authenticated
  using ( mentor_id = (select auth.uid()) or (select public.is_admin()) = true )
  with check ( mentor_id = (select auth.uid()) or (select public.is_admin()) = true );
create policy "mplan_del" on public.mentor_plans
  for delete to authenticated
  using ( mentor_id = (select auth.uid()) or (select public.is_admin()) = true );

alter table public.reviews enable row level security;
create policy "rev_select" on public.reviews
  for select
  to anon, authenticated
  using ( true );
create policy "rev_ins" on public.reviews
  for insert to authenticated
  with check ( author_id = (select auth.uid()) );
-- update: 본인 또는 admin(부정리뷰) — [불확실]
create policy "rev_update_own" on public.reviews
  for update to authenticated
  using ( author_id = (select auth.uid()) or (select public.is_admin()) = true );

-- =============================================================================
-- [주의] mentor_plans: FOR ALL 정책(멘토 도메인). 결제/원장과는 분리.
-- [주의] set_updated_at(mentor_plans) requires function from 001/002/003
-- =============================================================================
-- 미적용. 스테이징 검증 후.
-- =============================================================================
