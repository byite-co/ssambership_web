import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { ADMIN_LIST_SEARCH_USER_ID_LIMIT, buildAdminUsersSearchOr, normalizeAdminListSearchTerm } from "@/lib/admin/adminDataTable";
import {
  COMMUNITY_CONTENT_TABLES,
  COMMUNITY_CONTENT_TAB_VALUES,
  buildCommunityContentSearchOr,
  communityContentDeletedBy,
  communityContentEffectiveStatus,
  communityContentSummaryText,
  communityContentTabFilter,
  type CommunityContentDeletedBy,
  type CommunityContentStatus,
  type CommunityContentTab,
  type CommunityContentType,
} from "@/lib/admin/communityContentConsole";
import { mentorProfilesAdminReadClient } from "@/lib/admin/mentorProfilesAdminRead";

/**
 * 커뮤니티 관리 목록(PR-11 §1-1) 서버 조회 — 종류(글·숏폼·댓글)별 한 테이블 · 상태 탭 · 검색(제목·본문·작성자) · 신고 건수.
 *
 * - 콘텐츠 행은 관리자 읽기 클라이언트(service_role 우선 · 세션 폴백 — `mentorProfilesAdminReadClient`)로 읽는다(이관 전과 같은 우회 · RLS 정책 추가는 DB 작업).
 * - 삭제됨 탭 = `deleted_at IS NOT NULL` · 게시·숨김 탭은 `deleted_at IS NULL` 을 함께 건다 — 글·숏폼·댓글 전부(DB-2 SQL 194 소프트 삭제 · PR-W2).
 * - `deleted_by` 도 읽어 누가 지웠는지(`작성자 삭제` / `관리자 삭제`)를 행에 싣는다(PR-W3 · DB-3 SQL 196 `soft_delete_own_content` — 판정은 `communityContentDeletedBy`).
 *   관리자 읽기라 삭제 행도 읽히므로 탭 필터가 `deleted_at` 판정을 반드시 건다(소스 트립와이어: communitySoftDeleteReadPaths.contract.test).
 * - 신고 건수는 `content_reports.target_id` 를 페이지의 id 집합으로 한 번에 센다(대상 유형 무관 — target_id 는 uuid 라 유일).
 * - 정렬은 `created_at desc`(최신 위). 페이징은 서버 `.range`.
 */

const POST_COLUMNS = "id, author_id, author_label, author_role, title, body, category, status, deleted_at, created_at, updated_at, deleted_by";
const SHORTFORM_COLUMNS = "id, author_id, creator_id, author_label, author_role, title, description, category, status, deleted_at, created_at, updated_at, deleted_by";
const COMMENT_COLUMNS = "id, author_id, author_label, post_type, post_id, body, status, deleted_at, created_at, updated_at, deleted_by";
const USER_COLUMNS = "id, full_name, nickname, email";
/** 신고 건수 집계 행 상한 — 페이지 25행 × 신고 다수. */
const REPORT_ROW_LIMIT = 2000;

type Row = Record<string, unknown>;
type PgQuery = ReturnType<ReturnType<SupabaseClient["from"]>["select"]>;

export type CommunityContentListItem = {
  id: string;
  type: CommunityContentType;
  summary: string;
  authorId: string;
  authorName: string;
  /** 행의 `author_label`(작성 당시 표시명) — 계정 표시명과 다르면 함께 보인다 */
  authorLabel: string | null;
  status: CommunityContentStatus;
  rawStatus: string;
  deletedAt: string | null;
  /** 삭제 주체 — 작성자 본인(RPC) / 관리자(콘솔) / 기록 없음(null) */
  deletedBy: CommunityContentDeletedBy | null;
  reportCount: number;
  createdAt: string | null;
  /** 댓글만 — 소속 글 */
  postType: string | null;
  postId: string | null;
};

export type CommunityContentListResult = { rows: CommunityContentListItem[]; totalCount: number; error: string | null };
export type CommunityContentTabCounts = Record<CommunityContentTab, number>;

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
function strOrNull(v: unknown): string | null {
  const s = str(v);
  return s || null;
}

function columnsFor(type: CommunityContentType): string {
  if (type === "posts") return POST_COLUMNS;
  if (type === "shortforms") return SHORTFORM_COLUMNS;
  return COMMENT_COLUMNS;
}

function isRangeNotSatisfiable(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  return String(error.code ?? "") === "PGRST103" || /range not satisfiable|invalid range/i.test(String(error.message ?? ""));
}

async function searchAuthorIds(readDb: SupabaseClient, term: string): Promise<string[]> {
  const { data, error } = await readDb.from("users").select("id").or(buildAdminUsersSearchOr(term)).limit(ADMIN_LIST_SEARCH_USER_ID_LIMIT);
  if (error) {
    console.error("[loadCommunityContentList] users 검색 실패:", error.message);
    return [];
  }
  return ((data as { id?: string }[] | null) ?? []).map((r) => str(r.id)).filter(Boolean);
}

async function loadAuthorNames(readDb: SupabaseClient, ids: readonly string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return map;
  const { data, error } = await readDb.from("users").select(USER_COLUMNS).in("id", unique);
  if (error) {
    console.error("[loadCommunityContentList] users 조회 실패:", error.message);
    return map;
  }
  for (const row of (data as Row[] | null) ?? []) {
    const id = str(row.id);
    if (!id) continue;
    map.set(id, str(row.full_name) || str(row.nickname) || str(row.email) || id.slice(0, 8));
  }
  return map;
}

