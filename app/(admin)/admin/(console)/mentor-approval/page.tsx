import { AdminMentorApprovalWorkspace } from "@/components/admin/AdminMentorApprovalWorkspace";
import { AdminListToolbar } from "@/components/admin/AdminListToolbar";
import { AdminListPagination } from "@/components/admin/AdminListPagination";
import { createClient } from "@/lib/supabase/server";
import {
  countAdminMentorApprovalsByStatus,
  fetchAdminUsersDisplayByIds,
  loadAdminMentorApprovalsListPaged,
} from "@/lib/admin/adminQueries";
import { mentorProfilesAdminReadClient } from "@/lib/admin/mentorProfilesAdminRead";
import { parseAdminListParams } from "@/lib/admin/adminListParams";
import {
  fetchMentorSchoolVerificationProfilesByIds,
  loadMentorSchoolVerificationReviewRows,
} from "@/lib/admin/mentorSchoolVerificationReview";
import {
  findSchoolTierMappingForSchool,
  loadSchoolClassificationCatalogs,
  loadSchoolTierMappings,
} from "@/lib/mentor/schoolClassificationCatalog";
import { toAdminDisplayError } from "@/lib/admin/adminDisplayError";
import { resolveStudentIdImageSignedUrl } from "@/lib/storage/studentIdImageStorage";

type PageProps = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

export default async function AdminMentorApprovalPage(props: PageProps) {
  const sp = (await props.searchParams) ?? {};
  const filter = typeof sp.filter === "string" ? sp.filter : "all";
  const errParam = sp.error;
  const okParam = sp.ok;
  const flashErr =
    typeof errParam === "string" ? (toAdminDisplayError(errParam, "mentorApprovals") ?? "처리에 실패했습니다.") : null;
  const flashOk =
    okParam === "approve"
      ? "승인했습니다."
      : okParam === "reject"
        ? "반려했습니다."
        : okParam === "documents"
          ? "추가 서류를 요청했습니다."
          : null;

  const schoolFlashOk =
    okParam === "school-approve"
      ? "학교·전공 인증을 승인했습니다."
      : okParam === "school-reject"
        ? "학교·전공 인증을 반려했습니다."
        : okParam === "school-resubmit"
          ? "학교·전공 인증 재제출을 요청했습니다."
          : null;
  const flashOkMessage = schoolFlashOk ?? flashOk;

  const supabase = await createClient();
  const params = parseAdminListParams(sp, { defaultPageSize: 25, defaultStatus: "pending" });
  const [list, byStatus, schoolVerificationList, classificationCatalogs, schoolTierMappings] = await Promise.all([
    loadAdminMentorApprovalsListPaged(supabase, params),
    countAdminMentorApprovalsByStatus(supabase),
    loadMentorSchoolVerificationReviewRows(supabase, 50),
    loadSchoolClassificationCatalogs(supabase),
    loadSchoolTierMappings(supabase),
  ]);
  const MENTOR_APPROVAL_BASE_PATH = "/admin/mentor-approval";
  const statusTabs = [
    { value: "pending", label: "대기", count: byStatus.pending ?? 0 },
    { value: "submitted", label: "제출됨", count: byStatus.submitted ?? 0 },
    { value: "under_review", label: "검토 중", count: byStatus.under_review ?? 0 },
    { value: "approved", label: "승인", count: byStatus.approved ?? 0 },
    { value: "rejected", label: "반려", count: byStatus.rejected ?? 0 },
    { value: "all", label: "전체", count: byStatus.all ?? 0 },
  ];
  // [보안 주석] service_role로 RLS 우회
  // 이 페이지는 (admin)/layout.tsx + (admin)/(console)/layout.tsx
  // 이중 requireRole("admin") 가드로 보호됨.
  // service_role 사용은 관리자 업무상 의도된 것임.
  const readDb = mentorProfilesAdminReadClient(supabase);
  const schoolVerificationMentorIds = schoolVerificationList.rows.map((r) => r.mentor_id).filter(Boolean);
  const userIds = [
    ...list.rows.map((r) => String((r as Record<string, unknown>).user_id ?? "").trim()).filter(Boolean),
    ...schoolVerificationMentorIds,
  ];
  const userMap = await fetchAdminUsersDisplayByIds(readDb, userIds);
  const userById: Record<string, { nickname: string | null; full_name: string | null }> = {};
  userMap.forEach((v, k) => {
    userById[k] = v;
  });
  const schoolVerificationProfileByMentorId = await fetchMentorSchoolVerificationProfilesByIds(
    readDb,
    schoolVerificationMentorIds
  );
  const schoolTierSuggestionByVerificationId: Record<
    string,
    { schoolName: string; schoolTierCode: string; schoolTierLabel: string; note: string | null }
  > = {};
  for (const row of schoolVerificationList.rows) {
    const profile = schoolVerificationProfileByMentorId[row.mentor_id] ?? null;
    const mapping = findSchoolTierMappingForSchool(
      schoolTierMappings.rows,
      row.verified_university_name || profile?.university_name
    );
    if (mapping) {
      schoolTierSuggestionByVerificationId[row.id] = {
        schoolName: mapping.school_name,
        schoolTierCode: mapping.school_tier_code,
        schoolTierLabel: classificationCatalogs.schoolTierLabels[mapping.school_tier_code] ?? mapping.school_tier_code,
        note: mapping.note,
      };
    }
  }

  const studentIdImageSignedUrlByUserId: Record<string, string | null> = {};
  for (const r of list.rows) {
    const uid = String((r as Record<string, unknown>).user_id ?? "").trim();
    if (!uid) continue;
    const stored =
      (typeof (r as Record<string, unknown>).student_id_image_url === "string" &&
        (r as Record<string, unknown>).student_id_image_url) ||
      null;
    studentIdImageSignedUrlByUserId[uid] = await resolveStudentIdImageSignedUrl(readDb, String(stored ?? ""));
  }
  const schoolVerificationSignedUrlById: Record<string, string | null> = {};
  for (const r of schoolVerificationList.rows) {
    schoolVerificationSignedUrlById[r.id] = await resolveStudentIdImageSignedUrl(readDb, r.document_storage_ref);
  }

  return (
    <div className="space-y-4">
      {flashOkMessage ? <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900">{flashOkMessage}</p> : null}
      {flashErr ? <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-900">{flashErr}</p> : null}
      <AdminListToolbar
        basePath={MENTOR_APPROVAL_BASE_PATH}
        params={params}
        searchPlaceholder="멘토 ID/대학·학과/고교/소개로 검색"
        statusTabs={statusTabs}
      />
      <AdminMentorApprovalWorkspace
        rows={list.rows as Record<string, unknown>[]}
        userById={userById}
        studentIdImageSignedUrlByUserId={studentIdImageSignedUrlByUserId}
        schoolVerificationRows={schoolVerificationList.rows}
        schoolVerificationLoadError={schoolVerificationList.error}
        schoolVerificationProfileByMentorId={schoolVerificationProfileByMentorId}
        schoolVerificationSignedUrlById={schoolVerificationSignedUrlById}
        schoolTierOptions={classificationCatalogs.schoolTiers}
        majorCategoryOptions={classificationCatalogs.majorCategories}
        schoolTierSuggestionByVerificationId={schoolTierSuggestionByVerificationId}
        statusFilter={filter}
        statusColumn={list.keyHints.status ?? null}
      />
      <AdminListPagination
        basePath={MENTOR_APPROVAL_BASE_PATH}
        params={params}
        totalCount={list.totalCount}
        rowsOnPage={list.rows.length}
      />
    </div>
  );
}
