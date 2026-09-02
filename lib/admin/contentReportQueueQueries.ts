import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { mentorProfilesAdminReadClient } from "@/lib/admin/mentorProfilesAdminRead";
import { ADMIN_LIST_SEARCH_USER_ID_LIMIT, buildAdminUsersSearchOr, normalizeAdminListSearchTerm } from "@/lib/admin/adminDataTable";
import {
  CONTENT_REPORT_TAB_VALUES,
  buildContentReportSearchOr,
  contentReportElapsed,
  contentReportTabStatus,
  contentReportTargetLabel,
  type ContentReportElapsed,
  type ContentReportTab,
} from "@/lib/admin/contentReportConsole";

/**
 * 콘텐츠 검수 목록(PR-5 §1-1) 서버 조회.
 *
 * - 신고 행은 세션 클라이언트로 읽는다(이관 전과 동일 — content_reports 관리자 SELECT 정책). 신고자 표시명·이름 검색의
 *   `users` 조회만 관리자 읽기 클라이언트(service_role 우선 · 세션 폴백 — `mentorProfilesAdminReadClient`)로 한다.
 *   service_role 우회는 그대로 둔다(RLS 정책 추가는 DB 작업).
 * - 정렬은 모든 탭에서 `created_at asc` — 오래된 신고가 위. 페이징은 서버 `.range`.
 * - 탭 건수는 head count 를 병렬로 센다. 실패한 탭은 0 으로 두고 로그를 남긴다.
 */

const REPORT_COLUMNS = "id, reporter_id, target_type, target_id, reason, description, status, admin_note, resolved_by, resolved_at, created_at";
const USER_COLUMNS = "id, full_name, nickname, email";

type Row = Record<string, unknown>;
type PgQuery = ReturnType<ReturnType<SupabaseClient["from"]>["select"]>;

export type ContentReportQueueItem = {
  id: string;
  targetType: string;
  targetId: string;
  targetLabel: string;
  reporterId: string;
  reporterName: string;
  reason: string;
  status: string;
  createdAt: string | null;
  elapsed: ContentReportElapsed;
};

export type ContentReportQueueResult = { rows: ContentReportQueueItem[]; totalCount: number; error: string | null };
export type ContentReportTabCounts = Record<ContentReportTab, number>;

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function isRangeNotSatisfiable(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  return String(error.code ?? "") === "PGRST103" || /range not satisfiable|invalid range/i.test(String(error.message ?? ""));
}

async function searchReporterIds(readDb: SupabaseClient, term: string): Promise<string[]> {
  const { data, error } = await readDb.from("users").select("id").or(buildAdminUsersSearchOr(term)).limit(ADMIN_LIST_SEARCH_USER_ID_LIMIT);
  if (error) {
    console.error("[loadContentReportQueue] users 검색 실패:", error.message);
    return [];
  }
  return ((data as { id?: string }[] | null) ?? []).map((r) => str(r.id)).filter(Boolean);
}

async function loadReporterNames(readDb: SupabaseClient, ids: readonly string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return map;
  const { data, error } = await readDb.from("users").select(USER_COLUMNS).in("id", unique);
  if (error) {
    console.error("[loadContentReportQueue] users 조회 실패:", error.message);
    return map;
  }
  for (const row of (data as { id?: string; full_name?: string | null; nickname?: string | null; email?: string | null }[] | null) ?? []) {
    const id = str(row.id);
    if (!id) continue;
    map.set(id, str(row.full_name) || str(row.nickname) || str(row.email) || id.slice(0, 8));
  }
  return map;
}

function applyScope(q: PgQuery, args: { status: string | null; term: string; reporterIds: readonly string[] }): PgQuery {
  let r = q;
  if (args.status) r = r.eq("status", args.status);
  if (args.term) r = r.or(buildContentReportSearchOr(args.term, args.reporterIds));
  return r;
}

export async function loadContentReportQueue(
  supabase: SupabaseClient,
  args: { tab: ContentReportTab; search: string; page: number; pageSize: number }
): Promise<ContentReportQueueResult> {
  const readDb = mentorProfilesAdminReadClient(supabase);
  const term = normalizeAdminListSearchTerm(args.search);
  const reporterIds = term ? await searchReporterIds(readDb, term) : [];
  const from = Math.max(0, (args.page - 1) * args.pageSize);
  const to = from + args.pageSize - 1;
  const scope = { status: contentReportTabStatus(args.tab), term, reporterIds };

  const r = await applyScope(supabase.from("content_reports").select(REPORT_COLUMNS, { count: "exact" }), scope)
    .order("created_at", { ascending: true })
    .range(from, to);

  let rows: Row[] = [];
  let totalCount = 0;
  if (!r.error) {
    rows = (r.data as Row[] | null) ?? [];
    totalCount = r.count ?? 0;
  } else if (isRangeNotSatisfiable(r.error)) {
    const head = await applyScope(supabase.from("content_reports").select("id", { count: "exact", head: true }), scope);
    if (head.error) return { rows: [], totalCount: 0, error: head.error.message };
    totalCount = head.count ?? 0;
  } else {
    return { rows: [], totalCount: 0, error: r.error.message };
  }

  const reporterIdsOnPage = rows.map((row) => str(row.reporter_id)).filter(Boolean);
  const names = await loadReporterNames(readDb, reporterIdsOnPage);
  const now = Date.now();

  return {
    rows: rows.map((row) => {
      const reporterId = str(row.reporter_id);
      const status = str(row.status);
      const createdAt = typeof row.created_at === "string" ? row.created_at : null;
      return {
        id: str(row.id),
        targetType: str(row.target_type),
        targetId: str(row.target_id),
        targetLabel: contentReportTargetLabel(str(row.target_type)),
        reporterId,
        reporterName: reporterId ? (names.get(reporterId) ?? reporterId.slice(0, 8)) : "—",
        reason: str(row.reason) || str(row.description),
        status,
        createdAt,
        elapsed: contentReportElapsed(createdAt, status, now),
      };
    }),
    totalCount,
    error: null,
  };
}

/** 탭별 건수(head count 7회, 병렬). 실패한 탭은 0 으로 두고 로그를 남긴다. */
export async function countContentReportTabs(supabase: SupabaseClient): Promise<ContentReportTabCounts> {
  const entries = await Promise.all(
    CONTENT_REPORT_TAB_VALUES.map(async (tab) => {
      const status = contentReportTabStatus(tab);
      let q = supabase.from("content_reports").select("id", { count: "exact", head: true });
      if (status) q = q.eq("status", status);
      const { count, error } = await q;
      if (error) console.error(`[countContentReportTabs] ${tab}:`, error.message);
      return [tab, error ? 0 : (count ?? 0)] as const;
    })
  );
  return Object.fromEntries(entries) as ContentReportTabCounts;
}
