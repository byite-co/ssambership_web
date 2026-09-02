import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { mentorProfilesAdminReadClient } from "@/lib/admin/mentorProfilesAdminRead";
import { ADMIN_LIST_SEARCH_USER_ID_LIMIT, buildAdminUsersSearchOr, normalizeAdminListSearchTerm } from "@/lib/admin/adminDataTable";
import {
  ACADEMIC_RECORD_CHANGE_TAB_VALUES,
  academicRecordChangeTabAscending,
  academicRecordChangeTabStatus,
  buildAcademicRecordChangeSearchOr,
  describeAcademicRecordChangeTier,
  isAcademicRecordChangeReviewable,
  type AcademicRecordChangeTab,
  type AcademicRecordChangeTierView,
} from "@/lib/admin/academicRecordChangeConsole";
import { fetchAcademicRecordChangeProfilesByIds, type MentorAcademicRecordChangeReviewProfile } from "@/lib/admin/mentorAcademicRecordChangeReview";
import { describeStudentIdDocument } from "@/lib/admin/mentorApprovalDocuments";
import type { DocumentViewerSource } from "@/lib/admin/documentViewerModel";
import { pickSchoolTierReviewRow, resolveSchoolTierReviewState, type SchoolTierReviewRowLite } from "@/lib/admin/mentorSchoolTierReview";
import { MENTOR_ACADEMIC_RECORD_CHANGE_COLUMNS, MENTOR_ACADEMIC_RECORD_CHANGE_TABLE, type MentorAcademicRecordChangeRow } from "@/lib/mentor/mentorAcademicRecordChange";

/**
 * 학적 변경 요청 화면(PR-5 §2) 서버 조회 — 멘토 승인 작업대(PR-2)의 축소판.
 *
 * - 요청·프로필·users 는 관리자 읽기 클라이언트(`mentorProfilesAdminReadClient` — service_role 우선 · 세션 폴백)로 읽는다.
 *   이관 전 화면과 같은 우회다(그대로 둔다 — RLS 정책 추가는 DB 작업).
 * - 목록: 멘토 이름·이메일 검색(users → mentor_id.in) + 대학명·사유 부분일치 · 탭(`status` 키 하나) · 서버 range.
 * - 상세: 선택 1건만 조회한다(구 화면은 페이지의 모든 행에 서명 URL 을 발급했다). 서류는 `describeStudentIdDocument` 로
 *   PR-2 `DocumentViewer` 소스를 만든다(학적 변경 서류도 `student-id-images` 버킷 아래 `{userId}/academic-record-changes/…` 경로).
 * - 학교 등급은 `mentor_school_verifications` 행에서 **현재 값만** 읽는다(요청 대학의 등급 판정 함수가 코드에 없어 미리보기 생략).
 */

const USER_COLUMNS = "id, full_name, nickname, email";
const SCHOOL_VERIFICATION_COLUMNS =
  "id, mentor_id, status, school_tier, verified_major_category, verified_university_name, verified_university_id, verified_department_name, document_storage_ref, reviewed_by, reviewed_at, created_at";

type PgQuery = ReturnType<ReturnType<SupabaseClient["from"]>["select"]>;
type UserRow = { id?: string; full_name?: string | null; nickname?: string | null; email?: string | null };

export type AcademicRecordChangeQueueItem = {
  id: string;
  mentorId: string;
  mentorName: string;
  currentUniversity: string;
  currentDepartment: string;
  requestedUniversity: string;
  changeReason: string;
  status: string;
  createdAt: string | null;
  hasDocument: boolean;
};

export type AcademicRecordChangeQueueResult = { rows: AcademicRecordChangeQueueItem[]; totalCount: number; error: string | null };
export type AcademicRecordChangeTabCounts = Record<AcademicRecordChangeTab, number>;

