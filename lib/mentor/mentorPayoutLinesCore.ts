/**
 * 멘토 정산 라인 — 순수 헬퍼 (server-only import 금지 · node:test 검증 가능).
 *
 * V-5: 성과 목록·개별질문 라인은 **정산 행이 있으면 행 값(적용 요율), 없으면 정책 요율(lib/payout/platformFeePolicy.ts)로
 *   추정하고 '예상' 으로 표시**한다. 정책 모듈 호출은 행이 없는 분기에만 있다 — 행이 있는데 상수로 계산하는 것은 결함이다.
 *
 * PR-1b V-2: 맞춤의뢰 정산 라인의 금액은 DB 행(custom_order_settlement_items) **그대로**다.
 *   구 코드는 DB platform_fee_amount 를 "결제액의 15% 미만이면 floor(payment×0.05)" 휴리스틱으로 덮어썼고
 *   (정상 5% 행은 조건이 항상 참이라 매번 TS 상수로 재계산), 정산 행이 없는 완료 주문은 TS 0.95 로 멘토 몫을
 *   지어냈다. 이제 요율(fee_rate)이 없는 행은 null → 설명에 '요율 미설정' 을 붙이고 수수료·멘토 몫을 계산하지
 *   않는다. 0.05 같은 리터럴로 대체하지 않는다(그것도 사본) — mentorSettlementSchema.ts 규범(재계산 금지)과 동일.
 */
import { estimateMentorAmount } from "../payout/platformFeePolicy.ts";
import { parseSettlementFeeRate, SETTLEMENT_FEE_RATE_UNSET_LABEL } from "../payout/settlementFeeRate.ts";
import type { MentorPayoutDetailLine } from "./mentorPayoutsTypes.ts";
import { minorCentsToCash } from "./subscriptionSettlementItemsCore.ts";

/** 정책 요율로 추정한 금액 표시(정산 행 없음) — 라인 설명·성과 표에 붙는다. */
export const PAYOUT_AMOUNT_ESTIMATED_LABEL = "예상";

type Row = Record<string, unknown>;

/** 원천징수 산출 전 라인 — 서비스 층이 withPayoutWithholding 으로 감싼다. */
export type MentorPayoutLineDraft = Omit<MentorPayoutDetailLine, "withholdingAmount" | "payoutAmount">;

export function intWon(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string") {
    const n = Number(v.replace(/,/g, ""));
    return Number.isFinite(n) ? Math.trunc(n) : 0;
  }
  return 0;
}

export function pickTs(row: Row): string {
  for (const k of ["created_at", "paid_at", "updated_at", "completed_at"]) {
    const v = row[k];
    if (typeof v === "string" && v) return v;
  }
  return new Date().toISOString();
}

/** 주문 행(DB)의 결제 gross(원). 없으면 0. */
export function orderGrossWon(order: Row | null): number {
  if (!order) return 0;
  for (const k of ["agreed_price", "final_price", "paid_amount", "amount", "price", "total_amount"]) {
    const n = intWon(order[k]);
    if (n > 0) return n;
  }
  return 0;
}

export function customRequestSettlementStatusLabel(status: unknown): string {
  const st = String(status ?? "").toLowerCase();
  return st === "paid" ? "지급완료" : st === "on_hold" ? "보류" : st === "payable" ? "지급가능" : "정산예정";
}

/**
 * custom_order_settlement_items 행 → 라인. 결제액·수수료·멘토 몫 3종은 DB 값 그대로(재계산 없음).
 * 요율이 없으면 feeRate null + 설명에 '요율 미설정' — 금액을 요율로 만들어 내지 않는다.
 */
export function customRequestSettlementLine(s: Row): MentorPayoutLineDraft {
  const feeRate = parseSettlementFeeRate(s.fee_rate);
  const oid = String(s.custom_request_order_id ?? "");
  const base = oid ? `맞춤의뢰 주문 · ${oid.slice(0, 8)}` : "맞춤의뢰 주문";
  return {
    id: `cr-${String(s.id ?? oid)}`,
    type: "custom_request",
    date: pickTs(s),
    description: feeRate == null ? `${base} · ${SETTLEMENT_FEE_RATE_UNSET_LABEL}` : base,
    paymentAmount: intWon(s.gross_amount),
    feeAmount: intWon(s.platform_fee_amount),
    netAmount: intWon(s.mentor_amount),
    feeRate,
    status: customRequestSettlementStatusLabel(s.status),
  };
}

