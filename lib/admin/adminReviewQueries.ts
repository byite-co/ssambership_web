import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { ADMIN_LIST_SEARCH_USER_ID_LIMIT, buildAdminUsersSearchOr, normalizeAdminListSearchTerm } from "@/lib/admin/adminDataTable";
import { resolveAdminActionType } from "@/lib/admin/adminActionTypeLabels";
import { mentorProfilesAdminReadClient } from "@/lib/admin/mentorProfilesAdminRead";
import {
  REVIEW_ARCHIVE_SOURCES,
  REVIEW_TABLE,
  REVIEW_TAB_VALUES,
  buildReviewSearchOr,
  reviewEffectiveState,
  reviewTabFilter,
  reviewTabIsArchive,
  type ReviewArchiveTable,
  type ReviewEligibility,
  type ReviewState,
  type ReviewTab,
} from "@/lib/admin/reviewConsole";
import { createServiceRoleClient } from "@/lib/supabase/admin";

/**
 * 리뷰 관리(PR-11 §2) 서버 조회 — 목록(상태 탭 · 멘토·작성자 검색 · 신고 건수 · 격리 보관함) · 상세(전문 · 결제 이력 · 신고 이력 · 처리 이력).
 *
 * - `reviews` 는 관리자 읽기 클라이언트(service_role 우선 · 세션 폴백 — 이관 전 `mentorProfilesAdminReadClient` 와 같은 우회)로 읽는다.
 * - 격리·중복 보관함은 service_role 전용 테이블이라 서비스 키가 없으면 빈 목록 + 안내(`archiveError`).
 * - 결제 이력: 작성자→멘토의 `subscriptions` + 성공한 `subscription_billing_events` 건수. 자격 판정은 DB RPC `check_review_eligibility`
 *   (authenticated EXECUTE — 관리자 세션 클라이언트로 호출) 값 그대로 — 웹에서 재구현하지 않는다.
 * - 처리 이력: 행의 `moderated_by/at` + `admin_action_logs`(target_type=review). 쓰기 없음.
 */

const REVIEW_COLUMNS = "id, mentor_id, author_id, rating, body, created_at, updated_at, is_hidden, is_blinded, moderation_state, moderated_at, moderated_by, subscription_count, mentor_reply, mentor_replied_at";
const USER_COLUMNS = "id, full_name, nickname, email";
const REPORT_COLUMNS = "id, reporter_id, target_type, reason, description, status, created_at";
const ARCHIVE_COLUMNS = "id, original_id, reason, payload, archived_at";
const REPORT_ROW_LIMIT = 2000;
const ARCHIVE_ROW_LIMIT = 200;
const DETAIL_LOG_LIMIT = 50;

type Row = Record<string, unknown>;
type PgQuery = ReturnType<ReturnType<SupabaseClient["from"]>["select"]>;

export type ReviewListItem = {
  id: string;
  rating: number | null;
  body: string;
  mentorId: string;
  mentorName: string;
  authorId: string;
  authorName: string;
  reportCount: number;
  createdAt: string | null;
  state: ReviewState;
};

export type ReviewArchiveItem = {
  archiveId: string;
  source: ReviewArchiveTable;
  sourceLabel: string;
  originalId: string | null;
  reason: string;
  rating: number | null;
  body: string;
  mentorId: string | null;
  mentorName: string;
  authorId: string | null;
  authorName: string;
  archivedAt: string | null;
};

