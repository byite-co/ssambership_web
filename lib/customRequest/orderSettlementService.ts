import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { recordOrderEventBestEffort, type OrderRoomEventKind } from "@/lib/customRequest/orderRoomMutations";
import type { GrossAmountSource } from "@/lib/customRequest/orderSettlementAmounts";
import { createServiceRoleClient } from "@/lib/supabase/admin";

type Row = Record<string, unknown>;

const SETTLEMENT_TABLE = "custom_order_settlement_items" as const;

// D-CR-3: 사문(死文) service-role 정산 INSERT/DELETE 헬퍼(insertCustomOrderSettlementIfRequiredBeforeComplete·
// deleteCustomOrderSettlementItemBestEffort)를 삭제했다. 정산 생성·삭제 정본은 RPC
// (accept_custom_order_deliverable_atomic) 내부이며, 저장소 전체에서 두 헬퍼의 호출부는 0건이었다.
// 방치 시 RPC 정본을 우회하는 RLS 우회 쓰기 표면(특히 DELETE 는 order id 하나로 정산행 유실 위험)만 남는다.

/**
 * 주문방·정산 배너용: 정산 예정 1행(없으면 null, 테이블 없으면 null).
 */
export async function loadCustomOrderSettlementItemByOrderId(
  supabase: SupabaseClient,
  orderId: string
): Promise<{ row: Row | null; error: string | null }> {
  const { data, error } = await supabase
    .from(SETTLEMENT_TABLE)
    .select("*")
    .eq("custom_request_order_id", orderId)
    .maybeSingle();
  if (error) {
    if (/relation|does not exist|schema cache/i.test(error.message)) {
      return { row: null, error: null };
    }
    return { row: null, error: error.message };
  }
  return { row: (data as Row) ?? null, error: null };
}

export async function recordCustomOrderSettlementCreatedEvent(
  supabase: SupabaseClient,
  orderId: string,
  studentId: string,
  payload: {
    settlementId: string;
    gross: number;
    platform: number;
    mentor: number;
    feeRate: number;
    amountSource: GrossAmountSource;
    paymentStatus: string | null;
    isPaymentConfirmed: boolean;
  }
): Promise<void> {
  const kind = "settlement_item_created" as OrderRoomEventKind;
  await recordOrderEventBestEffort(supabase, orderId, kind, studentId, {
    settlement_id: payload.settlementId,
    gross_amount: payload.gross,
    platform_fee_amount: payload.platform,
    mentor_amount: payload.mentor,
    fee_rate: payload.feeRate,
    amount_source: payload.amountSource,
    payment_status: payload.paymentStatus,
    payment_confirmed: payload.isPaymentConfirmed,
    is_payment_confirmed: payload.isPaymentConfirmed,
  });
}

export type AcceptDeliverableAtomicRpcResult =
  | {
      ok: true;
      settlementCreated: boolean;
      settlementId?: string;
      gross?: number;
      feeRate?: number;
      payoutDone?: boolean;
      reason?: string;
    }
  | { ok: false; error: string };

/** 납품 수락 + 정산 예정 — DB 트랜잭션 RPC (service_role). */
export async function acceptCustomOrderDeliverableAtomic(
  orderId: string,
  studentId: string,
  requirePayment: boolean
): Promise<AcceptDeliverableAtomicRpcResult> {
  try {
    const admin = createServiceRoleClient();
    const { data, error } = await admin.rpc("accept_custom_order_deliverable_atomic", {
      p_order_id: orderId,
      p_student_id: studentId,
      p_require_payment: requirePayment,
    });
    if (error) {
      console.error("[acceptCustomOrderDeliverableAtomic]", orderId, error.message);
      return { ok: false, error: error.message };
    }
    const raw = data as Record<string, unknown> | null;
    if (!raw || raw.ok !== true) {
      const msg =
        typeof raw?.message === "string" && raw.message.trim()
          ? raw.message.trim()
          : "납품 수락 처리에 실패했습니다.";
      return { ok: false, error: msg };
    }
    return {
      ok: true,
      settlementCreated: raw.settlement_created === true,
      settlementId: typeof raw.settlement_id === "string" ? raw.settlement_id : undefined,
      gross: typeof raw.gross === "number" ? raw.gross : undefined,
      feeRate: typeof raw.fee_rate === "number" ? raw.fee_rate : undefined,
      payoutDone: raw.payout_done === true,
      reason: typeof raw.reason === "string" ? raw.reason : undefined,
    };
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    console.error("[acceptCustomOrderDeliverableAtomic] unavailable", orderId, m);
    return { ok: false, error: "납품 수락을 처리할 수 없습니다. 서버 설정을 확인해 주세요." };
  }
}
