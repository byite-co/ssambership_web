"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/routeGuard";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { logAdminAction } from "@/lib/admin/adminActionLog";
import { resolveAdminWriteClient } from "@/lib/admin/adminWriteClient";
import { toAdminDisplayError } from "@/lib/admin/adminDisplayError";

function idsFromForm(formData: FormData): string[] {
  return formData
    .getAll("ids")
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter((v) => v.length > 0);
}
function text(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}
function backUrl(path: string, key: "ok" | "error", msg: string): string {
  return `${path}?${key}=${encodeURIComponent(msg)}`;
}

/** P1 ③ — 신고(content_reports) 일괄 상태 변경(reviewing/resolved/dismissed). */
export async function bulkUpdateContentReportsAction(formData: FormData) {
  const { user } = await requireRole("admin");
  const path = "/admin/moderation";
  const ids = idsFromForm(formData);
  const nextStatus = text(formData, "bulkStatus").toLowerCase();
  if (!ids.length) redirect(backUrl(path, "error", "선택된 항목이 없습니다."));
  if (!["reviewing", "resolved", "dismissed"].includes(nextStatus)) {
    redirect(backUrl(path, "error", "허용되지 않은 일괄 처리입니다."));
  }

  // D-AD-4: service role 없으면 fail-closed(한글 안내) — 미가공 500 방지.
  const resolved = resolveAdminWriteClient(() => createServiceRoleClient());
  if (!resolved.ok) redirect(backUrl(path, "error", resolved.message));
  const admin = resolved.client;
  const patch: Record<string, unknown> = { status: nextStatus };
  if (nextStatus === "resolved" || nextStatus === "dismissed") {
    patch.resolved_at = new Date().toISOString();
    patch.resolved_by = user.id;
  }
  const { data, error } = await admin
    .from("content_reports")
    .update(patch)
    .in("id", ids)
    .in("status", ["pending", "reviewing"])
    .select("id");
  // D-AD-3: DB 원문 대신 표시용 문구만 URL 로 노출.
  if (error) redirect(backUrl(path, "error", toAdminDisplayError(error.message, "reports") ?? "일괄 처리에 실패했습니다."));

  const n = (data as unknown[] | null)?.length ?? 0;
  await logAdminAction(admin, {
    adminId: user.id,
    actionType: "content_report_bulk_status",
    targetType: "content_report",
    detail: { nextStatus, requested: ids.length, applied: n },
  });
  revalidatePath(path);
  redirect(backUrl(path, "ok", `${n}건을 일괄 처리했습니다(${nextStatus}).`));
}

/** P1 ③ — 분쟁(disputes) 일괄 상태 변경(under_review/resolved). */
export async function bulkUpdateDisputesAction(formData: FormData) {
  const { user } = await requireRole("admin");
  const path = "/admin/disputes";
  const ids = idsFromForm(formData);
  const nextStatus = text(formData, "bulkStatus").toLowerCase();
  if (!ids.length) redirect(backUrl(path, "error", "선택된 항목이 없습니다."));
  if (!["under_review", "resolved", "dismissed"].includes(nextStatus)) {
    redirect(backUrl(path, "error", "허용되지 않은 일괄 처리입니다."));
  }

  // D-AD-4: service role 없으면 fail-closed(한글 안내).
  const resolved = resolveAdminWriteClient(() => createServiceRoleClient());
  if (!resolved.ok) redirect(backUrl(path, "error", resolved.message));
  const admin = resolved.client;
  const patch: Record<string, unknown> = { status: nextStatus };
  if (nextStatus === "resolved" || nextStatus === "dismissed") {
    patch.resolved_at = new Date().toISOString();
    patch.resolved_by = user.id;
  }
  // D-AD-2: 현재 상태 게이트 — 종말 상태(resolved/dismissed/sanction_permanent)만 덮어쓰지 않음
  // (단건 statusIn 규약과 일치). sanction_7d/30d 는 기간 제재 중에도 전이 가능해야 한다(출구 보장).
  const { data, error } = await admin
    .from("disputes")
    .update(patch)
    .in("id", ids)
    .in("status", ["open", "under_review", "escalated", "sanction_7d", "sanction_30d"])
    .select("id");
  // D-AD-3: DB 원문 대신 표시용 문구만 URL 로 노출.
  if (error) redirect(backUrl(path, "error", toAdminDisplayError(error.message, "disputes") ?? "일괄 처리에 실패했습니다."));

  const n = (data as unknown[] | null)?.length ?? 0;
  await logAdminAction(admin, {
    adminId: user.id,
    actionType: "dispute_bulk_status",
    targetType: "dispute",
    detail: { nextStatus, requested: ids.length, applied: n },
  });
  revalidatePath(path);
  redirect(backUrl(path, "ok", `${n}건을 일괄 처리했습니다(${nextStatus}).`));
}

// PR-3: 환불 일괄 승인/반려는 `lib/admin/refundActions.ts` 의 `bulkRefundDecisionAction`(건별 결과 반환, useActionState)으로 이동했다.