export type ReviewListResult = { rows: ReviewListItem[]; totalCount: number; error: string | null };
export type ReviewArchiveResult = { rows: ReviewArchiveItem[]; totalCount: number; error: string | null };
export type ReviewTabCounts = Record<ReviewTab, number>;

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
function strOrNull(v: unknown): string | null {
  const s = str(v);
  return s || null;
}
function numOrNull(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
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

async function searchUserIds(readDb: SupabaseClient, term: string): Promise<string[]> {
  const { data, error } = await readDb.from("users").select("id").or(buildAdminUsersSearchOr(term)).limit(ADMIN_LIST_SEARCH_USER_ID_LIMIT);
  if (error) {
    console.error("[loadReviewList] users 검색 실패:", error.message);
    return [];
  }
  return ((data as { id?: string }[] | null) ?? []).map((r) => str(r.id)).filter(Boolean);
}

export async function loadReviewUserNames(readDb: SupabaseClient, ids: readonly (string | null | undefined)[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = [...new Set(ids.map((v) => str(v)).filter(Boolean))];
  if (!unique.length) return map;
  const { data, error } = await readDb.from("users").select(USER_COLUMNS).in("id", unique);
  if (error) {
    console.error("[loadReviewList] users 조회 실패:", error.message);
    return map;
  }
  for (const row of (data as Row[] | null) ?? []) {
    const id = str(row.id);
    if (!id) continue;
    map.set(id, str(row.full_name) || str(row.nickname) || str(row.email) || id.slice(0, 8));
  }
  return map;
}

async function loadReportCounts(readDb: SupabaseClient, ids: readonly string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return map;
  const { data, error } = await readDb.from("content_reports").select("target_id").in("target_id", unique).limit(REPORT_ROW_LIMIT);
  if (error) {
    console.error("[loadReviewList] content_reports 집계 실패:", error.message);
    return map;
  }
  for (const row of (data as Row[] | null) ?? []) {
    const id = str(row.target_id);
    if (id) map.set(id, (map.get(id) ?? 0) + 1);
  }
  return map;
}

function applyScope(q: PgQuery, args: { tab: ReviewTab; term: string; userIds: readonly string[] }): PgQuery {
  let r = q;
  const filter = reviewTabFilter(args.tab);
  if (filter.isHidden !== null) r = r.eq("is_hidden", filter.isHidden);
  if (filter.isBlinded !== null) r = r.eq("is_blinded", filter.isBlinded);
  if (args.term) r = r.or(buildReviewSearchOr(args.term, args.userIds));
  return r;
}

function toItem(row: Row, names: ReadonlyMap<string, string>, reports: ReadonlyMap<string, number>): ReviewListItem {
  const id = str(row.id);
  const mentorId = str(row.mentor_id);
  const authorId = str(row.author_id);
  return {
    id,
    rating: numOrNull(row.rating),
    body: str(row.body),
    mentorId,
    mentorName: mentorId ? (names.get(mentorId) ?? mentorId.slice(0, 8)) : "—",
    authorId,
    authorName: authorId ? (names.get(authorId) ?? authorId.slice(0, 8)) : "—",
    reportCount: reports.get(id) ?? 0,
    createdAt: strOrNull(row.created_at),
    state: reviewEffectiveState(row),
  };
}

export async function loadReviewList(
  supabase: SupabaseClient,
  args: { tab: ReviewTab; search: string; page: number; pageSize: number }
): Promise<ReviewListResult> {
  const readDb = mentorProfilesAdminReadClient(supabase);
  const term = normalizeAdminListSearchTerm(args.search);
  const userIds = term ? await searchUserIds(readDb, term) : [];
  const from = Math.max(0, (args.page - 1) * args.pageSize);
  const to = from + args.pageSize - 1;
  const scope = { tab: args.tab, term, userIds };

  const r = await applyScope(readDb.from(REVIEW_TABLE).select(REVIEW_COLUMNS, { count: "exact" }), scope)
    .order("created_at", { ascending: false })
    .range(from, to);

  let rows: Row[] = [];
  let totalCount = 0;
  if (!r.error) {
    rows = (r.data as Row[] | null) ?? [];
    totalCount = r.count ?? 0;
  } else if (isRangeNotSatisfiable(r.error)) {
    const head = await applyScope(readDb.from(REVIEW_TABLE).select("id", { count: "exact", head: true }), scope);
    if (head.error) return { rows: [], totalCount: 0, error: head.error.message };
    totalCount = head.count ?? 0;
  } else {
    return { rows: [], totalCount: 0, error: r.error.message };
  }

  const [names, reports] = await Promise.all([
    loadReviewUserNames(readDb, rows.flatMap((row) => [str(row.mentor_id), str(row.author_id)])),
    loadReportCounts(readDb, rows.map((row) => str(row.id))),
  ]);
  return { rows: rows.map((row) => toItem(row, names, reports)), totalCount, error: null };
}

/** 격리 탭 — 두 보관함을 합쳐 최신순(상한 200). service_role 전용이라 서비스 키가 없으면 error. */
export async function loadReviewArchiveList(args: { search: string; page: number; pageSize: number }): Promise<ReviewArchiveResult> {
  const admin = serviceRoleOrNull();
  if (!admin) return { rows: [], totalCount: 0, error: "서비스 키가 없어 격리 보관함을 조회할 수 없습니다." };
  const term = normalizeAdminListSearchTerm(args.search).toLowerCase();

  const results = await Promise.all(
    REVIEW_ARCHIVE_SOURCES.map(async (source) => {
      const { data, error } = await admin.from(source.table).select(ARCHIVE_COLUMNS).order("archived_at", { ascending: false }).limit(ARCHIVE_ROW_LIMIT);
      if (error) {
        console.error(`[loadReviewArchiveList] ${source.table}:`, error.message);
        return { source, rows: [] as Row[], error: error.message };
      }
      return { source, rows: (data as Row[] | null) ?? [], error: null };
    })
  );
  const firstError = results.find((r) => r.error)?.error ?? null;

  const raw = results.flatMap(({ source, rows }) =>
    rows.map((row) => {
      const payload = (row.payload && typeof row.payload === "object" ? row.payload : {}) as Row;
      return {
        archiveId: str(row.id),
        source: source.table,
        sourceLabel: source.label,
        originalId: strOrNull(row.original_id) ?? strOrNull(payload.id),
        reason: str(row.reason),
        rating: numOrNull(payload.rating),
        body: str(payload.body) || str(payload.content),
        mentorId: strOrNull(payload.mentor_id),
        authorId: strOrNull(payload.author_id) ?? strOrNull(payload.student_id),
        archivedAt: strOrNull(row.archived_at),
      };
    })
  );
  const names = await loadReviewUserNames(admin, raw.flatMap((r) => [r.mentorId, r.authorId]));
  const withNames: ReviewArchiveItem[] = raw
    .map((r) => ({
      ...r,
      mentorName: r.mentorId ? (names.get(r.mentorId) ?? r.mentorId.slice(0, 8)) : "—",
      authorName: r.authorId ? (names.get(r.authorId) ?? r.authorId.slice(0, 8)) : "—",
    }))
    .filter((r) => !term || [r.body, r.mentorName, r.authorName, r.originalId ?? ""].some((v) => v.toLowerCase().includes(term)))
    .sort((a, b) => (b.archivedAt ?? "").localeCompare(a.archivedAt ?? ""));

  const from = Math.max(0, (args.page - 1) * args.pageSize);
  return { rows: withNames.slice(from, from + args.pageSize), totalCount: withNames.length, error: firstError };
}

/** 탭별 건수 — reviews head count 4회 + 보관함 2회(service_role 없으면 격리 0). 실패한 탭은 0 · 로그. */
export async function countReviewTabs(supabase: SupabaseClient): Promise<ReviewTabCounts> {
  const readDb = mentorProfilesAdminReadClient(supabase);
  const out = { visible: 0, hidden: 0, blinded: 0, quarantine: 0, all: 0 } as ReviewTabCounts;
  await Promise.all(
    REVIEW_TAB_VALUES.map(async (tab) => {
      if (reviewTabIsArchive(tab)) {
        const admin = serviceRoleOrNull();
        if (!admin) return;
        const counts = await Promise.all(
          REVIEW_ARCHIVE_SOURCES.map(async (source) => {
            const { count, error } = await admin.from(source.table).select("id", { count: "exact", head: true });
            if (error) {
              console.error(`[countReviewTabs] ${source.table}:`, error.message);
              return 0;
            }
            return count ?? 0;
          })
        );
        out.quarantine = counts.reduce((a, b) => a + b, 0);
        return;
      }
      const { count, error } = await applyScope(readDb.from(REVIEW_TABLE).select("id", { count: "exact", head: true }), { tab, term: "", userIds: [] });
      if (error) {
        console.error(`[countReviewTabs] ${tab}:`, error.message);
        return;
      }
      out[tab] = count ?? 0;
    })
  );
  return out;
}

// ── 상세 ──────────────────────────────────────────────────────────────────────

export type ReviewDetailSubscription = { id: string; status: string; planTier: string | null; startedAt: string | null; currentPeriodEnd: string | null };
export type ReviewDetailReport = { id: string; reporterId: string; reporterName: string; reason: string; status: string; createdAt: string | null };
export type ReviewDetailLog = { id: string; actionLabel: string; actionRaw: string; adminName: string; reason: string | null; createdAt: string | null };

export type ReviewDetail = {
  id: string;
  rating: number | null;
  body: string;
  createdAt: string | null;
  updatedAt: string | null;
  mentorId: string;
  mentorName: string;
  authorId: string;
  authorName: string;
  state: ReviewState;
  isHidden: boolean;
  isBlinded: boolean;
  moderationState: string | null;
  moderatedAt: string | null;
  moderatedBy: string | null;
  moderatedByName: string | null;
  subscriptionCount: number | null;
  mentorReply: string | null;
  mentorRepliedAt: string | null;
  payments: { subscriptions: ReviewDetailSubscription[]; succeededBillingCount: number | null; eligibility: ReviewEligibility; error: string | null };
  reports: { rows: ReviewDetailReport[]; error: string | null };
  logs: { rows: ReviewDetailLog[]; error: string | null };
};

async function loadPaymentHistory(readDb: SupabaseClient, session: SupabaseClient, authorId: string, mentorId: string): Promise<ReviewDetail["payments"]> {
  const [subs, billing, eligibility] = await Promise.all([
    readDb.from("subscriptions").select("id, status, plan_tier, started_at, current_period_end, created_at").eq("student_id", authorId).eq("mentor_id", mentorId).order("created_at", { ascending: false }).limit(20),
    readDb.from("subscription_billing_events").select("id", { count: "exact", head: true }).eq("student_id", authorId).eq("mentor_id", mentorId).eq("status", "succeeded"),
    session.rpc("check_review_eligibility", { p_mentor_id: mentorId, p_student_id: authorId }),
  ]);
  const errors = [subs.error?.message, billing.error?.message].filter((m): m is string => Boolean(m));
  if (subs.error) console.error("[loadReviewDetail] subscriptions:", subs.error.message);
  if (billing.error) console.error("[loadReviewDetail] subscription_billing_events:", billing.error.message);
  if (eligibility.error) console.error("[loadReviewDetail] check_review_eligibility:", eligibility.error.message);
  return {
    subscriptions: ((subs.data as Row[] | null) ?? []).map((r) => ({
      id: str(r.id),
      status: str(r.status),
      planTier: strOrNull(r.plan_tier),
      startedAt: strOrNull(r.started_at) ?? strOrNull(r.created_at),
      currentPeriodEnd: strOrNull(r.current_period_end),
    })),
    succeededBillingCount: billing.error ? null : (billing.count ?? 0),
    eligibility: eligibility.error ? "unknown" : eligibility.data === true ? "eligible" : "ineligible",
    error: errors.length ? errors[0] : null,
  };
}

async function loadReviewReports(readDb: SupabaseClient, reviewId: string): Promise<ReviewDetail["reports"]> {
  const { data, error } = await readDb.from("content_reports").select(REPORT_COLUMNS).eq("target_id", reviewId).order("created_at", { ascending: false }).limit(50);
  if (error) {
    console.error("[loadReviewDetail] content_reports:", error.message);
    return { rows: [], error: error.message };
  }
  const rows = (data as Row[] | null) ?? [];
  const names = await loadReviewUserNames(readDb, rows.map((r) => str(r.reporter_id)));
  return {
    rows: rows.map((r) => {
      const reporterId = str(r.reporter_id);
      return {
        id: str(r.id),
        reporterId,
        reporterName: reporterId ? (names.get(reporterId) ?? reporterId.slice(0, 8)) : "—",
        reason: str(r.reason) || str(r.description),
        status: str(r.status),
        createdAt: strOrNull(r.created_at),
      };
    }),
    error: null,
  };
}

async function loadReviewLogs(readDb: SupabaseClient, reviewId: string): Promise<ReviewDetail["logs"]> {
  const { data, error } = await readDb
    .from("admin_action_logs")
    .select("id, admin_id, action_type, detail, created_at")
    .eq("target_type", "review")
    .eq("target_id", reviewId)
    .order("created_at", { ascending: false })
    .limit(DETAIL_LOG_LIMIT);
  if (error) {
    console.error("[loadReviewDetail] admin_action_logs:", error.message);
    return { rows: [], error: error.message };
  }
  const rows = (data as Row[] | null) ?? [];
  const names = await loadReviewUserNames(readDb, rows.map((r) => str(r.admin_id)));
  return {
    rows: rows.map((r) => {
      const adminId = str(r.admin_id);
      const detail = r.detail && typeof r.detail === "object" ? (r.detail as Row) : null;
      const resolved = resolveAdminActionType(str(r.action_type));
      return {
        id: str(r.id),
        actionLabel: resolved.label,
        actionRaw: resolved.raw,
        adminName: adminId ? (names.get(adminId) ?? adminId.slice(0, 8)) : "시스템",
        reason: detail ? strOrNull(detail.reason) : null,
        createdAt: strOrNull(r.created_at),
      };
    }),
    error: null,
  };
}

/** 리뷰 상세 재료 — 행이 없으면 null. `session` 은 자격 RPC 호출용 관리자 세션 클라이언트. */
export async function loadReviewDetail(session: SupabaseClient, reviewId: string): Promise<{ detail: ReviewDetail | null; error: string | null }> {
  const id = str(reviewId);
  if (!id) return { detail: null, error: null };
  const readDb = mentorProfilesAdminReadClient(session);
  const { data, error } = await readDb.from(REVIEW_TABLE).select(REVIEW_COLUMNS).eq("id", id).maybeSingle();
  if (error) return { detail: null, error: error.message };
  const row = data as Row | null;
  if (!row) return { detail: null, error: null };

  const mentorId = str(row.mentor_id);
  const authorId = str(row.author_id);
  const moderatedBy = strOrNull(row.moderated_by);
  const [names, payments, reports, logs] = await Promise.all([
    loadReviewUserNames(readDb, [mentorId, authorId, moderatedBy]),
    mentorId && authorId ? loadPaymentHistory(readDb, session, authorId, mentorId) : Promise.resolve({ subscriptions: [], succeededBillingCount: null, eligibility: "unknown" as ReviewEligibility, error: null }),
    loadReviewReports(readDb, id),
    loadReviewLogs(readDb, id),
  ]);

  return {
    detail: {
      id,
      rating: numOrNull(row.rating),
      body: str(row.body),
      createdAt: strOrNull(row.created_at),
      updatedAt: strOrNull(row.updated_at),
      mentorId,
      mentorName: mentorId ? (names.get(mentorId) ?? mentorId.slice(0, 8)) : "—",
      authorId,
      authorName: authorId ? (names.get(authorId) ?? authorId.slice(0, 8)) : "—",
      state: reviewEffectiveState(row),
      isHidden: row.is_hidden === true,
      isBlinded: row.is_blinded === true,
      moderationState: strOrNull(row.moderation_state),
      moderatedAt: strOrNull(row.moderated_at),
      moderatedBy,
      moderatedByName: moderatedBy ? (names.get(moderatedBy) ?? null) : null,
      subscriptionCount: numOrNull(row.subscription_count),
      mentorReply: strOrNull(row.mentor_reply),
      mentorRepliedAt: strOrNull(row.mentor_replied_at),
      payments,
      reports,
      logs,
    },
    error: null,
  };
}
