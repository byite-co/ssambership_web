import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { communityComposePath } from "@/lib/community/communityComposeTab";

type Row = Record<string, unknown>;

function fmt(err: PostgrestError | null): string | null {
  return err ? err.message : null;
}

async function firstReadableTable(supabase: SupabaseClient, candidates: readonly string[]): Promise<{ table: string | null; error: string | null }> {
  let last = "no table candidates";
  for (const table of candidates) {
    const { error } = await supabase.from(table).select("*").limit(1);
    if (!error) return { table, error: null };
    last = error.message;
  }
  return { table: null, error: last };
}

async function selectOrdered<T extends Row>(
  run: (orderBy: string | null) => Promise<{ data: T[] | null; error: PostgrestError | null }>
): Promise<{ rows: T[]; error: string | null }> {
  for (const col of ["created_at", "updated_at", "published_at", "id"] as const) {
    const res = await run(col);
    if (!res.error) return { rows: (res.data as T[] | null) ?? [], error: null };
    if (!/column|does not exist|order/i.test(res.error.message)) {
      return { rows: [], error: res.error.message };
    }
  }
  const fb = await run(null);
  return { rows: (fb.data as T[] | null) ?? [], error: fmt(fb.error) };
}

export async function listShortformPosts(
  supabase: SupabaseClient,
  limit: number
): Promise<{ rows: Row[]; table: string | null; error: string | null }> {
  const probe = await firstReadableTable(supabase, ["shortform_posts"] as const);
  if (!probe.table) return { rows: [], table: null, error: probe.error };
  const t = probe.table;
  const res = await selectOrdered<Row>(async (orderBy) => {
    let q = supabase.from(t).select("*");
    if (orderBy) q = q.order(orderBy, { ascending: false });
    return await q.limit(limit);
  });
  return { ...res, table: t, error: res.error };
}

export async function getShortformPost(
  supabase: SupabaseClient,
  id: string
): Promise<{ row: Row | null; table: string | null; error: string | null }> {
  const probe = await firstReadableTable(supabase, ["shortform_posts"] as const);
  if (!probe.table) return { row: null, table: null, error: probe.error };
  const { data, error } = await supabase.from(probe.table).select("*").eq("id", id).maybeSingle();
  if (error) return { row: null, table: probe.table, error: error.message };
  return { row: (data as Row) ?? null, table: probe.table, error: null };
}

export async function listBoardPosts(
  supabase: SupabaseClient,
  limit: number
): Promise<{ rows: Row[]; table: string | null; error: string | null }> {
  const probe = await firstReadableTable(supabase, ["community_posts"] as const);
  if (!probe.table) return { rows: [], table: null, error: probe.error };
  const t = probe.table;
  const res = await selectOrdered<Row>(async (orderBy) => {
    let q = supabase.from(t).select("*");
    if (orderBy) q = q.order(orderBy, { ascending: false });
    return await q.limit(limit);
  });
  return { ...res, table: t, error: res.error };
}

function rowTimestampMs(row: Row): number {
  for (const k of ["created_at", "updated_at", "published_at"] as const) {
    const v = row[k];
    if (typeof v === "string" && v.trim()) {
      const t = new Date(v).getTime();
      if (!Number.isNaN(t)) return t;
    }
  }
  return 0;
}

/** 내 활동: 게시판 글 — author_id 기준(스키마·RLS와 일치) */
export async function loadMyCommunityBoardPosts(
  supabase: SupabaseClient,
  userId: string,
  limit: number
): Promise<{ rows: Row[]; error: string | null }> {
  const probe = await firstReadableTable(supabase, ["community_posts"] as const);
  if (!probe.table) return { rows: [], error: null };
  const t = probe.table;
  const res = await selectOrdered<Row>(async (orderBy) => {
    let q = supabase.from(t).select("*").eq("author_id", userId);
    if (orderBy) q = q.order(orderBy, { ascending: false });
    return await q.limit(limit);
  });
  if (res.error && !/column|does not exist|order|schema cache/i.test(res.error)) {
    return { rows: [], error: res.error };
  }
  return { rows: res.rows, error: null };
}

/** 내 활동: 숏폼 — author_id 우선, 스키마에 따라 user_id 폴백 */
export async function loadMyShortformPosts(
  supabase: SupabaseClient,
  userId: string,
  limit: number
): Promise<{ rows: Row[]; error: string | null }> {
  const probe = await firstReadableTable(supabase, ["shortform_posts"] as const);
  if (!probe.table) return { rows: [], error: null };
  const t = probe.table;
  let res = await selectOrdered<Row>(async (orderBy) => {
    let q = supabase.from(t).select("*").eq("author_id", userId);
    if (orderBy) q = q.order(orderBy, { ascending: false });
    return await q.limit(limit);
  });
  if (res.error && /author_id|column|does not exist|schema cache/i.test(res.error)) {
    res = await selectOrdered<Row>(async (orderBy) => {
      let q = supabase.from(t).select("*").eq("user_id", userId);
      if (orderBy) q = q.order(orderBy, { ascending: false });
      return await q.limit(limit);
    });
  }
  if (res.error && !/column|does not exist|order|schema cache/i.test(res.error)) {
    return { rows: [], error: res.error };
  }
  return { rows: res.rows, error: null };
}

