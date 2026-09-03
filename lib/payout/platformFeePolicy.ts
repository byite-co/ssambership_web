/**
 * 플랫폼 수수료 **정책 요율** 정본 (V-5) — 코드 안의 수수료 요율 리터럴은 이 파일에만 둔다.
 *
 * 수수료에는 두 종류의 값이 있고 정본이 다르다:
 *   - 적용된 요율: 정산 항목이 이미 생성된 경우 → DB 행(subscription_settlement_items · custom_order_settlement_items ·
 *     payout_run_items 의 fee_rate). 파싱·라벨은 lib/payout/settlementFeeRate.ts(PR-1b). 이 모듈로 재계산하지 않는다.
 *   - 정책 요율: 정산 행이 아직 없는 미리보기(멘토에게 "15% 공제" 안내 · 진행 중 주문의 예상 수익 · 시스템 설정 표시 ·
 *     약관 문구 등) → 여기.
 *
 * 값은 현행 코드값(as-built)이다. 사업계획서(30/20)와 다르지만 그 결정은 오너 몫이며, 바꿀 때 고칠 곳은 아래 객체 한 곳이다.
 * 멘토 몫(85/85/95)은 `1 − 요율` 로 파생하고 따로 두지 않는다. 라벨("15%" · "15% 공제 (플랫폼 수수료)")도 여기서 만든다 —
 * 화면에 숫자를 직접 적지 않는다.
 *
 * server-only import 금지 · `@/` import 금지(node:test 계약 테스트가 직접 import) · 클라이언트 컴포넌트에서도 import 가능.
 * 가드: lib/payout/__contract__/platformFeePolicy.contract.test.ts (요율 리터럴·구 상수 식별자·백분율 문구·소비처 목록 소스 스캔).
 */
import { formatRatePercent } from "./ratePercent.ts";

export const PLATFORM_FEE_POLICY = {
  subscription: 0.15,
  individualQuestion: 0.15,
  customRequest: 0.05,
} as const;

export type PlatformFeeSourceKey = keyof typeof PLATFORM_FEE_POLICY;
export type PlatformFeePolicy = Readonly<Record<PlatformFeeSourceKey, number>>;
/** DB·정산 라인의 source_type 표기 — 정책 키로 매핑해 받는다. */
export type PlatformFeeSourceType = "subscription" | "individual_question" | "custom_request";
export type PlatformFeeSource = PlatformFeeSourceKey | PlatformFeeSourceType;

const SOURCE_KEY: Readonly<Record<PlatformFeeSource, PlatformFeeSourceKey>> = {
  subscription: "subscription",
  individualQuestion: "individualQuestion",
  individual_question: "individualQuestion",
  customRequest: "customRequest",
  custom_request: "customRequest",
};

export function platformFeeSourceKey(source: PlatformFeeSource): PlatformFeeSourceKey {
  return SOURCE_KEY[source];
}

/** 정책 수수료율(분수). `policy` 인자는 요율 변경 시뮬레이션(계약 테스트)용 — 화면은 기본값만 쓴다. */
export function platformFeeRate(source: PlatformFeeSource, policy: PlatformFeePolicy = PLATFORM_FEE_POLICY): number {
  return policy[platformFeeSourceKey(source)];
}

/**
 * 1 − 요율을 십진 소수로 정리해 같은 값의 리터럴과 동일한 double 로 만든다 — 이진 부동소수에서는 `1 − 0.2` 가
 * 0.7999999999999999… 로 나와 floor(gross × 몫) 이 DB(numeric, 정확 십진) 와 1원 어긋날 수 있다.
 */
function decimalComplement(rate: number): number {
  return Number((1 - rate).toFixed(12));
}

/** 멘토 몫 비율 = 1 − 수수료율. */
export function mentorShareRate(source: PlatformFeeSource, policy: PlatformFeePolicy = PLATFORM_FEE_POLICY): number {
  return decimalComplement(platformFeeRate(source, policy));
}

/**
 * 정책 요율로 추정한 멘토 몫 = floor(gross × 멘토 몫 비율). 입력은 절사하지 않고 그대로 곱한다(원·cents 단위는 호출부 규칙) —
 * 정산 행이 **없는** 미리보기(진행 중 주문 · 지급 스냅샷 없는 개별질문 · 성과 목록)에만 쓴다. 정산 행이 있으면 행 값이 정본이다.
 */
export function estimateMentorAmount(
  gross: number,
  source: PlatformFeeSource,
  policy: PlatformFeePolicy = PLATFORM_FEE_POLICY
): number {
  return Math.floor(gross * mentorShareRate(source, policy));
}

/** 수수료율 백분율 라벨 — 예: 구독 → "15%" */
export function platformFeePercentLabel(source: PlatformFeeSource, policy: PlatformFeePolicy = PLATFORM_FEE_POLICY): string {
  return formatRatePercent(platformFeeRate(source, policy));
}

/** 멘토 몫 백분율 라벨 — 예: 구독 → "85%" */
export function mentorSharePercentLabel(source: PlatformFeeSource, policy: PlatformFeePolicy = PLATFORM_FEE_POLICY): string {
  return formatRatePercent(mentorShareRate(source, policy));
}

/** 공제 안내 문구 — 예: 구독 → "15% 공제 (플랫폼 수수료)" (멘토 정산 KPI · 상단 카드 · 사이드바) */
export function platformFeeDeductionLabel(source: PlatformFeeSource, policy: PlatformFeePolicy = PLATFORM_FEE_POLICY): string {
  return `${platformFeePercentLabel(source, policy)} 공제 (플랫폼 수수료)`;
}