/**
 * 정산 행이 없는 완료 주문 보강 라인 — 결제 gross 는 주문 행(DB)에서 읽되, 요율·수수료·멘토 몫은 정본(정산 행)이
 * 없으므로 **계산하지 않는다**(0 · '요율 미설정'). 구 코드는 TS 0.95 로 멘토 몫을 지어냈다. gross 를 모르면 null.
 */
export function customRequestCompletedOrderLine(o: Row): MentorPayoutLineDraft | null {
  const oid = String(o.id ?? "");
  if (!oid) return null;
  const payment = orderGrossWon(o);
  if (payment <= 0) return null;
  return {
    id: `cro-${oid}`,
    type: "custom_request",
    date: pickTs(o),
    description: `맞춤의뢰 완료 · ${oid.slice(0, 8)} · ${SETTLEMENT_FEE_RATE_UNSET_LABEL}`,
    paymentAmount: payment,
    feeAmount: 0,
    netAmount: 0,
    feeRate: null,
    status: "정산예정",
  };
}

/**
 * 개별질문(individual_questions released 행) → 라인.
 * - `runItem`(payout_run_items · source_type = individual_question · 지급 run 이 기록한 적용 요율·금액 스냅샷)이 있으면
 *   결제액·수수료·멘토 몫·요율을 **행 그대로** 쓴다(DB 가 정책과 다른 요율을 기록했어도 그대로).
 * - 없으면(아직 지급 run 이 돌지 않은 released 건) 정책 요율로 추정하고 설명에 '예상' 을 붙인다(amountEstimated).
 * 가격을 모르면(price_cents ≤ 0) null. 상태는 release_ledger_id 유무(현행 즉시지급 ↔ 후불)로 정한다.
 */
export function individualQuestionLine(q: Row, runItem: Row | null): MentorPayoutLineDraft | null {
  const priceCents = intWon(q.price_cents);
  if (priceCents <= 0) return null;
  const qid = String(q.id ?? "");
  const date = [q.released_at, q.answered_at, q.created_at].find((v) => typeof v === "string" && v) as string | undefined;
  const base = qid ? `개별질문 · ${qid.slice(0, 8)}` : "개별질문";
  const common = {
    id: `iq-${qid}`,
    type: "individual_question" as const,
    date: date ?? new Date().toISOString(),
    status: q.release_ledger_id ? "지급완료" : "정산예정",
  };
  if (runItem) {
    return {
      ...common,
      description: base,
      paymentAmount: minorCentsToCash(runItem.gross_cents),
      feeAmount: minorCentsToCash(runItem.platform_fee_cents),
      netAmount: minorCentsToCash(runItem.mentor_amount_cents),
      feeRate: parseSettlementFeeRate(runItem.fee_rate),
    };
  }
  const netCents = estimateMentorAmount(priceCents, "individual_question");
  return {
    ...common,
    description: `${base} · ${PAYOUT_AMOUNT_ESTIMATED_LABEL}`,
    paymentAmount: minorCentsToCash(priceCents),
    feeAmount: minorCentsToCash(priceCents - netCents),
    netAmount: minorCentsToCash(netCents),
    amountEstimated: true,
  };
}

/**
 * 성과 목록의 맞춤의뢰 금액 — 주문에 정산 행(custom_order_settlement_items)이 있으면 행의 mentor_amount(적용 요율),
 * 없으면(진행 중·취소·정산 행 없는 완료 주문) 결제 gross(주문 행)에 정책 요율을 적용한 추정값 + amountEstimated.
 */
export function customRequestPerformanceAmount(
  order: Row,
  settlement: Row | null
): { amount: number; amountEstimated: boolean } {
  if (settlement) return { amount: intWon(settlement.mentor_amount), amountEstimated: false };
  const gross = orderGrossWon(order);
  return { amount: gross > 0 ? estimateMentorAmount(gross, "custom_request") : 0, amountEstimated: true };
}
