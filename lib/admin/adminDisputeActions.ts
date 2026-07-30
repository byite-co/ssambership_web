"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireRole } from "@/lib/auth/routeGuard";
import { toAdminDisplayError } from "@/lib/admin/adminDisplayError";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { recordCustomOrderDisputeSplitRpc } from "@/lib/customRequest/customOrderDisputeSplitService";
import { insertAdminDisputeNote } from "@/lib/admin/adminCaseNotes";
import { logAdminAction } from "@/lib/admin/adminActionLog";

const LIST_PATH = "/admin/disputes";

// W4(C10): disputes 단일 정본(004 SQL, 187 baseline 실측) — phantom 후보(order/refund/user_disputes,
// support_tickets) 테이블 프로빙(firstReadableAdminTable)·requireDisputesTable 게이트 제거.
const TABLE = "disputes";

function textFromForm(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

function errUrlDetail(disputeId: string, msg: string) {
  const q = new URLSearchParams();
  q.set("error", msg);
  return `/admin/disputes/${encodeURIComponent(disputeId)}?${q.toString()}`;
}

function okUrl(id: string, kind: string) {
  return `/admin/disputes/${encodeURIComponent(id)}?ok=${encodeURIComponent(kind)}`;
}

function safeMsg(raw: string | null | undefined): string {
  return toAdminDisplayError(raw, "disputes") ?? "처리에 실패했습니다. 잠시 후 다시 시도해 주세요.";
}

async function runDisputeUpdate(
  disputeId: string,
  patch: Record<string, unknown>,
  /** statusIn으로 상태 제한(004 스키마). null이면 상태 조건 없음(메모 전용 등). */
  statusIn: readonly string[] | null
): Promise<{ touched: boolean; errorMsg: string | null }> {
  const session = await createClient();
  const run = (client: SupabaseClient) => {
    let q = client.from(TABLE).update(patch).eq("id", disputeId);
    if (statusIn?.length) {
      q = q.in("status", [...statusIn]);
    }
    return q.select("id");
  };

  const first = await run(session);
  if (first.error && !/permission|row-level|rls|denied|policy/i.test(first.error.message)) {
    return { touched: false, errorMsg: first.error.message };
  }
  if (!first.error && first.data && first.data.length > 0) {
    return { touched: true, errorMsg: null };
  }

  try {
    const sr = createServiceRoleClient();
    const second = await run(sr);
    if (second.error) return { touched: false, errorMsg: second.error.message };
    if (second.data && second.data.length > 0) return { touched: true, errorMsg: null };
    return { touched: false, errorMsg: null };
  } catch {
    if (first.error) return { touched: false, errorMsg: first.error.message };
    return { touched: false, errorMsg: null };
  }
}

// W4(C10): disputes.updated_at 실존(004:93, modified_at 부재) — 컬럼 프로빙 제거, 고정 대입.
function appendTimestampColumns(patch: Record<string, unknown>): void {
  patch.updated_at = new Date().toISOString();
}

/** 검토 중: open · escalated → under_review */
export async function setDisputeUnderReviewAction(formData: FormData) {
  const { user } = await requireRole("admin");
  const disputeId = textFromForm(formData.get("disputeId"));
  if (!disputeId) redirect(`${LIST_PATH}?error=${encodeURIComponent(safeMsg("분쟁을 식별할 수 없습니다."))}`);

  let admin: SupabaseClient;
  try {
    admin = createServiceRoleClient();
  } catch {
    admin = await createClient();
  }

  const patch: Record<string, unknown> = { status: "under_review" };
  appendTimestampColumns(patch);

  const { touched, errorMsg } = await runDisputeUpdate(disputeId, patch, ["open", "escalated"]);
  if (errorMsg) redirect(errUrlDetail(disputeId, safeMsg(errorMsg)));
  if (!touched) redirect(errUrlDetail(disputeId, safeMsg("이미 검토 중이거나 변경할 수 없는 상태입니다.")));

  await logAdminAction(admin, {
    adminId: user.id,
    actionType: "dispute_under_review",
    targetType: "dispute",
    targetId: disputeId,
    detail: {},
  });

  revalidatePath(LIST_PATH);
  revalidatePath("/admin");
  revalidatePath(`/admin/disputes/${disputeId}`);
  redirect(okUrl(disputeId, "reviewing"));
}

/** 해결: 진행 중 → resolved */
export async function resolveDisputeAction(formData: FormData) {
  const { user } = await requireRole("admin");
  const disputeId = textFromForm(formData.get("disputeId"));
  if (!disputeId) redirect(`${LIST_PATH}?error=${encodeURIComponent(safeMsg("분쟁을 식별할 수 없습니다."))}`);

  let admin: SupabaseClient;
  try {
    admin = createServiceRoleClient();
  } catch {
    admin = await createClient();
  }

  // W4(C10): disputes.resolved_at·resolved_by 실존(034 SQL, closed_* 부재) — 컬럼 프로빙 제거.
  const patch: Record<string, unknown> = { status: "resolved" };
  appendTimestampColumns(patch);
  patch.resolved_at = new Date().toISOString();
  patch.resolved_by = user.id;

  const { touched, errorMsg } = await runDisputeUpdate(disputeId, patch, ["open", "under_review", "escalated"]);
  if (errorMsg) redirect(errUrlDetail(disputeId, safeMsg(errorMsg)));
  if (!touched) redirect(errUrlDetail(disputeId, safeMsg("이미 종료되었거나 변경할 수 없는 상태입니다.")));

  await logAdminAction(admin, {
    adminId: user.id,
    actionType: "dispute_resolved",
    targetType: "dispute",
    targetId: disputeId,
    detail: {},
  });

  revalidatePath(LIST_PATH);
  revalidatePath("/admin");
  revalidatePath(`/admin/disputes/${disputeId}`);
  redirect(okUrl(disputeId, "resolved"));
}

/** 종결 dismissed */
export async function dismissDisputeAction(formData: FormData) {
  const { user } = await requireRole("admin");
  const disputeId = textFromForm(formData.get("disputeId"));
  if (!disputeId) redirect(`${LIST_PATH}?error=${encodeURIComponent(safeMsg("분쟁을 식별할 수 없습니다."))}`);

  let admin: SupabaseClient;
  try {
    admin = createServiceRoleClient();
  } catch {
    admin = await createClient();
  }

  // W4(C10): disputes.resolved_at·resolved_by 실존(034 SQL, closed_* 부재) — 컬럼 프로빙 제거.
  const patch: Record<string, unknown> = { status: "dismissed" };
  appendTimestampColumns(patch);
  patch.resolved_at = new Date().toISOString();
  patch.resolved_by = user.id;

  const { touched, errorMsg } = await runDisputeUpdate(disputeId, patch, ["open", "under_review", "escalated"]);
  if (errorMsg) redirect(errUrlDetail(disputeId, safeMsg(errorMsg)));
  if (!touched) redirect(errUrlDetail(disputeId, safeMsg("이미 종료되었거나 변경할 수 없는 상태입니다.")));

  await logAdminAction(admin, {
    adminId: user.id,
    actionType: "dispute_dismissed",
    targetType: "dispute",
    targetId: disputeId,
    detail: {},
  });

  revalidatePath(LIST_PATH);
  revalidatePath("/admin");
  revalidatePath(`/admin/disputes/${disputeId}`);
  redirect(okUrl(disputeId, "dismissed"));
}

/**
 * 운영 메모 저장. 새 관리자 전용 타임라인(admin_case_notes)에 append 한다.
 * 이 액션은 메모만 추가하며 status·환불·정산·주문 상태는 변경하지 않는다.
 */
export async function saveDisputeAdminNoteAction(formData: FormData) {
  const { user } = await requireRole("admin");
  const disputeId = textFromForm(formData.get("disputeId"));
  const note = textFromForm(formData.get("adminNote"));
  if (!disputeId) redirect(`${LIST_PATH}?error=${encodeURIComponent(safeMsg("분쟁을 식별할 수 없습니다."))}`);
  if (!note) redirect(errUrlDetail(disputeId, safeMsg("메모 내용을 입력해 주세요.")));

  let admin: SupabaseClient;
  try {
    admin = createServiceRoleClient();
  } catch {
    admin = await createClient();
  }

  const result = await insertAdminDisputeNote(admin, { disputeId, note, adminId: user.id });
  if (!result.ok) {
    if (result.missing) {
      redirect(errUrlDetail(disputeId, safeMsg("운영 메모 테이블이 아직 적용되지 않았습니다. 084 SQL 적용 후 다시 시도해 주세요.")));
    }
    redirect(errUrlDetail(disputeId, safeMsg(result.error)));
  }

  await logAdminAction(admin, {
    adminId: user.id,
    actionType: "dispute_note_created",
    targetType: "dispute",
    targetId: disputeId,
    detail: { note },
  });

  revalidatePath(LIST_PATH);
  revalidatePath("/admin");
  revalidatePath(`/admin/disputes/${disputeId}`);
  redirect(okUrl(disputeId, "note"));
}
function parseNonNegativeIntWon(raw: string, label: string): number | { error: string } {
  const t = raw.trim();
  if (!t || !/^\d+$/.test(t)) {
    return { error: `${label}은(는) 0 이상의 정수(원)로 입력해 주세요.` };
  }
  const n = Number.parseInt(t, 10);
  if (!Number.isSafeInteger(n) || n < 0) {
    return { error: `${label}이(가) 올바르지 않습니다.` };
  }
  return n;
}

/**
 * 분쟁 예치 분배(4단계-A) — RPC만 호출. UI(폼)는 4단계-B.
 * FormData: disputeId, orderId, mentorGrossWon, studentRefundWon (원, 정수)
 */
export async function applyCustomOrderDisputeSplitAdminAction(formData: FormData) {
  const { user } = await requireRole("admin");
  const disputeId = textFromForm(formData.get("disputeId"));
  const orderId = textFromForm(formData.get("orderId"));
  if (!disputeId) redirect(`${LIST_PATH}?error=${encodeURIComponent(safeMsg("분쟁을 식별할 수 없습니다."))}`);
  if (!orderId) redirect(errUrlDetail(disputeId, safeMsg("주문 ID가 필요합니다.")));

  const mentorParsed = parseNonNegativeIntWon(textFromForm(formData.get("mentorGrossWon")), "멘토 배정 gross");
  if (typeof mentorParsed !== "number") {
    redirect(errUrlDetail(disputeId, safeMsg(mentorParsed.error)));
  }
  const studentParsed = parseNonNegativeIntWon(textFromForm(formData.get("studentRefundWon")), "학생 환불");
  if (typeof studentParsed !== "number") {
    redirect(errUrlDetail(disputeId, safeMsg(studentParsed.error)));
  }

  const split = await recordCustomOrderDisputeSplitRpc({
    orderId,
    mentorGrossWon: mentorParsed,
    studentRefundWon: studentParsed,
    adminId: user.id,
  });
  if (!split.ok) {
    redirect(errUrlDetail(disputeId, safeMsg(split.error)));
  }

  revalidatePath(LIST_PATH);
  revalidatePath("/admin");
  revalidatePath(`/admin/disputes/${disputeId}`);
  revalidatePath(`/custom-request/orders/${orderId}`);
  revalidatePath("/wallet/ledger");
  revalidatePath("/mentor/payouts");
  redirect(okUrl(disputeId, "dispute_split"));
}
