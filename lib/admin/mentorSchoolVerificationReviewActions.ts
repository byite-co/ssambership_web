"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireRole } from "@/lib/auth/routeGuard";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { logAdminAction } from "@/lib/admin/adminActionLog";
import {
  type SchoolTier,
  type VerifiedMajorCategory,
} from "@/lib/mentor/schoolVerificationConstants";
import { loadSchoolClassificationCatalogs } from "@/lib/mentor/schoolClassificationCatalog";
import { mapDataErrorMessage } from "@/lib/utils/mapDataError";
import {
  ADMIN_SERVICE_ROLE_UNAVAILABLE_MESSAGE,
  resolveAdminWriteClient,
} from "@/lib/admin/adminWriteClient";
import {
  APPROVE_MENTOR_SCHOOL_VERIFICATION_RPC,
  buildApproveMentorSchoolVerificationParams,
  mapApproveMentorSchoolVerificationError,
  parseApproveMentorSchoolVerificationResult,
} from "@/lib/admin/mentorSchoolVerificationApproval";

const PATH = "/admin/mentor-approval";
const TABLE = "mentor_school_verifications";
const REVIEWABLE_STATUSES = ["pending", "resubmit_required"] as const;

function textFromForm(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

function errUrl(message: string): string {
  const q = new URLSearchParams();
  q.set("error", message);
  return `${PATH}?${q.toString()}`;
}

function okUrl(kind: "school-approve" | "school-reject" | "school-resubmit"): string {
  return `${PATH}?ok=${encodeURIComponent(kind)}`;
}

/**
 * W4-A: service role 실패 시 일반 세션 클라이언트로 내려가던 폴백을 제거했다(fail-closed).
 * 폴백은 권한 상승은 아니었지만 `SUPABASE_SERVICE_ROLE_KEY` 누락을 조용히 가렸다.
 * 반환이 null 이면 호출부는 처리하지 않고 중단한다.
 */
function writeClientOrNull(): SupabaseClient | null {
  const resolved = resolveAdminWriteClient(createServiceRoleClient);
  return resolved.ok ? (resolved.client as SupabaseClient) : null;
}

async function asMajorCategory(value: string): Promise<VerifiedMajorCategory | null> {
  const supabase = await createClient();
  const catalogs = await loadSchoolClassificationCatalogs(supabase);
  return catalogs.majorCategories.some((category) => category.code === value) ? (value as VerifiedMajorCategory) : null;
}

async function asSchoolTier(value: string): Promise<SchoolTier | null> {
  const supabase = await createClient();
  const catalogs = await loadSchoolClassificationCatalogs(supabase);
  return catalogs.schoolTiers.some((tier) => tier.code === value) ? (value as SchoolTier) : null;
}

function buildSimpleUniversityId(universityName: string): string {
  return universityName
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w가-힣-]+/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function updateReviewableRow(
  admin: SupabaseClient,
  verificationId: string,
  patch: Record<string, unknown>
): Promise<{ row: { id: string; mentor_id: string } | null; error: string | null }> {
  const { data, error } = await admin
    .from(TABLE)
    .update(patch)
    .eq("id", verificationId)
    .in("status", [...REVIEWABLE_STATUSES])
    .select("id, mentor_id")
    .maybeSingle();

  if (error) {
    return { row: null, error: error.message };
  }
  return { row: (data as { id: string; mentor_id: string } | null) ?? null, error: null };
}

async function logSchoolVerificationAction(
  adminId: string,
  actionType: string,
  targetId: string,
  detail: Record<string, unknown>
): Promise<void> {
  const session = await createClient();
  await logAdminAction(session, {
    adminId,
    actionType,
    targetType: "mentor_school_verification",
    targetId,
    detail,
  });
}

export async function approveMentorSchoolVerificationAction(formData: FormData) {
  const { user } = await requireRole("admin");
  const verificationId = textFromForm(formData.get("verificationId"));
  const verifiedUniversityName = textFromForm(formData.get("verifiedUniversityName"));
  const verifiedUniversityIdInput = textFromForm(formData.get("verifiedUniversityId"));
  const verifiedDepartmentName = textFromForm(formData.get("verifiedDepartmentName"));
  const [verifiedMajorCategory, schoolTier] = await Promise.all([
    asMajorCategory(textFromForm(formData.get("verifiedMajorCategory"))),
    asSchoolTier(textFromForm(formData.get("schoolTier"))),
  ]);

  if (!verificationId) {
    redirect(errUrl("학교·전공 인증 요청을 식별할 수 없습니다."));
  }
  if (!verifiedUniversityName || !verifiedDepartmentName || !verifiedMajorCategory || !schoolTier) {
    redirect(errUrl("승인하려면 학교명, 학과명, 전공 계열, 학교군을 모두 입력해야 합니다."));
  }

  const verifiedUniversityId = verifiedUniversityIdInput || buildSimpleUniversityId(verifiedUniversityName);
  if (!verifiedUniversityId) {
    redirect(errUrl("정규화 학교 키를 만들 수 없습니다. 학교명을 확인해 주세요."));
  }

  // 승인은 서버 정본 RPC 한 경로로만 한다(SQL 174).
  // ★ 관리자 세션 클라이언트로 호출한다 — RPC 의 is_admin() 이 호출자 JWT 의 auth.uid() 를
  //   읽으므로 service role 클라이언트로 부르면 정상 관리자도 NOT_ADMIN 이 된다.
  const session = await createClient();
  const reviewedAt = new Date().toISOString();
  const { data, error } = await session.rpc(
    APPROVE_MENTOR_SCHOOL_VERIFICATION_RPC,
    buildApproveMentorSchoolVerificationParams({
      verificationId,
      universityName: verifiedUniversityName,
      universityId: verifiedUniversityId,
      departmentName: verifiedDepartmentName,
      majorCategory: verifiedMajorCategory,
      schoolTier,
    })
  );

  if (error) {
    redirect(errUrl(mapApproveMentorSchoolVerificationError(error.message)));
  }
  const row = parseApproveMentorSchoolVerificationResult(data);
  if (!row) {
    redirect(errUrl(mapApproveMentorSchoolVerificationError(null)));
  }

  await logSchoolVerificationAction(user.id, "mentor_school_verification_approve", row.verificationId, {
    mentorId: row.mentorId,
    supersededCount: row.supersededCount,
    verifiedUniversityName,
    verifiedUniversityId,
    verifiedDepartmentName,
    verifiedMajorCategory,
    schoolTier,
    reviewedAt,
  });

  revalidatePath(PATH);
  revalidatePath("/mentor/verification");
  redirect(okUrl("school-approve"));
}

export async function rejectMentorSchoolVerificationAction(formData: FormData) {
  const { user } = await requireRole("admin");
  const verificationId = textFromForm(formData.get("verificationId"));
  const rejectReason = textFromForm(formData.get("rejectReason"));

  if (!verificationId) {
    redirect(errUrl("학교·전공 인증 요청을 식별할 수 없습니다."));
  }
  if (!rejectReason) {
    redirect(errUrl("반려 사유를 입력해 주세요."));
  }

  const admin = writeClientOrNull();
  if (!admin) {
    redirect(errUrl(ADMIN_SERVICE_ROLE_UNAVAILABLE_MESSAGE));
  }
  const reviewedAt = new Date().toISOString();
  const { row, error } = await updateReviewableRow(admin, verificationId, {
    status: "rejected",
    reviewed_by: user.id,
    reviewed_at: reviewedAt,
    reject_reason: rejectReason,
  });

  if (error) {
    redirect(errUrl(mapDataErrorMessage(error)));
  }
  if (!row) {
    redirect(errUrl("이미 처리되었거나 심사 대기 상태가 아닌 요청입니다."));
  }

  await logSchoolVerificationAction(user.id, "mentor_school_verification_reject", row.id, {
    mentorId: row.mentor_id,
    reason: rejectReason,
    reviewedAt,
  });

  revalidatePath(PATH);
  revalidatePath("/mentor/verification");
  redirect(okUrl("school-reject"));
}

export async function requestMentorSchoolVerificationResubmitAction(formData: FormData) {
  const { user } = await requireRole("admin");
  const verificationId = textFromForm(formData.get("verificationId"));
  const rejectReason = textFromForm(formData.get("rejectReason"));

  if (!verificationId) {
    redirect(errUrl("학교·전공 인증 요청을 식별할 수 없습니다."));
  }
  if (!rejectReason) {
    redirect(errUrl("재제출 요청 사유를 입력해 주세요."));
  }

  const admin = writeClientOrNull();
  if (!admin) {
    redirect(errUrl(ADMIN_SERVICE_ROLE_UNAVAILABLE_MESSAGE));
  }
  const reviewedAt = new Date().toISOString();
  const { row, error } = await updateReviewableRow(admin, verificationId, {
    status: "resubmit_required",
    reviewed_by: user.id,
    reviewed_at: reviewedAt,
    reject_reason: rejectReason,
  });

  if (error) {
    redirect(errUrl(mapDataErrorMessage(error)));
  }
  if (!row) {
    redirect(errUrl("이미 처리되었거나 심사 대기 상태가 아닌 요청입니다."));
  }

  await logSchoolVerificationAction(user.id, "mentor_school_verification_resubmit_required", row.id, {
    mentorId: row.mentor_id,
    reason: rejectReason,
    reviewedAt,
  });

  revalidatePath(PATH);
  revalidatePath("/mentor/verification");
  redirect(okUrl("school-resubmit"));
}