export type AcademicRecordChangeDetail = {
  id: string;
  mentorId: string;
  mentorName: string;
  mentorEmail: string | null;
  status: string;
  reviewable: boolean;
  currentUniversity: string;
  currentDepartment: string;
  requestedUniversity: string;
  approvedUniversity: string;
  changeReason: string;
  rejectReason: string;
  createdAt: string | null;
  reviewedAt: string | null;
  reviewerName: string | null;
  tier: AcademicRecordChangeTierView;
  /** null = 제출된 서류 없음 */
  document: DocumentViewerSource | null;
};

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function displayName(user: UserRow | null | undefined, fallbackId: string): string {
  return str(user?.full_name) || str(user?.nickname) || str(user?.email) || (fallbackId ? fallbackId.slice(0, 8) : "이름 없음");
}

function isRangeNotSatisfiable(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  return String(error.code ?? "") === "PGRST103" || /range not satisfiable|invalid range/i.test(String(error.message ?? ""));
}

async function searchMentorIds(db: SupabaseClient, term: string): Promise<string[]> {
  const { data, error } = await db.from("users").select("id").or(buildAdminUsersSearchOr(term)).limit(ADMIN_LIST_SEARCH_USER_ID_LIMIT);
  if (error) {
    console.error("[loadAcademicRecordChangeQueue] users 검색 실패:", error.message);
    return [];
  }
  return ((data as { id?: string }[] | null) ?? []).map((r) => str(r.id)).filter(Boolean);
}

async function loadUsersByIds(db: SupabaseClient, ids: readonly string[]): Promise<Map<string, UserRow>> {
  const map = new Map<string, UserRow>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return map;
  const { data, error } = await db.from("users").select(USER_COLUMNS).in("id", unique);
  if (error) {
    console.error("[academicRecordChange] users 조회 실패:", error.message);
    return map;
  }
  for (const row of (data as UserRow[] | null) ?? []) {
    if (row.id) map.set(row.id, row);
  }
  return map;
}

function applyScope(q: PgQuery, args: { status: string | null; term: string; mentorIds: readonly string[] }): PgQuery {
  let r = q;
  if (args.status) r = r.eq("status", args.status);
  if (args.term) r = r.or(buildAcademicRecordChangeSearchOr(args.term, args.mentorIds));
  return r;
}

export async function loadAcademicRecordChangeQueue(
  supabase: SupabaseClient,
  args: { tab: AcademicRecordChangeTab; search: string; page: number; pageSize: number }
): Promise<AcademicRecordChangeQueueResult> {
  const db = mentorProfilesAdminReadClient(supabase);
  const term = normalizeAdminListSearchTerm(args.search);
  const mentorIds = term ? await searchMentorIds(db, term) : [];
  const from = Math.max(0, (args.page - 1) * args.pageSize);
  const to = from + args.pageSize - 1;
  const scope = { status: academicRecordChangeTabStatus(args.tab), term, mentorIds };

  const r = await applyScope(db.from(MENTOR_ACADEMIC_RECORD_CHANGE_TABLE).select(MENTOR_ACADEMIC_RECORD_CHANGE_COLUMNS, { count: "exact" }), scope)
    .order("created_at", { ascending: academicRecordChangeTabAscending(args.tab) })
    .range(from, to);

  let rows: MentorAcademicRecordChangeRow[] = [];
  let totalCount = 0;
  if (!r.error) {
    rows = (r.data as unknown as MentorAcademicRecordChangeRow[] | null) ?? [];
    totalCount = r.count ?? 0;
  } else if (isRangeNotSatisfiable(r.error)) {
    const head = await applyScope(db.from(MENTOR_ACADEMIC_RECORD_CHANGE_TABLE).select("id", { count: "exact", head: true }), scope);
    if (head.error) return { rows: [], totalCount: 0, error: head.error.message };
    totalCount = head.count ?? 0;
  } else {
    return { rows: [], totalCount: 0, error: r.error.message };
  }

  const ids = rows.map((row) => str(row.mentor_id)).filter(Boolean);
  const [users, profiles] = await Promise.all([loadUsersByIds(db, ids), fetchAcademicRecordChangeProfilesByIds(db, ids)]);

  return {
    rows: rows.map((row) => {
      const mentorId = str(row.mentor_id);
      const profile: MentorAcademicRecordChangeReviewProfile | undefined = profiles[mentorId];
      return {
        id: str(row.id),
        mentorId,
        mentorName: displayName(users.get(mentorId), mentorId),
        currentUniversity: str(profile?.university_name),
        currentDepartment: str(profile?.department_name),
        requestedUniversity: str(row.requested_university_name),
        changeReason: str(row.change_reason),
        status: str(row.status),
        createdAt: typeof row.created_at === "string" ? row.created_at : null,
        hasDocument: Boolean(str(row.document_storage_ref)),
      };
    }),
    totalCount,
    error: null,
  };
}

