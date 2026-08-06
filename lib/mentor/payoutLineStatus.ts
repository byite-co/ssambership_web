// 정산 라인 상태 분류 — 순수 모듈(별칭 import 없음 · node:test 로 검증 가능).
//
// 왜 분리했나: 종전에는 서비스(합계 산출)와 표시(칩 매핑)가 각자 상태 문자열을
// 해석했고, 둘 다 **모르는 값을 조용히 '지급 예정'으로 접었다**. 그래서 구독
// 정산의 accruing(사이클 미완료 = 지급 불가)이 "지급 대기"로 표시되고 지급 예정
// 합계에도 들어갔다 — 아직 받을 수 없는 돈이 받을 수 있는 돈으로 보였다(QA-A2).
// 분류 규칙을 한 곳에 두고 테스트로 고정한다.

export type PayoutLineStatusKind = "accruing" | "pending" | "paid" | "hold" | "canceled";

/**
 * 정산 라인의 상태 문자열(영문 코드 또는 한글 표시값)을 분류한다.
 *
 * 판정 순서가 곧 우선순위다: 취소 → 지급완료 → 보류 → 적립중 → (나머지) 지급 예정.
 * 적립중을 마지막 명시 분기에 두는 이유는, 취소·지급완료된 항목은 이미 사이클이
 * 끝난 것이라 적립 여부를 따질 필요가 없기 때문이다.
 */
export function payoutLineStatusKind(status: string): PayoutLineStatusKind {
  const raw = status.trim();
  const s = raw.toLowerCase();
  if (s === "canceled" || s === "cancelled" || raw.includes("취소")) return "canceled";
  if (s === "paid" || raw.includes("지급완료") || raw.includes("정산완료")) return "paid";
  if (s === "hold" || s === "on_hold" || raw.includes("보류")) return "hold";
  if (isAccruingPayoutStatus(raw)) return "accruing";
  return "pending";
}

/**
 * 적립중인가 — 구독 사이클이 끝나지 않아 아직 지급 대상이 아닌 상태.
 * (DB: subscription_settlement_items.status = 'accruing')
 */
export function isAccruingPayoutStatus(status: string): boolean {
  const raw = status.trim();
  return raw.toLowerCase() === "accruing" || raw.includes("적립중");
}
