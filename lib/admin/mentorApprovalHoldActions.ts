"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/routeGuard";
import { ADMIN_CONFIRM_REASON_MIN_LENGTH } from "@/lib/admin/adminConfirmPolicy";
import { logAdminAction } from "@/lib/admin/adminActionLog";
import { MENTOR_PENDING_STATUS_VALUES_FOR_IN } from "@/lib/admin/mentorApprovalConstants";
import {
  MENTOR_HOLD_REASON_FIELD,
  MENTOR_HOLD_RELEASE_NOTE_FIELD,
  MENTOR_HOLD_RELEASE_TARGET_STATUS,
  MENTOR_HOLD_STATUS,
} from "@/lib/admin/mentorApprovalHold";
import { mentorApprovalAlreadyProcessedUrl, mentorApprovalErrorUrl, mentorApprovalOkUrl } from "@/lib/admin/mentorApprovalActionUrls";
import { transitionMentorVerificationStatus } from "@/lib/admin/mentorProfileStatusTransition";
import { createClient } from "@/lib/supabase/server";

/**
 * 멘토 승인 작업대 — 보류 · 보류 해제(PR-2b §1). 새 쓰기 경로 ①.
 *
 * - 보류: 결정 가능 상태(승인·반려 액션의 `.in(...)` 집합과 같다) → `on_hold`. 메모 필수(서버에서도 검사 — 모달을 우회한 제출 차단).
 *   메모는 `admin_action_logs.detail`(`note` · `reason`)에 남는다. `admin_case_notes` 는 CHECK 가 분쟁·신고만 받아 쓸 수 없다(DB 변경 금지).
 * - 해제: `on_hold` → `pending`. 처리 후 같은 지원자를 선택한 채 돌아온다(바로 결정할 수 있게).
 * - **멘토에게 알림을 보내지 않는다.** verification_status 에 반응하는 알림 트리거도 없다(staging pg_trigger 실측).
 * - 권한: 첫 줄 `requireRole("admin")`. 쓰기는 `transitionMentorVerificationStatus`(세션 → service_role, 상태 컬럼 하나).
 */

function textFromForm(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

export async function holdMentorApplicationAction(formData: FormData) {
  const { user } = await requireRole("admin");
  const mentorUserId = textFromForm(formData.get("mentorUserId"));
  const note = textFromForm(formData.get(MENTOR_HOLD_REASON_FIELD));

  if (!mentorUserId) redirect(mentorApprovalErrorUrl("신청을 식별할 수 없습니다."));
  if (note.length < ADMIN_CONFIRM_REASON_MIN_LENGTH) redirect(mentorApprovalErrorUrl("보류 메모를 입력해 주세요.", mentorUserId));

  const { touched, errorMsg } = await transitionMentorVerificationStatus(mentorUserId, MENTOR_PENDING_STATUS_VALUES_FOR_IN, MENTOR_HOLD_STATUS);
  if (errorMsg) redirect(mentorApprovalErrorUrl(errorMsg, mentorUserId));
  if (!touched) redirect(await mentorApprovalAlreadyProcessedUrl(mentorUserId));

  const session = await createClient();
  await logAdminAction(session, {
    adminId: user.id,
    actionType: "mentor_hold",
    targetType: "mentor_profile",
    targetId: mentorUserId,
    // 감사 로그 화면·계정 상세의 사유 추출 키(reason · note) 둘 다에 실린다.
    detail: { note, reason: note },
  });

  revalidatePath("/admin/mentor-approval");
  revalidatePath("/admin/dashboard");
  // 선택을 비워 첫 대기 건으로 넘어간다 — 보류 건은 대기 탭에서 빠졌으므로 자동 이동이 건너뛴다.
  redirect(mentorApprovalOkUrl("hold"));
}

export async function releaseMentorHoldAction(formData: FormData) {
  const { user } = await requireRole("admin");
  const mentorUserId = textFromForm(formData.get("mentorUserId"));
  const note = textFromForm(formData.get(MENTOR_HOLD_RELEASE_NOTE_FIELD));

  if (!mentorUserId) redirect(mentorApprovalErrorUrl("신청을 식별할 수 없습니다."));

  const { touched, errorMsg } = await transitionMentorVerificationStatus(mentorUserId, [MENTOR_HOLD_STATUS], MENTOR_HOLD_RELEASE_TARGET_STATUS);
  if (errorMsg) redirect(mentorApprovalErrorUrl(errorMsg, mentorUserId));
  if (!touched) redirect(await mentorApprovalAlreadyProcessedUrl(mentorUserId));

  const session = await createClient();
  await logAdminAction(session, {
    adminId: user.id,
    actionType: "mentor_hold_release",
    targetType: "mentor_profile",
    targetId: mentorUserId,
    detail: { note, reason: note },
  });

  revalidatePath("/admin/mentor-approval");
  revalidatePath("/admin/dashboard");
  // 해제한 지원자를 그대로 선택한 채 돌아온다 — 바로 승인·반려할 수 있게.
  redirect(mentorApprovalOkUrl("hold-release", mentorUserId));
}
