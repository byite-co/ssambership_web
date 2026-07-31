"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/routeGuard";
import { canAccessOrder } from "@/lib/customRequest/orderAccess";
import { recordCustomOrderEscrowRefundRpc } from "@/lib/customRequest/customOrderEscrowService";
import {
  isOrderPaymentEscrowedForStudentCancel,
  isOrderStatusAllowingStudentAccept,
  isOrderStatusBeforeMentorWorkStarted,
  isOrderRowTerminalForActions,
  normalizedPrimaryOrderStatus,
  ORDER_MENTOR_WORK_STARTED_PRIMARY_STATUS,
  primaryOrderStatusColumnKey,
} from "@/lib/customRequest/orderLifecycleConstants";
import { getActiveDisputeBlockMessage } from "@/lib/customRequest/orderDisputeHelpers";
import {
  isCustomOrderPaymentStatusStrictlyPaid,
  mustBlockUnpaidAcceptForProduction,
} from "@/lib/customRequest/orderPaymentPolicy";
// W4(C10): 테이블/컬럼 프로빙 제거 — custom_request_orders·custom_order_deliverables 정본 고정(187 baseline 실측)
import { ORDER_CHILD_FK_COLUMN } from "@/lib/customRequest/customRequestQueries";
import { recordOrderEventBestEffort } from "@/lib/customRequest/orderRoomMutations";
import { splitPlatformAndMentorForGross } from "@/lib/customRequest/orderSettlementAmounts";
import { MENTOR_CUSTOM_REQUEST_PLATFORM_SHARE } from "@/lib/mentor/mentorPayoutsConstants";
import {
  acceptCustomOrderDeliverableAtomic,
  recordCustomOrderSettlementCreatedEvent,
} from "@/lib/customRequest/orderSettlementService";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;

function orderPath(orderId: string) {
  return `/custom-request/orders/${encodeURIComponent(orderId)}`;
}

function redirectWithError(orderId: string, msg: string): never {
  redirect(`${orderPath(orderId)}?error=${encodeURIComponent(msg)}`);
}

/**
 * W4(C10): custom_order_deliverables.custom_request_order_id 정본 count 고정.
 * 조회 오류는 '납품 없음'과 구분해 error 로 반환 — 호출부는 fail-closed 처리.
 */
export async function hasDeliverableRowsForOrder(
  supabase: SupabaseClient,
  orderId: string
): Promise<{ has: boolean; error: string | null }> {
  const { count, error } = await supabase
    .from("custom_order_deliverables")
    .select("id", { count: "exact", head: true })
    .eq(ORDER_CHILD_FK_COLUMN, orderId);
  if (error) {
    return { has: false, error: error.message };
  }
  return { has: (count ?? 0) > 0, error: null };
}

/**
 * 학생: 납품 검토 단계 주문을 완료(`completed`)로 전이. 본인 주문 + 허용 상태 + 납품 행 존재 필요.
 * 주문 완료·정산 row 생성은 `accept_custom_order_deliverable_atomic` RPC 단일 트랜잭션으로 처리.
 */
