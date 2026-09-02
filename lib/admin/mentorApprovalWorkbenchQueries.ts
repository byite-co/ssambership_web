import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { mentorProfilesAdminReadClient } from "@/lib/admin/mentorProfilesAdminRead";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import {
  buildMentorProfileSearchOr,
  buildMentorUserSearchOr,
  MENTOR_APPROVAL_PENDING_TAB_STATUSES,
  MENTOR_APPROVAL_TAB_VALUES,
  MENTOR_SEARCH_USER_ID_LIMIT,
  isMentorApprovalDecidable,
  mentorApprovalTabStatuses,
  normalizeMentorSearchTerm,
  type MentorApprovalTab,
} from "@/lib/admin/mentorApprovalQueue";
import { splitPendingFirstRange } from "@/lib/admin/adminDataTable";
import {
  resolveMentorIdentityReview,
  type MentorIdentityReview,
  type MentorIdentityReviewKind,
  type MentorIdentityRowLite,
} from "@/lib/admin/mentorIdentityReview";
import {
  pickSchoolTierReviewRow,
  resolveSchoolTierReviewState,
  type SchoolTierReviewRowLite,
  type SchoolTierReviewState,
} from "@/lib/admin/mentorSchoolTierReview";
import { MENTOR_DECISION_ACTION_TYPES } from "@/lib/admin/mentorApprovalDecision";
import { describeStudentIdDocument } from "@/lib/admin/mentorApprovalDocuments";
import type { DocumentViewerSource } from "@/lib/admin/documentViewerModel";
import { loadMentorCapUsage, type MentorCapUsage } from "@/lib/subscribe/mentorCapService";
import { kstDayString } from "@/lib/utils/kstTime";

/**
 * 멘토 승인 작업대(PR-2) 서버 조회 정본.
 *
 * - 목록: 서버 검색(이름·이메일 → users, 대학·학과 → mentor_profiles) + 서버 탭(`status` 키 하나) + 페이징.
 *   전체 탭은 대기 행을 항상 위에 두기 위해 두 range 로 이어 붙인다(공용 정본 `adminDataTable.ts` 의 `splitPendingFirstRange`).
 * - 상세: 선택 1건만 조회한다(구 화면은 25행 전부의 서명 URL 을 발급했다).
 * - `identity_verifications` 는 RLS 정책 0개 테이블 → service_role 로만 읽는다. 키가 없으면 "없음" 으로
 *   속이지 않고 `identityError` 로 판정 불가를 드러낸다(fail-closed).
 * - 정원(cap)은 PR-1b 의 DB RPC 결과(`loadMentorCapUsage`)를 그대로 넘긴다 — TS 계산 없음.
 */

export const MENTOR_PROFILE_LIST_COLUMNS = "user_id, university_name, department_name, verification_status, created_at";
export const MENTOR_PROFILE_DETAIL_COLUMNS =
  "user_id, university_name, department_name, teaching_subjects, high_school_name, intro_line, bio, verification_status, student_id_image_url, profile_image_url, created_at, updated_at";
const USER_DISPLAY_COLUMNS = "id, full_name, nickname, email, created_at, identity_verified_at";
const IDENTITY_COLUMNS = "user_id, kind, status, verified_name, birthdate, verified_at, created_at, mobile_no_enc";
const SCHOOL_VERIFICATION_COLUMNS =
  "id, mentor_id, status, school_tier, verified_major_category, verified_university_name, verified_university_id, verified_department_name, document_storage_ref, reviewed_by, reviewed_at, created_at";

export const IDENTITY_READ_UNAVAILABLE_MESSAGE = "본인인증 정보를 조회할 수 없습니다(service_role 설정 확인).";

type Row = Record<string, unknown>;
// .select() 이후의 PostgrestFilterBuilder — `.in/.not/.or/.range/.order` 체인용
type PgQuery = ReturnType<ReturnType<SupabaseClient["from"]>["select"]>;

export type MentorApprovalUserRow = {
  id: string;
  full_name: string | null;
  nickname: string | null;
  email: string | null;
  created_at: string | null;
  identity_verified_at: string | null;
};

