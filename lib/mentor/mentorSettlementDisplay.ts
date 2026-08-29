/**
 * 멘토 정산 화면 표시 헬퍼 — 클라이언트·서버 공용 (server-only import 금지)
 *
 * 금액·상태는 RPC 검증값을 그대로 표기하고, 여기서는 표기 형태(행 구성·라벨·날짜 문자열)만
 * 만든다. 상태는 RPC 5종만 칩으로 매핑하고 그 외 값은 오류 칩으로 노출한다(무음 매핑 금지).
 */
import {
  centsToCash,
  formatKstMonthDay,
  isSettlementLineStatus,
  type MentorSettlementLine,
  type MentorSettlementSummary,
  type SettlementLineStatus,
  type SettlementSourceType,
} from "@/lib/mentor/mentorSettlementSchema";
import type { MentorPayoutPerformanceRow } from "@/lib/mentor/mentorPayoutsTypes";

export type MentorSettlementTableRow = {
  id: string;
  /** occurred_at — 월 필터·정렬 기준 */
  date: string;
  type: SettlementSourceType | "unknown";
  description: string;
  grossCash: number;
  feeCash: number;
  mentorCash: number;
  withholdingCash: number;
  netCash: number;
  /** RPC 원문 상태 (5종 외 값 포함) */
  status: string;
  holdReason: string | null;
  /** 지급(예정)일 = paid_run_date ?? expected_run_date */
  payDate: string | null;
};

function shortId(id: string): string {
  return id.slice(0, 8);
}

function lineDescription(line: MentorSettlementLine): string {
  if (line.sourceType === "subscription") {
    if (line.periodStart && line.periodEnd) {
      return `구독 정산 · ${formatKstMonthDay(line.periodStart)}~${formatKstMonthDay(line.periodEnd)}`;
    }
    return "구독 정산";
  }
  if (line.sourceType === "custom_request") return `맞춤의뢰 주문 · ${shortId(line.sourceId)}`;
  if (line.sourceType === "individual_question") return `개별질문 · ${shortId(line.sourceId)}`;
  return `정산 항목 · ${shortId(line.sourceId)}`;
}

function lineType(line: MentorSettlementLine): MentorSettlementTableRow["type"] {
  if (
    line.sourceType === "subscription" ||
    line.sourceType === "custom_request" ||
    line.sourceType === "individual_question"
  ) {
    return line.sourceType;
  }
  return "unknown";
}

export function settlementLineToTableRow(line: MentorSettlementLine): MentorSettlementTableRow {
  return {
    id: `${line.sourceType}-${line.sourceId}`,
    date: line.occurredAt,
    type: lineType(line),
    description: lineDescription(line),
    grossCash: centsToCash(line.grossCents),
    feeCash: centsToCash(line.platformFeeCents),
    mentorCash: centsToCash(line.mentorAmountCents),
    withholdingCash: centsToCash(line.withholdingCents),
    netCash: centsToCash(line.netCents),
    status: line.status,
    holdReason: line.holdReason,
    payDate: line.paidRunDate ?? line.expectedRunDate,
  };
}

const STATUS_LABELS: Record<SettlementLineStatus, string> = {
  accruing: "적립중",
  pending: "지급 예정",
  hold: "보류",
  paid: "지급 완료",
  canceled: "취소",
};

/** RPC 5종 상태 → 칩 라벨. 그 외 값은 null (호출측이 오류 칩을 그린다 — 무음 매핑 금지). */
export function settlementStatusLabel(status: string): string | null {
  return isSettlementLineStatus(status) ? STATUS_LABELS[status] : null;
}

/** 보류 사유 툴팁 — active_dispute 는 고정 문구, 그 외 원문 노출 */
export function settlementHoldReasonLabel(holdReason: string | null): string | null {
  if (!holdReason) return null;
  return holdReason === "active_dispute" ? "분쟁 진행 중" : holdReason;
}

const WEEKDAY_KO = ["일", "월", "화", "수", "목", "금", "토"] as const;

/** 'YYYY-MM-DD' → 'YYYY.MM.DD (요일)' — Date.UTC 기반이라 실행 시간대와 무관하게 결정적. */
export function formatRunDateLabel(ymd: string): string {
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return ymd;
  const [, y, mo, d] = m;
  const weekday = WEEKDAY_KO[new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d))).getUTCDay()];
  return `${y}.${mo}.${d} (${weekday})`;
}

/** 'YYYY-MM' → 월 숫자 (헤드라인 "{M}월 …" 표기) */
export function monthNumberOf(ym: string): number {
  return Number(ym.slice(5, 7));
}

export type SettlementTrendPoint = {
  yearMonth: string;
  /** 해당 월 발생 기준 멘토 수익(수수료 공제 후·원천징수 전) — summary.by_source_this_month 합 */
  revenueCash: number;
};

/** 월별 summary → 추이 포인트. 금액은 by_source_this_month 의 mentor_amount_cents 합 그대로. */
export function summaryToTrendPoint(summary: MentorSettlementSummary): SettlementTrendPoint {
  let revenueCents = 0;
  for (const entry of Object.values(summary.bySourceThisMonth)) {
    if (entry) revenueCents += entry.mentorAmountCents;
  }
  return { yearMonth: summary.month, revenueCash: centsToCash(revenueCents) };
}

export type MentorSettlementPageData = {
  /** 현재(KST) 연월 — 표 기본 월 필터 */
  month: string;
  /** KST 오늘 날짜 'YYYY-MM-DD' — run_date 경과 판정(서버 계산, hydration 안전) */
  todayKst: string;
  /** 이번 달 정산 진행률(%) — 우측 지급 일정 위젯 */
  monthProgressPct: number;
  summary: MentorSettlementSummary;
  /** 현재 월(KST 경계) 정산 내역 — mentor_settlement_lines */
  lines: MentorSettlementLine[];
  /** 최근 6개월 월간 추이 (오름차순) */
  trend: SettlementTrendPoint[];
  bank: { display: string; editable: boolean; bankName: string | null; accountMasked: string | null };
  performanceLines: MentorPayoutPerformanceRow[];
};
