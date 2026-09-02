import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdminDisputeEscrowSplitPanelState } from "@/lib/admin/adminDisputeEscrowSplitTypes";
import { pickGrossAmountWonWithSource } from "@/lib/customRequest/orderSettlementAmounts";
import { loadCustomOrderSettlementItemByOrderId } from "@/lib/customRequest/orderSettlementService";
import { parseSettlementFeeRate } from "@/lib/payout/settlementFeeRate";

type Row = Record<string, unknown>;

export type { AdminDisputeEscrowSplitFormProps, AdminDisputeEscrowSplitPanelState } from "@/lib/admin/adminDisputeEscrowSplitTypes";

function pickPaymentStatus(row: Row | null): string {
  if (!row) return "";
  for (const k of ["payment_status", "payment_state", "pay_status"] as const) {
    const v = row[k];
    if (v != null && String(v).trim()) {
      return String(v).trim().toLowerCase();
    }
  }
  return "";
}

function pickOrderId(disputeRow: Row | null, customOrderRow: Row | null): string | null {
  const fromDispute = (() => {
    if (!disputeRow) return null;
    for (const k of [
      "custom_request_order_id",
      "mentor_order_id",
      "order_id_linked",
      "order_id",
      "custom_order_id",
      "request_order_id",
    ] as const) {
      const v = disputeRow[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return null;
  })();
  if (fromDispute) return fromDispute;
  const fromOrder = customOrderRow?.id;
  return typeof fromOrder === "string" && fromOrder.trim() ? fromOrder.trim() : null;
}

type LedgerFlags = {
  holdCents: number | null;
  hasPayout: boolean;
  hasRefund: boolean;
  hasDisputeSplit: boolean;
};

async function loadEscrowLedgerFlags(client: SupabaseClient, orderId: string): Promise<LedgerFlags> {
  const keys = [
    `cr_hold_${orderId}`,
    `cr_payout_${orderId}`,
    `cr_refund_${orderId}`,
    `cr_dispute_payout_${orderId}`,
    `cr_dispute_refund_${orderId}`,
  ];
  const { data, error } = await client
    .from("cash_ledger")
    .select("idempotency_key, reason, delta_cents")
    .in("idempotency_key", keys);

  if (error) {
    console.error("[loadEscrowLedgerFlags]", orderId, error.message);
    return { holdCents: null, hasPayout: false, hasRefund: false, hasDisputeSplit: false };
  }

  let holdCents: number | null = null;
  let hasPayout = false;
  let hasRefund = false;
  let hasDisputeSplit = false;

  for (const row of (data as Row[] | null) ?? []) {
    const key = String(row.idempotency_key ?? "");
    const reason = String(row.reason ?? "");
    if (key === `cr_hold_${orderId}` && reason === "custom_order_escrow_hold") {
      const d = row.delta_cents;
      if (typeof d === "number" && Number.isFinite(d)) {
        holdCents = Math.abs(Math.trunc(d));
      }
    }
    if (key === `cr_payout_${orderId}` && reason === "custom_order_escrow_payout") hasPayout = true;
    if (key === `cr_refund_${orderId}` && reason === "custom_order_escrow_refund") hasRefund = true;
    if (
      (key === `cr_dispute_payout_${orderId}` && reason === "custom_order_dispute_payout") ||
      (key === `cr_dispute_refund_${orderId}` && reason === "custom_order_dispute_refund")
    ) {
      hasDisputeSplit = true;
    }
  }

  return { holdCents, hasPayout, hasRefund, hasDisputeSplit };
}

/**
 * 관리자 분쟁 상세 — 예치 분배 UI 노출 여부·hold gross(원) (읽기 전용).
 */
export async function loadAdminDisputeEscrowSplitPanelState(
  client: SupabaseClient,
  disputeId: string,
  disputeRow: Row | null,
  customOrderRow: Row | null
): Promise<AdminDisputeEscrowSplitPanelState> {
  const orderId = pickOrderId(disputeRow, customOrderRow);
  if (!orderId) {
    return { kind: "unavailable", message: "연결된 맞춤의뢰 주문이 없어 예치 분배를 할 수 없습니다." };
  }

  const paymentStatus = pickPaymentStatus(customOrderRow);
  const settlementLoad = await loadCustomOrderSettlementItemByOrderId(client, orderId);
  const settlementStatus =
    settlementLoad.row && typeof settlementLoad.row.status === "string"
      ? String(settlementLoad.row.status).trim().toLowerCase()
      : null;

  const flags = await loadEscrowLedgerFlags(client, orderId);
  const holdGrossWon =
    flags.holdCents != null && flags.holdCents > 0 && flags.holdCents % 100 === 0
      ? flags.holdCents / 100
      : null;

  if (settlementStatus === "paid" || flags.hasPayout) {
    return {
      kind: "completed",
      orderId,
      message: "이미 멘토 지급이 완료된 주문입니다.",
      paymentStatus: paymentStatus || "paid",
    };
  }

  if (flags.hasRefund) {
    return {
      kind: "completed",
      orderId,
      message: "이미 전액 환불 처리된 주문입니다.",
      paymentStatus: paymentStatus || "refunded",
    };
  }

  if (flags.hasDisputeSplit || paymentStatus === "dispute_resolved") {
    return {
      kind: "completed",
      orderId,
      message: "분쟁 예치 분배가 이미 완료된 주문입니다.",
      paymentStatus: paymentStatus || "dispute_resolved",
    };
  }

  if (holdGrossWon == null) {
    return {
      kind: "no_hold",
      orderId,
      message: "예치(hold) 내역이 없어 분배할 수 없습니다. 레거시·미결제 주문일 수 있습니다.",
      paymentStatus: paymentStatus || null,
    };
  }

  if (paymentStatus !== "escrowed") {
    return {
      kind: "no_hold",
      orderId,
      message: `결제 상태가 예치(escrowed)가 아니어서 분배할 수 없습니다.(현재: ${paymentStatus || "—"})`,
      paymentStatus: paymentStatus || null,
    };
  }

  const grossPick = pickGrossAmountWonWithSource(customOrderRow, null);
  const agreedPriceWon = grossPick?.gross ?? null;

  if (settlementLoad.row) {
    const sg = settlementLoad.row.gross_amount;
    if (typeof sg === "number" && Number.isFinite(sg) && Math.trunc(sg) !== holdGrossWon) {
      return {
        kind: "unavailable",
        message: "예치 금액과 정산 gross가 일치하지 않아 분배 UI를 표시할 수 없습니다. 운영팀에 문의해 주세요.",
      };
    }
  }

  return {
    kind: "split_form",
    form: {
      orderId,
      disputeId,
      holdGrossWon,
      paymentStatus,
      settlementStatus,
      agreedPriceWon,
      // PR-1b V-4: 미리보기 요율은 DB 정산 행 그대로(없으면 null → '요율 미설정'). 실제 분배 RPC 도 DB 요율로 집행한다.
      feeRate: settlementLoad.row ? parseSettlementFeeRate(settlementLoad.row.fee_rate) : null,
    },
  };
}
