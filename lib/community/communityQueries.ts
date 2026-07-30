import type { SupabaseClient } from "@supabase/supabase-js";
import { communityComposePath } from "@/lib/community/communityComposeTab";
import {
  authorModerationNotice,
  communityRowAuthorId,
  type AuthorModerationNotice,
} from "@/lib/community/communityModerationVisibility";
import { API_WEB_V1_SCHEMA } from "@/lib/apiWebV1/rpc";

type Row = Record<string, unknown>;

/**
 * S2-2 전환 W1(C1): 게시판 글 읽기는 V1 `api_web_v1.community_posts_v1` 을 쓴다
 * (계약 §6 V1 · §17 #6). 노출 조건(`deleted_at IS NULL` AND (`published` OR 본인 글))
 * 은 view 소유 — 테이블 프로빙·정렬 폴백 없이 정본 `created_at` 로 정렬한다.
 * 숏폼(`shortform_posts`) 경로는 V1 대상이 아니다(직접 테이블 조회 유지, W4(C10) 정본화).
 */
function boardPostsView(supabase: SupabaseClient) {
  return supabase.schema(API_WEB_V1_SCHEMA).from("community_posts_v1");
}

// W4(C10): 테이블 프로빙 헬퍼·정렬 컬럼 재시도 헬퍼 삭제 —
// 숏폼 정본은 shortform_posts(author_id, created_at) 단일 테이블(187 baseline 실측)이라
// 후보 순회가 불필요하다. getShortformPost 는 호출부 0곳(레포 전역 grep)이라 함께 삭제
// (숏폼 상세 정본 경로는 app/(public)/community/shortform/[id]/page.tsx 가 자체 조회).

export async function listShortformPosts(
  supabase: SupabaseClient,
  limit: number
): Promise<{ rows: Row[]; table: string | null; error: string | null }> {
  // W4(C10): shortform_posts.created_at DESC 고정(187 baseline 실측) — 프로빙·정렬 폴백 제거, 오류는 그대로 반환.
  const { data, error } = await supabase
    .from("shortform_posts")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return { rows: [], table: "shortform_posts", error: error.message };
  return { rows: (data as Row[]) ?? [], table: "shortform_posts", error: null };
}

export async function listBoardPosts(
  supabase: SupabaseClient,
  limit: number
): Promise<{ rows: Row[]; table: string | null; error: string | null }> {
  const { data, error } = await boardPostsView(supabase)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return { rows: [], table: "api_web_v1.community_posts_v1", error: error.message };
  return { rows: (data as Row[]) ?? [], table: "api_web_v1.community_posts_v1", error: null };
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
  const { data, error } = await boardPostsView(supabase)
    .select("*")
    .eq("author_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return { rows: [], error: error.message };
  return { rows: (data as Row[]) ?? [], error: null };
}

/** 내 활동: 숏폼 — shortform_posts.author_id 정본(187 baseline 실측: user_id 컬럼 부재) */
export async function loadMyShortformPosts(
  supabase: SupabaseClient,
  userId: string,
  limit: number
): Promise<{ rows: Row[]; error: string | null }> {
  // W4(C10): 프로빙·user_id 재시도·스키마 오류→빈 목록 변환 제거 — 오류는 error 로 반환(빈 목록과 구분).
  const { data, error } = await supabase
    .from("shortform_posts")
    .select("*")
    .eq("author_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return { rows: [], error: error.message };
  return { rows: (data as Row[]) ?? [], error: null };
}

export async function countMyCommunityBoardPosts(supabase: SupabaseClient, userId: string): Promise<number | null> {
  const { count, error } = await boardPostsView(supabase)
    .select("*", { count: "exact", head: true })
    .eq("author_id", userId);
  if (error) return null;
  return typeof count === "number" ? count : null;
}

export async function countMyShortformPosts(supabase: SupabaseClient, userId: string): Promise<number | null> {
  // W4(C10): shortform_posts.author_id 고정(user_id 부재 실측) — 프로빙·재시도 제거.
  const { count, error } = await supabase
    .from("shortform_posts")
    .select("*", { count: "exact", head: true })
    .eq("author_id", userId);
  if (error) {
    // 표시 전용 카운트의 명시적 degrade(성공 아님): null = 조회 실패(0건과 구분), 로그로 표면화.
    console.error("[countMyShortformPosts]", error.message);
    return null;
  }
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
  const { data, error } = await boardPostsView(supabase).select("*").eq("id", id).maybeSingle();
  if (error) return { row: null, table: "api_web_v1.community_posts_v1", error: error.message };
  return { row: (data as Row) ?? null, table: "api_web_v1.community_posts_v1", error: null };
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
 * community_comments — 게시 유형 + 글 id 별(숏폼·레거시 경로, 016 정본).
 * W4(C10): 테이블 미배포 가정의 relation-오류→빈 목록 변환 제거 — community_comments 는
 * 187 baseline 실측 존재. 모든 조회 오류는 error 로 반환한다(빈 댓글과 구분).
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
  /**
   * 관리자 숨김·삭제 처분 배지(작성자 본인 표면 전용). 정상 노출 글은 null 이라
   * 복구(restored) 직후 배지가 자동으로 사라진다.
   */
  moderation: AuthorModerationNotice | null;
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

export function toCommunityMePostListItem(
  kind: "board" | "shortform",
  row: Row,
  viewerId?: string | null
): CommunityMePostListItem | null {
  if (isDraftRow(row)) return null;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  if (!id) return null;
  const base = kind === "board" ? "/community/board" : "/community/shortform";
  // 「내 활동」은 본인 행만 조회하지만(author_id 스코프), 배지 판정은 뷰어=작성자일 때만
  // 성립하도록 명시적으로 확인한다(타인 표면 재사용 시에도 안전).
  const moderation = authorModerationNotice(row, viewerId ?? communityRowAuthorId(row));
  return {
    kind,
    id,
    title: pickTitle(row),
    dateLabel: formatCommunityPostDate(row),
    // 숨김 글은 작성자 본인 상세가 열리므로 링크를 유지한다. 삭제 글은 상세가 not-found 라 링크 제거.
    linkHref:
      moderation?.state === "deleted" || !isCommunityPostUuid(id)
        ? null
        : `${base}/${encodeURIComponent(id)}`,
    moderation,
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

export function buildCommunityMePostsList(
  boardRows: Row[],
  shortformRows: Row[],
  max: number,
  viewerId?: string | null
): CommunityMePostListItem[] {
  const merged = mergeMeRecentCommunityItems(boardRows, shortformRows, max);
  const out: CommunityMePostListItem[] = [];
  for (const { kind, row } of merged) {
    const item = toCommunityMePostListItem(kind, row, viewerId);
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
