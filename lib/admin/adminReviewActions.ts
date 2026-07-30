"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireRole } from "@/lib/auth/routeGuard";
import { toAdminDisplayError } from "@/lib/admin/adminDisplayError";
import { logAdminAction } from "@/lib/admin/adminActionLog";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  probeAdminReviewAuditColumnNames,
  probeAdminReviewModerationPlan,
  type AdminReviewAuditColumnNames,
} from "@/lib/admin/adminQueries";
import type { AdminReviewModerationPlan } from "@/lib/admin/reviewLabels";

const PATH = "/admin/reviews";

// W4(C10): 리뷰 정본 테이블은 public.reviews 뿐(mentor_reviews/mentor_review — 187 baseline 부재).
// 구 REVIEW_TABLE_CANDIDATES 프로빙(firstReadableAdminTable) 제거.
const REVIEW_TABLE = "reviews" as const;

const ACTION_SET = new Set(["hide", "restore", "blind", "review"]);

function textFromForm(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

function errUrl(msg: string) {
  const q = new URLSearchParams();
  q.set("error", msg);
  return `${PATH}?${q.toString()}`;
}

function okUrl(kind: string) {
  return `${PATH}?ok=${encodeURIComponent(kind)}`;
}

function safeMsg(raw: string | null | undefined): string {
  return toAdminDisplayError(raw, "reviews") ?? "처리에 실패했습니다. 잠시 후 다시 시도해 주세요.";
}


/** 숨김 의미: boolean_true 컬럼이 true이거나, visible 반전 컬럼이 false */
function applyHiddenSemantic(patch: Record<string, unknown>, plan: AdminReviewModerationPlan, hidden: boolean): void {
  if (!plan.hide) return;
  if (plan.hide.mode === "boolean_true") patch[plan.hide.column] = hidden;
  else patch[plan.hide.column] = !hidden;
}

function applyModerationAuditFields(
  patch: Record<string, unknown>,
  audit: AdminReviewAuditColumnNames,
  adminUserId: string
): void {
  const now = new Date().toISOString();
  if (audit.moderatedAt) patch[audit.moderatedAt] = now;
  if (audit.moderatedBy) patch[audit.moderatedBy] = adminUserId;
}

function setModerationState(patch: Record<string, unknown>, audit: AdminReviewAuditColumnNames, value: string): void {
  if (audit.moderationState) patch[audit.moderationState] = value;
}

async function runReviewUpdate(
  table: string,
  reviewId: string,
  patch: Record<string, unknown>
): Promise<{ touched: boolean; errorMsg: string | null }> {
  const session = await createClient();
  const run = (client: SupabaseClient) => client.from(table).update(patch).eq("id", reviewId).select("id");

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

export async function moderateAdminReviewAction(formData: FormData) {
  const { user } = await requireRole("admin");
  const adminUserId = user.id;
  const reviewId = textFromForm(formData.get("reviewId"));
  const action = textFromForm(formData.get("action")).toLowerCase();

  if (!reviewId) {
    redirect(errUrl(safeMsg("리뷰를 식별할 수 없습니다.")));
  }
  if (!ACTION_SET.has(action)) {
    redirect(errUrl(safeMsg("허용되지 않은 조치입니다.")));
  }

  let admin: SupabaseClient;
  try {
    admin = createServiceRoleClient();
  } catch {
    admin = await createClient();
  }

  const table = REVIEW_TABLE;

  const plan = await probeAdminReviewModerationPlan(admin, table);
  const audit = await probeAdminReviewAuditColumnNames(admin, table);
  const patch: Record<string, unknown> = {};

  if (action === "hide") {
    if (!plan.hide) {
      redirect(errUrl(safeMsg("숨김 처리에 필요한 항목이 스키마에 없습니다.")));
    }
    applyHiddenSemantic(patch, plan, true);
    if (plan.blind) patch[plan.blind.column] = false;
    setModerationState(patch, audit, "hidden");
    applyModerationAuditFields(patch, audit, adminUserId);
  } else if (action === "restore") {
    if (!plan.hide && !plan.blind) {
      redirect(errUrl(safeMsg("복원에 필요한 항목이 스키마에 없습니다.")));
    }
    if (plan.blind) patch[plan.blind.column] = false;
    applyHiddenSemantic(patch, plan, false);
    setModerationState(patch, audit, "visible");
    applyModerationAuditFields(patch, audit, adminUserId);
  } else if (action === "blind") {
    if (!plan.blind) {
      redirect(errUrl(safeMsg("블라인드 처리에 필요한 항목이 스키마에 없습니다.")));
    }
    patch[plan.blind.column] = true;
    applyHiddenSemantic(patch, plan, false);
    setModerationState(patch, audit, "blinded");
    applyModerationAuditFields(patch, audit, adminUserId);
  } else if (action === "review") {
    if (!plan.reviewDone) {
      redirect(errUrl(safeMsg("검토 완료 표시에 필요한 항목이 스키마에 없습니다.")));
    }
    if (plan.reviewDone.kind === "timestamp") {
      patch[plan.reviewDone.column] = new Date().toISOString();
    } else {
      patch[plan.reviewDone.column] = "reviewed";
    }
    applyModerationAuditFields(patch, audit, adminUserId);
  }

  const { touched, errorMsg } = await runReviewUpdate(table, reviewId, patch);
  if (errorMsg) {
    redirect(errUrl(safeMsg(errorMsg)));
  }
  if (!touched) {
    redirect(errUrl(safeMsg("대상 리뷰를 찾지 못했거나 이미 동일한 상태입니다.")));
  }

  const session = await createClient();
  await logAdminAction(session, {
    adminId: adminUserId,
    actionType: `review_${action}`,
    targetType: "review",
    targetId: reviewId,
    detail: { table },
  });

  revalidatePath(PATH);
  revalidatePath("/admin");
  redirect(okUrl(action === "review" ? "review" : action));
}
