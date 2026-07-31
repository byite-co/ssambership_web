"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServerUserWithProfile } from "@/lib/auth/getServerUserWithProfile";
import { canAccessOrder } from "@/lib/customRequest/orderAccess";
import { sanitizeTrustSafetyText } from "@/lib/safety/trustSafetyText";
import {
  getOrderMessageAttachmentFileFromFormData,
  insertOrderMessageAttachmentRow,
  removeOrderMessageAttachmentObjectBestEffort,
  uploadOrderMessageAttachment,
  type OrderMessageAttachmentMeta,
} from "@/lib/customRequest/orderMessageAttachments";
import { isOrderRowTerminalForActions } from "@/lib/customRequest/orderLifecycleConstants";
import { insertOrderRoomMessage, recordOrderEventBestEffort } from "@/lib/customRequest/orderRoomMutations";
import { createClient } from "@/lib/supabase/server";
import type { AppRole } from "@/lib/types/user";

type Row = Record<string, unknown>;

function orderPath(orderId: string) {
  return `/custom-request/orders/${encodeURIComponent(orderId)}`;
}

function logActionFailure(
  reason: string,
  ctx: {
    orderId: string;
    userId: string | null;
    role: AppRole | undefined;
    canAccess: boolean | null;
    studentMatch: boolean | null;
    mentorMatch: boolean | null;
    supabaseError: string | null;
  }
) {
  console.error(`[submitCustomOrderRoomMessageAction] ${reason}`, ctx);
}

/**
 * 주문방 메시지: orderId + 본문만 form에서 받고, author·역할은 세션/프로필로만 판정.
 * 완료·종료 주문(`isOrderRowTerminalForActions`)에서는 새 메시지 작성을 막고 UI(읽기 전용)와 맞춘다.
 */
