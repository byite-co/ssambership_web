-- =============================================================================
-- 105_subscription_settlement_period_gating.sql   [DRAFT — DB 미적용]
-- 목적(토대): 구독 정산항목을 "기간 완료(period_end<=now) 후에만 지급대기(pending)"가
--   되도록 게이팅한다. 미완료 사이클은 새 상태 'accruing'(지급 불가)로 둔다.
--   즉시지급 동작·수수료·돈 이동은 이 파일에서 바꾸지 않는다(086 본문 verbatim + 게이팅만).
--
-- 선행: 086 → 095_subscription_fee_15pct.sql 적용됨.
-- 적용: 사용자가 Supabase에서 직접 실행(이 단계에선 미적용).
--
-- ★ 베이스 = 095 버전(구독 수수료 15%/85%). 30% 회귀 아님.
--   현재 유효 정의는 095(095:21 create or replace, 0.15: 095:79-80 계산·095:130 insert·
--   095:18 컬럼 default)다. 086의 30%는 stale(095가 덮어씀). 본 105는 105가 095보다
--   나중 번호라 함수를 재정의하므로, 반드시 095(0.15) 본문을 베이스로 삼는다.
--   계산 2곳 + insert fee_rate 1곳 모두 0.15 — 0.30 절대 금지(있으면 15→30 회귀 버그).
--   (CLAUDE.md 30%는 stale이나 이 프롬프트 범위 밖 — 미수정. fee_rate 컬럼 default는
--    095:18이 이미 0.15로 바꿔둠 → 본 파일은 default 미터치.)
--
-- 변경점(095 베이스 대비, 딱 4가지 — 수수료는 095 그대로 0.15):
--   (1) status CHECK 에 'accruing' 추가.
--   (2) INSERT 블록 calculated CASE: else 'pending' 앞에
--       when period_end is null or period_end > now() then 'accruing'.
--   (3) UPDATE(재싱크) 블록: source_events 에 e.period_end 추가 + 동일 CASE 게이팅 +
--       WHERE 에 업그레이드 1줄 or (c.sync_status='pending' and i.status='accruing').
--       (paid 는 i.status<>'paid' 가드로 절대 미터치 — 086 그대로)
--   (4) 1회성 백필: status='pending' 이며 미완료(period_end null/미래) → 'accruing'.
-- =============================================================================

-- (1) status CHECK 에 'accruing' 추가 (086:33 인라인 CHECK 교체)
alter table public.subscription_settlement_items
  drop constraint if exists subscription_settlement_items_status_check;
alter table public.subscription_settlement_items
  add constraint subscription_settlement_items_status_check
  check (status in ('accruing', 'pending', 'paid', 'hold', 'canceled'));

