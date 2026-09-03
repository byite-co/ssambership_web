/**
 * 멘토 정산 UI 표시 헬퍼 — 클라이언트·서버 공용 (server-only import 없음)
 */
import { calcPayoutWithholding } from "@/lib/payout/payoutComputation";
import { isAccruingPayoutStatus } from "@/lib/mentor/payoutLineStatus";
import { formatCashKrw as formatCashKrwDisplay } from "@/lib/utils/formatDisplay";
import { kstDateString, kstYearMonth, nextYearMonth } from "@/lib/mentor/mentorSettlementSchema";
import type {
  MentorPayoutDetailLine,
  MentorPayoutScheduleInfo,
  MentorPayoutSettlementTableRow,
  PayoutUiStatus,
} from "@/lib/mentor/mentorPayoutsTypes";

// PR-1b V-3: 구 resolvePlatformFeeRate / platformFeeRateForType / formatPlatformFeeRateLabel / platformFeeLabelForType 삭제 —
// DB fee_rate 를 TS 잠금값으로 "보정"하던 사문 코드(호출자 0). 요율 표시는 lib/payout/settlementFeeRate.ts(DB 값 그대로)로만.

const WEEKDAY_KO = ["일", "월", "화", "수", "목", "금", "토"] as const;

export const DEFAULT_MASKED_BANK_DISPLAY = "정산 계좌 미등록";

/** 정산 화면 인앱 가치 표시 — 캐시 단위(숫자 동일, 표시만). 실결제 KRW는 충전/토스에서만. */
export function formatCashKrw(n: number): string {
  return formatCashKrwDisplay(n, { unit: "캐시" });
}

export function formatPayoutDateLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // TZ-FIX R3 #31: 서버 로컬 getter → KST 벽시계 (epoch+9h 후 UTC getter, 포맷 유지).
  const k = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const w = WEEKDAY_KO[k.getUTCDay()];
  const y = k.getUTCFullYear();
  const m = String(k.getUTCMonth() + 1).padStart(2, "0");
  const day = String(k.getUTCDate()).padStart(2, "0");
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
  // TZ-FIX R3 #31: 서버 로컬(UTC) 일·월 → KST 달력 (kstDateString/kstYearMonth 교체만 —
  // orphan 소비처 정리는 별도 회차, §4 화이트리스트 주의).
  const [y, m, day] = kstDateString(from).split("-").map(Number); // m = 1..12
  const targetYm = day < 23 ? kstYearMonth(from) : nextYearMonth(kstYearMonth(from));
  const target = new Date(`${targetYm}-23T00:00:00+09:00`);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const progress = Math.min(100, Math.round((day / daysInMonth) * 100));

  return {
    nextPayoutDateIso: target.toISOString(),
    nextPayoutLabel: formatPayoutDateLabel(target.toISOString()),
    monthProgressPct: progress,
    monthLabel: `${m}월`,
    completedPayoutAmount: completedAmount,
    expectedPayoutAmount: expectedAmount,
  };
}

function mapLineStatusToUi(status: string, net: number): PayoutUiStatus {
  const s = status.toLowerCase();
  if (s.includes("취소") || s.includes("cancel") || net < 0) return "cancelled";
  if (s.includes("완료") || s.includes("paid") || s.includes("지급")) return "paid";
  if (s.includes("보류") || s.includes("hold")) return "hold";
  // 적립중은 "지급 예정"과 다른 칩으로 보여준다 — 아직 받을 수 없는 돈이다(QA-A2).
  if (isAccruingPayoutStatus(status)) return "accruing";
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
