-- [의존 순서] 이 파일은 001_initial_auth_profile.sql 이후 적용할 것
-- [번호 충돌] 접두 002 — 동일 번호: 002_p0_subscriptions_questions_draft.sql, 002_custom_request_orders_status.sql
--   (이 파일: 인벤토리 초안 DRAFT. 적용 이력 불명 시 번호 변경 없이 참고용으로만 유지)
-- ============================================================================
-- DRAFT — Supabase SQL Editor에 바로 적용하지 마세요. 팀 검토·정합성 확인 후 적용.
-- 001_initial_auth_profile.sql 의 public.users, mentor_profiles, verification_logs
--   은 절대 DROP/ALTER 하지 않습니다. (이 파일에는 해당 테이블 DDL 없음)
-- ============================================================================
-- [아직 확정 필요]
--   - custom_order_revisions, custom_order_messages: 레포에 직접 .from 참조 없음(문서/P0용 예약)
--   - custom_request_orders: 코드가 status|state|order_status|stage 등 다열 insert, 단일 DB 스키마로 통합할지
--   - RLS: 운영 정책(관리자, 멘토/학생 분기) — 여기는 본인 행만 읽는 수준의 초안
--   - Storage: 맞춤의뢰/커뮤니티 첨부는 bucket·경로·정책이 정해지면 별도 003 등으로
--   - question_messages vs custom_order_messages: Q&A는 question_messages만 코드 참조
-- ============================================================================
-- Extensions (001에서 이미 있을 수 있음)
create extension if not exists pgcrypto;

-- --------------------------------------------------------------------------
-- set_updated_at (001과 동일 시그니처 가정, 없을 때만 생성하려면 별도 migration에서 처리)
-- --------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $fn$
begin
  new.updated_at = now();
  return new;
end;
$fn$;

-- --------------------------------------------------------------------------
-- 결제(구독/캐시 intent 공용 후보) — lib/subscribe/subscribeCheckoutService, lib/cash/cashQueries
-- insert 컬럼 예: user|student_id, mentor_id, status= pending|성공시 succeeded 등, amount, currency, kind
-- --------------------------------------------------------------------------
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users (id) on delete set null,
  student_id uuid references public.users (id) on delete set null,
  payer_id uuid references public.users (id) on delete set null,
  mentor_id uuid references public.users (id) on delete set null,
  payee_id uuid references public.users (id) on delete set null,
  amount numeric,
  amount_krw numeric,
  total numeric,
  currency text,
  ccy text,
  status text,
  state text,
  payment_status text,
  kind text,
  type text,
  product text,
  purpose text,
  external_id text,
  client_reference text,
  idempotency_key text,
  request_id text,
  metadata jsonb,
  raw jsonb,
  data jsonb,
  payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
-- 코드에서 확인된 status·payment_status 인자: pending(의도 생성), succeeded|paid|complete|success(완료, 멱등) —  전체 enum은 CHECK 보류(검토 필요)
create index if not exists idx_payments_student on public.payments (student_id);
create index if not exists idx_payments_user on public.payments (user_id);
create index if not exists idx_payments_mentor on public.payments (mentor_id);
create index if not exists idx_payments_status on public.payments (status, payment_status);

-- --------------------------------------------------------------------------
-- order_payments (맞춤의뢰 주문과 연결) — lib/disputes/disputeQueries: order_id / custom_request_order_id 등
-- --------------------------------------------------------------------------
create table if not exists public.order_payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid,
  custom_order_id uuid,
  custom_request_order_id uuid,
  request_order_id uuid,
  payment_id uuid,
  user_id uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_order_payments_cust on public.order_payments (custom_request_order_id);