export type MentorApprovalProfileRow = {
  user_id: string;
  university_name: string | null;
  department_name: string | null;
  teaching_subjects: string[] | null;
  high_school_name: string | null;
  intro_line: string | null;
  bio: string | null;
  verification_status: string | null;
  student_id_image_url: string | null;
  profile_image_url: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type MentorApprovalQueueItem = {
  mentorUserId: string;
  name: string;
  email: string | null;
  university: string;
  department: string;
  appliedAt: string | null;
  status: string;
  identity: MentorIdentityReviewKind | null;
};

export type MentorApprovalQueueResult = {
  rows: MentorApprovalQueueItem[];
  totalCount: number;
  error: string | null;
  identityError: string | null;
};

export type MentorApprovalTabCounts = Record<MentorApprovalTab, number>;

export type MentorApprovalLastDecision = {
  actionType: string;
  createdAt: string;
  adminName: string | null;
};

export type MentorApprovalDetail = {
  mentorUserId: string;
  profile: MentorApprovalProfileRow;
  user: MentorApprovalUserRow | null;
  displayName: string;
  status: string;
  /** 승인·반려·재제출 액션의 `.in(...)` 조건에 드는 상태인가 */
  decidable: boolean;
  identity: MentorIdentityReview | null;
  identityError: string | null;
  schoolTier: SchoolTierReviewState;
  schoolTierReviewerName: string | null;
  cap: MentorCapUsage;
  /** null = 학생증 미제출 */
  studentIdDocument: DocumentViewerSource | null;
  /** null = 학교 인증 서류 없음(현재 전부) */
  schoolDocument: DocumentViewerSource | null;
  /** 같은 대학에서 오늘(KST) 가입한 멘토 수. 조회 실패 null */
  sameSchoolTodayCount: number | null;
  lastDecision: MentorApprovalLastDecision | null;
};

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function displayNameOf(user: MentorApprovalUserRow | null | undefined, profile?: { university_name?: string | null } | null): string {
  const u = str(user?.full_name) || str(user?.nickname);
  if (u) return u;
  return str(profile?.university_name) || "이름 없음";
}

function isRangeNotSatisfiable(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  return String(error.code ?? "") === "PGRST103" || /range not satisfiable|invalid range/i.test(String(error.message ?? ""));
}

function serviceRoleOrNull(): SupabaseClient | null {
  try {
    return createServiceRoleClient();
  } catch {
    return null;
  }
}

/** KST 오늘 00:00 의 ISO — "당일 가입" 판정·"오늘 처리 건수" 집계 기준 */
export function kstTodayStartIso(now: Date = new Date()): string {
  return `${kstDayString(now)}T00:00:00+09:00`;
}

// ── 목록 ────────────────────────────────────────────────────────────────────

async function searchMentorUserIds(db: SupabaseClient, term: string): Promise<string[]> {
  const { data, error } = await db.from("users").select("id").or(buildMentorUserSearchOr(term)).limit(MENTOR_SEARCH_USER_ID_LIMIT);
  if (error) {
    console.error("[loadMentorApprovalQueue] users 검색 실패:", error.message);
    return [];
  }
  return ((data as { id?: string }[] | null) ?? []).map((r) => str(r.id)).filter(Boolean);
}

type ScopeArgs = {
  /** 포함 상태 집합. null = 필터 없음 */
  statuses: readonly string[] | null;
  /** true 면 statuses 를 **제외**(전체 탭의 "나머지" 부분) */
  negate: boolean;
  term: string;
  userIds: readonly string[];
};

function applyScope(q: PgQuery, scope: ScopeArgs): PgQuery {
  let r = q;
  if (scope.statuses && scope.statuses.length) {
    r = scope.negate
      ? r.not("verification_status", "in", `(${scope.statuses.join(",")})`)
      : r.in("verification_status", [...scope.statuses]);
  }
  if (scope.term) r = r.or(buildMentorProfileSearchOr(scope.term, scope.userIds));
  return r;
}

async function headCount(db: SupabaseClient, scope: ScopeArgs): Promise<{ count: number; error: string | null }> {
  const q = applyScope(db.from("mentor_profiles").select("user_id", { count: "exact", head: true }), scope);
  const { count, error } = await q;
  if (error) return { count: 0, error: error.message };
  return { count: count ?? 0, error: null };
}

async function fetchRange(
  db: SupabaseClient,
  scope: ScopeArgs,
  from: number,
  to: number
): Promise<{ rows: Row[]; count: number; error: string | null }> {
  const q = applyScope(db.from("mentor_profiles").select(MENTOR_PROFILE_LIST_COLUMNS, { count: "exact" }), scope);
  const r = await q.order("created_at", { ascending: false }).range(from, to);
  if (!r.error) return { rows: ((r.data as Row[] | null) ?? []), count: r.count ?? 0, error: null };
  if (isRangeNotSatisfiable(r.error)) {
    const head = await headCount(db, scope);
    return { rows: [], count: head.count, error: head.error };
  }
  return { rows: [], count: 0, error: r.error.message };
}

async function loadIdentityKinds(
  ids: readonly string[],
  nameById: ReadonlyMap<string, string>
): Promise<{ byId: Map<string, MentorIdentityReviewKind>; error: string | null }> {
  const byId = new Map<string, MentorIdentityReviewKind>();
  if (!ids.length) return { byId, error: null };
  const admin = serviceRoleOrNull();
  if (!admin) return { byId, error: IDENTITY_READ_UNAVAILABLE_MESSAGE };
  const { data, error } = await admin
    .from("identity_verifications")
    .select("user_id, kind, status, verified_name, birthdate, verified_at, created_at")
    .in("user_id", [...ids]);
  if (error) {
    console.error("[loadMentorApprovalQueue] identity_verifications 조회 실패:", error.message);
    return { byId, error: IDENTITY_READ_UNAVAILABLE_MESSAGE };
  }
  const grouped = new Map<string, MentorIdentityRowLite[]>();
  for (const raw of (data as (MentorIdentityRowLite & { user_id?: string })[] | null) ?? []) {
    const uid = str(raw.user_id);
    if (!uid) continue;
    grouped.set(uid, [...(grouped.get(uid) ?? []), raw]);
  }
  const now = Date.now();
  for (const id of ids) {
    byId.set(id, resolveMentorIdentityReview(grouped.get(id) ?? [], nameById.get(id) ?? "", now).kind);
  }
  return { byId, error: null };
}

async function loadUsersByIds(db: SupabaseClient, ids: readonly string[]): Promise<Map<string, MentorApprovalUserRow>> {
  const map = new Map<string, MentorApprovalUserRow>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return map;
  const { data, error } = await db.from("users").select(USER_DISPLAY_COLUMNS).in("id", unique);
  if (error) {
    console.error("[mentorApprovalWorkbench] users 조회 실패:", error.message);
    return map;
  }
  for (const row of (data as MentorApprovalUserRow[] | null) ?? []) {
    if (row.id) map.set(row.id, row);
  }
  return map;
}

export async function loadMentorApprovalQueue(
  supabase: SupabaseClient,
  args: { tab: MentorApprovalTab; search: string; page: number; pageSize: number }
): Promise<MentorApprovalQueueResult> {
  const db = mentorProfilesAdminReadClient(supabase);
  const term = normalizeMentorSearchTerm(args.search);
  const userIds = term ? await searchMentorUserIds(db, term) : [];
  const from = Math.max(0, (args.page - 1) * args.pageSize);
  const to = from + args.pageSize - 1;

  let rows: Row[] = [];
  let totalCount = 0;
  let error: string | null = null;

  if (args.tab !== "all") {
    const scope: ScopeArgs = { statuses: mentorApprovalTabStatuses(args.tab), negate: false, term, userIds };
    const r = await fetchRange(db, scope, from, to);
    rows = r.rows;
    totalCount = r.count;
    error = r.error;
  } else {
    // 전체 탭: 대기 행이 항상 위 — 대기 부분과 나머지 부분을 서버에서 두 range 로 이어 붙인다.
    const pendingScope: ScopeArgs = { statuses: MENTOR_APPROVAL_PENDING_TAB_STATUSES, negate: false, term, userIds };
    const restScope: ScopeArgs = { statuses: MENTOR_APPROVAL_PENDING_TAB_STATUSES, negate: true, term, userIds };
    const allScope: ScopeArgs = { statuses: null, negate: false, term, userIds };
    const [pendingHead, allHead] = await Promise.all([headCount(db, pendingScope), headCount(db, allScope)]);
    totalCount = allHead.count;
    error = pendingHead.error ?? allHead.error;
    if (!error) {
      const split = splitPendingFirstRange(pendingHead.count, from, to);
      const [p, rest] = await Promise.all([
        split.pending ? fetchRange(db, pendingScope, split.pending.from, split.pending.to) : Promise.resolve(null),
        split.rest ? fetchRange(db, restScope, split.rest.from, split.rest.to) : Promise.resolve(null),
      ]);
      rows = [...(p?.rows ?? []), ...(rest?.rows ?? [])];
      error = p?.error ?? rest?.error ?? null;
    }
  }

  const ids = rows.map((r) => str(r.user_id)).filter(Boolean);
  const users = await loadUsersByIds(db, ids);
  const nameById = new Map<string, string>();
  for (const id of ids) nameById.set(id, str(users.get(id)?.full_name));
  const identity = await loadIdentityKinds(ids, nameById);

  return {
    rows: rows.map((r) => {
      const id = str(r.user_id);
      const user = users.get(id) ?? null;
      return {
        mentorUserId: id,
        name: displayNameOf(user, { university_name: str(r.university_name) }),
        email: user?.email ?? null,
        university: str(r.university_name),
        department: str(r.department_name),
        appliedAt: typeof r.created_at === "string" ? r.created_at : null,
        status: str(r.verification_status),
        identity: identity.byId.get(id) ?? null,
      };
    }),
    totalCount,
    error,
    identityError: identity.error,
  };
}

/** 탭별 건수(head count 5회, 병렬). 실패한 탭은 0 으로 두고 로그를 남긴다. */
export async function countMentorApprovalTabs(supabase: SupabaseClient): Promise<MentorApprovalTabCounts> {
  const db = mentorProfilesAdminReadClient(supabase);
  const entries = await Promise.all(
    MENTOR_APPROVAL_TAB_VALUES.map(async (tab) => {
      const r = await headCount(db, { statuses: mentorApprovalTabStatuses(tab), negate: false, term: "", userIds: [] });
      if (r.error) console.error(`[countMentorApprovalTabs] ${tab}:`, r.error);
      return [tab, r.count] as const;
    })
  );
  return Object.fromEntries(entries) as MentorApprovalTabCounts;
}

// ── 상세 ────────────────────────────────────────────────────────────────────

async function loadIdentityReview(
  mentorUserId: string,
  registeredName: string
): Promise<{ review: MentorIdentityReview | null; error: string | null }> {
  const admin = serviceRoleOrNull();
  if (!admin) return { review: null, error: IDENTITY_READ_UNAVAILABLE_MESSAGE };
  const { data, error } = await admin.from("identity_verifications").select(IDENTITY_COLUMNS).eq("user_id", mentorUserId);
  if (error) {
    console.error("[loadMentorApprovalDetail] identity_verifications 조회 실패:", error.message);
    return { review: null, error: IDENTITY_READ_UNAVAILABLE_MESSAGE };
  }
  return { review: resolveMentorIdentityReview(((data as MentorIdentityRowLite[] | null) ?? []), registeredName), error: null };
}

async function loadSchoolTierRows(db: SupabaseClient, mentorUserId: string): Promise<SchoolTierReviewRowLite[]> {
  const { data, error } = await db
    .from("mentor_school_verifications")
    .select(SCHOOL_VERIFICATION_COLUMNS)
    .eq("mentor_id", mentorUserId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) {
    console.error("[loadMentorApprovalDetail] mentor_school_verifications 조회 실패:", error.message);
    return [];
  }
  return (data as unknown as SchoolTierReviewRowLite[] | null) ?? [];
}

async function loadLastDecision(db: SupabaseClient, mentorUserId: string): Promise<{ actionType: string; createdAt: string; adminId: string | null } | null> {
  const { data, error } = await db
    .from("admin_action_logs")
    .select("action_type, admin_id, created_at")
    .eq("target_type", "mentor_profile")
    .eq("target_id", mentorUserId)
    .in("action_type", [...MENTOR_DECISION_ACTION_TYPES])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[loadMentorApprovalDetail] admin_action_logs 조회 실패:", error.message);
    return null;
  }
  const row = data as { action_type?: string; admin_id?: string | null; created_at?: string } | null;
  if (!row?.action_type || !row.created_at) return null;
  return { actionType: row.action_type, createdAt: row.created_at, adminId: row.admin_id ?? null };
}

