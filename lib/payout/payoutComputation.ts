// 멘토 지급 계산 순수 유틸 — UI 표시·정합(node:test 검증). SQL 153(pay_due_payouts) 와 동일 규칙.
//
// 수수료 정책 요율(구독·개별질문·맞춤의뢰 → 멘토 몫 = 1 − 요율)의 정본은 lib/payout/platformFeePolicy.ts 다 —
// 이 파일은 요율 리터럴을 두지 않고 거기서 파생한다(V-5).
// 원천징수: 사업소득 3.3% = floor(mentor_amount * WITHHOLDING_RATE), 실지급 = mentor_amount - withholding.
// 지급일: 매월 23일 통합 후불.

import { mentorShareRate, type PlatformFeeSourceType } from "./platformFeePolicy.ts";
import { formatRatePercent } from "./ratePercent.ts";

export const PAYOUT_DAY_OF_MONTH = 23;

/**
 * UI 표기용 지급일 문구 — **여기서만 만든다**. 화면에 날짜를 직접 적어 두면 계산과
 * 어긋나도 아무도 모른다. 실제로 정산 카드는 23일을 계산해 보여주는데 안내 문구만
 * "매월 10일"로 박혀 있어 멘토에게 모순된 두 날짜가 동시에 노출됐다(QA-C12).
 * 오너 판단 2026-08-06: 23일이 정본이고 문구를 고친다.
 */
export const PAYOUT_DAY_LABEL = `매월 ${PAYOUT_DAY_OF_MONTH}일`;

/** W-01 — 프리랜서 사업소득 원천징수 3.3%(23일 후불 지급 시점 공제, SQL 108/114 와 동일 산식). 요율 정본은 이 상수 하나다. */
export const WITHHOLDING_RATE = 0.033;
/** UI 표기 — 요율에서 파생("원천징수 3.3%"). 문구에 숫자를 직접 적지 않는다(지급일 문구와 같은 원칙). */
export const PAYOUT_WITHHOLDING_LABEL = `원천징수 ${formatRatePercent(WITHHOLDING_RATE)}`;
export const PAYOUT_WITHHOLDING_TOOLTIP = "프리랜서 사업소득 원천징수";

export type PayoutSourceType = PlatformFeeSourceType;

/** 소스별 멘토 수령 비율(수수료 공제 후) — 정책 요율 정본에서 파생(1 − 요율). */
export { mentorShareRate };

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

/**
 * 캐시(원) 단위 라인의 원천징수 공제액 = floor(정산액 × 3.3%) — 음수·0 라인은 공제 없음.
 * 구 lib/mentor/mentorPayoutsConstants.calcPayoutWithholding 그대로(입력을 절사하지 않는 원 단위 헬퍼라
 * cents 단위 withholdingCents 와 합치지 않는다 — 소수 캐시 입력에서 결과가 달라질 수 있다).
 */
export function calcPayoutWithholding(netAmount: number): number {
  return netAmount > 0 ? Math.floor(netAmount * WITHHOLDING_RATE) : 0;
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