export async function countMyCommunityBoardPosts(supabase: SupabaseClient, userId: string): Promise<number | null> {
  const probe = await firstReadableTable(supabase, ["community_posts"] as const);
  if (!probe.table) return null;
  const t = probe.table;
  const { count, error } = await supabase.from(t).select("*", { count: "exact", head: true }).eq("author_id", userId);
  if (error) return null;
  return typeof count === "number" ? count : null;
}

export async function countMyShortformPosts(supabase: SupabaseClient, userId: string): Promise<number | null> {
  const probe = await firstReadableTable(supabase, ["shortform_posts"] as const);
  if (!probe.table) return null;
  const t = probe.table;
  let { count, error } = await supabase.from(t).select("*", { count: "exact", head: true }).eq("author_id", userId);
  if (error && /author_id|column|does not exist|schema cache/i.test(error.message)) {
    ({ count, error } = await supabase.from(t).select("*", { count: "exact", head: true }).eq("user_id", userId));
  }
  if (error) return null;
  return typeof count === "number" ? count : null;
}

/** 게시판·숏폼 행을 합쳐 최근 순으로 max개 */
export function mergeMeRecentCommunityItems(
  boardRows: Row[],
  shortformRows: Row[],
  max: number
): { kind: "board" | "shortform"; row: Row }[] {
  const items = [
    ...boardRows.map((row) => ({ kind: "board" as const, row })),
    ...shortformRows.map((row) => ({ kind: "shortform" as const, row })),
  ];
  items.sort((a, b) => rowTimestampMs(b.row) - rowTimestampMs(a.row));
  return items.slice(0, max);
}

export async function getBoardPost(
  supabase: SupabaseClient,
  id: string
): Promise<{ row: Row | null; table: string | null; error: string | null }> {
  const probe = await firstReadableTable(supabase, ["community_posts"] as const);
  if (!probe.table) return { row: null, table: null, error: probe.error };
  const { data, error } = await supabase.from(probe.table).select("*").eq("id", id).maybeSingle();
  if (error) return { row: null, table: probe.table, error: error.message };
  return { row: (data as Row) ?? null, table: probe.table, error: null };
}

export function pickTitle(r: Row): string {
  const k = ["title", "headline", "subject"] as const;
  for (const x of k) {
    if (typeof r[x] === "string" && (r[x] as string).trim()) return r[x] as string;
  }
  return "제목 없음";
}

export function pickExcerpt(r: Row): string {
  const k = ["body", "content", "text", "excerpt", "summary"] as const;
  for (const x of k) {
    if (typeof r[x] === "string" && (r[x] as string).trim()) {
      const s = r[x] as string;
      return s.length > 120 ? `${s.slice(0, 120)}…` : s;
    }
  }
  return "";
}

/** 목록 UI용 댓글 수 표기 */
export function pickCommentCountDisplay(r: Row): string {
  if (typeof r.comment_count === "number") return String(r.comment_count);
  if (typeof r.comments_count === "number") return String(r.comments_count);
  return "—";
}

export type CommunityPostType = "board" | "shortform";

/** UI·액션과 맞춘 댓글(내부 id 등 비노출) */
export type CommunityCommentListItem = {
  id: string;
  body: string;
  createdAt: string;
  /** W-blocks(v1): 차단 필터용 — 표시에는 미사용(additive, 스펙 §3) */
  authorId?: string | null;
  authorLabel: string;
  status: string;
};

/**
 * community_comments — 게시 유형 + 글 id 별. 테이블 미배포 시 rows 빈 배열(오류 메시지 없이)
 */
export async function loadCommunityComments(
  supabase: SupabaseClient,
  postType: CommunityPostType,
  postId: string
): Promise<{ rows: CommunityCommentListItem[]; error: string | null }> {
  const { data, error } = await supabase
    .from("community_comments")
    .select("id, body, created_at, author_id, author_label, status")
    .eq("post_type", postType)
    .eq("post_id", postId)
    .eq("status", "visible")
    .order("created_at", { ascending: true });

  if (error) {
    if (/relation|does not exist|schema cache/i.test(error.message)) {
      return { rows: [], error: null };
    }
    return { rows: [], error: "댓글을 불러오지 못했어요. 잠시 후 다시 시도해 주세요." };
  }

  const list = (data as Record<string, unknown>[]) ?? [];
  const rows: CommunityCommentListItem[] = list.map((r) => {
    const created = r.created_at;
    return {
      id: String(r.id ?? ""),
      body: String(r.body ?? ""),
      createdAt: typeof created === "string" ? created : new Date().toISOString(),
      authorId: typeof r.author_id === "string" ? r.author_id : null,
      authorLabel:
        typeof r.author_label === "string" && r.author_label.trim() ? r.author_label.trim() : "쌤버십 회원",
      status: String(r.status ?? "visible"),
    };
  });
  return { rows, error: null };
}

