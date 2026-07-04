-- =============================================================================
-- 111_due_payouts_completion_guard.sql
-- 목적: due_payouts(107)에 "완료 시각이 현재 이하" 방어를 한 겹 추가.
--   = 미완료(미래 period_end=accruing 등) 행이 뷰에 아예 안 보이게.
--   배경: 107은 cutoff를 의도적으로 RPC(108)에 위임 → 뷰 단독으로는 미래 period 행이
--   노출됐음(STEP2 발견). Option A: 뷰에도 completion_ts<=now() 방어를 둬 이중 안전망.
--   ※ 23일 배치의 정밀 cutoff(전월 말 23:59)는 여전히 108 RPC가 담당. 본 방어는
--     "현재 이미 완료된 것만 후보"라는 약한 상한(now())일 뿐 — 둘은 상호보완.
--   ※ 돈 이동 없음(뷰만). 컬럼 구조 107과 동일 → CREATE OR REPLACE.
--
-- 변경점(107 대비, 각 채널 WHERE 에 완료시각<=now() 1줄씩):
--   구독: ssi.period_end <= now()
--   CR  : o.accepted_at <= now()
--   IQ  : q.released_at <= now()
-- =============================================================================

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
  ssi.period_end                        as completion_ts
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
  o.accepted_at                                   as completion_ts
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
  q.released_at                                            as completion_ts
from public.individual_questions q
where q.released_at is not null
  and q.released_at <= now()                             -- [111] 미래 확정시각 방어
  and q.release_ledger_id is null
  and q.refund_ledger_id is null
  and q.status not in ('refunded', 'expired', 'canceled')
  and coalesce(q.claimed_mentor_id, q.designated_mentor_id) is not null;

comment on view public.due_payouts is
  '107+111: 3채널 지급가능 후보(완료 사실 있고 미지급·환불/취소/분쟁 제외) + completion_ts<=now() 방어. 23일 cutoff는 108 RPC.';

revoke all on public.due_payouts from anon, authenticated;
grant select on public.due_payouts to service_role;
