"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/routeGuard";
import { requireVerifiedIdentity } from "@/lib/identity/identityGate";
import { createClient } from "@/lib/supabase/server";
import {
  findOrderForPostAndStudent,
  getApplicationPriceAmount,
  isAuthorOfPost,
  loadApplicationById,
  loadCustomPostById,
  pickMentorIdFromApplication,
  verifyApplicationForPost,
} from "@/lib/customRequest/customRequestQueries";
import { createCustomRequestOrderWithEscrowHold } from "@/lib/customRequest/customOrderEscrowService";

const MSG_NO_PRICE = "제안 가격을 확인할 수 없어 주문을 열 수 없습니다. 잠시 후 다시 시도해 주세요.";
const MSG_ORDER_FAIL = "주문을 열 수 없습니다. 잠시 후 다시 시도해 주세요.";
const MSG_ESCROW_FAIL = "예치(캐시 차감)에 실패했습니다. 잠시 후 다시 시도해 주세요.";
const MSG_NO_APP = "지원서를 찾을 수 없어요. 잠시 후 다시 시도해 주세요.";
const MSG_NEED_IDS = "의뢰와 지원서를 다시 선택해 주세요.";

function backToApplications(postId: string, msg: string) {
  redirect(`/custom-request/${postId}/applications?error=${encodeURIComponent(msg)}`);
}

/**
 * 의뢰자(학생)가 지원 1건을 골라 custom_request_orders 1행 생성(결제/납품 후속).
 */
export async function selectMentorApplicationForOrder(formData: FormData) {
  const { user } = await requireRole("student");
  // S-C 머니패스 가드: 맞춤형 주문(에스크로 홀드)은 본인인증 완료 계정만.
  const identity = await requireVerifiedIdentity(user.id);
  if (!identity.ok) {
    redirect("/onboarding/verify");
  }
  const supabase = await createClient();
  const postId = String(formData.get("postId") ?? "").trim();
  const applicationId = String(formData.get("applicationId") ?? "").trim();
  if (!postId) {
    redirect("/custom-request");
  }
  if (!applicationId) {
    backToApplications(postId, MSG_NEED_IDS);
  }

  const existing = await findOrderForPostAndStudent(supabase, postId, user.id);
  if (existing.orderId) {
    redirect(`/custom-request/orders/${existing.orderId}`);
  }

  const [post, app] = await Promise.all([loadCustomPostById(supabase, postId), loadApplicationById(supabase, applicationId)]);

  const authz = isAuthorOfPost(user.id, post.row);
  if (!authz.ok) {
    backToApplications(postId, "의뢰를 등록하신 본인만 멘토를 선택해 주문을 열 수 있어요.");
  }
  if (!app.row) {
    backToApplications(postId, MSG_NO_APP);
    return;
  }
  const appRow = app.row;
  const postMatch = verifyApplicationForPost(app.row, postId);
  if (!postMatch.ok) {
    backToApplications(postId, "이 지원서는 이 의뢰에 해당하지 않아요.");
  }
  const mentor = pickMentorIdFromApplication(appRow);
  if (!mentor) {
    backToApplications(postId, "지원서에서 멘토를 확인할 수 없어요. 잠시 후 다시 시도해 주세요.");
    return;
  }

  const price = getApplicationPriceAmount(appRow);
  if (price === null) {
    backToApplications(postId, MSG_NO_PRICE);
    return;
  }

  const r = await createCustomRequestOrderWithEscrowHold(supabase, {
    postId,
    studentId: user.id,
    applicationId,
    mentorId: mentor,
    agreedPrice: price,
  });
  if (r.ok) {
    revalidatePath("/custom-request");
    revalidatePath(`/custom-request/${postId}`);
    revalidatePath(`/custom-request/${postId}/applications`, "page");
    revalidatePath(`/custom-request/orders/${r.orderId}`);
    revalidatePath("/wallet/ledger");
    revalidatePath("/wallet/charge");
    revalidatePath("/mentor/custom-request/orders");
    revalidatePath("/mentor/custom-request/dashboard");
    redirect(`/custom-request/orders/${r.orderId}`);
  }
  if (r.code === "ORDER_DUPLICATE") {
    const duplicate = await findOrderForPostAndStudent(supabase, postId, user.id);
    if (duplicate.orderId) {
      redirect(`/custom-request/orders/${duplicate.orderId}`);
    }
    backToApplications(postId, "이미 주문이 생성되었습니다. 주문 목록에서 확인해 주세요.");
  }
  if (r.code === "CASH_INSUFFICIENT") {
    backToApplications(postId, r.error);
  }
  if (r.code === "ORDER_STATUS") {
    backToApplications(postId, r.error);
  }
  backToApplications(postId, r.code === "ESCROW_RPC" ? MSG_ESCROW_FAIL : MSG_ORDER_FAIL);
}