/** 게시글 id — UUID가 아니면 PostgREST 조회 전에 막기 */
const COMMUNITY_POST_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isCommunityPostUuid(id: string): boolean {
  return COMMUNITY_POST_UUID_RE.test(id.trim());
}

/** /community/me 목록·요약용 직렬화 아이템 */
export type CommunityMePostListItem = {
  kind: "board" | "shortform";
  id: string;
  title: string;
  dateLabel: string | null;
  linkHref: string | null;
};

export type CommunityMeDraftItem = {
  kind: "board" | "shortform";
  id: string;
  title: string;
  dateLabel: string | null;
  continueHref: string;
};

function isDraftRow(row: Row): boolean {
  const status = typeof row.status === "string" ? row.status : "published";
  return status === "draft";
}

export function toCommunityMePostListItem(kind: "board" | "shortform", row: Row): CommunityMePostListItem | null {
  if (isDraftRow(row)) return null;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  if (!id) return null;
  const base = kind === "board" ? "/community/board" : "/community/shortform";
  return {
    kind,
    id,
    title: pickTitle(row),
    dateLabel: formatCommunityPostDate(row),
    linkHref: isCommunityPostUuid(id) ? `${base}/${encodeURIComponent(id)}` : null,
  };
}

export function toCommunityMeDraftItem(kind: "board" | "shortform", row: Row): CommunityMeDraftItem | null {
  if (!isDraftRow(row)) return null;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  if (!id || !isCommunityPostUuid(id)) return null;
  return {
    kind,
    id,
    title: pickTitle(row),
    dateLabel: formatCommunityPostDate(row),
    continueHref: communityComposePath(kind, { draftId: id }),
  };
}

export function buildCommunityMeDraftsList(boardRows: Row[], shortformRows: Row[], max: number): CommunityMeDraftItem[] {
  const merged = mergeMeRecentCommunityItems(
    boardRows.filter(isDraftRow),
    shortformRows.filter(isDraftRow),
    max
  );
  const out: CommunityMeDraftItem[] = [];
  for (const { kind, row } of merged) {
    const item = toCommunityMeDraftItem(kind, row);
    if (item) out.push(item);
  }
  return out;
}

export function buildCommunityMePostsList(boardRows: Row[], shortformRows: Row[], max: number): CommunityMePostListItem[] {
  const merged = mergeMeRecentCommunityItems(boardRows, shortformRows, max);
  const out: CommunityMePostListItem[] = [];
  for (const { kind, row } of merged) {
    const item = toCommunityMePostListItem(kind, row);
    if (item) out.push(item);
  }
  return out;
}

/** 기존 행에 썸네일·표지 URL이 있으면 사용(스키마 변경 없음) */
export function pickMediaThumbnailUrl(row: Row): string | null {
  const keys = [
    "thumbnail_url",
    "thumbnailUrl",
    "cover_url",
    "cover_image",
    "image_url",
    "poster_url",
    "video_thumbnail_url",
    "og_image_url",
    "thumb_url",
  ] as const;
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "string" && v.trim().toLowerCase().startsWith("http")) return v.trim();
  }
  return null;
}

export function formatCommunityPostDate(row: Row): string | null {
  for (const k of ["created_at", "published_at", "updated_at"] as const) {
    const v = row[k];
    if (typeof v === "string" && v.trim()) {
      try {
        const d = new Date(v);
        if (!Number.isNaN(d.getTime())) {
          return d.toLocaleDateString("ko-KR", { dateStyle: "medium" });
        }
      } catch {
        /* ignore */
      }
    }
  }
  return null;
}

/** 카드 메타용 짧은 역할 문구 */
export function pickAuthorRoleSummary(row: Row): string | null {
  const r =
    (typeof row.author_role === "string" && row.author_role.trim()) ||
    (typeof row.role === "string" && row.role.trim()) ||
    (typeof row.writer_type === "string" && row.writer_type.trim()) ||
    null;
  if (!r) return null;
  const low = r.toLowerCase();
  if (low === "mentor" || r === "멘토") return "멘토";
  if (low === "student" || r === "학생") return "학생";
  if (low === "admin" || r === "관리자") return "관리자";
  if (low === "user") return "회원";
  return "회원";
}
