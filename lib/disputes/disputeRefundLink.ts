/**
 * D-CR-9: disputes↔refunds 연계 순수부.
 * disputes 에는 refunds 로 향하는 직접 FK(refund_id)가 없다. 대신 두 테이블이 동일한
 * custom_request_order_id · payment_id · subscription_id 를 공유하므로(실측 스키마), 이 공유키를
 * 우선순위대로 후보로 만들어 refunds 를 역참조한다.
 *
 * 우선순위: custom_request_order_id → payment_id → subscription_id.
 * (맞춤의뢰 분쟁은 주문 단위가 가장 특정적이고, 없으면 결제, 그다음 구독 순.)
 */
type Row = Record<string, unknown>;

export const REFUND_LINK_KEY_PRECEDENCE = [
  "custom_request_order_id",
  "payment_id",
  "subscription_id",
] as const;

export function refundLinkCandidatesForDispute(dispute: Row | null): Array<[column: string, value: string]> {
  if (!dispute) return [];
  const out: Array<[string, string]> = [];
  for (const col of REFUND_LINK_KEY_PRECEDENCE) {
    const v = dispute[col];
    if (v != null && String(v).trim()) {
      out.push([col, String(v)]);
    }
  }
  return out;
}
