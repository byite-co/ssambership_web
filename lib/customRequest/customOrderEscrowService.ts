import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { krwWonToCents } from "@/lib/toss/cashTopupFromPayment";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import {
  insertCustomRequestOrder,
  type CreateOrderFromApplicationInput,
} from "@/lib/customRequest/customRequestMutations";

export type CustomOrderEscrowErrorCode =
  | "ORDER_INSERT"
  | "ORDER_DUPLICATE"
  | "CASH_INSUFFICIENT"
  | "ESCROW_RPC"
  | "ESCROW_REFUND_RPC"
  | "ORDER_STATUS"
  | "ALREADY_PAID_OUT"
  | "NOT_ESCROWED"
  | "HOLD_MISSING";

export type CreateCustomRequestOrderWithEscrowResult =
  | { ok: true; orderId: string }
  | { ok: false; error: string; code: CustomOrderEscrowErrorCode };

const MSG_INSUFFICIENT =
  "캐시가 부족합니다. 캐시 충전(/wallet/charge) 후 다시 멘토를 선택해 주세요.";
const MSG_ESCROW_FAIL = "예치(캐시 차감)에 실패했습니다. 잠시 후 다시 시도해 주세요.";
const MSG_STATUS_FAIL =
  "예치는 완료됐지만 주문 상태를 갱신하지 못했습니다. 고객센터에 문의해 주세요.";
const MSG_REFUND_FAIL = "예치 반환(환불)에 실패했습니다. 잠시 후 다시 시도해 주세요.";
const MSG_ALREADY_PAID_OUT =
  "멘토에게 이미 지급된 주문은 환불할 수 없습니다. 문의·분쟁을 이용해 주세요.";
const MSG_NOT_ESCROWED = "예치(에스크로) 상태가 아니어서 취소·환불할 수 없습니다.";
const MSG_HOLD_MISSING = "예치 내역이 없어 환불할 수 없습니다.";

function isUniqueViolationMessage(message: string | undefined): boolean {
  return /23505|duplicate key|unique constraint|ux_cro_active_application_once/i.test(message ?? "");
}

/**
 * 맞춤의뢰 주문 금액(원, agreed_price) → cash_ledger / cash_wallets minor units (원×100).
 * 변환은 이 RPC 호출 직전에서만 수행한다.
 */
export async function recordCustomOrderEscrowHoldRpc(
  studentId: string,
  orderId: string,
  agreedPriceWon: number
): Promise<{ ok: true } | { ok: false; error: string; code: "CASH_INSUFFICIENT" | "ESCROW_RPC" }> {
  const amountCents = krwWonToCents(agreedPriceWon);
  if (amountCents <= 0) {
    console.error("[recordCustomOrderEscrowHoldRpc] invalid amount", {
      studentId,
      orderId,
      agreedPriceWon,
      amountCents,
    });
    return { ok: false, error: MSG_ESCROW_FAIL, code: "ESCROW_RPC" };
  }

  try {
    const admin = createServiceRoleClient();
    const { error } = await admin.rpc("record_custom_order_escrow_hold", {
      p_student_id: studentId,
      p_order_id: orderId,
      p_amount_cents: amountCents,
    });
    if (error) {
      const m = String(error.message ?? error);
      console.error("[recordCustomOrderEscrowHoldRpc] RPC error", { studentId, orderId, message: m });
      if (/CASH_INSUFFICIENT|잔액|balance|P0001/i.test(m) || m.includes("CASH")) {
        return { ok: false, error: MSG_INSUFFICIENT, code: "CASH_INSUFFICIENT" };
      }
      return { ok: false, error: MSG_ESCROW_FAIL, code: "ESCROW_RPC" };
    }
    return { ok: true };
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    console.error("[recordCustomOrderEscrowHoldRpc] exception", { studentId, orderId, message: m });
    if (/CASH_INSUFFICIENT|잔액|balance|P0001/i.test(m)) {
      return { ok: false, error: MSG_INSUFFICIENT, code: "CASH_INSUFFICIENT" };
    }
    return { ok: false, error: MSG_ESCROW_FAIL, code: "ESCROW_RPC" };
  }
}

async function setOrderPaymentStatusEscrowed(orderId: string, studentId: string): Promise<boolean> {
  try {
    const admin = createServiceRoleClient();
    // W4(C10): 정본 custom_request_orders 고정(custom_orders/request_orders — 187 baseline 부재).
    const { data, error } = await admin
      .from("custom_request_orders")
      .update({ payment_status: "escrowed", updated_at: new Date().toISOString() })
      .eq("id", orderId)
      .eq("student_id", studentId)
      .select("id")
      .maybeSingle();
    if (error) {
      console.error("[setOrderPaymentStatusEscrowed] update failed", { orderId, message: error.message });
      return false;
    }
    return Boolean(data?.id);
  } catch (e) {
    console.error("[setOrderPaymentStatusEscrowed] exception", orderId, e);
    return false;
  }
}

