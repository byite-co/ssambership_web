/** 잠금값 — 멘토 몫 비율 */
export const MENTOR_SUBSCRIPTION_SHARE = 0.85 as const;
export const MENTOR_CUSTOM_REQUEST_SHARE = 0.95 as const;
/** W-04 — 개별질문 멘토 몫 85% (SQL 096/107/109 산식과 동일) */
export const MENTOR_INDIVIDUAL_QUESTION_SHARE = 0.85 as const;

export const MENTOR_SUBSCRIPTION_PLATFORM_SHARE = 0.15 as const;
export const MENTOR_CUSTOM_REQUEST_PLATFORM_SHARE = 0.05 as const;
export const MENTOR_INDIVIDUAL_QUESTION_PLATFORM_SHARE = 0.15 as const;

/**
 * UI 표기 — 지급일. 계산 정본(lib/payout/payoutComputation.ts)에서 그대로 재수출한다.
 * 화면 문구가 계산과 갈라지지 않게 하는 단일 지점이다(QA-C12).
 */
export { PAYOUT_DAY_LABEL } from "@/lib/payout/payoutComputation";

/** UI 표기 — 플랫폼 수수료(공제) */
export const SUBSCRIPTION_PLATFORM_FEE_LABEL = "15% 공제 (플랫폼 수수료)" as const;
export const CUSTOM_REQUEST_PLATFORM_FEE_LABEL = "5% 공제 (플랫폼 수수료)" as const;
export const INDIVIDUAL_QUESTION_PLATFORM_FEE_LABEL = "15% 공제 (플랫폼 수수료)" as const;

/** W-01 — 프리랜서 사업소득 원천징수 3.3% (23일 후불 지급 시점 공제, SQL 108/114와 동일 산식) */
export const PAYOUT_WITHHOLDING_RATE = 0.033 as const;
export const PAYOUT_WITHHOLDING_LABEL = "원천징수 3.3%" as const;
export const PAYOUT_WITHHOLDING_TOOLTIP = "프리랜서 사업소득 원천징수" as const;

/** 공제액 = floor(정산액 × 3.3%) — 음수·0 라인은 공제 없음 */
export function calcPayoutWithholding(netAmount: number): number {
  return netAmount > 0 ? Math.floor(netAmount * PAYOUT_WITHHOLDING_RATE) : 0;
}

import { formatCashKrw as formatCashKrwDisplay, minorUnitsToDisplayCash } from "@/lib/utils/formatDisplay";

/** cash_ledger minor 단위 → 표시 캐시(원) */
export function minorUnitsToCash(minor: number): number {
  return minorUnitsToDisplayCash(minor);
}

/** 정산 화면 인앱 가치 표시 — 캐시 단위(숫자 동일, 표시만). 실결제 KRW는 충전/토스에서만. */
export function formatCashKrw(n: number): string {
  return formatCashKrwDisplay(n, { unit: "캐시" });
}

export { formatCashKrwDisplay as formatCashAmount };

export const DEFAULT_MASKED_BANK_DISPLAY = "정산 계좌 미등록";
