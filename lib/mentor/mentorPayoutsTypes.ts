/** 멘토 정산 UI·API 공용 타입 — server-only 모듈 import 금지 */

export type PayoutLineType = "subscription" | "custom_request" | "individual_question";

export type MentorPayoutDetailLine = {
  id: string;
  type: PayoutLineType;
  date: string;
  description: string;
  paymentAmount: number;
  feeAmount: number;
  netAmount: number;
  /** W-01: 원천징수 3.3% 공제액 = floor(netAmount × 0.033) */
  withholdingAmount: number;
  /** W-01: 실지급(예정)액 = netAmount − withholdingAmount */
  payoutAmount: number;
  status: string;
};

export type MentorPayoutMonthlyCard = {
  yearMonth: string;
  label: string;
  revenue: number;
  scheduledPayout: number;
  status: "paid" | "scheduled";
};

export type MentorPayoutSummary = {
  thisMonthRevenue: number;
  thisMonthScheduledPayout: number;
  thisMonthSubscription: number;
  thisMonthCustomRequest: number;
  /** W-04: 이번 달 개별질문 수익(수수료 공제 후) */
  thisMonthIndividualQuestion: number;
  lifetimeSubscription: number;
  lifetimeCustomRequest: number;
  /** W-04: 누적 개별질문 수익 */
  lifetimeIndividualQuestion: number;
  /** W-01 4단 구조: 이번 달 총 수익(수수료 공제 전) */
  thisMonthGross: number;
  /** W-01 4단 구조: 이번 달 플랫폼 수수료 합계 */
  thisMonthFee: number;
  /** W-01 4단 구조: 이번 달 원천징수 3.3% 공제(예정)액 */
  thisMonthWithholding: number;
  /** W-01 4단 구조: 이번 달 실지급 예정액(수수료·원천징수 공제 후, 23일 지급) */
  thisMonthNetScheduledPayout: number;
  /**
   * 이번 달 **적립중** 금액(수수료 공제 후). 구독 사이클이 끝나지 않아 아직 지급
   * 대상이 아닌 항목의 합계이며, thisMonthScheduledPayout 과 겹치지 않는다(QA-A2).
   */
  thisMonthAccruing: number;
  bankDisplay: string;
  bankEditable: boolean;
  bankName: string | null;
  /** W2(C11): 마스킹 값(끝 4자리 외 *) — 계좌 원문은 서버 밖으로 내보내지 않는다. */
  bankAccountNumber: string | null;
};

export type MentorPayoutDetailResult = {
  lines: MentorPayoutDetailLine[];
  totals: {
    paymentAmount: number;
    feeAmount: number;
    netAmount: number;
    /** W-01: 원천징수 합계 */
    withholdingAmount: number;
    /** W-01: 실지급 합계 */
    payoutAmount: number;
  };
};

/** accruing = 적립중(구독 사이클 미완료 — 아직 지급 대상이 아니다, QA-A2) */
export type PayoutUiStatus = "paid" | "scheduled" | "accruing" | "hold" | "cancelled";

export type MentorPayoutSettlementTableRow = {
  id: string;
  date: string;
  type: PayoutLineType;
  description: string;
  grossAmount: number;
  feeAmount: number;
  netAmount: number;
  /** W-01: 원천징수 3.3% (취소 행은 0) */
  withholdingAmount: number;
  /** W-01: 실지급(예정)액 */
  payoutAmount: number;
  uiStatus: PayoutUiStatus;
  isCancelled: boolean;
};

export type MentorPayoutPerformanceRow = {
  id: string;
  date: string;
  type: PayoutLineType;
  title: string;
  studentName: string;
  amount: number;
  uiStatus: "done" | "in_progress" | "cancelled";
};

export type MentorPayoutScheduleInfo = {
  nextPayoutDateIso: string;
  nextPayoutLabel: string;
  monthProgressPct: number;
  monthLabel: string;
  completedPayoutAmount: number;
  expectedPayoutAmount: number;
};

export type MentorPayoutsPageData = {
  summary: MentorPayoutSummary;
  months: MentorPayoutMonthlyCard[];
  schedule: MentorPayoutScheduleInfo;
  revenueShare: {
    subscription: number;
    customRequest: number;
    /** W-04 */
    individualQuestion: number;
    total: number;
    subscriptionPct: number;
    customRequestPct: number;
    /** W-04 */
    individualQuestionPct: number;
  };
  kpis: {
    subscription: { amount: number; momPct: number | null };
    customRequest: { amount: number; momPct: number | null };
    /** W-04 */
    individualQuestion: { amount: number; momPct: number | null };
    total: { amount: number; momPct: number | null };
    lifetimePaid: number;
  };
  settlementLines: MentorPayoutSettlementTableRow[];
  performanceLines: MentorPayoutPerformanceRow[];
  defaultMonth: string;
};