/** 예치 실패 시 unpaid 주문 행 제거(학생 재시도 가능). hold 성공 후에는 호출하지 않는다. */
async function deleteUnpaidOrderBestEffort(orderId: string, studentId: string): Promise<void> {
  try {
    const admin = createServiceRoleClient();
    // W4(C10): 정본 custom_request_orders 고정.
    const { error } = await admin
      .from("custom_request_orders")
      .delete()
      .eq("id", orderId)
      .eq("student_id", studentId)
      .eq("payment_status", "unpaid");
    if (error) {
      console.error("[deleteUnpaidOrderBestEffort]", orderId, error.message);
    }
  } catch (e) {
    console.error("[deleteUnpaidOrderBestEffort] exception", orderId, e);
  }
}

/**
 * 멘토 선정 → 주문 insert(unpaid) → 예치 RPC → payment_status=escrowed.
 * 예치 실패 시 unpaid 주문 삭제 — escrowed without hold 불가.
 */
export async function createCustomRequestOrderWithEscrowHold(
  supabase: SupabaseClient,
  input: CreateOrderFromApplicationInput
): Promise<CreateCustomRequestOrderWithEscrowResult> {
  const inserted = await insertCustomRequestOrder(supabase, input);
  if (!inserted.ok) {
    if (isUniqueViolationMessage(inserted.error)) {
      return {
        ok: false,
        error: "이미 주문이 생성되었습니다.",
        code: "ORDER_DUPLICATE",
      };
    }
    return {
      ok: false,
      error: inserted.error ?? "주문을 열 수 없습니다.",
      code: "ORDER_INSERT",
    };
  }
  if (!inserted.id) {
    return { ok: false, error: "주문을 열 수 없습니다.", code: "ORDER_INSERT" };
  }

  const orderId = inserted.id;
  const hold = await recordCustomOrderEscrowHoldRpc(input.studentId, orderId, input.agreedPrice);
  if (!hold.ok) {
    await deleteUnpaidOrderBestEffort(orderId, input.studentId);
    return { ok: false, error: hold.error, code: hold.code };
  }

  const marked = await setOrderPaymentStatusEscrowed(orderId, input.studentId);
  if (!marked) {
    console.error(
      "[createCustomRequestOrderWithEscrowHold] CRITICAL: escrow hold succeeded but payment_status not escrowed",
      { orderId, studentId: input.studentId }
    );
    return { ok: false, error: MSG_STATUS_FAIL, code: "ORDER_STATUS" };
  }

  return { ok: true, orderId };
}

export type RecordCustomOrderEscrowRefundResult =
  | { ok: true }
  | {
      ok: false;
      error: string;
      code: "ESCROW_REFUND_RPC" | "ALREADY_PAID_OUT" | "NOT_ESCROWED" | "HOLD_MISSING";
    };

/**
 * 맞춤의뢰 예치 전액 학생 반환 — `record_custom_order_escrow_refund` RPC (service_role).
 */
export async function recordCustomOrderEscrowRefundRpc(
  orderId: string
): Promise<RecordCustomOrderEscrowRefundResult> {
  if (!orderId.trim()) {
    return { ok: false, error: MSG_REFUND_FAIL, code: "ESCROW_REFUND_RPC" };
  }
  try {
    const admin = createServiceRoleClient();
    const { error } = await admin.rpc("record_custom_order_escrow_refund", {
      p_order_id: orderId,
    });
    if (error) {
      const m = String(error.message ?? error);
      console.error("[recordCustomOrderEscrowRefundRpc] RPC error", { orderId, message: m });
      if (/ALREADY_PAID_OUT/i.test(m)) {
        return { ok: false, error: MSG_ALREADY_PAID_OUT, code: "ALREADY_PAID_OUT" };
      }
      if (/PAYMENT_NOT_ESCROWED/i.test(m)) {
        return { ok: false, error: MSG_NOT_ESCROWED, code: "NOT_ESCROWED" };
      }
      if (/ESCROW_HOLD_MISSING/i.test(m)) {
        return { ok: false, error: MSG_HOLD_MISSING, code: "HOLD_MISSING" };
      }
      return { ok: false, error: MSG_REFUND_FAIL, code: "ESCROW_REFUND_RPC" };
    }
    return { ok: true };
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    console.error("[recordCustomOrderEscrowRefundRpc] exception", { orderId, message: m });
    if (/ALREADY_PAID_OUT/i.test(m)) {
      return { ok: false, error: MSG_ALREADY_PAID_OUT, code: "ALREADY_PAID_OUT" };
    }
    if (/PAYMENT_NOT_ESCROWED/i.test(m)) {
      return { ok: false, error: MSG_NOT_ESCROWED, code: "NOT_ESCROWED" };
    }
    if (/ESCROW_HOLD_MISSING/i.test(m)) {
      return { ok: false, error: MSG_HOLD_MISSING, code: "HOLD_MISSING" };
    }
    return { ok: false, error: MSG_REFUND_FAIL, code: "ESCROW_REFUND_RPC" };
  }
}
