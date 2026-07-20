/**
 * 멘토 정산 UI 표시 헬퍼 — 클라이언트·서버 공용 (server-only import 없음)
 */
import {
  calcPayoutWithholding,
  CUSTOM_REQUEST_PLATFORM_FEE_LABEL,
  INDIVIDUAL_QUESTION_PLATFORM_FEE_LABEL,
  MENTOR_CUSTOM_REQUEST_PLATFORM_SHARE,
  MENTOR_INDIVIDUAL_QUESTION_PLATFORM_SHARE,
  MENTOR_SUBSCRIPTION_PLATFORM_SHARE,
  SUBSCRIPTION_PLATFORM_FEE_LABEL,
} from "@/lib/mentor/mentorPayoutsConstants";
import type {
  MentorPayoutDetailLine,
  MentorPayoutScheduleInfo,
  MentorPayoutSettlementTableRow,
  PayoutLineType,
  PayoutUiStatus,
} from "@/lib/mentor/mentorPayoutsTypes";

export function platformFeeLabelForType(type: PayoutLineType): string {
  if (type === "subscription") return SUBSCRIPTION_PLATFORM_FEE_LABEL;
  if (type === "individual_question") return INDIVIDUAL_QUESTION_PLATFORM_FEE_LABEL;
  return CUSTOM_REQUEST_PLATFORM_FEE_LABEL;
}

export function platformFeeRateForType(type: PayoutLineType): number {
  if (type === "subscription") return MENTOR_SUBSCRIPTION_PLATFORM_SHARE;
  if (type === "individual_question") return MENTOR_INDIVIDUAL_QUESTION_PLATFORM_SHARE;
  return MENTOR_CUSTOM_REQUEST_PLATFORM_SHARE;
}

/** DB fee_rate가 잘못 저장된 경우(예: 0.1) 유형별 잠금값으로 보정 */
export function resolvePlatformFeeRate(type: PayoutLineType, raw: unknown): number {
  const expected = platformFeeRateForType(type);
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return expected;
  const asFraction = n > 0 && n <= 1 ? n : n / 100;
  if (Math.abs(asFraction - expected) < 0.02) return expected;
  if (type === "subscription" && asFraction <= 0.11) return MENTOR_SUBSCRIPTION_PLATFORM_SHARE;
  if (type === "custom_request" && asFraction <= 0.11) return MENTOR_CUSTOM_REQUEST_PLATFORM_SHARE;
  if (type === "individual_question" && asFraction <= 0.11) return MENTOR_INDIVIDUAL_QUESTION_PLATFORM_SHARE;
  return expected;
}

export function formatPlatformFeeRateLabel(type: PayoutLineType, _raw?: unknown): string {
  return platformFeeLabelForType(type);
}

const WEEKDAY_KO = ["일", "월", "화", "수", "목", "금", "토"] as const;

export function formatPayoutDateLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const w = WEEKDAY_KO[d.getDay()];
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}.${m}.${day} (${w})`;
}

export function formatYearMonthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  return `${y}년 ${String(m).padStart(2, "0")}월`;
}

export function formatChartMonthLabel(ym: string): string {
  const [y, m] = ym.split("-");
  if (!y || !m) return ym;
  return `${y.slice(-2)}.${m}`;
}

export function buildPayoutScheduleInfo(
  expectedAmount: number,
  completedAmount: number,
  from = new Date()
): MentorPayoutScheduleInfo {
  const y = from.getFullYear();
  const m = from.getMonth();
  const day = from.getDate();
  const target = day < 23 ? new Date(y, m, 23) : new Date(y, m + 1, 23);
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const progress = Math.min(100, Math.round((day / daysInMonth) * 100));

  return {
    nextPayoutDateIso: target.toISOString(),
    nextPayoutLabel: formatPayoutDateLabel(target.toISOString()),
    monthProgressPct: progress,
    monthLabel: `${m + 1}월`,
    completedPayoutAmount: completedAmount,
    expectedPayoutAmount: expectedAmount,
  };
}

function mapLineStatusToUi(status: string, net: number): PayoutUiStatus {
  const s = status.toLowerCase();
  if (s.includes("취소") || s.includes("cancel") || net < 0) return "cancelled";
  if (s.includes("완료") || s.includes("paid") || s.includes("지급")) return "paid";
  if (s.includes("보류") || s.includes("hold")) return "hold";
  return "scheduled";
}

/** W-01: 라인 생성 시 원천징수 3.3%·실지급액을 산출해 채운다 (SQL 108/114와 동일 per-line floor) */
export function withPayoutWithholding(
  line: Omit<MentorPayoutDetailLine, "withholdingAmount" | "payoutAmount">
): MentorPayoutDetailLine {
  const withholdingAmount = calcPayoutWithholding(line.netAmount);
  return { ...line, withholdingAmount, payoutAmount: line.netAmount - withholdingAmount };
}

export function detailLineToSettlementRow(line: MentorPayoutDetailLine): MentorPayoutSettlementTableRow {
  const uiStatus = mapLineStatusToUi(line.status, line.netAmount);
  const isCancelled = uiStatus === "cancelled";
  return {
    id: line.id,
    date: line.date,
    type: line.type,
    description: line.description,
    grossAmount: isCancelled ? -Math.abs(line.paymentAmount) : line.paymentAmount,
    feeAmount: isCancelled ? Math.abs(line.feeAmount) : line.feeAmount,
    netAmount: line.netAmount,
    withholdingAmount: isCancelled ? 0 : line.withholdingAmount,
    payoutAmount: isCancelled ? line.netAmount : line.payoutAmount,
    uiStatus,
    isCancelled,
  };
}
