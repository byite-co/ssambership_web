"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/routeGuard";
import { canAccessOrder } from "@/lib/customRequest/orderAccess";
import { sanitizeTrustSafetyText } from "@/lib/safety/trustSafetyText";
// W4(C10): 테이블/컬럼 프로빙 제거 — custom_request_orders·custom_order_revisions 정본 고정(187 baseline 실측)
import { ORDER_CHILD_FK_COLUMN } from "@/lib/customRequest/customRequestQueries";
import {
  isOrderStatusAllowingStudentAccept,
  isOrderRowTerminalForActions,
  normalizedPrimaryOrderStatus,
  orderStatusLabelForUi,
} from "@/lib/customRequest/orderLifecycleConstants";
import { getActiveDisputeBlockMessage } from "@/lib/customRequest/orderDisputeHelpers";
import { hasDeliverableRowsForOrder } from "@/lib/customRequest/orderStudentActions";
import { recordOrderEventBestEffort } from "@/lib/customRequest/orderRoomMutations";
import { requestCustomOrderRevisionRpc } from "@/lib/customRequest/orderTransitionRpc";
import { createClient } from "@/lib/supabase/server";

type Row = Record<string, unknown>;

const MAX_REVISION_REQUESTS_PER_ORDER = 2;

function orderPath(orderId: string) {
  return `/custom-request/orders/${encodeURIComponent(orderId)}`;
}

function redirectWithError(orderId: string, msg: string): never {
  redirect(`${orderPath(orderId)}?error=${encodeURIComponent(msg)}`);
}

/**
 * 학생: 납품·검토 대기(수락 가능) 단계에서만 수정 요청. 완료·종료·납품 전 등은 서버에서 거절.
 */
export async function submitCustomOrderRevisionRequestAction(formData: FormData): Promise<void> {
  const { user } = await requireRole("student");
  const supabase = await createClient();
  const orderId = String(formData.get("orderId") ?? "").trim();
  const note = String(formData.get("requestNote") ?? "").trim();
  if (!orderId) {
    redirect("/custom-request?error=" + encodeURIComponent("orderId가 필요합니다."));
  }
  if (!note) {
    redirectWithError(orderId, "수정 요청 내용을 입력하세요.");
  }
  if (note.length > 8000) {
    redirectWithError(orderId, "수정 요청은 8,000자 이하로 입력하세요.");
  }

  // W4(C10): custom_request_orders 정본 테이블 + student_id(NOT NULL) 직접 대조 — 프로빙 제거
  const { data: rowData, error: oe } = await supabase
    .from("custom_request_orders")
    .select("*")
    .eq("id", orderId)
    .maybeSingle();
  if (oe || !rowData) {
    redirectWithError(orderId, oe?.message ?? "주문을 찾을 수 없습니다.");
  }
  const row = rowData as Row;

  const access = canAccessOrder(row, user.id, "student");
  if (!access.ok) {
    redirectWithError(orderId, "이 주문에 대한 접근 권한이 없습니다.");
  }
  if (String(row.student_id) !== user.id) {
    redirectWithError(orderId, "의뢰자(학생) 본인만 수정 요청을 보낼 수 있습니다.");
  }

  const disputeBlock = await getActiveDisputeBlockMessage(supabase, orderId);
  if (disputeBlock) {
    redirectWithError(orderId, disputeBlock);
  }

  const norm = normalizedPrimaryOrderStatus(row);
  if (!norm) {
    redirectWithError(orderId, "주문 상태를 확인할 수 없어 요청을 처리할 수 없습니다.");
  }
  if (isOrderRowTerminalForActions(row)) {
    redirectWithError(orderId, "완료된 주문에서는 수정 요청을 보낼 수 없습니다.");
  }
  if (!isOrderStatusAllowingStudentAccept(norm)) {
    redirectWithError(
      orderId,
      `납품 검토·수락 단계에서만 수정 요청할 수 있습니다(현재: ${orderStatusLabelForUi(norm)}).`
    );
  }
  const delCheck = await hasDeliverableRowsForOrder(supabase, orderId);
  if (delCheck.error) {
    // W4(C10): 조회 오류를 '납품 없음'으로 오인하지 않도록 구분해 fail-closed
    redirectWithError(orderId, "납품 정보를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
  if (!delCheck.has) {
    redirectWithError(orderId, "등록된 납품이 있어야 수정 요청을 할 수 있습니다.");
  }

  // W4(C10): custom_order_revisions.custom_request_order_id 정본 count — 테이블/FK 프로빙 실패 시
  // 횟수 제한을 건너뛰던 fail-open 분기 제거(테이블 실존 — 003, 187 baseline). 오류는 fail-closed.
  const { count: revisionCount, error: revCountErr } = await supabase
    .from("custom_order_revisions")
    .select("id", { count: "exact", head: true })
    .eq(ORDER_CHILD_FK_COLUMN, orderId);
  if (revCountErr) {
    redirectWithError(orderId, "수정 요청 횟수를 확인하지 못했습니다.");
  }
  if ((revisionCount ?? 0) >= MAX_REVISION_REQUESTS_PER_ORDER) {
    redirectWithError(orderId, "수정 요청 횟수를 초과했습니다. (최대 2회)");
  }

  // 안전필터: 수정요청 글은 멘토(상대방)가 읽는 통로이므로, 다른 채널과 동일하게
  // 대필 금지어 차단 + 외부 연락처 마스킹을 적용한다.
  const noteSafety = sanitizeTrustSafetyText(note);
  if (!noteSafety.ok) {
    redirectWithError(orderId, noteSafety.error);
  }
  const safeNote = noteSafety.text;

  const transition = await requestCustomOrderRevisionRpc(supabase, orderId, safeNote);
  if (!transition.ok) {
    redirectWithError(orderId, transition.error);
  }

  await recordOrderEventBestEffort(supabase, orderId, "revision_requested", user.id, { noteLength: safeNote.length });
  revalidatePath(orderPath(orderId));
  revalidatePath("/custom-request");
  redirect(`${orderPath(orderId)}?ok=${encodeURIComponent("수정 요청을 전달했습니다.")}`);
}
