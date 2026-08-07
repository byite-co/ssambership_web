"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/routeGuard";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { logAdminAction } from "@/lib/admin/adminActionLog";
import { resolveAdminWriteClient } from "@/lib/admin/adminWriteClient";
import { finalizeMentorTermination } from "@/lib/mentor/mentorActivityService";

const PATH = "/admin/mentor-activity";

function textFromForm(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}
function back(key: "ok" | "error", msg: string): string {
  return `${PATH}?${key}=${encodeURIComponent(msg)}`;
}

async function loadEvent(admin: ReturnType<typeof createServiceRoleClient>, eventId: string) {
  const { data } = await admin
    .from("mentor_activity_events")
    .select("id, mentor_id, event_type, status")
    .eq("id", eventId)
    .maybeSingle();
  return (data as { id?: string; mentor_id?: string; status?: string } | null) ?? null;
}

/** 무단이탈 의심 — 정산 보류 확정(approved). 보류 유지. */
export async function approveMentorAbandonmentHoldAction(formData: FormData) {
  const { user } = await requireRole("admin");
  const eventId = textFromForm(formData.get("eventId"));
  if (!eventId) redirect(back("error", "이벤트를 식별할 수 없습니다."));

  // D-AD-4: service role 없으면 fail-closed(한글 안내) — 미가공 500 방지.
  const resolved = resolveAdminWriteClient(() => createServiceRoleClient());
  if (!resolved.ok) redirect(back("error", resolved.message));
  const admin = resolved.client;
  const ev = await loadEvent(admin, eventId);
  if (!ev?.mentor_id) redirect(back("error", "이벤트를 찾을 수 없습니다."));

  const { error } = await admin
    .from("mentor_activity_events")
    .update({ status: "approved", reviewed_by: user.id, reviewed_at: new Date().toISOString() })
    .eq("id", eventId);
  if (error) redirect(back("error", error.message));

  await logAdminAction(admin, {
    adminId: user.id,
    actionType: "mentor_abandonment_hold_approved",
    targetType: "mentor_activity_event",
    targetId: eventId,
    detail: { mentor_id: ev.mentor_id },
  });
  revalidatePath(PATH);
  redirect(back("ok", "정산 보류를 확정했습니다."));
}

/** 구제 — 정산 보류 해제(released). 해당 멘토의 보류 정산 항목을 pending 으로 복원. */
export async function releaseMentorSettlementHoldAction(formData: FormData) {
  const { user } = await requireRole("admin");
  const eventId = textFromForm(formData.get("eventId"));
  if (!eventId) redirect(back("error", "이벤트를 식별할 수 없습니다."));

  // D-AD-4: service role 없으면 fail-closed(한글 안내).
  const resolved = resolveAdminWriteClient(() => createServiceRoleClient());
  if (!resolved.ok) redirect(back("error", resolved.message));
  const admin = resolved.client;
  const ev = await loadEvent(admin, eventId);
  if (!ev?.mentor_id) redirect(back("error", "이벤트를 찾을 수 없습니다."));

  // D-AD-7: 두 문장 비트랜잭션. 단일 RPC 가 없어(스키마 변경은 본 배치 범위 밖) 순서 보장 +
  // 부분 실패를 정확히 표면화한다. 정산 항목 복원(자금 해제)을 먼저 확정한 뒤 이벤트 상태를
  // released 로 전이한다. 이벤트 전이가 실패하면 "복원됐으나 상태 갱신 실패"를 명시해
  // '아무 것도 안 됐다'는 오인을 막는다(이벤트 UPDATE 에 상태 게이트가 없어 재실행이 안전).
  const { data: restored, error: restoreErr } = await admin
    .from("subscription_settlement_items")
    .update({ status: "pending", hold_reason: null })
    .eq("mentor_id", ev.mentor_id)
    .eq("status", "hold")
    .eq("hold_reason", "mentor_abandonment_suspected")
    .select("id");
  if (restoreErr) redirect(back("error", restoreErr.message));
  const restoredCount = (restored as unknown[] | null)?.length ?? 0;

  const { error } = await admin
    .from("mentor_activity_events")
    .update({ status: "released", reviewed_by: user.id, reviewed_at: new Date().toISOString() })
    .eq("id", eventId);
  if (error) {
    redirect(
      back(
        "error",
        `정산 항목 ${restoredCount}건은 복원했으나 이벤트 상태 갱신에 실패했습니다. 다시 시도하면 남은 갱신만 처리됩니다.`
      )
    );
  }

  await logAdminAction(admin, {
    adminId: user.id,
    actionType: "mentor_settlement_hold_released",
    targetType: "mentor_activity_event",
    targetId: eventId,
    detail: { mentor_id: ev.mentor_id, restored: restoredCount },
  });
  revalidatePath(PATH);
  redirect(back("ok", `정산 보류를 해제(구제)했습니다. ${restoredCount}건 복원.`));
}

/** 완전 종료 유예 만료 멘토를 관리자가 즉시 정리(잔여 환불 생성). */
export async function finalizeMentorTerminationAdminAction(formData: FormData) {
  const { user } = await requireRole("admin");
  const mentorId = textFromForm(formData.get("mentorId"));
  if (!mentorId) redirect(back("error", "멘토를 식별할 수 없습니다."));

  // D-AD-4: service role 없으면 fail-closed(한글 안내).
  const resolved = resolveAdminWriteClient(() => createServiceRoleClient());
  if (!resolved.ok) redirect(back("error", resolved.message));
  const admin = resolved.client;
  const res = await finalizeMentorTermination(admin, mentorId, new Date());
  if (!res.ok) redirect(back("error", res.error ?? "정리에 실패했습니다."));

  await logAdminAction(admin, {
    adminId: user.id,
    actionType: "mentor_termination_finalized",
    targetType: "user",
    targetId: mentorId,
    detail: res.summary ?? {},
  });
  revalidatePath(PATH);
  redirect(back("ok", `활동 종료를 정리했습니다. 환불 ${res.summary?.refundsCreated ?? 0}건 생성.`));
}
