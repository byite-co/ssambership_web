/**
 * 멘토 정산 라인 — 순수 헬퍼 (server-only import 금지 · node:test 검증 가능).
 *
 * PR-1b V-2: 맞춤의뢰 정산 라인의 금액은 DB 행(custom_order_settlement_items) **그대로**다.
 *   구 코드는 DB platform_fee_amount 를 "결제액의 15% 미만이면 floor(payment×0.05)" 휴리스틱으로 덮어썼고
 *   (정상 5% 행은 조건이 항상 참이라 매번 TS 상수로 재계산), 정산 행이 없는 완료 주문은 TS 0.95 로 멘토 몫을
 *   지어냈다. 이제 요율(fee_rate)이 없는 행은 null → 설명에 '요율 미설정' 을 붙이고 수수료·멘토 몫을 계산하지
 *   않는다. 0.05 같은 리터럴로 대체하지 않는다(그것도 사본) — mentorSettlementSchema.ts 규범(재계산 금지)과 동일.
 */
import { parseSettlementFeeRate, SETTLEMENT_FEE_RATE_UNSET_LABEL } from "../payout/settlementFeeRate.ts";
import type { MentorPayoutDetailLine } from "./mentorPayoutsTypes.ts";

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
