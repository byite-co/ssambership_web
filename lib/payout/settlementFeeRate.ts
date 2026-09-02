/**
 * 정산 요율(fee_rate) 공용 순수 헬퍼 — server-only import 금지 · node:test 검증 가능 · 클라이언트 컴포넌트에서도 import 가능.
 *
 * ★ 값의 정본은 DB 다: subscription_settlement_items.fee_rate · custom_order_settlement_items.fee_rate ·
 *   정산/분배 RPC 본문(refresh_subscription_settlement_items · record_custom_order_dispute_split).
 *   코드에는 요율 사본·폴백 리터럴(0.3 / 0.15 / 0.05 / 0)을 두지 않는다 — 행에 요율이 없으면 null 로 남기고
 *   '요율 미설정' 으로 표시하며, 어떤 금액도 요율로 재계산하지 않는다(PR-1b 값 연동 원칙).
 *
 * 소비처: 관리자 정산 목록(lib/admin/adminSettlementItems.ts) · 관리자 분쟁 예치 분배 미리보기
 * (lib/admin/adminDisputeEscrowSplitQueries.ts → components/disputes/DisputeEscrowSplitPanel.tsx) ·
 * 멘토 정산 라인(lib/mentor/mentorPayoutLinesCore.ts).
 */
export const SETTLEMENT_FEE_RATE_UNSET_LABEL = "요율 미설정";

/** DB fee_rate → 분수(0.15). 없거나 숫자가 아니면 null — 추측값 금지. DB 가 0 을 저장했으면 0 은 값이다. */
export function parseSettlementFeeRate(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string" && raw.trim() === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** 요율 표시 라벨 — null 은 '요율 미설정', 숫자는 백분율("15%" · "5.5%"). */
export function settlementFeeRateLabel(feeRate: number | null): string {
  if (feeRate == null) return SETTLEMENT_FEE_RATE_UNSET_LABEL;
  const pct = Number((feeRate * 100).toFixed(2));
  return `${pct}%`;
}