async function countSameSchoolToday(db: SupabaseClient, universityName: string): Promise<number | null> {
  if (!universityName) return null;
  const { count, error } = await db
    .from("mentor_profiles")
    .select("user_id", { count: "exact", head: true })
    .eq("university_name", universityName)
    .gte("created_at", kstTodayStartIso());
  if (error) {
    console.error("[loadMentorApprovalDetail] 당일 동일 대학 집계 실패:", error.message);
    return null;
  }
  return count ?? 0;
}

export async function loadMentorApprovalDetail(supabase: SupabaseClient, mentorUserId: string): Promise<MentorApprovalDetail | null> {
  const db = mentorProfilesAdminReadClient(supabase);
  const id = str(mentorUserId);
  if (!id) return null;

  const { data: profileData, error: profileError } = await db
    .from("mentor_profiles")
    .select(MENTOR_PROFILE_DETAIL_COLUMNS)
    .eq("user_id", id)
    .maybeSingle();
  if (profileError) {
    console.error("[loadMentorApprovalDetail] mentor_profiles 조회 실패:", profileError.message);
    return null;
  }
  const profile = (profileData as unknown as MentorApprovalProfileRow | null) ?? null;
  if (!profile) return null;

  const users = await loadUsersByIds(db, [id]);
  const user = users.get(id) ?? null;
  const registeredName = str(user?.full_name);

  const studentIdRef = str(profile.student_id_image_url);
  const [identity, schoolRows, cap, lastDecision, sameSchoolTodayCount, studentIdDocument] = await Promise.all([
    loadIdentityReview(id, registeredName),
    loadSchoolTierRows(db, id),
    loadMentorCapUsage(id),
    loadLastDecision(db, id),
    countSameSchoolToday(db, str(profile.university_name)),
    studentIdRef ? describeStudentIdDocument(db, studentIdRef) : Promise.resolve(null),
  ]);

  const schoolTier = resolveSchoolTierReviewState(pickSchoolTierReviewRow(schoolRows));
  const schoolDocRef = str(schoolTier.row?.document_storage_ref);
  const lookupIds = [schoolTier.row?.reviewed_by ?? "", lastDecision?.adminId ?? ""].filter(Boolean);
  const [schoolDocument, lookups] = await Promise.all([
    schoolDocRef ? describeStudentIdDocument(db, schoolDocRef) : Promise.resolve(null),
    loadUsersByIds(db, lookupIds),
  ]);

  return {
    mentorUserId: id,
    profile,
    user,
    displayName: displayNameOf(user, profile),
    status: str(profile.verification_status),
    decidable: isMentorApprovalDecidable(profile.verification_status),
    identity: identity.review,
    identityError: identity.error,
    schoolTier,
    schoolTierReviewerName: schoolTier.row?.reviewed_by ? displayNameOf(lookups.get(schoolTier.row.reviewed_by) ?? null) : null,
    cap,
    studentIdDocument,
    schoolDocument,
    sameSchoolTodayCount,
    lastDecision: lastDecision
      ? {
          actionType: lastDecision.actionType,
          createdAt: lastDecision.createdAt,
          adminName: lastDecision.adminId ? displayNameOf(lookups.get(lastDecision.adminId) ?? null) : null,
        }
      : null,
  };
}

/** 오늘(KST) 승인·반려·재제출 처리 건수 — 대기 0건 빈 상태에 함께 보인다. 실패 null. */
export async function countMentorDecisionsToday(supabase: SupabaseClient): Promise<number | null> {
  const db = mentorProfilesAdminReadClient(supabase);
  const { count, error } = await db
    .from("admin_action_logs")
    .select("id", { count: "exact", head: true })
    .eq("target_type", "mentor_profile")
    .in("action_type", [...MENTOR_DECISION_ACTION_TYPES])
    .gte("created_at", kstTodayStartIso());
  if (error) {
    console.error("[countMentorDecisionsToday]", error.message);
    return null;
  }
  return count ?? 0;
}