/** 페이지 id 집합의 신고 건수 — 실패하면 빈 맵(건수 0 · 로그). */
async function loadReportCounts(readDb: SupabaseClient, ids: readonly string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return map;
  const { data, error } = await readDb.from("content_reports").select("target_id").in("target_id", unique).limit(REPORT_ROW_LIMIT);
  if (error) {
    console.error("[loadCommunityContentList] content_reports 집계 실패:", error.message);
    return map;
  }
  for (const row of (data as Row[] | null) ?? []) {
    const id = str(row.target_id);
    if (id) map.set(id, (map.get(id) ?? 0) + 1);
  }
  return map;
}

function applyScope(q: PgQuery, type: CommunityContentType, args: { tab: CommunityContentTab; term: string; authorIds: readonly string[] }): PgQuery {
  let r = q;
  const filter = communityContentTabFilter(type, args.tab);
  if (filter.status) r = r.eq("status", filter.status);
  if (filter.deleted === "only") r = r.not("deleted_at", "is", null);
  else if (filter.deleted === "exclude") r = r.is("deleted_at", null);
  if (args.term) r = r.or(buildCommunityContentSearchOr(type, args.term, args.authorIds));
  return r;
}

function toItem(type: CommunityContentType, row: Row, names: ReadonlyMap<string, string>, reports: ReadonlyMap<string, number>): CommunityContentListItem {
  const id = str(row.id);
  const authorId = str(row.author_id);
  const deletedAt = strOrNull(row.deleted_at);
  const authorLabel = strOrNull(row.author_label);
  return {
    id,
    type,
    summary: communityContentSummaryText({ title: row.title, body: row.body, content: row.content, description: row.description }),
    authorId,
    authorName: authorId ? (names.get(authorId) ?? authorLabel ?? authorId.slice(0, 8)) : (authorLabel ?? "—"),
    authorLabel,
    status: communityContentEffectiveStatus(type, row.status, deletedAt),
    rawStatus: str(row.status),
    deletedAt,
    deletedBy: communityContentDeletedBy({ deletedAt, deletedBy: row.deleted_by, authorId, creatorId: type === "shortforms" ? row.creator_id : null }),
    reportCount: reports.get(id) ?? 0,
    createdAt: strOrNull(row.created_at),
    postType: type === "comments" ? strOrNull(row.post_type) : null,
    postId: type === "comments" ? strOrNull(row.post_id) : null,
  };
}

export async function loadCommunityContentList(
  supabase: SupabaseClient,
  args: { type: CommunityContentType; tab: CommunityContentTab; search: string; page: number; pageSize: number }
): Promise<CommunityContentListResult> {
  const readDb = mentorProfilesAdminReadClient(supabase);
  const table = COMMUNITY_CONTENT_TABLES[args.type];
  const term = normalizeAdminListSearchTerm(args.search);
  const authorIds = term ? await searchAuthorIds(readDb, term) : [];
  const from = Math.max(0, (args.page - 1) * args.pageSize);
  const to = from + args.pageSize - 1;
  const scope = { tab: args.tab, term, authorIds };

  const r = await applyScope(readDb.from(table).select(columnsFor(args.type), { count: "exact" }), args.type, scope)
    .order("created_at", { ascending: false })
    .range(from, to);

  let rows: Row[] = [];
  let totalCount = 0;
  if (!r.error) {
    rows = (r.data as Row[] | null) ?? [];
    totalCount = r.count ?? 0;
  } else if (isRangeNotSatisfiable(r.error)) {
    const head = await applyScope(readDb.from(table).select("id", { count: "exact", head: true }), args.type, scope);
    if (head.error) return { rows: [], totalCount: 0, error: head.error.message };
    totalCount = head.count ?? 0;
  } else {
    return { rows: [], totalCount: 0, error: r.error.message };
  }

  const [names, reports] = await Promise.all([
    loadAuthorNames(readDb, rows.map((row) => str(row.author_id))),
    loadReportCounts(readDb, rows.map((row) => str(row.id))),
  ]);
  return { rows: rows.map((row) => toItem(args.type, row, names, reports)), totalCount, error: null };
}

/** 종류 하나의 탭별 건수(head count 4회, 병렬). 실패한 탭은 0 으로 두고 로그를 남긴다. */
export async function countCommunityContentTabs(supabase: SupabaseClient, type: CommunityContentType): Promise<CommunityContentTabCounts> {
  const readDb = mentorProfilesAdminReadClient(supabase);
  const table = COMMUNITY_CONTENT_TABLES[type];
  const out = { published: 0, hidden: 0, deleted: 0, all: 0 } as CommunityContentTabCounts;
  await Promise.all(
    COMMUNITY_CONTENT_TAB_VALUES.map(async (tab) => {
      const { count, error } = await applyScope(readDb.from(table).select("id", { count: "exact", head: true }), type, { tab, term: "", authorIds: [] });
      if (error) {
        console.error(`[countCommunityContentTabs] ${table}.${tab}:`, error.message);
        return;
      }
      out[tab] = count ?? 0;
    })
  );
  return out;
}

/** 종류 탭 건수 — 종류별 전체(head count 3회, 병렬). */
export async function countCommunityContentTypes(supabase: SupabaseClient): Promise<Record<CommunityContentType, number>> {
  const readDb = mentorProfilesAdminReadClient(supabase);
  const out: Record<CommunityContentType, number> = { posts: 0, shortforms: 0, comments: 0 };
  await Promise.all(
    (Object.keys(COMMUNITY_CONTENT_TABLES) as CommunityContentType[]).map(async (type) => {
      const { count, error } = await readDb.from(COMMUNITY_CONTENT_TABLES[type]).select("id", { count: "exact", head: true });
      if (error) {
        console.error(`[countCommunityContentTypes] ${type}:`, error.message);
        return;
      }
      out[type] = count ?? 0;
    })
  );
  return out;
}
