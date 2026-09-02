/**
 * 구독 정산 항목 — 순수 헬퍼 (server-only import 금지 · node:test 검증 가능).
 * 서버 모듈 lib/mentor/subscriptionSettlementItems.ts 가 그대로 재수출하며, 관리자 정산 파서
 * (lib/admin/adminSettlementItems.ts)가 네트워크 없이 검증되도록 여기로 분리했다(PR-1b).
 */

/**
 * 구독 정산 항목 상태. DB CHECK 는 ('accruing','pending','paid','hold','canceled') 5종이다.
 *
 * ★ accruing = 구독 사이클이 아직 안 끝나 **지급 불가**한 적립 상태다. 종전 매핑은
 *   미지값을 전부 pending 으로 접어서 적립중 금액이 "지급 대기"로 표시되고 지급 예정
 *   합계에도 들어갔다 — 아직 받을 수 없는 돈이 받을 수 있는 돈으로 보였다(QA-A2).
 *   오너 판단 2026-08-06: **적립중과 지급 예정을 구분해 보여준다.**
 */
export type SubscriptionSettlementItemStatus =
  | "accruing"
  | "pending"
  | "paid"
  | "hold"
  | "canceled";

export function minorCentsToCash(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(n) ? Math.floor(Math.abs(n) / 100) : 0;
}

export function subscriptionSettlementStatus(value: unknown): SubscriptionSettlementItemStatus {
  const status = String(value ?? "pending").trim().toLowerCase();
  if (status === "accruing") return "accruing";
  if (status === "paid") return "paid";
  if (status === "hold" || status === "on_hold") return "hold";
  if (status === "canceled" || status === "cancelled") return "canceled";
  return "pending";
}
