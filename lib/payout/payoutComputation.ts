// 멘토 지급 계산 순수 유틸 — UI 표시·정합(node:test 검증). SQL 153(pay_due_payouts) 와 동일 규칙.
//
// 잠금값(CLAUDE.md): 수수료 공제 — 구독 15% · 개별질문 15% · 맞춤의뢰 5% → 멘토 수령 85/85/95%.
// 원천징수: 사업소득 3.3% = floor(mentor_amount * 0.033), 실지급 = mentor_amount - withholding.
// 지급일: 매월 23일 통합 후불.

export const PAYOUT_DAY_OF_MONTH = 23;

/**
 * UI 표기용 지급일 문구 — **여기서만 만든다**. 화면에 날짜를 직접 적어 두면 계산과
 * 어긋나도 아무도 모른다. 실제로 정산 카드는 23일을 계산해 보여주는데 안내 문구만
 * "매월 10일"로 박혀 있어 멘토에게 모순된 두 날짜가 동시에 노출됐다(QA-C12).
 * 오너 판단 2026-08-06: 23일이 정본이고 문구를 고친다.
 */
export const PAYOUT_DAY_LABEL = `매월 ${PAYOUT_DAY_OF_MONTH}일`;
export const WITHHOLDING_RATE = 0.033;

export type PayoutSourceType = "subscription" | "individual_question" | "custom_request";

/** 소스별 멘토 수령 비율(수수료 공제 후). 구독·개별질문 0.85 · 맞춤의뢰 0.95. */
export function mentorShareRate(sourceType: PayoutSourceType): number {
  return sourceType === "custom_request" ? 0.95 : 0.85;
}

/** 플랫폼 수수료 공제 후 멘토 몫(원천징수 전). floor 로 원 단위 절사. */
export function mentorAmountCents(grossCents: number, sourceType: PayoutSourceType): number {
  const g = Math.max(0, Math.floor(grossCents));
  return Math.floor(g * mentorShareRate(sourceType));
}

/** 원천징수 3.3% = floor(mentor_amount * 0.033). */
export function withholdingCents(mentorAmountCentsValue: number): number {
  const m = Math.max(0, Math.floor(mentorAmountCentsValue));
  return Math.floor(m * WITHHOLDING_RATE);
}

/** 실지급액 = 멘토 몫 - 원천징수(음수 방지). */
export function netPaidCents(mentorAmountCentsValue: number): number {
  const m = Math.max(0, Math.floor(mentorAmountCentsValue));
  return m - withholdingCents(m);
}

export type MentorPayoutBreakdown = {
  grossCents: number;
  mentorAmountCents: number;
  withholdingCents: number;
  netPaidCents: number;
  shareRate: number;
};

/** gross → 멘토 지급 내역 전체(표시용). */
export function computeMentorPayout(grossCents: number, sourceType: PayoutSourceType): MentorPayoutBreakdown {
  const mentor = mentorAmountCents(grossCents, sourceType);
  const wh = withholdingCents(mentor);
  return {
    grossCents: Math.max(0, Math.floor(grossCents)),
    mentorAmountCents: mentor,
    withholdingCents: wh,
    netPaidCents: mentor - wh,
    shareRate: mentorShareRate(sourceType),
  };
}
