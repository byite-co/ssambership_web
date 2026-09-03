/**
 * 요율(분수) → 백분율 라벨 — 정책 요율(lib/payout/platformFeePolicy.ts)과 적용 요율(lib/payout/settlementFeeRate.ts)이
 * 같은 규칙으로 표시되도록 한 곳에 둔다. 0.055 → "5.5%" · 0.033 → "3.3%" · 정수 백분율은 소수 없이("15%").
 * 부동소수 꼬리(예: 0.07 × 100 = 7.000000000000001)는 소수 2자리에서 정리한다.
 *
 * server-only import 금지 · `@/` import 금지(node:test 계약 테스트가 직접 import).
 */
export function formatRatePercent(rate: number): string {
  return `${Number((rate * 100).toFixed(2))}%`;
}
