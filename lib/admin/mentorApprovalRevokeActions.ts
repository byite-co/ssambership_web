"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/routeGuard";
import { ADMIN_CONFIRM_REASON_MIN_LENGTH } from "@/lib/admin/adminConfirmPolicy";
import { logAdminAction } from "@/lib/admin/adminActionLog";
import { MENTOR_HOLD_RELEASE_TARGET_STATUS, MENTOR_REVERT_REASON_FIELD, MENTOR_REVOKE_REASON_FIELD, revokeBlockedMessage } from "@/lib/admin/mentorApprovalHold";
import { mentorApprovalAlreadyProcessedUrl, mentorApprovalErrorUrl, mentorApprovalOkUrl } from "@/lib/admin/mentorApprovalActionUrls";
import { countMentorActiveSubscriptions } from "@/lib/admin/mentorApprovalWorkbenchQueries";
import { transitionMentorVerificationStatus } from "@/lib/admin/mentorProfileStatusTransition";
import { createClient } from "@/lib/supabase/server";

/**
 * 멘토 승인 작업대 — 승인 취소 · 반려 되돌리기(PR-2b §3). 새 쓰기 경로 ②(터미널 상태 → `pending` 복귀).
 *
 * - 승인 취소: `approved → pending`. critical(사유 필수 — 서버에서도 검사). **활성 구독이 있으면 막는다**(화면의 비활성 버튼을 우회한
 *   제출도 서버에서 다시 센다 · 집계 실패도 막는다 — fail-closed). 학교 인증 행·요금제 행은 건드리지 않는다: 재승인 시 트리거가
 *   `NOT EXISTS`(SQL 192) · `ON CONFLICT DO NOTHING`(SQL 166/190) 으로 중복 없이 그대로 쓴다.
 * - 반려 되돌리기: `rejected → pending`. 오늘 처리 목록의 `되돌리기`(§3-3) — 잘못 누른 반려를 대기로 되돌린다. 사유 필수.
 * - 권한: 첫 줄 `requireRole("admin")`. 쓰기는 `transitionMentorVerificationStatus`(세션 → service_role, 상태 컬럼 하나).
 */

function textFromForm(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

export async function revokeMentorApprovalAction(formData: FormData) {
  const { user } = await requireRole("admin");
  const mentorUserId = textFromForm(formData.get("mentorUserId"));
  const reason = textFromForm(formData.get(MENTOR_REVOKE_REASON_FIELD));

  if (!mentorUserId) redirect(mentorApprovalErrorUrl("신청을 식별할 수 없습니다."));
  if (reason.length < ADMIN_CONFIRM_REASON_MIN_LENGTH) redirect(mentorApprovalErrorUrl("승인 취소 사유를 입력해 주세요.", mentorUserId));

  // 활성 구독 재검사 — 확인 모달(critical)을 우회한 제출도 서버에서 막는다.
  const activeSubscriptions = await countMentorActiveSubscriptions(mentorUserId);
  const blocked = revokeBlockedMessage(activeSubscriptions);
  if (blocked) redirect(mentorApprovalErrorUrl(blocked, mentorUserId));

  const { touched, errorMsg } = await transitionMentorVerificationStatus(mentorUserId, ["approved"], MENTOR_HOLD_RELEASE_TARGET_STATUS);
  if (errorMsg) redirect(mentorApprovalErrorUrl(errorMsg, mentorUserId));
  if (!touched) redirect(await mentorApprovalAlreadyProcessedUrl(mentorUserId));

  const session = await createClient();
  await logAdminAction(session, {
    adminId: user.id,
    actionType: "mentor_approval_revoked",
    targetType: "mentor_profile",
    targetId: mentorUserId,
    detail: { reason, note: reason, activeSubscriptions },
  });

  revalidatePath("/admin/mentor-approval");
  revalidatePath("/admin/dashboard");
  // 취소된 지원자는 대기 탭으로 돌아온다(`승인 취소됨` 배지). 그 지원자를 선택한 채 돌아온다.
  redirect(mentorApprovalOkUrl("revoke", mentorUserId));
}

export async function revertMentorRejectionAction(formData: FormData) {
  const { user } = await requireRole("admin");
  const mentorUserId = textFromForm(formData.get("mentorUserId"));
  const reason = textFromForm(formData.get(MENTOR_REVERT_REASON_FIELD));

  if (!mentorUserId) redirect(mentorApprovalErrorUrl("신청을 식별할 수 없습니다."));
  if (reason.length < ADMIN_CONFIRM_REASON_MIN_LENGTH) redirect(mentorApprovalErrorUrl("되돌리기 사유를 입력해 주세요.", mentorUserId));

  const { touched, errorMsg } = await transitionMentorVerificationStatus(mentorUserId, ["rejected"], MENTOR_HOLD_RELEASE_TARGET_STATUS);
  if (errorMsg) redirect(mentorApprovalErrorUrl(errorMsg, mentorUserId));
  if (!touched) redirect(await mentorApprovalAlreadyProcessedUrl(mentorUserId));

  const session = await createClient();
  await logAdminAction(session, {
    adminId: user.id,
    actionType: "mentor_rejection_reverted",
    targetType: "mentor_profile",
    targetId: mentorUserId,
    detail: { reason, note: reason },
  });

  revalidatePath("/admin/mentor-approval");
  revalidatePath("/admin/dashboard");
  redirect(mentorApprovalOkUrl("reject-revert", mentorUserId));
}