export async function submitCustomOrderRoomMessageAction(formData: FormData): Promise<void> {
  const orderIdEarly = String(formData.get("orderId") ?? "").trim();
  const { user, profile, error: pe } = await getServerUserWithProfile();
  if (!user) {
    logActionFailure("no user", {
      orderId: orderIdEarly || "—",
      userId: null,
      role: undefined,
      canAccess: null,
      studentMatch: null,
      mentorMatch: null,
      supabaseError: pe?.message ?? null,
    });
    const next = orderIdEarly ? `/custom-request/orders/${orderIdEarly}` : "/custom-request";
    redirect("/login?next=" + encodeURIComponent(next));
  }
  if (pe) {
    logActionFailure("profile load error", {
      orderId: orderIdEarly || "—",
      userId: user.id,
      role: profile?.role as AppRole | undefined,
      canAccess: null,
      studentMatch: null,
      mentorMatch: null,
      supabaseError: pe.message,
    });
  }
  const role = profile?.role as AppRole | undefined;
  if (role !== "student" && role !== "mentor") {
    logActionFailure("role not student/mentor", {
      orderId: orderIdEarly || "—",
      userId: user.id,
      role,
      canAccess: null,
      studentMatch: null,
      mentorMatch: null,
      supabaseError: null,
    });
    redirect("/custom-request?error=" + encodeURIComponent("학생·멘토만 메시지를 보낼 수 있습니다."));
  }

  const orderId = orderIdEarly;
  const text = String(formData.get("messageBody") ?? "").trim();
  const attachmentFile = getOrderMessageAttachmentFileFromFormData(formData, "attachment");
  if (!orderId) {
    logActionFailure("missing orderId", {
      orderId: "—",
      userId: user.id,
      role,
      canAccess: null,
      studentMatch: null,
      mentorMatch: null,
      supabaseError: null,
    });
    redirect("/custom-request?error=" + encodeURIComponent("orderId가 필요합니다."));
  }
  if (!text && !attachmentFile) {
    redirect(`${orderPath(orderId)}?error=${encodeURIComponent("메시지나 첨부 파일을 입력해 주세요.")}`);
  }

  const supabase = await createClient();
  // W4(C10): custom_request_orders 정본 테이블 고정 — 후보 테이블 프로빙 제거
  const { data: rowData, error: oe } = await supabase
    .from("custom_request_orders")
    .select("*")
    .eq("id", orderId)
    .maybeSingle();
  if (oe || !rowData) {
    logActionFailure("order row load", {
      orderId,
      userId: user.id,
      role,
      canAccess: null,
      studentMatch: null,
      mentorMatch: null,
      supabaseError: oe?.message ?? (!rowData ? "no row" : null),
    });
    redirect(`${orderPath(orderId)}?error=${encodeURIComponent(oe?.message ?? "주문을 찾을 수 없습니다.")}`);
  }
  const row = rowData as Row;

  if (isOrderRowTerminalForActions(row)) {
    redirect(`${orderPath(orderId)}?error=${encodeURIComponent("완료된 주문에서는 새 메시지를 보낼 수 없습니다.")}`);
  }

  const access = canAccessOrder(row, user.id, role);
  if (!access.ok) {
    logActionFailure("no order access", {
      orderId,
      userId: user.id,
      role,
      canAccess: false,
      studentMatch: null,
      mentorMatch: null,
      supabaseError: null,
    });
    redirect(`${orderPath(orderId)}?error=${encodeURIComponent("이 주문에 메시지를 보낼 권한이 없습니다.")}`);
  }

  // W4(C10): custom_request_orders.student_id/mentor_id(NOT NULL) 직접 대조 — 소유자 컬럼 프로빙 제거
  if (role === "student") {
    const studentMatch = String(row.student_id) === user.id;
    if (!studentMatch) {
      logActionFailure("student id mismatch", {
        orderId,
        userId: user.id,
        role,
        canAccess: true,
        studentMatch,
        mentorMatch: null,
        supabaseError: null,
      });
      redirect(`${orderPath(orderId)}?error=${encodeURIComponent("의뢰자(학생) 본인만 이 영역에서 메시지를 보낼 수 있습니다.")}`);
    }
  } else {
    const mentorMatch = String(row.mentor_id) === user.id;
    if (!mentorMatch) {
      logActionFailure("mentor id mismatch", {
        orderId,
        userId: user.id,
        role,
        canAccess: true,
        studentMatch: null,
        mentorMatch,
        supabaseError: null,
      });
      redirect(`${orderPath(orderId)}?error=${encodeURIComponent("배정 멘토 본인만 이 영역에서 메시지를 보낼 수 있습니다.")}`);
    }
  }

  // 안전필터: 다른 채널(질문방·커뮤니티)과 동일하게 외부 연락처 마스킹 + 대필 금지어 차단.
  // 권한 확인을 마친 정당한 당사자에 한해 적용하고, 첨부 업로드 전에 차단하여 고아 업로드를 막는다.
  let safeText = text;
  if (text) {
    const safety = sanitizeTrustSafetyText(text);
    if (!safety.ok) {
      redirect(`${orderPath(orderId)}?error=${encodeURIComponent(safety.error)}`);
    }
    safeText = safety.text;
  }

  let uploadedAttachment: OrderMessageAttachmentMeta | null = null;
  if (attachmentFile) {
    const uploadRes = await uploadOrderMessageAttachment(supabase, {
      orderId,
      userId: user.id,
      file: attachmentFile,
    });
    if (!uploadRes.ok) {
      redirect(`${orderPath(orderId)}?error=${encodeURIComponent("첨부 파일 업로드 실패. " + uploadRes.error)}`);
    }
    uploadedAttachment = uploadRes.meta;
  }

  const messageBody = safeText || "첨부 파일";
  // W4(C10): role/party 는 custom_order_messages 에 저장 열이 없어 전달하지 않음(라벨은 author_id 파생)
  const insertRes = await insertOrderRoomMessage(supabase, orderId, user.id, messageBody);
  if (insertRes.error) {
    if (uploadedAttachment) {
      await removeOrderMessageAttachmentObjectBestEffort(supabase, uploadedAttachment.objectPath);
    }
    logActionFailure("message insert failed", {
      orderId,
      userId: user.id,
      role,
      canAccess: true,
      studentMatch: role === "student" ? true : null,
      mentorMatch: role === "mentor" ? true : null,
      supabaseError: insertRes.error,
    });
    redirect(`${orderPath(orderId)}?error=${encodeURIComponent("메시지 저장 실패. " + insertRes.error)}`);
  }

  if (uploadedAttachment) {
    const attachmentRowRes = await insertOrderMessageAttachmentRow(supabase, {
      orderId,
      messageId: insertRes.id,
      uploaderId: user.id,
      fileMeta: uploadedAttachment,
    });
    if (attachmentRowRes.error) {
      await removeOrderMessageAttachmentObjectBestEffort(supabase, uploadedAttachment.objectPath);
      redirect(`${orderPath(orderId)}?error=${encodeURIComponent("첨부 파일 저장 실패. " + attachmentRowRes.error)}`);
    }
  }

  await recordOrderEventBestEffort(supabase, orderId, "message_created", user.id, {
    party: role,
    has_attachment: Boolean(uploadedAttachment),
  });

  // 상대방 알림은 159 트리거(custom_order_messages INSERT)가 도메인 write 와 원자적으로 발행한다.
  revalidatePath(orderPath(orderId));
  revalidatePath("/custom-request");
  redirect(`${orderPath(orderId)}?ok=${encodeURIComponent("메시지를 보냈습니다.")}`);
}
