"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/routeGuard";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { logAdminAction } from "@/lib/admin/adminActionLog";
import { resolveAdminWriteClient } from "@/lib/admin/adminWriteClient";
import { ACCOUNT_BASE_PATH, accountDetailPath, buildAccountDetailUrl } from "@/lib/admin/accountDetailConsole";

const TABLE = "mentor_profiles";

/**
 * 정원 조정 결과가 돌아가는 곳 — PR-7 부터 계정 상세 멘토 탭(`/admin/users/[id]?tab=mentor`).
 * 구 라우트 `/admin/mentor-approvals/[id]` 는 이 상세로 리다이렉트만 한다.
 */
function okPath(mentorUserId: string): string {
  return buildAccountDetailUrl(mentorUserId, { tab: "mentor", capOk: true });
}
function errPath(mentorUserId: string, message: string): string {
  return buildAccountDetailUrl(mentorUserId, { tab: "mentor", capError: message });
}

/**
 * 멘토 cap 상한(cap_limit) 변경 — 관리자 전용. (미도달 라우트에 있던 액션을 PR-7 계정 상세 멘토 탭이 재사용한다.)
 * `reason`(선택)은 감사 로그 detail 에 남긴다 — 확인 모달(stateChange + 사유)이 싣는다.
 */
export async function updateMentorCapLimitAction(formData: FormData) {
  const { user } = await requireRole("admin");
  const mentorUserId = String(formData.get("mentorUserId") ?? "").trim();
  const raw = String(formData.get("capLimit") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();

  if (!mentorUserId) {
    redirect(`${ACCOUNT_BASE_PATH}?error=` + encodeURIComponent("멘토를 식별할 수 없습니다."));
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1000) {
    redirect(errPath(mentorUserId, "0~1000 사이 숫자를 입력해 주세요."));
  }
  const capLimit = Math.round(parsed * 10) / 10; // 소수 1자리

  // D-AD-1: service role 없으면 세션 폴백 금지(fail-closed). mentor_profiles 에는 관리자 UPDATE
  // 정책이 없어 세션 경로에서는 0행 갱신이 error 없이 "성공"으로 보였다.
  const resolved = resolveAdminWriteClient(() => createServiceRoleClient());
  if (!resolved.ok) {
    redirect(errPath(mentorUserId, resolved.message));
  }
  const admin = resolved.client;

  const { data, error } = await admin
    .from(TABLE)
    .update({ cap_limit: capLimit })
    .eq("user_id", mentorUserId)
    .select("user_id");

  if (error) {
    redirect(errPath(mentorUserId, "cap 상한 저장에 실패했습니다. (마이그레이션 050 적용 여부 확인)"));
  }

  // D-AD-1: 반환 행수 검증 — 0행이면 저장이 실제로 반영되지 않은 것이므로 실패 처리.
  if (((data as unknown[] | null)?.length ?? 0) === 0) {
    redirect(errPath(mentorUserId, "cap 상한을 저장하지 못했습니다. 대상 멘토를 찾을 수 없습니다."));
  }

  const session = await createClient();
  await logAdminAction(session, {
    adminId: user.id,
    actionType: "mentor_cap_limit_update",
    targetType: "mentor_profile",
    targetId: mentorUserId,
    // 기본 한도는 DB(mentor_profiles.cap_limit default · mentor_cap_limit()) 소유 — TS 사본을 남기지 않는다(PR-1b).
    detail: { capLimit, reason: reason || null },
  });

  revalidatePath(accountDetailPath(mentorUserId));
  redirect(okPath(mentorUserId));
}