export async function acceptCustomOrderDeliverableAction(formData: FormData): Promise<void> {
  const { user } = await requireRole("student");
  const supabase = await createClient();
  const orderId = String(formData.get("orderId") ?? "").trim();
  if (!orderId) {
    redirect("/custom-request?error=" + encodeURIComponent("orderId가 필요합니다."));
  }

  // W4(C10): custom_request_orders 정본 테이블 + student_id(NOT NULL) 직접 대조 — 프로빙 제거
  const { data: rowData, error: oe } = await supabase
    .from("custom_request_orders")
    .select("*")
    .eq("id", orderId)
    .maybeSingle();
  if (oe || !rowData) {
    redirectWithError(orderId, "주문을 찾을 수 없어요. 잠시 후 다시 시도해 주세요.");
  }
  const row = rowData as Row;

  const access = canAccessOrder(row, user.id, "student");
  if (!access.ok) {
    redirectWithError(orderId, "이 주문을 수락할 권한이 없습니다.");
  }

  if (String(row.student_id) !== user.id) {
    redirectWithError(orderId, "의뢰자(학생) 본인만 납품을 수락할 수 있습니다.");
  }

  if (mustBlockUnpaidAcceptForProduction(row)) {
    redirectWithError(
      orderId,
      "결제(예치)가 완료되지 않은 주문은 수락할 수 없습니다. 캐시 예치 확인 후 다시 시도해 주세요."
    );
  }
  if (!isCustomOrderPaymentStatusStrictlyPaid(row)) {
    const paymentStatus: string | null = (() => {
      for (const k of ["payment_status", "payment_state", "pay_status"] as const) {
        const v = row[k];
        if (v != null && String(v).trim()) {
          return String(v).trim();
        }
      }
      return null;
    })();
    console.warn(
      "[acceptCustomOrderDeliverableAction] Unpaid accept allowed by env (staging/test). Custom order will proceed without payment_status === \"paid\".",
      {
        orderId,
        payment_status: paymentStatus,
        CUSTOM_ORDER_ALLOW_UNPAID_ACCEPT: process.env.CUSTOM_ORDER_ALLOW_UNPAID_ACCEPT,
        NODE_ENV: process.env.NODE_ENV,
      }
    );
  }

  const disputeBlock = await getActiveDisputeBlockMessage(supabase, orderId);
  if (disputeBlock) {
    redirectWithError(orderId, disputeBlock);
  }

  const norm = normalizedPrimaryOrderStatus(row);
  if (!norm) {
    redirectWithError(orderId, "주문 상태를 확인할 수 없어 수락할 수 없습니다.");
  }
  if (isOrderRowTerminalForActions(row)) {
    redirectWithError(orderId, "이미 완료된 주문입니다.");
  }
  if (!isOrderStatusAllowingStudentAccept(norm)) {
    redirectWithError(orderId, `현재 상태(${norm})에서는 납품 수락을 할 수 없습니다.`);
  }

  const delCheck = await hasDeliverableRowsForOrder(supabase, orderId);
  if (delCheck.error) {
    // W4(C10): 조회 오류를 '납품 없음'으로 오인하지 않도록 구분해 fail-closed
    redirectWithError(orderId, "납품 정보를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
  if (!delCheck.has) {
    redirectWithError(orderId, "등록된 납품이 없어 수락할 수 없습니다.");
  }

  if (!primaryOrderStatusColumnKey(row)) {
    redirectWithError(orderId, "주문 상태 컬럼을 찾을 수 없습니다.");
  }

  const atomic = await acceptCustomOrderDeliverableAtomic(
    orderId,
    user.id,
    mustBlockUnpaidAcceptForProduction(row)
  );
  if (!atomic.ok) {
    redirectWithError(orderId, atomic.error);
  }

  await recordOrderEventBestEffort(supabase, orderId, "deliverable_accepted", user.id, {
    settlement_row_created: atomic.settlementCreated,
    payout_done: atomic.payoutDone ?? false,
    via: "accept_custom_order_deliverable_atomic",
  });

  if (atomic.settlementCreated && atomic.settlementId && atomic.gross != null) {
    const feeRate = atomic.feeRate ?? MENTOR_CUSTOM_REQUEST_PLATFORM_SHARE;
    const { platformFee, mentorAmount } = splitPlatformAndMentorForGross(atomic.gross, feeRate);
    await recordCustomOrderSettlementCreatedEvent(supabase, orderId, user.id, {
      settlementId: atomic.settlementId,
      gross: atomic.gross,
      platform: platformFee,
      mentor: mentorAmount,
      feeRate,
      amountSource: "order.agreed_price",
      paymentStatus: (() => {
        for (const k of ["payment_status", "payment_state", "pay_status"] as const) {
          const v = row[k];
          if (v != null && String(v).trim()) return String(v).trim();
        }
        return null;
      })(),
      isPaymentConfirmed: !mustBlockUnpaidAcceptForProduction(row),
    });
  }

  revalidatePath(orderPath(orderId));
  revalidatePath("/custom-request");
  revalidatePath("/wallet/ledger");
  revalidatePath("/mentor/payouts");
  redirect(`${orderPath(orderId)}?ok=${encodeURIComponent("납품을 수락해 주문을 완료했습니다.")}`);
}

/**
 * 학생 직접 취소 — 멘토 작업 시작 전(`pending`) + 예치(`escrowed`)만.
 * 예치 전액 반환 RPC 후 주문은 RPC에서 cancelled·payment_status refunded 로 마감.
 */
export async function cancelCustomOrderByStudentAction(formData: FormData): Promise<void> {
  const { user } = await requireRole("student");
  const supabase = await createClient();
  const orderId = String(formData.get("orderId") ?? "").trim();
  if (!orderId) {
    redirect("/custom-request?error=" + encodeURIComponent("orderId가 필요합니다."));
  }

  // W4(C10): custom_request_orders 정본 테이블 + student_id(NOT NULL) 직접 대조 — 프로빙 제거
  const { data: rowData, error: oe } = await supabase
    .from("custom_request_orders")
    .select("*")
    .eq("id", orderId)
    .maybeSingle();
  if (oe || !rowData) {
    redirectWithError(orderId, "주문을 찾을 수 없어요. 잠시 후 다시 시도해 주세요.");
  }
  const row = rowData as Row;

  const access = canAccessOrder(row, user.id, "student");
  if (!access.ok) {
    redirectWithError(orderId, "이 주문을 취소할 권한이 없습니다.");
  }

  if (String(row.student_id) !== user.id) {
    redirectWithError(orderId, "의뢰자(학생) 본인만 주문을 취소할 수 있습니다.");
  }

  const disputeBlock = await getActiveDisputeBlockMessage(supabase, orderId);
  if (disputeBlock) {
    redirectWithError(orderId, disputeBlock);
  }

  if (isOrderRowTerminalForActions(row)) {
    redirectWithError(orderId, "이미 종료된 주문입니다.");
  }

  const norm = normalizedPrimaryOrderStatus(row);
  if (!norm) {
    redirectWithError(orderId, "주문 상태를 확인할 수 없어 취소할 수 없습니다.");
  }

  if (!isOrderStatusBeforeMentorWorkStarted(norm)) {
    if (norm === ORDER_MENTOR_WORK_STARTED_PRIMARY_STATUS || norm === "in_progress") {
      redirectWithError(
        orderId,
        "작업이 시작되어 직접 취소할 수 없습니다. 문의·분쟁을 이용해 주세요."
      );
    }
    redirectWithError(orderId, `현재 단계(${norm})에서는 직접 취소할 수 없습니다.`);
  }

  if (!isOrderPaymentEscrowedForStudentCancel(row)) {
    redirectWithError(orderId, "예치(결제)가 완료된 주문만 직접 취소할 수 있습니다.");
  }

  const refunded = await recordCustomOrderEscrowRefundRpc(orderId);
  if (!refunded.ok) {
    redirectWithError(orderId, refunded.error);
  }

  await recordOrderEventBestEffort(supabase, orderId, "order_cancelled", user.id, {
    via: "student_direct_cancel",
    escrow_refund: true,
  });

  revalidatePath(orderPath(orderId));
  revalidatePath("/custom-request");
  revalidatePath("/custom-request/orders");
  revalidatePath("/wallet/ledger");
  redirect(`${orderPath(orderId)}?ok=${encodeURIComponent("주문을 취소했고 예치 캐시를 반환했습니다.")}`);
}