-- --------------------------------------------------------------------------
-- custom_request_posts — customRequestMutations.insertCustomRequestPost, customRequestPostMappers
-- insert: subject, body, description, category, subcategory/goal, title, due_*, budget_*, status/state open, author_id|student_id|user_id, deliverable_*
-- --------------------------------------------------------------------------
create table if not exists public.custom_request_posts (
  id uuid primary key default gen_random_uuid(),
  title text,
  subject text,
  body text,
  content text,
  description text,
  goal text,
  subcategory text,
  category text,
  due_at timestamptz,
  deadline timestamptz,
  due_date date,
  budget_min numeric,
  budget_max numeric,
  deliverable_type text,
  deliverable_format text,
  result_format text,
  output_format text,
  status text not null default 'open' check (status in ('open')),
  -- 검토 필요: 'closed', 'cancelled' 등 (코드 select만 있으면 CHECK 확장)
  state text,
  author_id uuid references public.users (id) on delete cascade,
  student_id uuid references public.users (id) on delete cascade,
  user_id uuid references public.users (id) on delete cascade,
  requester_id uuid references public.users (id) on delete set null,
  client_id uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_crp_set_updated on public.custom_request_posts;
create trigger trg_crp_set_updated
  before update on public.custom_request_posts
  for each row execute function public.set_updated_at();
create index if not exists idx_crp_author on public.custom_request_posts (author_id, student_id, user_id);

-- --------------------------------------------------------------------------
-- custom_request_applications — customRequestMutations.insertMentorApplication
-- insert: post FK, mentor FK, proposed_price|price|bid_amount, delivery|due fields, cover_letter|message, status/state submitted, extra_answers, notes, answers
-- --------------------------------------------------------------------------
create table if not exists public.custom_request_applications (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references public.custom_request_posts (id) on delete cascade,
  custom_request_id uuid references public.custom_request_posts (id) on delete cascade,
  custom_request_post_id uuid references public.custom_request_posts (id) on delete cascade,
  request_id uuid references public.custom_request_posts (id) on delete cascade,
  mentor_id uuid not null references public.users (id) on delete cascade,
  applicant_id uuid references public.users (id) on delete set null,
  proposer_id uuid references public.users (id) on delete set null,
  user_id uuid references public.users (id) on delete set null,
  proposed_price numeric,
  price numeric,
  bid_amount numeric,
  delivery_at timestamptz,
  proposed_due timestamptz,
  due_proposed timestamptz,
  scope text,
  offer_scope text,
  services_offered text,
  cover_letter text,
  message text,
  self_intro text,
  content text,
  extra_answers text,
  answers text,
  notes text,
  school text,
  university text,
  university_name text,
  major text,
  department text,
  field text,
  status text,
  state text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- 코드 insert 리터럴: status/state 'submitted' (CHECK는 accepted/rejected 등 확인 후)
drop trigger if exists trg_cra_set_updated on public.custom_request_applications;
create trigger trg_cra_set_updated
  before update on public.custom_request_applications
  for each row execute function public.set_updated_at();
create index if not exists idx_cra_post on public.custom_request_applications (post_id, custom_request_post_id, request_id, custom_request_id);
create index if not exists idx_cra_mentor on public.custom_request_applications (mentor_id);

-- --------------------------------------------------------------------------
-- custom_request_orders — insertCustomRequestOrder, order*Actions, orderDetailQueries, subscribe data model
-- insert: post_id, student_id, mentor_id, application_id, status/state pending, order_status open, payment_status unpaid
-- update(멘토/학생): primary status 컬럼(동적), started_at, completed_at 등
-- --------------------------------------------------------------------------
create table if not exists public.custom_request_orders (
  id uuid primary key default gen_random_uuid(),
  post_id uuid,
  custom_request_post_id uuid references public.custom_request_posts (id) on delete set null,
  custom_request_id uuid references public.custom_request_posts (id) on delete set null,
  request_id uuid,
  student_id uuid references public.users (id) on delete set null,
  buyer_id uuid references public.users (id) on delete set null,
  client_id uuid references public.users (id) on delete set null,
  user_id uuid references public.users (id) on delete set null,
  author_id uuid references public.users (id) on delete set null,
  requester_id uuid references public.users (id) on delete set null,
  mentor_id uuid references public.users (id) on delete set null,
  selected_mentor_id uuid references public.users (id) on delete set null,
  assigned_mentor_id uuid references public.users (id) on delete set null,
  expert_id uuid references public.users (id) on delete set null,
  application_id uuid,
  custom_request_application_id uuid references public.custom_request_applications (id) on delete set null,
  selected_application_id uuid,
  status text,
  state text,
  order_status text,
  stage text,
  payment_status text,
  agreed_price numeric,
  proposed_price numeric,
  price numeric,
  amount numeric,
  started_at timestamptz,
  work_started_at timestamptz,
  in_progress_at timestamptz,
  mentor_started_at timestamptz,
  completed_at timestamptz,
  accepted_at timestamptz,
  closed_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- orderLifecycleConstants: pending, open(멘토 착수 후), completed(학생 수락), payment unpaid, 터미널 completed|cancelled|… — CHECK 전체는 검토 필요(주석)
/*
  검토 필요: status/state/order_status 값 집합
  - insert: status/state pending, order_status open, payment_status unpaid
  - 멘토 시작: open (primary 컬럼 1곳)
  - 학생 수락: completed
  - 터미널: orderLifecycleConstants.ORDER_TERMINAL_STATUSES
*/
drop trigger if exists trg_cro_set_updated on public.custom_request_orders;
create trigger trg_cro_set_updated
  before update on public.custom_request_orders
  for each row execute function public.set_updated_at();
create index if not exists idx_cro_student on public.custom_request_orders (student_id, user_id, buyer_id);
create index if not exists idx_cro_mentor on public.custom_request_orders (mentor_id, selected_mentor_id, expert_id);
create index if not exists idx_cro_post on public.custom_request_orders (post_id, custom_request_post_id);

-- --------------------------------------------------------------------------
-- custom_order_deliverables — hasDeliverableRowsForOrder, customRequestQueries loadOrderBundle
-- FK: order_id | custom_order_id | request_order_id
-- --------------------------------------------------------------------------
create table if not exists public.custom_order_deliverables (
  id uuid primary key default gen_random_uuid(),
  order_id uuid,
  custom_order_id uuid,
  request_order_id uuid,
  file_url text,
  url text,
  note text,
  version int,
  status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
create index if not exists idx_cod_order on public.custom_order_deliverables (order_id, custom_order_id, request_order_id);

-- --------------------------------------------------------------------------
-- [코드 미참조] 맞춤의뢰 쪽 revision/message — P0 백로그, 컬럼·FK는 이후 앱/문서에 맞춰 조정
-- --------------------------------------------------------------------------
create table if not exists public.custom_order_revisions (
  id uuid primary key default gen_random_uuid(),
  custom_request_order_id uuid,
  order_id uuid,
  author_id uuid references public.users (id) on delete set null,
  body text,
  request_note text,
  status text,
  created_at timestamptz not null default now()
);

create table if not exists public.custom_order_messages (
  id uuid primary key default gen_random_uuid(),
  custom_request_order_id uuid,
  order_id uuid,
  author_id uuid references public.users (id) on delete set null,
  body text,
  created_at timestamptz not null default now()
);

-- --------------------------------------------------------------------------
-- order_events (주문 이벤트 로그) — orderDetailQueries.loadOrderEventLog 후보: order_events, custom_order_events, request_order_status_events, order_status_history
-- --------------------------------------------------------------------------
create table if not exists public.order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid,
  custom_order_id uuid,
  request_order_id uuid,
  event text,
  kind text,
  metadata jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_oe_order on public.order_events (order_id, custom_order_id, request_order_id);

-- --------------------------------------------------------------------------
-- subscriptions — subscribeCheckoutService, subscribePageQueries, mypage, disputeQueries
-- insert: student+mentor FK, status|state=active, plan_id, plan_tier, payment_id, ...
-- --------------------------------------------------------------------------
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references public.users (id) on delete cascade,
  user_id uuid references public.users (id) on delete cascade,
  student_user_id uuid,
  subscriber_id uuid,
  mentor_id uuid references public.users (id) on delete cascade,
  mentor_user_id uuid,
  creator_id uuid,
  host_id uuid,
  status text,
  state text,
  subscription_status text,
  plan_id text,
  mentor_plan_id text,
  product_id text,
  price_id text,
  payment_id uuid,
  last_payment_id uuid,
  initial_payment_id uuid,
  plan_tier text,
  tier text,
  label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
-- 코드 insert: st = "active" —  검토 필요: cancelled, expired 등 (ACTIVE_SUB_RE 정규식)
create index if not exists idx_subs_pair on public.subscriptions (student_id, user_id, mentor_id);

-- --------------------------------------------------------------------------
-- mentor_student_rooms — questionRoomQueries, subscribeCheckoutService.ensureMentorStudentRoom
-- insert: student_id, mentor_id, payment_id|subscription_id
-- --------------------------------------------------------------------------
create table if not exists public.mentor_student_rooms (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.users (id) on delete cascade,
  student_user_id uuid,
  student_uid uuid,
  mentor_id uuid not null references public.users (id) on delete cascade,
  mentor_user_id uuid,
  mentor_uid uuid,
  payment_id uuid,
  subscription_id uuid,
  source_payment_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists uq_mentor_student_rooms_pair on public.mentor_student_rooms (student_id, mentor_id);
drop trigger if exists trg_msr_set_updated on public.mentor_student_rooms;
create trigger trg_msr_set_updated
  before update on public.mentor_student_rooms
  for each row execute function public.set_updated_at();

-- --------------------------------------------------------------------------
-- question_threads / question_messages / connection_notes — qna: questionRoomQueries, questionRoomMutations
-- --------------------------------------------------------------------------
create table if not exists public.question_threads (
  id uuid primary key default gen_random_uuid(),
  room_id uuid,
  mentor_student_room_id uuid,
  msr_id uuid,
  title text,
  status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
create index if not exists idx_qt_room on public.question_threads (room_id, mentor_student_room_id, msr_id);
-- FK(room_id -> mentor_student_rooms.id): room_id NULL 허용 여부·on delete는 데이터 모델 확정 후 추가(검토 필요)

create table if not exists public.question_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid,
  question_thread_id uuid,
  room_id uuid,
  author_id uuid references public.users (id) on delete set null,
  body text,
  text text,
  kind text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists idx_qm_thread on public.question_messages (thread_id, question_thread_id);

create table if not exists public.connection_notes (
  id uuid primary key default gen_random_uuid(),
  room_id uuid,
  mentor_student_room_id uuid,
  msr_id uuid,
  body text,
  note text,
  created_at timestamptz not null default now()
);

-- --------------------------------------------------------------------------
-- notifications — notificationsHubQueries, notificationReadActions, mypage, mentorDashboardQueries
-- user FK(다중 후보명), read: is_read | read_at |…, type column 후보, sort by created_at/…
-- --------------------------------------------------------------------------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users (id) on delete cascade,
  recipient_id uuid references public.users (id) on delete cascade,
  student_id uuid references public.users (id) on delete set null,
  mentor_id uuid references public.users (id) on delete set null,
  target_user_id uuid,
  owner_id uuid,
  type text,
  kind text,
  category text,
  event_type text,
  notification_type text,
  channel text,
  template text,
  title text,
  body text,
  message text,
  is_read boolean default false,
  read boolean,
  read_at timestamptz,
  read_at_utc timestamptz,
  seen_at timestamptz,
  opened_at timestamptz,
  viewed_at timestamptz,
  acknowledged boolean,
  acknowledged_at timestamptz,
  metadata jsonb,
  data jsonb,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  inserted_at timestamptz,
  updated_at timestamptz
);
create index if not exists idx_notif_user on public.notifications (user_id, recipient_id, student_id, mentor_id, owner_id);
create index if not exists idx_notif_created on public.notifications (created_at, sent_at, updated_at, id);

-- --------------------------------------------------------------------------
-- cash_wallets, cash_ledger, cash_topup_packages — lib/cash/cashQueries, wallet UI
-- --------------------------------------------------------------------------
create table if not exists public.cash_wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users (id) on delete cascade,
  student_id uuid references public.users (id) on delete cascade,
  owner_id uuid references public.users (id) on delete set null,
  balance_cents int,
  amount_cents int,
  balance numeric,
  currency text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_cw_set_updated on public.cash_wallets;
create trigger trg_cw_set_updated
  before update on public.cash_wallets
  for each row execute function public.set_updated_at();

create table if not exists public.cash_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users (id) on delete cascade,
  student_id uuid,
  account_owner_id uuid,
  kind text,
  type text,
  amount_cents int,
  amount numeric,
  balance_after numeric,
  reference text,
  metadata jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_cl_user on public.cash_ledger (user_id, student_id);

create table if not exists public.cash_topup_packages (
  id uuid primary key default gen_random_uuid(),
  label text,
  amount_cents int,
  price_cents int,
  currency text,
  display_order int,
  active boolean default true,
  created_at timestamptz not null default now()
);

-- --------------------------------------------------------------------------
-- disputes & refunds — disputeQueries, disputeListQueries, admin, cash DATA_MODEL
-- --------------------------------------------------------------------------
create table if not exists public.disputes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users (id) on delete set null,
  student_id uuid,
  mentor_id uuid,
  refund_id uuid,
  refund_request_id uuid,
  r_id uuid,
  payment_id uuid,
  order_payment_id uuid,
  subscription_id uuid,
  sub_id uuid,
  custom_request_order_id uuid,
  mentor_order_id uuid,
  order_id uuid,
  order_id_linked uuid,
  custom_order_id uuid,
  request_order_id uuid,
  status text,
  state text,
  reason text,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
-- 코드 dispute row FK: 다중 후보(상세) —  CHECK( status ) 검토 필요
create index if not exists idx_disputes_cro on public.disputes (custom_request_order_id, order_id);

create table if not exists public.refunds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users (id) on delete set null,
  student_id uuid,
  status text,
  state text,
  amount numeric,
  currency text,
  payment_id uuid,
  custom_request_order_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

-- --------------------------------------------------------------------------
-- shortform_posts, community_posts — communityMutations, landingPageQueries
-- --------------------------------------------------------------------------
create table if not exists public.shortform_posts (
  id uuid primary key default gen_random_uuid(),
  title text,
  body text,
  text text,
  content text,
  category text,
  source text,
  source_url text,
  attribution text,
  author_id uuid references public.users (id) on delete cascade,
  user_id uuid references public.users (id) on delete cascade,
  author_role text,
  rights_confirmed boolean,
  rights_ack boolean,
  legal_use_confirmed boolean,
  created_at timestamptz not null default now()
);

create table if not exists public.community_posts (
  id uuid primary key default gen_random_uuid(),
  title text,
  body text,
  content text,
  category text,
  source text,
  source_url text,
  source_url_alt text,
  author_id uuid references public.users (id) on delete cascade,
  user_id uuid references public.users (id) on delete cascade,
  author_role text,
  rights_confirmed boolean,
  rights_ack boolean,
  legal_use_confirmed boolean,
  created_at timestamptz not null default now()
);

-- --------------------------------------------------------------------------
-- mentor_plans / reviews (멘토 공개 페이지) — publicMentorBundle
-- --------------------------------------------------------------------------
create table if not exists public.mentor_plans (
  id uuid primary key default gen_random_uuid(),
  mentor_id uuid not null references public.users (id) on delete cascade,
  user_id uuid references public.users (id) on delete cascade,
  owner_id uuid references public.users (id) on delete set null,
  name text,
  plan_tier text,
  amount numeric,
  amount_cents int,
  price_cents int,
  price numeric,
  monthly_price numeric,
  price_krw numeric,
  label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

-- superseded by 042 (see 120) — BUG-C(2026-07-12): 아래 draft 블록이 신규 환경에서
-- 042 정본보다 먼저 실행되면 create table if not exists 경합으로 042 가 no-op 되어
-- 잘못된 형태가 고착된다. 정본은 042, 기존 DB 수렴 보정은 120. (무력화 주석 —
-- 이동·분할 아님. 인덱스는 draft 전용 컬럼 reviewee_id 참조라 블록에 포함)
-- create table if not exists public.reviews (
--   id uuid primary key default gen_random_uuid(),
--   mentor_id uuid references public.users (id) on delete cascade,
--   mentor_user_id uuid,
--   reviewee_id uuid,
--   to_user_id uuid,
--   target_user_id uuid,
--   user_id uuid references public.users (id) on delete set null,
--   rating int,
--   score int,
--   stars int,
--   comment text,
--   body text,
--   created_at timestamptz not null default now()
-- );
-- create index if not exists idx_reviews_mentor on public.reviews (mentor_id, reviewee_id);

-- --------------------------------------------------------------------------
-- RLS (초안) — “전체 공개” 금지, 본인 연관 행 위주(관리자·멘토 혼선은 앱+정책에서 후속)
-- --------------------------------------------------------------------------
alter table if exists public.payments enable row level security;
create policy "payments_self_rw" on public.payments
  for all to authenticated
  using (
    (select auth.uid()) = user_id
    or (select auth.uid()) = student_id
    or (select auth.uid()) = payer_id
    or (select auth.uid()) = mentor_id
    or (select auth.uid()) = payee_id
  )
  with check (
    (select auth.uid()) = user_id
    or (select auth.uid()) = student_id
    or (select auth.uid()) = payer_id
  );

-- 동일 패턴: 반복·단순화 (draft). 운영 전 관리자 role·service role 분리 필수
alter table if exists public.subscriptions enable row level security;
create policy "subscriptions_pair" on public.subscriptions
  for all to authenticated
  using ( (select auth.uid()) in (coalesce(student_id, user_id), coalesce(mentor_id, mentor_user_id)) )
  with check ( (select auth.uid()) in (coalesce(student_id, user_id), coalesce(mentor_id, mentor_user_id)) );

alter table if exists public.mentor_student_rooms enable row level security;
create policy "msr_pair" on public.mentor_student_rooms
  for all to authenticated
  using ( (select auth.uid()) in (student_id, mentor_id, student_user_id, mentor_user_id) )
  with check ( (select auth.uid()) in (student_id, mentor_id) );

-- 나머지 테이블: 동일하게 enable + policy는 한두 개만 예시(전체 40줄+). 실서비스 전 통합.
alter table if exists public.notifications enable row level security;
create policy "notif_recipient" on public.notifications
  for all to authenticated
  using ( (select auth.uid()) in (user_id, recipient_id, student_id, mentor_id, target_user_id, owner_id) )
  with check ( (select auth.uid()) in (user_id, recipient_id) );

-- 맞춤의뢰(작성자·멘토)
alter table if exists public.custom_request_posts enable row level security;
create policy "crp_self" on public.custom_request_posts
  for all to authenticated
  using ( (select auth.uid()) in (author_id, student_id, user_id, requester_id, client_id) )
  with check ( (select auth.uid()) in (author_id, student_id, user_id) );

-- … 기타 테이블 RLS: 적용 시 동일한 패턴으로 정리(이 draft는 RLS “샘플”이며, disputes/refunds/관리자 읽기는 service_role / 별 policy 필요)

-- Storage bucket: student-id-images — 001 및 대시보드. 맞춤의뢰/커뮤니티 첨부는 미정(주석)
