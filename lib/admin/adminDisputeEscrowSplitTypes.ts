/** 관리자 분쟁 상세 — 예치 분배 UI (클라이언트·서버 공유 타입) */

export type AdminDisputeEscrowSplitFormProps = {
  orderId: string;
  disputeId: string;
  holdGrossWon: number;
  paymentStatus: string;
  settlementStatus: string | null;
  agreedPriceWon: number | null;
  /**
   * PR-1b V-4: 미리보기 요율 = DB 정산 행(custom_order_settlement_items.fee_rate). 행이 없으면 null →
   * '요율 미설정' 을 표시하고 예상액을 계산하지 않는다. TS 상수(구 CUSTOM_ORDER_PLATFORM_FEE_RATE)는 쓰지 않는다.
   */
  feeRate: number | null;
};

export type AdminDisputeEscrowSplitPanelState =
  | { kind: "split_form"; form: AdminDisputeEscrowSplitFormProps }
  | { kind: "completed"; orderId: string | null; message: string; paymentStatus: string | null }
  | { kind: "no_hold"; orderId: string | null; message: string; paymentStatus: string | null }
  | { kind: "unavailable"; message: string };