/** 탭별 건수(head count 5회, 병렬). 실패한 탭은 0 으로 두고 로그를 남긴다. */
export async function countAcademicRecordChangeTabs(supabase: SupabaseClient): Promise<AcademicRecordChangeTabCounts> {
  const db = mentorProfilesAdminReadClient(supabase);
  const entries = await Promise.all(
    ACADEMIC_RECORD_CHANGE_TAB_VALUES.map(async (tab) => {
      const status = academicRecordChangeTabStatus(tab);
      let q = db.from(MENTOR_ACADEMIC_RECORD_CHANGE_TABLE).select("id", { count: "exact", head: true });
      if (status) q = q.eq("status", status);
      const { count, error } = await q;
      if (error) console.error(`[countAcademicRecordChangeTabs] ${tab}:`, error.message);
      return [tab, error ? 0 : (count ?? 0)] as const;
    })
  );
  return Object.fromEntries(entries) as AcademicRecordChangeTabCounts;
}

async function loadSchoolTierRows(db: SupabaseClient, mentorId: string): Promise<SchoolTierReviewRowLite[]> {
  const { data, error } = await db
    .from("mentor_school_verifications")
    .select(SCHOOL_VERIFICATION_COLUMNS)
    .eq("mentor_id", mentorId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) {
    console.error("[loadAcademicRecordChangeDetail] mentor_school_verifications 조회 실패:", error.message);
    return [];
  }
  return (data as unknown as SchoolTierReviewRowLite[] | null) ?? [];
}

export async function loadAcademicRecordChangeDetail(supabase: SupabaseClient, requestId: string): Promise<AcademicRecordChangeDetail | null> {
  const db = mentorProfilesAdminReadClient(supabase);
  const id = str(requestId);
  if (!id) return null;

  const { data, error } = await db.from(MENTOR_ACADEMIC_RECORD_CHANGE_TABLE).select(MENTOR_ACADEMIC_RECORD_CHANGE_COLUMNS).eq("id", id).maybeSingle();
  if (error) {
    console.error("[loadAcademicRecordChangeDetail] 요청 조회 실패:", error.message);
    return null;
  }
  const row = (data as unknown as MentorAcademicRecordChangeRow | null) ?? null;
  if (!row) return null;

  const mentorId = str(row.mentor_id);
  const reviewerId = str(row.reviewed_by);
  const docRef = str(row.document_storage_ref);
  const [users, profiles, tierRows, document] = await Promise.all([
    loadUsersByIds(db, [mentorId, reviewerId].filter(Boolean)),
    fetchAcademicRecordChangeProfilesByIds(db, [mentorId]),
    loadSchoolTierRows(db, mentorId),
    docRef ? describeStudentIdDocument(db, docRef) : Promise.resolve(null),
  ]);
  const profile = profiles[mentorId];
  const mentor = users.get(mentorId) ?? null;

  return {
    id: str(row.id),
    mentorId,
    mentorName: displayName(mentor, mentorId),
    mentorEmail: str(mentor?.email) || null,
    status: str(row.status),
    reviewable: isAcademicRecordChangeReviewable(row.status),
    currentUniversity: str(profile?.university_name),
    currentDepartment: str(profile?.department_name),
    requestedUniversity: str(row.requested_university_name),
    approvedUniversity: str(row.approved_university_name),
    changeReason: str(row.change_reason),
    rejectReason: str(row.reject_reason),
    createdAt: typeof row.created_at === "string" ? row.created_at : null,
    reviewedAt: typeof row.reviewed_at === "string" ? row.reviewed_at : null,
    reviewerName: reviewerId ? displayName(users.get(reviewerId), reviewerId) : null,
    tier: describeAcademicRecordChangeTier(resolveSchoolTierReviewState(pickSchoolTierReviewRow(tierRows))),
    document,
  };
}
