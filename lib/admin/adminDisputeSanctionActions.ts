"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/routeGuard";
import { logAdminAction } from "@/lib/admin/adminActionLog";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { resolveAdminWriteClient } from "@/lib/admin/adminWriteClient";
import { tryInsertAdminDisputeNote } from "@/lib/admin/adminCaseNotes";
import { applyAccountStatus, sanctionToAccountStatus } from "@/lib/admin/accountStatusCore";

const PATH = "/admin/disputes";

// 현재 상태 게이트 — 종결(resolved/dismissed/sanction_permanent)된 분쟁은 재제재하지 않는다.
const SANCTIONABLE_STATUSES = ["open", "under_review", "escalated", "on_hold"] as const;

function errUrl(msg: string) {
  return `${PATH}?error=${encodeURIComponent(msg)}`;
}

/** 분쟁/신고 제재 — 운영 메모와 함께 기록 */
export async function applyDisputeSanctionAction(formData: FormData) {
  const { user } = await requireRole("admin");
  const disputeId = String(formData.get("disputeId") ?? "").trim();
  const sanction = String(formData.get("sanction") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();
  const target = String(formData.get("target") ?? "mentor").trim().toLowerCase();

  if (!disputeId) redirect(errUrl("대상을 식별할 수 없습니다."));
  if (!["7d", "30d", "permanent", "hold", "complete"].includes(sanction)) {
    redirect(errUrl("허용되지 않은 조치입니다."));
  }

  // D-AD-6: 계정 반영이 필요한 제재(7d/30d/permanent)는 service role 이 반드시 있어야 하고,
  // 실패를 예외로 삼키지 않는다. 계정 반영이 먼저 성공해야 분쟁 상태를 제재로 전이한다.
  const supabase = await createClient();
  const resolved = resolveAdminWriteClient(() => createServiceRoleClient());
  if (!resolved.ok) redirect(errUrl(resolved.message));
  const admin = resolved.client;

  const statusMap: Record<string, string> = {
    complete: "resolved",
    hold: "on_hold",
    "7d": "sanction_7d",
    "30d": "sanction_30d",
    permanent: "sanction_permanent",
  };

  // 1) 계정 상태 반영(7d/30d 정지, permanent 차단) — 대상 부재·반영 실패는 모두 실패로 표면화.
  let accountApplied: { target: string; status: string; userId: string } | null = null;
  const mapping = sanctionToAccountStatus(sanction);
  if (mapping) {
    const { data: dispute } = await admin
      .from("disputes")
      .select("student_id, mentor_id")
      .eq("id", disputeId)
      .maybeSingle();
    const d = (dispute as { student_id?: string | null; mentor_id?: string | null } | null) ?? null;
    const targetUserId = target === "student" ? d?.student_id ?? null : d?.mentor_id ?? null;
    if (!targetUserId) {
      redirect(errUrl("제재 대상 계정을 찾을 수 없어 제재를 적용하지 못했습니다."));
    }
    const res = await applyAccountStatus(admin, {
      targetUserId,
      nextStatus: mapping.nextStatus,
      durationDays: mapping.durationDays,
      reason: `분쟁 제재(${sanction})${note ? `: ${note}` : ""}`,
      adminId: user.id,
    });
    if (!res.ok) {
      redirect(errUrl(`계정 상태 반영에 실패해 제재를 적용하지 못했습니다. (${res.error ?? "알 수 없는 오류"})`));
    }
    accountApplied = { target, status: mapping.nextStatus, userId: targetUserId };
  }

  // 2) 분쟁 상태 전이 — 현재 상태 게이트로 종결 건 덮어쓰기 방지, 0행이면 실패.
  const patch: Record<string, unknown> = { status: statusMap[sanction] ?? sanction };
  if (note) patch.admin_note = note;

  const { data: updated, error } = await admin
    .from("disputes")
    .update(patch)
    .eq("id", disputeId)
    .in("status", [...SANCTIONABLE_STATUSES])
    .select("id");
  if (error) redirect(errUrl("처리에 실패했습니다."));
  if (!((updated as unknown[] | null)?.length ?? 0)) {
    redirect(errUrl("이미 종료되었거나 변경할 수 없는 상태입니다."));
  }

  await tryInsertAdminDisputeNote(admin, { disputeId, note, adminId: user.id });

  await logAdminAction(supabase, {
    adminId: user.id,
    actionType: `dispute_${sanction}`,
    targetType: "dispute",
    targetId: disputeId,
    detail: { note, target, accountApplied },
  });

  revalidatePath(PATH);
  revalidatePath(`/admin/disputes/${disputeId}`);
  redirect(`${PATH}?ok=sanction`);
}