-- (2)(3) refresh 함수 재정의 — 086 본문 동일 + period 게이팅만 추가
create or replace function public.refresh_subscription_settlement_items(
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (
  item_status text,
  item_count bigint,
  gross_cents bigint,
  platform_fee_cents bigint,
  mentor_amount_cents bigint
)
language plpgsql
security definer
set search_path = public
as $function$
begin
  with source_events as (
    select
      e.id as billing_event_id,
      e.subscription_id,
      e.student_id,
      e.mentor_id,
      e.payment_id,
      e.ledger_id,
      e.event_type,
      coalesce(e.billing_at, e.processed_at, e.created_at) as billing_at,
      e.period_start,
      e.period_end,
      e.amount_cents::bigint as gross_cents,
      lower(coalesce(s.status, '')) as subscription_status,
      coalesce(s.cancel_at_period_end, false) as cancel_at_period_end,
      coalesce(rf.has_pending_refund, false) as has_pending_refund,
      coalesce(rf.has_succeeded_refund, false) as has_succeeded_refund
    from public.subscription_billing_events e
    join public.subscriptions s on s.id = e.subscription_id
    left join lateral (
      select
        bool_or(lower(coalesce(r.status, '')) = 'pending') as has_pending_refund,
        bool_or(lower(coalesce(r.status, '')) in ('succeeded', 'success', 'approved', 'paid')) as has_succeeded_refund
      from public.refunds r
      where coalesce(r.request_type, '') = 'subscription_prorated'
        and (
          r.subscription_id = e.subscription_id
          or (
            r.subscription_id is null
            and r.payment_id is not null
            and r.payment_id = e.payment_id
          )
        )
    ) rf on true
    where e.status = 'succeeded'
      and e.event_type in ('initial', 'renewal')
      and coalesce(e.amount_cents, 0) > 0
      and (p_from is null or coalesce(e.billing_at, e.processed_at, e.created_at) >= p_from)
      and (p_to is null or coalesce(e.billing_at, e.processed_at, e.created_at) < p_to)
  ), calculated as (
    select
      se.*,
      floor(se.gross_cents::numeric * 0.15)::bigint as platform_fee_cents,
      (se.gross_cents - floor(se.gross_cents::numeric * 0.15)::bigint) as mentor_amount_cents,
      case
        when se.has_succeeded_refund or se.subscription_status = 'refunded' then 'canceled'
        when se.has_pending_refund then 'hold'
        when se.subscription_status in ('cancel_scheduled', 'canceled', 'cancelled', 'expired') then 'hold'
        when se.cancel_at_period_end then 'hold'
        -- [105 게이팅] 기간 미완료(또는 period_end 미상)면 지급 불가 = accruing
        when se.period_end is null or se.period_end > now() then 'accruing'
        else 'pending'
      end as sync_status,
      case
        when se.has_succeeded_refund or se.subscription_status = 'refunded' then 'refund_succeeded'
        when se.has_pending_refund then 'refund_pending'
        when se.subscription_status in ('cancel_scheduled', 'canceled', 'cancelled', 'expired') then 'subscription_canceled_or_expired'
        when se.cancel_at_period_end then 'cancel_at_period_end'
        else null
      end as sync_hold_reason
    from source_events se
  )
  insert into public.subscription_settlement_items (
    billing_event_id,
    subscription_id,
    mentor_id,
    student_id,
    payment_id,
    ledger_id,
    event_type,
    billing_at,
    period_start,
    period_end,
    gross_cents,
    platform_fee_cents,
    mentor_amount_cents,
    fee_rate,
    status,
    hold_reason,
    idempotency_key
  )
  select
    c.billing_event_id,
    c.subscription_id,
    c.mentor_id,
    c.student_id,
    c.payment_id,
    c.ledger_id,
    c.event_type,
    c.billing_at,
    c.period_start,
    c.period_end,
    c.gross_cents,
    c.platform_fee_cents,
    c.mentor_amount_cents,
    0.15,
    c.sync_status,
    c.sync_hold_reason,
    'sub_settlement:' || c.billing_event_id::text
  from calculated c
  on conflict (billing_event_id) do nothing;

  with source_events as (
    select
      e.id as billing_event_id,
      e.period_end,
      lower(coalesce(s.status, '')) as subscription_status,
      coalesce(s.cancel_at_period_end, false) as cancel_at_period_end,
      coalesce(rf.has_pending_refund, false) as has_pending_refund,
      coalesce(rf.has_succeeded_refund, false) as has_succeeded_refund
    from public.subscription_billing_events e
    join public.subscriptions s on s.id = e.subscription_id
    left join lateral (
      select
        bool_or(lower(coalesce(r.status, '')) = 'pending') as has_pending_refund,
        bool_or(lower(coalesce(r.status, '')) in ('succeeded', 'success', 'approved', 'paid')) as has_succeeded_refund
      from public.refunds r
      where coalesce(r.request_type, '') = 'subscription_prorated'
        and (
          r.subscription_id = e.subscription_id
          or (
            r.subscription_id is null
            and r.payment_id is not null
            and r.payment_id = e.payment_id
          )
        )
    ) rf on true
    where e.status = 'succeeded'
      and e.event_type in ('initial', 'renewal')
      and coalesce(e.amount_cents, 0) > 0
      and (p_from is null or coalesce(e.billing_at, e.processed_at, e.created_at) >= p_from)
      and (p_to is null or coalesce(e.billing_at, e.processed_at, e.created_at) < p_to)
  ), calculated as (
    select
      se.billing_event_id,
      case
        when se.has_succeeded_refund or se.subscription_status = 'refunded' then 'canceled'
        when se.has_pending_refund then 'hold'
        when se.subscription_status in ('cancel_scheduled', 'canceled', 'cancelled', 'expired') then 'hold'
        when se.cancel_at_period_end then 'hold'
        -- [105 게이팅] 기간 미완료(또는 period_end 미상)면 accruing
        when se.period_end is null or se.period_end > now() then 'accruing'
        else 'pending'
      end as sync_status,
      case
        when se.has_succeeded_refund or se.subscription_status = 'refunded' then 'refund_succeeded'
        when se.has_pending_refund then 'refund_pending'
        when se.subscription_status in ('cancel_scheduled', 'canceled', 'cancelled', 'expired') then 'subscription_canceled_or_expired'
        when se.cancel_at_period_end then 'cancel_at_period_end'
        else null
      end as sync_hold_reason
    from source_events se
  )
  update public.subscription_settlement_items i
  set
    status = c.sync_status,
    hold_reason = c.sync_hold_reason,
    updated_at = now()
  from calculated c
  where i.billing_event_id = c.billing_event_id
    and i.status <> 'paid'
    and (
      (c.sync_status = 'canceled' and i.status <> 'canceled')
      or (c.sync_status = 'hold' and i.status = 'pending')
      -- [105 게이팅] 기간이 완료되면 accruing → pending 업그레이드
      or (c.sync_status = 'pending' and i.status = 'accruing')
    );

  return query
  select
    i.status::text as item_status,
    count(*)::bigint as item_count,
    coalesce(sum(i.gross_cents), 0)::bigint as gross_cents,
    coalesce(sum(i.platform_fee_cents), 0)::bigint as platform_fee_cents,
    coalesce(sum(i.mentor_amount_cents), 0)::bigint as mentor_amount_cents
  from public.subscription_settlement_items i
  where (p_from is null or i.billing_at >= p_from)
    and (p_to is null or i.billing_at < p_to)
  group by i.status
  order by i.status;
end;
$function$;

comment on function public.refresh_subscription_settlement_items(timestamptz, timestamptz) is
  '105: 095(수수료 15%) 베이스 + period 완료 게이팅(accruing). 미완료=accruing(지급불가), period_end<=now 시 pending 업그레이드. 수수료 15%/85% 유지(30% 회귀 아님).';

-- (4) 1회성 백필 — 미완료인데 pending 으로 적립돼 있던 진행중 사이클을 accruing 으로.
--     paid/hold/canceled 는 status='pending' 필터로 자동 제외(기존 paid 보존).
update public.subscription_settlement_items
set status = 'accruing', updated_at = now()
where status = 'pending'
  and (period_end is null or period_end > now());
