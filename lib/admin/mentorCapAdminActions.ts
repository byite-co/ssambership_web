"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/routeGuard";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { logAdminAction } from "@/lib/admin/adminActionLog";
import { resolveAdminWriteClient } from "@/lib/admin/adminWriteClient";
import { MENTOR_CAP_LIMIT_DEFAULT } from "@/lib/subscribe/mentorCapService";

const TABLE = "mentor_profiles";

function detailPath(mentorUserId: string): string {
  return `/admin/mentor-approvals/${encodeURIComponent(mentorUserId)}`;
}

/** 멘토 cap 상한(cap_limit) 변경 — 관리자 전용. */
export async function updateMentorCapLimitAction(formData: FormData) {
  const { user } = await requireRole("admin");
  const mentorUserId = String(formData.get("mentorUserId") ?? "").trim();
  const raw = String(formData.get("capLimit") ?? "").trim();

  if (!mentorUserId) {
    redirect("/admin/mentor-approvals?error=" + encodeURIComponent("멘토를 식별할 수 없습니다."));
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1000) {
    redirect(detailPath(mentorUserId) + "?capError=" + encodeURIComponent("0~1000 사이 숫자를 입력해 주세요."));
  }
  const capLimit = Math.round(parsed * 10) / 10; // 소수 1자리

  // D-AD-1: service role 없으면 세션 폴백 금지(fail-closed). mentor_profiles 에는 관리자 UPDATE
  // 정책이 없어 세션 경로에서는 0행 갱신이 error 없이 "성공"으로 보였다.
  const resolved = resolveAdminWriteClient(() => createServiceRoleClient());
  if (!resolved.ok) {
    redirect(detailPath(mentorUserId) + "?capError=" + encodeURIComponent(resolved.message));
  }
  const admin = resolved.client;

  const { data, error } = await admin
    .from(TABLE)
    .update({ cap_limit: capLimit })
    .eq("user_id", mentorUserId)
    .select("user_id");

  if (error) {
    redirect(
      detailPath(mentorUserId) +
        "?capError=" +
        encodeURIComponent("cap 상한 저장에 실패했습니다. (마이그레이션 050 적용 여부 확인)")
    );
  }

  // D-AD-1: 반환 행수 검증 — 0행이면 저장이 실제로 반영되지 않은 것이므로 실패 처리.
  if (((data as unknown[] | null)?.length ?? 0) === 0) {
    redirect(
      detailPath(mentorUserId) +
        "?capError=" +
        encodeURIComponent("cap 상한을 저장하지 못했습니다. 대상 멘토를 찾을 수 없습니다.")
    );
  }

  const session = await createClient();
  await logAdminAction(session, {
    adminId: user.id,
    actionType: "mentor_cap_limit_update",
    targetType: "mentor_profile",
    targetId: mentorUserId,
    detail: { capLimit, default: MENTOR_CAP_LIMIT_DEFAULT },
  });

  revalidatePath(detailPath(mentorUserId));
  redirect(detailPath(mentorUserId) + "?capOk=1");
}
