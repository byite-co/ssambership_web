"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireRole } from "@/lib/auth/routeGuard";
import { toAdminDisplayError } from "@/lib/admin/adminDisplayError";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { MENTOR_PENDING_STATUS_VALUES_FOR_IN } from "@/lib/admin/mentorApprovalConstants";
import { logAdminAction } from "@/lib/admin/adminActionLog";

const PATH = "/admin/mentor-approval";
const TABLE = "mentor_profiles";
// W4(C10): mentor_profiles 상태 컬럼은 verification_status 단일 정본(187 baseline 실측) — 후보 컬럼 프로빙 제거.
const STATUS_COLUMN = "verification_status";

function textFromForm(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

function errUrl(safeMessage: string) {
  const q = new URLSearchParams();
  q.set("error", safeMessage);
  return `${PATH}?${q.toString()}`;
}

function okUrl(kind: string) {
  return `${PATH}?ok=${encodeURIComponent(kind)}`;
}

function safeActionMsg(raw: string | null | undefined): string {
  return toAdminDisplayError(raw, "mentorApprovals") ?? "처리에 실패했습니다. 잠시 후 다시 시도해 주세요.";
}

// W4(C10): 후보 테이블·컬럼 부재 실측(187 baseline 0) — mentor_profiles 에는 reviewed_at/approved_at/verified_at,
// reviewed_by/approved_by/verified_by, rejected_at/rejected_by, rejection_reason/admin_note/review_note/note 컬럼이
// 전부 없어 프로빙이 항상 실패했다. 프로빙 제거, 현행 관측 동작(상태 컬럼만 갱신) 고정. 검토 시각·조치자·메모의
// 정본 기록처는 admin_action_logs(logAdminAction) — 각 액션이 이미 기록한다. 기능 정본화는 비범위.
function buildApprovePatch(): Record<string, unknown> {
  return { [STATUS_COLUMN]: "approved" };
}

function buildRejectPatch(): Record<string, unknown> {
  return { [STATUS_COLUMN]: "rejected" };
}

async function runMentorProfileUpdate(
  mentorUserId: string,
  statusCol: string,
  patch: Record<string, unknown>
): Promise<{ touched: boolean; errorMsg: string | null }> {
  const pendingList = [...MENTOR_PENDING_STATUS_VALUES_FOR_IN];
  const exec = async (client: SupabaseClient) =>
    client.from(TABLE).update(patch).eq("user_id", mentorUserId).in(statusCol, pendingList).select("user_id");

  const session = await createClient();
  const first = await exec(session);
  if (first.error && !/permission|row-level|rls|denied|policy/i.test(first.error.message)) {
    return { touched: false, errorMsg: first.error.message };
  }
  if (!first.error && first.data && first.data.length > 0) {
    return { touched: true, errorMsg: null };
  }

  try {
    const sr = createServiceRoleClient();
    const second = await exec(sr);
    if (second.error) return { touched: false, errorMsg: second.error.message };
    if (second.data && second.data.length > 0) return { touched: true, errorMsg: null };
    return { touched: false, errorMsg: null };
  } catch {
    if (first.error) return { touched: false, errorMsg: first.error.message };
    return { touched: false, errorMsg: null };
  }
}

export async function approveMentorApplicationAction(formData: FormData) {
  const { user } = await requireRole("admin");
  const mentorUserId = textFromForm(formData.get("mentorUserId"));
  const adminNote = textFromForm(formData.get("adminNote") ?? formData.get("note"));

  if (!mentorUserId) {
    redirect(errUrl(safeActionMsg("신청을 식별할 수 없습니다.")));
  }

  const { touched, errorMsg } = await runMentorProfileUpdate(mentorUserId, STATUS_COLUMN, buildApprovePatch());
  if (errorMsg) {
    redirect(errUrl(safeActionMsg(errorMsg)));
  }
  if (!touched) {
    redirect(errUrl(safeActionMsg("이미 처리되었거나 승인 대기 상태가 아닙니다.")));
  }

  const session = await createClient();
  await logAdminAction(session, {
    adminId: user.id,
    actionType: "mentor_approve",
    targetType: "mentor_profile",
    targetId: mentorUserId,
    detail: { note: adminNote },
  });

  revalidatePath(PATH);
  revalidatePath("/admin/dashboard");
  redirect(okUrl("approve"));
}

export async function rejectMentorApplicationAction(formData: FormData) {
  const { user } = await requireRole("admin");
  const mentorUserId = textFromForm(formData.get("mentorUserId"));
  const reason = textFromForm(formData.get("rejectionReason") ?? formData.get("note"));

  if (!mentorUserId) {
    redirect(errUrl(safeActionMsg("신청을 식별할 수 없습니다.")));
  }

  const { touched, errorMsg } = await runMentorProfileUpdate(mentorUserId, STATUS_COLUMN, buildRejectPatch());
  if (errorMsg) {
    redirect(errUrl(safeActionMsg(errorMsg)));
  }
  if (!touched) {
    redirect(errUrl(safeActionMsg("이미 처리되었거나 승인 대기 상태가 아닙니다.")));
  }

  const session = await createClient();
  await logAdminAction(session, {
    adminId: user.id,
    actionType: "mentor_reject",
    targetType: "mentor_profile",
    targetId: mentorUserId,
    detail: { reason },
  });

  revalidatePath(PATH);
  revalidatePath("/admin/dashboard");
  redirect(okUrl("reject"));
}

/** 추가 서류 요청 — under_review 상태로 표시 */
export async function requestMentorDocumentsAction(formData: FormData) {
  const { user } = await requireRole("admin");
  const mentorUserId = textFromForm(formData.get("mentorUserId"));
  const adminNote = textFromForm(formData.get("adminNote") ?? formData.get("note"));

  if (!mentorUserId) redirect(errUrl(safeActionMsg("신청을 식별할 수 없습니다.")));

  // W4(C10): 메모 컬럼(admin_note/review_note/note) 부재 실측 — 프로빙 제거, 상태만 갱신(메모는 admin_action_logs 에 기록).
  const patch: Record<string, unknown> = { [STATUS_COLUMN]: "under_review" };

  const { touched, errorMsg } = await runMentorProfileUpdate(mentorUserId, STATUS_COLUMN, patch);
  if (errorMsg) redirect(errUrl(safeActionMsg(errorMsg)));
  if (!touched) redirect(errUrl(safeActionMsg("처리할 수 없는 상태입니다.")));

  const session = await createClient();
  await logAdminAction(session, {
    adminId: user.id,
    actionType: "mentor_request_documents",
    targetType: "mentor_profile",
    targetId: mentorUserId,
    detail: { note: adminNote },
  });

  revalidatePath(PATH);
  redirect(okUrl("documents"));
}
