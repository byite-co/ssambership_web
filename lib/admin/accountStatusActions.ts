"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/routeGuard";
import { logAdminAction } from "@/lib/admin/adminActionLog";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { mapDataErrorMessage } from "@/lib/utils/mapDataError";

const PATH = "/admin/users";

const ALLOWED_STATUS = new Set(["active", "suspended", "banned"]);

function textFromForm(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

function errUrl(msg: string) {
  return `${PATH}?error=${encodeURIComponent(msg)}`;
}
function okUrl(kind: string) {
  return `${PATH}?ok=${encodeURIComponent(kind)}`;
}

function suspendedUntilIso(durationDays: number | null): string | null {
  if (!durationDays || durationDays <= 0) return null;
  const d = new Date();
  d.setDate(d.getDate() + durationDays);
  return d.toISOString();
}

/**
 * 관리자 계정 상태 변경 — active / suspended / banned.
 * suspended 는 durationDays 가 있으면 그만큼 후 자동 해제(suspended_until).
 */
export async function setUserStatusAction(formData: FormData) {
  const { user } = await requireRole("admin");
  const targetUserId = textFromForm(formData.get("userId"));
  const nextStatus = textFromForm(formData.get("nextStatus")).toLowerCase();
  const reason = textFromForm(formData.get("reason"));
  const durationRaw = textFromForm(formData.get("durationDays"));
  const durationDays = durationRaw ? Number.parseInt(durationRaw, 10) : null;

  if (!targetUserId) redirect(errUrl("대상 계정을 식별할 수 없습니다."));
  if (!ALLOWED_STATUS.has(nextStatus)) redirect(errUrl("허용되지 않은 상태값입니다."));
  if (targetUserId === user.id) redirect(errUrl("본인 계정 상태는 변경할 수 없습니다."));

  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch {
    redirect(errUrl("서버 설정 오류로 처리할 수 없습니다."));
  }

  // 관리자 계정은 보호(다른 관리자 정지 방지)
  const { data: targetRow } = await admin
    .from("users")
    .select("id, role, status")
    .eq("id", targetUserId)
    .maybeSingle();
  if (!targetRow) redirect(errUrl("대상 계정을 찾을 수 없습니다."));
  if ((targetRow as { role?: string }).role === "admin") {
    redirect(errUrl("관리자 계정은 상태를 변경할 수 없습니다."));
  }

  const nowIso = new Date().toISOString();
  const patch: Record<string, unknown> = {
    status: nextStatus,
    status_reason: reason || null,
    status_changed_at: nowIso,
    status_changed_by: user.id,
    suspended_until: nextStatus === "suspended" ? suspendedUntilIso(durationDays) : null,
  };

  const { data, error } = await admin
    .from("users")
    .update(patch)
    .eq("id", targetUserId)
    .select("id");
  if (error) redirect(errUrl(error.message));
  if (!data?.length) redirect(errUrl("상태를 변경하지 못했습니다."));

  await logAdminAction(admin, {
    adminId: user.id,
    actionType: "account_status_change",
    targetType: "user",
    targetId: targetUserId,
    detail: { status: nextStatus, reason, durationDays },
  });

  revalidatePath(PATH);
  revalidatePath("/admin/dashboard");
  redirect(okUrl(nextStatus));
}

/**
 * P1 ② — 사용자 경고 발급. 활성 경고가 임계치(3)에 도달하면 자동 일시정지(7일).
 */
export async function issueUserWarningAction(formData: FormData) {
  const { user } = await requireRole("admin");
  const targetUserId = textFromForm(formData.get("userId"));
  const reason = textFromForm(formData.get("warnReason"));
  const severity = textFromForm(formData.get("severity")) === "severe" ? "severe" : "normal";

  if (!targetUserId) redirect(errUrl("대상 계정을 식별할 수 없습니다."));
  if (reason.length < 2) redirect(errUrl("경고 사유를 입력해 주세요."));
  if (targetUserId === user.id) redirect(errUrl("본인에게는 경고를 발급할 수 없습니다."));

  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch {
    redirect(errUrl("서버 설정 오류로 처리할 수 없습니다."));
  }

  // 경고 INSERT → 활성 카운트 → 3회 자동정지(7일)를 DB 단일 트랜잭션으로 수행하는
  // 원자 RPC(수렴 §18.3). 관리자 세션 클라이언트로 호출해 issued_by=관리자를 기록한다
  // (부분 성공 — 경고만 들어가고 정지가 빠지는 상태 — 이 구조적으로 불가능).
  const session = await createClient();
  const { data: rpcData, error: rpcErr } = await session.rpc("admin_issue_user_warning", {
    p_user_id: targetUserId,
    p_reason: reason,
    p_severity: severity,
  });
  if (rpcErr) redirect(errUrl(`경고 발급 실패: ${mapDataErrorMessage(rpcErr.message)}`));
  const envelope = (rpcData ?? {}) as {
    ok?: boolean;
    active_warning_count?: number;
    auto_suspended?: boolean;
  };
  if (envelope.ok !== true) redirect(errUrl("경고 발급 실패: 서버 응답이 계약과 다릅니다."));
  const warnings = Number(envelope.active_warning_count ?? 0);
  const autoSuspended = envelope.auto_suspended === true;

  await logAdminAction(admin, {
    adminId: user.id,
    actionType: "user_warning_issued",
    targetType: "user",
    targetId: targetUserId,
    detail: { reason, severity, warnings, autoSuspended },
  });

  revalidatePath(PATH);
  redirect(
    okUrl(
      autoSuspended
        ? `warned_suspended:${warnings}`
        : `warned:${warnings}`
    )
  );
}
