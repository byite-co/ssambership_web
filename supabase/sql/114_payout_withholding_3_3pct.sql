-- =============================================================================
-- 114_payout_withholding_3_3pct.sql
-- 목적(W-01): 프리랜서 사업소득 원천징수 3.3% — "23일 후불 지급 시점 공제" 설계 확정분.
--   ① payout_run_items(106)에 공제액·실지급액 컬럼 추가(불변 스냅샷·원장성 추적).
--   ② due_payouts 뷰(111 정의 기반)에 공제 예정액을 노출.
--   실제 공제 실행은 108 RPC(pay_due_payouts_for_run — W-01 개정판)가 담당.
--
-- ⚠️ 적용 메모:
--   - payout_run_items 는 라이브 기적용 테이블(106) → 본 ALTER 는 비파괴(ADD COLUMN)지만
--     라이브 반영은 별도 운영 결정. 108/109/110(DRAFT) 가동 전에는 공제가 일어나지 않음.
--   - payout_run_items_block_mutation 트리거(106)는 행 UPDATE/DELETE 차단용 —
--     컬럼 추가(DDL)·신규 INSERT 와 충돌 없음(트리거 변경 불필요).
--   - 컬럼 명칭: 기존 gross_cents/platform_fee_cents/mentor_amount_cents 와의
--     단위·명명 일관성을 위해 *_cents 채택(1캐시=1원, cents=원×100 규약).
--
-- 선행(적용 시): 105, 106, 107, 108(W-01 개정판), 109, 110, 111, ~113.
-- =============================================================================

-- ① 불변 스냅샷에 원천징수 추적 컬럼 추가
alter table public.payout_run_items
  add column if not exists withholding_cents bigint,
  add column if not exists net_paid_cents bigint;

comment on column public.payout_run_items.withholding_cents is
  'W-01: 프리랜서 사업소득 원천징수 3.3% 공제액 = floor(mentor_amount_cents * 0.033). 지급 시점 고정.';
comment on column public.payout_run_items.net_paid_cents is
  'W-01: 실지급액 = mentor_amount_cents - withholding_cents. 지급 시점 고정.';

-- ② due_payouts 뷰 — 공제 예정액 노출 (111 정의 verbatim + 말미 2컬럼 추가)
--    CREATE OR REPLACE VIEW 는 기존 컬럼 뒤에만 추가 가능 → 끝에 덧붙인다.
create or replace view public.due_payouts as

-- ── 구독 ──────────────────────────────────────────────────────────────────
select
  'subscription'::text                  as source_type,
  ssi.id                                as source_id,
  ssi.mentor_id                         as mentor_id,
  ssi.mentor_amount_cents::bigint       as mentor_amount_cents,
  ssi.gross_cents::bigint               as gross_cents,
  ssi.platform_fee_cents::bigint        as platform_fee_cents,
  ssi.fee_rate                          as fee_rate,
  ssi.period_end                        as completion_ts,
  floor(ssi.mentor_amount_cents::numeric * 0.033)::bigint as withholding_cents_est,   -- [114]
  (ssi.mentor_amount_cents::bigint
    - floor(ssi.mentor_amount_cents::numeric * 0.033)::bigint) as net_cents_est        -- [114]
from public.subscription_settlement_items ssi
where ssi.period_end is not null
  and ssi.period_end <= now()                          -- [111] 미완료(미래 period) 배제
  and ssi.status not in ('paid', 'hold', 'canceled')

union all

-- ── 맞춤의뢰(CR) ─────────────────────────────────────────────────────────
select
  'custom_request'::text                          as source_type,
  cs.id                                           as source_id,
  cs.mentor_id                                    as mentor_id,
  (cs.mentor_amount::bigint * 100)                as mentor_amount_cents,
  (cs.gross_amount::bigint * 100)                 as gross_cents,
  (cs.platform_fee_amount::bigint * 100)          as platform_fee_cents,
  cs.fee_rate                                     as fee_rate,
  o.accepted_at                                   as completion_ts,
  floor((cs.mentor_amount::numeric * 100) * 0.033)::bigint as withholding_cents_est,   -- [114]
  ((cs.mentor_amount::bigint * 100)
    - floor((cs.mentor_amount::numeric * 100) * 0.033)::bigint) as net_cents_est        -- [114]
from public.custom_order_settlement_items cs
join public.custom_request_orders o on o.id = cs.custom_request_order_id
where cs.status in ('pending', 'on_hold', 'payable')
  and o.accepted_at is not null
  and o.accepted_at <= now()                           -- [111] 미래 수락시각 방어
  and coalesce(lower(trim(o.payment_status)), '') <> 'refunded'
  and coalesce(lower(trim(o.status)), '') not in ('cancelled', 'canceled', 'refunded')
  and not exists (
    select 1 from public.disputes d
    where d.custom_request_order_id = o.id
      and d.status in ('open', 'under_review', 'escalated')
  )

union all

-- ── 개별질문(IQ) ─────────────────────────────────────────────────────────
select
  'individual_question'::text                              as source_type,
  q.id                                                     as source_id,
  coalesce(q.claimed_mentor_id, q.designated_mentor_id)    as mentor_id,
  floor(q.price_cents::numeric * 0.85)::bigint             as mentor_amount_cents,
  q.price_cents::bigint                                    as gross_cents,
  (q.price_cents - floor(q.price_cents::numeric * 0.85)::bigint) as platform_fee_cents,
  0.15::numeric                                            as fee_rate,
  q.released_at                                            as completion_ts,
  floor(floor(q.price_cents::numeric * 0.85) * 0.033)::bigint as withholding_cents_est, -- [114]
  (floor(q.price_cents::numeric * 0.85)::bigint
    - floor(floor(q.price_cents::numeric * 0.85) * 0.033)::bigint) as net_cents_est      -- [114]
from public.individual_questions q
where q.released_at is not null
  and q.released_at <= now()                             -- [111] 미래 확정시각 방어
  and q.release_ledger_id is null
  and q.refund_ledger_id is null
  and q.status not in ('refunded', 'expired', 'canceled')
  and coalesce(q.claimed_mentor_id, q.designated_mentor_id) is not null;

comment on view public.due_payouts is
  '107+111+114: 3채널 지급가능 후보 + completion_ts<=now() 방어 + 원천징수 3.3% 공제 예정액(withholding_cents_est/net_cents_est). 정밀 cutoff·실제 공제는 108 RPC.';

revoke all on public.due_payouts from anon, authenticated;
grant select on public.due_payouts to service_role;
