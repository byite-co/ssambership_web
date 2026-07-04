-- =============================================================================
-- 106_payout_runs.sql   [DRAFT — DB 미적용]
-- 목적(토대): 23일 통합 지급의 '불변 지급 기록' 골격.
--   payout_runs(가변: 실행 상태/합계) + payout_run_items(불변: 지급 1건 스냅샷).
--   이 파일은 테이블/제약/RLS/불변 트리거만. 지급 RPC·뷰는 별도(107, ②단계).
--
-- 선행: 004(cash_ledger), pgcrypto. 적용은 사용자가 Supabase에서 직접(이 단계 미적용).
-- 돈 이동 없음(스키마만). main·타 로직 미터치.
-- =============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- payout_runs (가변) — 한 번의 23일 지급 실행 헤더
--   멱등키 'payout:YYYY-MM' 로 같은 달 재실행 방지. status/합계는 갱신 허용.
-- ---------------------------------------------------------------------------
create table if not exists public.payout_runs (
  id uuid primary key default gen_random_uuid(),
  run_date date not null,                 -- 지급일(매월 23일)
  cutoff_end timestamptz not null,        -- 전월 말 23:59 (이 시점까지 완료분 대상)
  status text not null default 'executing' check (status in ('executing', 'completed')),
  mentor_count integer not null default 0,
  total_mentor_cents bigint not null default 0,
  executed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  idempotency_key text not null,
  constraint payout_runs_idem_unique unique (idempotency_key)
);

create index if not exists idx_payout_runs_run_date
  on public.payout_runs (run_date desc);

-- updated_at 자동 갱신(086 에서 쓰는 공용 트리거 함수 재사용)
drop trigger if exists trg_payout_runs_set_updated on public.payout_runs;
create trigger trg_payout_runs_set_updated
  before update on public.payout_runs
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- payout_run_items (불변) — 지급 1건 = 멘토·채널·금액 스냅샷(immutable)
--   source_type + source_id 폴리모픽(구독/CR/IQ). 금액은 FK 파생이 아닌 '복사'(고정).
-- ---------------------------------------------------------------------------
create table if not exists public.payout_run_items (
  id uuid primary key default gen_random_uuid(),
  payout_run_id uuid not null references public.payout_runs (id) on delete restrict,
  mentor_id uuid not null references public.users (id) on delete restrict,
  source_type text not null check (source_type in ('subscription', 'custom_request', 'individual_question')),
  source_id uuid not null,
  -- 금액 스냅샷(지급 시점 고정 — 원본 행이 나중에 바뀌어도 불변)
  gross_cents bigint not null,
  platform_fee_cents bigint not null,
  mentor_amount_cents bigint not null,
  fee_rate numeric not null,
  ledger_id uuid references public.cash_ledger (id) on delete set null,  -- 지급 크레딧 ledger 행
  created_at timestamptz not null default now(),
  constraint payout_run_items_unique unique (payout_run_id, source_type, source_id),
  constraint payout_run_items_amount_chk check (mentor_amount_cents >= 0 and gross_cents >= 0)
);

create index if not exists idx_pri_run on public.payout_run_items (payout_run_id);
create index if not exists idx_pri_mentor on public.payout_run_items (mentor_id, created_at desc);
create index if not exists idx_pri_source on public.payout_run_items (source_type, source_id);

-- 불변(append-only) 보장: UPDATE/DELETE 차단 트리거
create or replace function public.payout_run_items_block_mutation()
returns trigger
language plpgsql
as $f$
begin
  raise exception 'payout_run_items is append-only (immutable); % not allowed', tg_op
    using errcode = 'P0001';
end;
$f$;

drop trigger if exists trg_pri_no_update on public.payout_run_items;
create trigger trg_pri_no_update
  before update on public.payout_run_items
  for each row execute function public.payout_run_items_block_mutation();

drop trigger if exists trg_pri_no_delete on public.payout_run_items;
create trigger trg_pri_no_delete
  before delete on public.payout_run_items
  for each row execute function public.payout_run_items_block_mutation();

-- ---------------------------------------------------------------------------
-- RLS — service_role 만 쓰기. 멘토는 본인 지급항목 읽기 가능. payout_runs 는 운영(service_role)만.
-- ---------------------------------------------------------------------------
alter table public.payout_runs enable row level security;
alter table public.payout_run_items enable row level security;

revoke all on table public.payout_runs from anon, authenticated;
grant all on table public.payout_runs to service_role;

revoke all on table public.payout_run_items from anon;
revoke insert, update, delete on table public.payout_run_items from authenticated;
grant select on table public.payout_run_items to authenticated;
grant all on table public.payout_run_items to service_role;

-- 멘토 본인 지급 항목만 읽기 (086 ssi_select_mentor_own 패턴)
drop policy if exists "pri_select_mentor_own" on public.payout_run_items;
create policy "pri_select_mentor_own"
  on public.payout_run_items
  for select
  to authenticated
  using (mentor_id = (select auth.uid()));
-- payout_run_items 에 INSERT/UPDATE/DELETE 정책 없음 → 쓰기는 service_role(RPC)만.
-- payout_runs 에 정책 없음 → authenticated 접근 불가(운영 service_role 전용).

comment on table public.payout_runs is
  '106: 23일 통합 지급 실행 헤더(가변). idempotency_key=payout:YYYY-MM 로 월 1회.';
comment on table public.payout_run_items is
  '106: 지급 1건 불변 스냅샷(append-only). source_type+source_id 폴리모픽(구독/CR/IQ). 금액 복사 고정.';
