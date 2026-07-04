-- =============================================================================
-- 107_due_payouts_view.sql   [DRAFT — DB 미적용]
-- 목적(토대): 3채널(구독/CR/IQ)의 '지급 가능 후보'를 단일 shape 로 노출하는 읽기 전용 VIEW.
--   = 완료 사실이 있고(타임스탬프) + 아직 미지급 + 환불/취소/역행/분쟁/hold 아님.
--   ※ cutoff(전월 말 23:59) 필터는 여기 두지 않음 → ②단계 23일 RPC 에서 completion_ts<=cutoff 로 필터.
--   ※ 돈 이동 없음(뷰). 파생 status 의존 최소화 — 완료는 '타임스탬프 사실' 기준.
--
-- 공통 컬럼: source_type · source_id · mentor_id · mentor_amount_cents · gross_cents ·
--            platform_fee_cents · fee_rate · completion_ts
--
-- 단위 정규화: 구독=이미 cents(086) · CR=원(013, ×100) · IQ=price_cents 기준 계산.
--
-- ⚠️ 구독 mentor_amount_cents 는 086 계산(현재 70%) 그대로 노출 → 15%/85% 정합은
--    ②단계 송금 전 별도 확정(105 헤더 참조). 본 뷰는 원본 값을 가공 없이 합산.
--
-- 채널별 제외 근거(파일:줄):
--   구독: 환불=086 derive(refund_succeeded→canceled, pending→hold), period_end=086:28/127.
--   CR  : 환불 시 settlement 'cancelled'(056:84)·order payment_status 'refunded'(056:79)·
--         status 'cancelled'(056:91); 분쟁 open/under_review/escalated(055:250-253); 완료=accepted_at(055:314).
--   IQ  : 종료상태 refunded/expired/canceled(070:60-62, actions:414/580)·refund_ledger_id(070:71);
--         완료=released_at(070:67)·지급=release_ledger_id(070:70).
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
where ssi.period_end is not null                       -- 완료 사실(기간 종료시각)
  and ssi.status not in ('paid', 'hold', 'canceled')   -- 미지급 + 환불/해지 제외(accruing/pending 후보)

union all

-- ── 맞춤의뢰(CR) ─────────────────────────────────────────────────────────
select
  'custom_request'::text                          as source_type,
  cs.id                                           as source_id,
  cs.mentor_id                                    as mentor_id,
  (cs.mentor_amount::bigint * 100)                as mentor_amount_cents,   -- 원 → cents
  (cs.gross_amount::bigint * 100)                 as gross_cents,
  (cs.platform_fee_amount::bigint * 100)          as platform_fee_cents,
  cs.fee_rate                                     as fee_rate,
  o.accepted_at                                   as completion_ts
from public.custom_order_settlement_items cs
join public.custom_request_orders o on o.id = cs.custom_request_order_id
where cs.status in ('pending', 'on_hold', 'payable')   -- 미지급(=not paid/cancelled)
  and o.accepted_at is not null                        -- 완료 사실(수락/자동완료)
  and coalesce(lower(trim(o.payment_status)), '') <> 'refunded'
  and coalesce(lower(trim(o.status)), '') not in ('cancelled', 'canceled', 'refunded')
  and not exists (                                     -- 진행 중 분쟁 제외(055:250)
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
  floor(q.price_cents::numeric * 0.85)::bigint             as mentor_amount_cents,  -- 096: 멘토 85%
  q.price_cents::bigint                                    as gross_cents,
  (q.price_cents - floor(q.price_cents::numeric * 0.85)::bigint) as platform_fee_cents,
  0.15::numeric                                            as fee_rate,
  q.released_at                                            as completion_ts
from public.individual_questions q
where q.released_at is not null                  -- 완료 사실(학생 확정)
  and q.release_ledger_id is null                -- 아직 미지급
  and q.refund_ledger_id is null                 -- 환불 안 됨
  and q.status not in ('refunded', 'expired', 'canceled')
  and coalesce(q.claimed_mentor_id, q.designated_mentor_id) is not null;

comment on view public.due_payouts is
  '107: 3채널 지급가능 후보(완료 사실 있고 미지급·환불/취소/분쟁 제외) 단일 shape. cutoff 필터는 23일 RPC에서.';

-- 운영(service_role) 전용 — 후보 큐는 지급 RPC가 읽는다. 멘토 노출은 payout_run_items(106)로.
revoke all on public.due_payouts from anon, authenticated;
grant select on public.due_payouts to service_role;
