/**
 * 관리자 정산 목록 항목 — 행 파싱·요약 순수 모듈 (server-only import 금지 · node:test 검증 가능).
 *
 * PR-1b(값 연동): 금액·요율은 DB 행 **그대로**다. 여기서 재계산하지 않는다.
 *   - 요율(fee_rate)이 없는 행에 추측값을 넣지 않는다 — 구 폴백 `0.3`(사업계획서 시절 30% 잔재)·맞춤의뢰
 *     `0` 을 제거하고 null 로 남겨 '요율 미설정' 으로 표시한다. 0.15/0.05 로 바꾸는 것도 금지(그것도 사본).
 *   - 요율 정본은 DB 다: subscription_settlement_items.fee_rate default 0.15 · custom_order_settlement_items
 *     .fee_rate default 0.05 · refresh_subscription_settlement_items / record_custom_order_dispute_split 본문.
 */
import { minorCentsToCash, subscriptionSettlementStatus } from "../mentor/subscriptionSettlementItemsCore.ts";
import { formatKoreanDate } from "../utils/formatDisplay.ts";

type Row = Record<string, unknown>;

export type AdminSettlementSummary = {
  totalRows: number;
  pendingMentorAmountSum: number;
  paidMentorAmountSum: number;
  /** 적립중(지급 불가) 멘토 정산금 합계 — pendingMentorAmountSum 과 겹치지 않는다. */
  accruingMentorAmountSum: number;
  pendingCount: number;
  accruingCount: number;
  onHoldCount: number;
  payableCount: number;
  paidCount: number;
  cancelledCount: number;
};

export type AdminSettlementListItem = {
  id: string;
  sourceType: "custom_request" | "subscription";
  customRequestOrderId: string;
  mentorId: string;
  payoutAccountDisplay: string;
  studentId: string | null;
  grossAmount: number;
  platformFeeAmount: number;
  mentorAmount: number;
  /** DB fee_rate(분수, 0.15). 행에 없으면 null — 폴백 리터럴 금지, 표시는 '요율 미설정' */
  feeRate: number | null;
  status: string;
  reason: string | null;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** 주문 보조 조회 성공 시 툴팁용(한 줄). 요율 없는 행은 '요율 미설정' 이 덧붙는다 */
  orderMetaLine: string | null;
};

export const ADMIN_SETTLEMENT_FEE_RATE_UNSET_LABEL = "요율 미설정";

/** DB fee_rate → 분수(0.15). 없거나 숫자가 아니면 null — 추측값(0.3/0.15/0) 금지. */
export function parseSettlementFeeRate(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string" && raw.trim() === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** 요율 표시 라벨 — null 은 '요율 미설정', 숫자는 백분율("15%"). */
export function adminSettlementFeeRateLabel(feeRate: number | null): string {
  if (feeRate == null) return ADMIN_SETTLEMENT_FEE_RATE_UNSET_LABEL;
  const pct = Number((feeRate * 100).toFixed(2));
  return `${pct}%`;
}

/** 요율 없는 행은 보조 메타 줄에 '요율 미설정' 을 덧붙여 기존 툴팁 경로로 표면화한다(레이아웃 불변). */
export function withFeeRateUnsetMarker(meta: string | null, feeRate: number | null): string | null {
  if (feeRate != null) return meta;
  return [meta, ADMIN_SETTLEMENT_FEE_RATE_UNSET_LABEL].filter((s): s is string => Boolean(s)).join(" · ");
}

export function toMoneyInt(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v);
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n) : 0;
  }
  return 0;
}

export function emptySettlementSummary(): AdminSettlementSummary {
  return {
    totalRows: 0,
    pendingMentorAmountSum: 0,
    paidMentorAmountSum: 0,
    accruingMentorAmountSum: 0,
    pendingCount: 0,
    accruingCount: 0,
    onHoldCount: 0,
    payableCount: 0,
    paidCount: 0,
    cancelledCount: 0,
  };
}

