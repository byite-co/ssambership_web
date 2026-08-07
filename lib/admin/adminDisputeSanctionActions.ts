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

// 현재 상태 게이트 — 종말 상태(resolved/dismissed/sanction_permanent)만 재제재하지 않는다.
// D-AD-2: sanction_7d/sanction_30d 는 기간 제재 중에도 재제재·상향(예: 7d→30d→permanent)과
// 해결·기각 전이가 가능해야 하므로 게이트에 포함한다(출구 없는 종말 상태 방지).
const SANCTIONABLE_STATUSES = [
  "open",
  "under_review",
  "escalated",
  "on_hold",
  "sanction_7d",
  "sanction_30d",
] as const;

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
  // 실패를 예외로 삼키지 않는다. 분쟁 행 선점(상태 전이)이 먼저 성공해야 계정을 변경한다 —
  // 종결 분쟁에서 계정만 정지되고 액션 실패·감사 로그 미기록이 되는 반쪽 실행을 막는다.
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

  // 1) 계정 반영 제재(7d/30d/permanent)면 대상 계정과 보상 복원용 현재 상태를 먼저 읽는다.
  const mapping = sanctionToAccountStatus(sanction);
  let targetUserId: string | null = null;
  let prevStatus: string | null = null;
  let prevAdminNote: string | null = null;
  if (mapping) {
    const { data: dispute } = await admin
      .from("disputes")
      .select("student_id, mentor_id, status, admin_note")
      .eq("id", disputeId)
      .maybeSingle();
    const d =
      (dispute as {
        student_id?: string | null;
        mentor_id?: string | null;
        status?: string | null;
        admin_note?: string | null;
      } | null) ?? null;
    targetUserId = target === "student" ? d?.student_id ?? null : d?.mentor_id ?? null;
    prevStatus = d?.status ?? null;
    prevAdminNote = d?.admin_note ?? null;
    if (!targetUserId) {
      redirect(errUrl("제재 대상 계정을 찾을 수 없어 제재를 적용하지 못했습니다."));
    }
  }

  // 2) 분쟁 상태 전이(행 선점) — 현재 상태 게이트로 종결 건 덮어쓰기 방지.
  //    0행이면 계정 무변경으로 즉시 종료한다.
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

  // 3) 계정 상태 반영(7d/30d 정지, permanent 차단) — 실패 시 2)의 분쟁 행을 이전 상태로
  //    되돌리는 보상 UPDATE 를 시도한다(보상 실패는 서버 로그만 — 사용자 URL 에 원문 미노출, D-AD-3).
  let accountApplied: { target: string; status: string; userId: string } | null = null;
  if (mapping && targetUserId) {
    const res = await applyAccountStatus(admin, {
      targetUserId,
      nextStatus: mapping.nextStatus,
      durationDays: mapping.durationDays,
      reason: `분쟁 제재(${sanction})${note ? `: ${note}` : ""}`,
      adminId: user.id,
    });
    if (!res.ok) {
      const restorePatch: Record<string, unknown> = { status: prevStatus };
      if (note) restorePatch.admin_note = prevAdminNote;
      const restored = await admin
        .from("disputes")
        .update(restorePatch)
        .eq("id", disputeId)
        .select("id");
      if (restored.error || !((restored.data as unknown[] | null)?.length ?? 0)) {
        console.error("[applyDisputeSanctionAction] 보상 복원 실패", {
          disputeId,
          prevStatus,
          error: restored.error?.message ?? null,
        });
      }
      redirect(errUrl("계정 상태 반영에 실패해 제재를 적용하지 못했습니다."));
    }
    accountApplied = { target, status: mapping.nextStatus, userId: targetUserId };
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