/** 상태별 건수·멘토 정산금 합계 — 금액은 행의 DB 값(mentorAmount) 그대로 합산한다(요율 재계산 없음). */
export function summarizeSettlementRows(rows: AdminSettlementListItem[]): AdminSettlementSummary {
  const s = emptySettlementSummary();
  s.totalRows = rows.length;
  for (const r of rows) {
    const st = r.status.trim().toLowerCase();
    const m = r.mentorAmount;
    if (st === "pending" || st === "on_hold" || st === "hold" || st === "payable") {
      s.pendingMentorAmountSum += m;
    }
    if (st === "paid") {
      s.paidMentorAmountSum += m;
    }
    if (st === "accruing") {
      s.accruingMentorAmountSum += m;
    }
    if (st === "accruing") s.accruingCount += 1;
    else if (st === "pending") s.pendingCount += 1;
    else if (st === "on_hold" || st === "hold") s.onHoldCount += 1;
    else if (st === "payable") s.payableCount += 1;
    else if (st === "paid") s.paidCount += 1;
    else if (st === "cancelled" || st === "canceled") s.cancelledCount += 1;
  }
  return s;
}

/** custom_order_settlement_items 행 → 목록 항목 (금액 원 단위 정수, DB 값 그대로). */
export function parseCosItem(r: Row): AdminSettlementListItem | null {
  const id = r.id != null ? String(r.id) : "";
  if (!id) return null;
  const feeRate = parseSettlementFeeRate(r.fee_rate);
  return {
    id,
    sourceType: "custom_request",
    customRequestOrderId: String(r.custom_request_order_id ?? ""),
    mentorId: String(r.mentor_id ?? ""),
    payoutAccountDisplay: "미등록",
    studentId: r.student_id != null && String(r.student_id).length ? String(r.student_id) : null,
    grossAmount: toMoneyInt(r.gross_amount),
    platformFeeAmount: toMoneyInt(r.platform_fee_amount),
    mentorAmount: toMoneyInt(r.mentor_amount),
    feeRate,
    status: String(r.status ?? "pending"),
    reason: r.reason != null && String(r.reason).length ? String(r.reason) : null,
    paidAt: r.paid_at != null ? String(r.paid_at) : null,
    createdAt: String(r.created_at ?? ""),
    updatedAt: String(r.updated_at ?? ""),
    // 주문 보조 조회가 붙으면 호출부가 buildOrderMetaLine 결과에 같은 마커를 다시 덧붙인다.
    orderMetaLine: withFeeRateUnsetMarker(null, feeRate),
  };
}

/** subscription_settlement_items 행 → 목록 항목 (cents → 캐시, DB 값 그대로). */
export function parseSubscriptionSettlementItem(r: Row): AdminSettlementListItem | null {
  const id = r.id != null ? String(r.id) : "";
  if (!id) return null;
  const billingEventId = String(r.billing_event_id ?? "");
  const feeRate = parseSettlementFeeRate(r.fee_rate);
  // TZ-FIX R3 #28: UTC ISO slice 절단 → KST 달력일 (formatKoreanDate, P-C).
  const periodStart = typeof r.period_start === "string" && r.period_start ? formatKoreanDate(r.period_start) : "";
  const periodEnd = typeof r.period_end === "string" && r.period_end ? formatKoreanDate(r.period_end) : "";
  const meta = [
    "구독 정산",
    r.event_type != null ? String(r.event_type) : "",
    periodStart || periodEnd ? `${periodStart || "?"}~${periodEnd || "?"}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return {
    id,
    sourceType: "subscription",
    customRequestOrderId: billingEventId || String(r.subscription_id ?? ""),
    mentorId: String(r.mentor_id ?? ""),
    payoutAccountDisplay: "미등록",
    studentId: r.student_id != null && String(r.student_id).length ? String(r.student_id) : null,
    grossAmount: minorCentsToCash(r.gross_cents),
    platformFeeAmount: minorCentsToCash(r.platform_fee_cents),
    mentorAmount: minorCentsToCash(r.mentor_amount_cents),
    feeRate,
    status: subscriptionSettlementStatus(r.status),
    reason: r.hold_reason != null && String(r.hold_reason).length ? String(r.hold_reason) : null,
    paidAt: r.paid_at != null ? String(r.paid_at) : null,
    createdAt: String(r.billing_at ?? r.created_at ?? ""),
    updatedAt: String(r.updated_at ?? r.created_at ?? r.billing_at ?? ""),
    orderMetaLine: withFeeRateUnsetMarker(meta || null, feeRate),
  };
}
