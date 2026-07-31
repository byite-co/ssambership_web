import type { SupabaseClient } from "@supabase/supabase-js";
import { canAuthorViewHiddenDetail } from "@/lib/community/communityModerationVisibility";
import {
  COMMUNITY_POST_CATEGORIES,
  COMMUNITY_POST_PAGE_SIZE,
  type CommunityPostCategorySlug,
} from "@/lib/community/communityBoardConstants";
import {
  collectAuthorIdsNeedingLookup,
  fetchCommunityAuthorNamesByIds,
  resolveCommunityAuthorLabel,
  type CommunityAuthorNameRow,
} from "@/lib/community/communityAuthorLabels";
import { pickAuthorRoleSummary, pickExcerpt, pickTitle } from "@/lib/community/communityQueries";
import {
  resolveCommunityImageUrls,
} from "@/lib/community/communityImageStorage";
import { API_WEB_V1_SCHEMA } from "@/lib/apiWebV1/rpc";

type Row = Record<string, unknown>;

/**
 * S2-2 전환 W1(C1): 게시판 글 읽기 정본 — V1 `api_web_v1.community_posts_v1`
 * (계약 §6 V1 · §17 #6, 글 목록·상세 한정). invoker view 라 기반 RLS 가 그대로
 * 적용되고, 노출 조건(`deleted_at IS NULL` AND (`published` OR 본인 글))은 view 가
 * 정의 안에서 건다(XW-09·XW-14 해소 — JS deleted 필터·레거시 폴백 제거).
 * `body = coalesce(content, body)` · `image_refs` 는 view 가 한 번만 수렴한다.
 * 해시태그(`community_hashtags`)·리액션·숏폼은 V1 범위 밖이다(§17 #6 — U-12).
 */
function boardPostsView(supabase: SupabaseClient) {
  return supabase.schema(API_WEB_V1_SCHEMA).from("community_posts_v1");
}

/**
 * 카드 배열의 imageUrls(현재 ref)를 표시용 서명 URL 로 일괄 변환(BUG-B).
 * 카드별 이미지 수가 적어(≤5) N+? 서명이지만 목록당 총량은 작다.
 */
async function signBoardCardImages(
  supabase: SupabaseClient,
  cards: CommunityBoardPostCard[]
): Promise<CommunityBoardPostCard[]> {
  return Promise.all(
    cards.map(async (c) =>
      c.imageUrls.length
        ? { ...c, imageUrls: await resolveCommunityImageUrls(supabase, c.imageUrls) }
        : c
    )
  );
}

export type CommunityBoardPostCard = {
  id: string;
  title: string;
  excerpt: string;
  category: string | null;
  categoryLabel: string;
  authorId: string | null;
  authorLabel: string;
  authorRole: string | null;
  imageUrls: string[];
  hashtags: string[];
  viewCount: number;
  likeCount: number;
  commentCount: number;
  createdAt: string;
  createdAtLabel: string;
};

export type CommunityHashtagRow = { tag: string; count: number };

export type CommunityBoardCommentNode = {
  id: string;
  postId: string;
  parentId: string | null;
  content: string;
  likeCount: number;
  authorId: string;
  authorLabel: string;
  createdAt: string;
  createdAtLabel: string;
  isOwn: boolean;
  replies: CommunityBoardCommentNode[];
};

function categoryLabel(slug: string | null): string {
  if (!slug || !slug.trim()) {
    return COMMUNITY_POST_CATEGORIES.find((c) => c.slug === "free")?.label ?? "\uC790\uC720";
  }
  const hit = COMMUNITY_POST_CATEGORIES.find((c) => c.slug === slug);
  if (hit) return hit.label;
  return slug;
}

function pickBody(row: Row): string {
  for (const k of ["content", "body", "text"] as const) {
    if (typeof row[k] === "string" && row[k].trim()) return row[k] as string;
  }
  return "";
}

async function boardAuthorNameMap(supabase: SupabaseClient, rows: Row[]): Promise<Map<string, CommunityAuthorNameRow>> {
  return fetchCommunityAuthorNamesByIds(supabase, collectAuthorIdsNeedingLookup(rows));
}

/**
 * 저장된 이미지 참조 배열을 그대로 반환(BUG-B: 이제 `bucket/path` ref 저장).
 * http 필터를 두지 않는다 — ref 는 http 로 시작하지 않으므로 필터하면 사라진다.
 * 표시용 서명 URL 변환은 로더가 resolveCommunityImageUrls 로 후처리한다.
 */
function pickImageRefs(row: Row): string[] {
  // W1(C1): V1 정본 필드는 `image_refs` — 구 키(image_urls 등)는 비-V1 행 호환용
  const v = row.image_refs ?? row.image_urls;
  if (Array.isArray(v)) {
    return v.filter((u): u is string => typeof u === "string" && u.trim().length > 0).slice(0, 5);
  }
  const single = row.image_url ?? row.thumbnail_url;
  if (typeof single === "string" && single.trim()) return [single.trim()];
  return [];
}

function pickHashtags(row: Row): string[] {
  const v = row.hashtags;
  if (Array.isArray(v)) return v.map(String).filter(Boolean).slice(0, 8);
  return [];
}

function formatRelativeTime(iso: string): string {
  try {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return "\uBC29\uAE08";
    if (m < 60) return `${m}\uBD84 \uC804`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}\uC2DC\uAC04 \uC804`;
    const day = Math.floor(h / 24);
    if (day < 7) return `${day}\uC77C \uC804`;
    return d.toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

export function mapRowToBoardCard(
  row: Row,
  userMap?: Map<string, CommunityAuthorNameRow>
): CommunityBoardPostCard {
  const id = String(row.id ?? "");
  const createdAt =
    typeof row.created_at === "string" ? row.created_at : new Date().toISOString();
  const cat = typeof row.category === "string" ? row.category : null;
  const authorId = typeof row.author_id === "string" ? row.author_id : null;
  const user = authorId && userMap ? userMap.get(authorId) : undefined;
  return {
    id,
    title: pickTitle(row),
    excerpt: pickExcerpt(row) || pickBody(row).slice(0, 120),
    category: cat,
    categoryLabel: categoryLabel(cat),
    authorId,
    authorLabel: resolveCommunityAuthorLabel(row, user),
    authorRole: pickAuthorRoleSummary(row),
    imageUrls: pickImageRefs(row),
    hashtags: pickHashtags(row),
    viewCount: typeof row.view_count === "number" ? row.view_count : 0,
    likeCount: typeof row.like_count === "number" ? row.like_count : 0,
    commentCount: typeof row.comment_count === "number" ? row.comment_count : 0,
    createdAt,
    createdAtLabel: formatRelativeTime(createdAt),
  };
}

function applyBoardCategoryFilter<T extends { eq: (col: string, val: string) => T; or: (filters: string) => T }>(
  q: T,
  category: CommunityPostCategorySlug
): T {
  if (category === "free") {
    return q.or("category.eq.free,category.is.null,category.eq.");
  }
  return q.eq("category", category);
}

export type CommunityBoardFeedSort = "all" | "latest" | "popular";

function applyBoardFeedSort<T extends { order: (col: string, opts: { ascending: boolean }) => T }>(
  q: T,
  sort: CommunityBoardFeedSort
): T {
  if (sort === "popular") {
    return q
      .order("like_count", { ascending: false })
      .order("view_count", { ascending: false })
      .order("comment_count", { ascending: false })
      .order("created_at", { ascending: false });
  }
  return q.order("created_at", { ascending: false });
}

export async function listCommunityBoardPosts(
  supabase: SupabaseClient,
  opts: {
    category?: CommunityPostCategorySlug;
    cursor?: string | null;
    limit?: number;
    authorId?: string | null;
    status?: "published" | "draft";
    sort?: CommunityBoardFeedSort;
  }
): Promise<{ posts: CommunityBoardPostCard[]; nextCursor: string | null; error: string | null }> {
  const limit = opts.limit ?? COMMUNITY_POST_PAGE_SIZE;
  const sort = opts.sort ?? "all";
  const isPopular = sort === "popular";
  let offset = 0;
  if (isPopular && opts.cursor?.startsWith("o:")) {
    offset = Math.max(0, parseInt(opts.cursor.slice(2), 10) || 0);
  }

  let q = applyBoardFeedSort(
    boardPostsView(supabase)
      .select("*")
      .eq("status", opts.status ?? "published"),
    sort
  );

  if (isPopular) {
    q = q.range(offset, offset + limit);
  } else {
    q = q.limit(limit + 1);
    if (opts.cursor) {
      q = q.lt("created_at", opts.cursor);
    }
  }

  if (opts.category && opts.category !== "all") {
    q = applyBoardCategoryFilter(q, opts.category);
  }
  if (opts.authorId) {
    q = q.eq("author_id", opts.authorId);
  }

  const { data, error } = await q;
  if (error) {
    return { posts: [], nextCursor: null, error: error.message };
  }

  const rows = (data as Row[]) ?? [];
  const hasMore = rows.length > limit;
  const slice = hasMore ? rows.slice(0, limit) : rows;
  const userMap = await boardAuthorNameMap(supabase, slice);
  const posts = await signBoardCardImages(supabase, slice.map((r) => mapRowToBoardCard(r, userMap)));
  const nextCursor = hasMore
    ? isPopular
      ? `o:${offset + limit}`
      : slice.length
        ? String(slice[slice.length - 1].created_at ?? "")
        : null
    : null;
  return { posts, nextCursor: nextCursor || null, error: null };
}

/**
 * G4.1 홈 "인기 게시글" 결정적 선정: 좋아요(like_count) 상위, 동률 시 created_at 최신, limit개.
 * 표시용 정렬·limit일 뿐 escrow/결제/한도와 무관. 게시판 피드의 popular 정렬(view·comment tiebreak 포함)과는
 * 분리해, 매번 동일 결과가 나오도록 likes→created_at 만으로 결정한다(랜덤 없음).
 */
export async function listCommunityPopularPostsForHome(
  supabase: SupabaseClient,
  limit: number
): Promise<{ posts: CommunityBoardPostCard[]; error: string | null }> {
  const { data, error } = await boardPostsView(supabase)
    .select("*")
    .eq("status", "published")
    .order("like_count", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    return { posts: [], error: error.message };
  }
  const rows = (data as Row[]) ?? [];
  const userMap = await boardAuthorNameMap(supabase, rows);
  return { posts: await signBoardCardImages(supabase, rows.map((r) => mapRowToBoardCard(r, userMap))), error: null };
}

export async function getCommunityBoardPost(
  supabase: SupabaseClient,
  id: string,
  /** 로그인 사용자 id. 작성자 본인이면 숨김 글도 배지와 함께 열람할 수 있다. */
  viewerId?: string | null
): Promise<{ post: CommunityBoardPostCard | null; row: Row | null; error: string | null }> {
  const { data, error } = await boardPostsView(supabase).select("*").eq("id", id).maybeSingle();
  if (error) return { post: null, row: null, error: error.message };
  if (!data) return { post: null, row: null, error: null };
  const row = data as Row;
  // soft-delete 글은 V1 노출 조건이 이미 숨긴다(§6 V1 — XW-09) → 여기 도달하면 미삭제.
  const status = typeof row.status === "string" ? row.status : "published";
  if (status === "hidden" && !canAuthorViewHiddenDetail(row, viewerId)) {
    // 타인·비로그인에게는 기존 not-found 그대로. 작성자 본인만 행이 유지된다.
    return { post: null, row, error: null };
  }
  if (status === "draft") {
    return { post: null, row, error: null };
  }
  const userMap = await boardAuthorNameMap(supabase, [row]);
  const post = mapRowToBoardCard(row, userMap);
  return { post: { ...post, imageUrls: await resolveCommunityImageUrls(supabase, post.imageUrls) }, row, error: null };
}

export type CommunityBoardDraftRow = {
  id: string;
  title: string;
  body: string;
  category: string;
  imageUrls: string[];
  /** 낙관 잠금 기준값(F5 p_expected_updated_at — 계약 §7 F5). */
  updatedAt: string;
};

export async function getCommunityBoardDraft(
  supabase: SupabaseClient,
  userId: string,
  draftId: string
): Promise<{ draft: CommunityBoardDraftRow | null; error: string | null }> {
  const { data, error } = await boardPostsView(supabase)
    .select("id, title, body, category, image_refs, status, author_id, updated_at")
    .eq("id", draftId)
    .eq("author_id", userId)
    .eq("status", "draft")
    .maybeSingle();
  if (error) return { draft: null, error: error.message };
  if (!data) return { draft: null, error: null };
  const row = data as Row;
  const body = typeof row.body === "string" ? row.body : "";
  const imageUrls = Array.isArray(row.image_refs)
    ? (row.image_refs as unknown[]).filter((u): u is string => typeof u === "string")
    : [];
  return {
    draft: {
      id: String(row.id ?? ""),
      title: typeof row.title === "string" ? row.title : "",
      body,
      category: typeof row.category === "string" ? row.category : "free",
      imageUrls,
      updatedAt: typeof row.updated_at === "string" ? row.updated_at : "",
    },
    error: null,
  };
}

/**
 * 작성자 본인의 게시글(상태 무관: 발행/임시)을 편집용으로 로드한다. 삭제된 글은 제외.
 * 소유권은 `.eq("author_id")` 로 강제 — 편집 화면은 본인 글만 연다(서버 update 도 재검사).
 */
export async function getCommunityBoardPostForEdit(
  supabase: SupabaseClient,
  userId: string,
  postId: string
): Promise<{ draft: CommunityBoardDraftRow | null; error: string | null }> {
  const { data, error } = await boardPostsView(supabase)
    .select("id, title, body, category, image_refs, status, author_id, updated_at")
    .eq("id", postId)
    .eq("author_id", userId)
    .maybeSingle();
  if (error) return { draft: null, error: error.message };
  if (!data) return { draft: null, error: null };
  const row = data as Row;
  const body = typeof row.body === "string" ? row.body : "";
  const imageUrls = Array.isArray(row.image_refs)
    ? (row.image_refs as unknown[]).filter((u): u is string => typeof u === "string")
    : [];
  return {
    draft: {
      id: String(row.id ?? ""),
      title: typeof row.title === "string" ? row.title : "",
      body,
      category: typeof row.category === "string" ? row.category : "free",
      imageUrls,
      updatedAt: typeof row.updated_at === "string" ? row.updated_at : "",
    },
    error: null,
  };
}

export async function listPopularHashtags(
  supabase: SupabaseClient,
  limit: number
): Promise<{ rows: CommunityHashtagRow[]; error: string | null }> {
  const { data, error } = await supabase
    .from("community_hashtags")
    .select("tag, count")
    .order("count", { ascending: false })
    .limit(limit);
  if (error) {
    if (/relation|does not exist/i.test(error.message)) {
      return { rows: [], error: null };
    }
    return { rows: [], error: error.message };
  }
  const rows = ((data as { tag: string; count: number }[]) ?? []).map((r) => ({
    tag: r.tag,
    count: r.count ?? 0,
  }));
  return { rows, error: null };
}

export async function loadBoardComments(
  supabase: SupabaseClient,
  postId: string,
  viewerId: string | null
): Promise<{ nodes: CommunityBoardCommentNode[]; error: string | null }> {
  // W1(C1): V2 `api_web_v1.community_comments_v1` — 정본 `comments` 만 노출(§6 V2 —
  // 레거시 `community_comments` 이중 읽기 종료). `body = comments.content` 는 view 가
  // 수렴하고, `author_label` 은 M13 비정규화 컬럼이라 users 보강 조회가 불필요하다.
  const { data, error } = await supabase
    .schema(API_WEB_V1_SCHEMA)
    .from("community_comments_v1")
    .select("id, post_id, parent_id, body, like_count, author_id, author_label, author_role, created_at")
    .eq("post_id", postId)
    .order("created_at", { ascending: true });

  if (error) {
    return { nodes: [], error: "\uB313\uAE00\uC744 \uBD88\uB7EC\uC624\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4." };
  }

  const commentRows = (data as Record<string, unknown>[]) ?? [];

  const flat = commentRows.map((r) => {
    const createdAt = typeof r.created_at === "string" ? r.created_at : new Date().toISOString();
    const authorId = String(r.author_id ?? "");
    return {
      id: String(r.id ?? ""),
      postId: String(r.post_id ?? ""),
      parentId: typeof r.parent_id === "string" ? r.parent_id : null,
      content: String(r.body ?? ""),
      likeCount: typeof r.like_count === "number" ? r.like_count : 0,
      authorId,
      authorLabel: resolveCommunityAuthorLabel(r, undefined),
      createdAt,
      createdAtLabel: formatRelativeTime(createdAt),
      isOwn: viewerId != null && authorId === viewerId,
      replies: [] as CommunityBoardCommentNode[],
    };
  });

  const top: CommunityBoardCommentNode[] = [];
  const byId = new Map(flat.map((c) => [c.id, c]));
  for (const c of flat) {
    if (!c.parentId) {
      top.push(c);
      continue;
    }
    const parent = byId.get(c.parentId);
    if (parent && !parent.parentId) {
      parent.replies.push(c);
    } else {
      top.push(c);
    }
  }
  return { nodes: top, error: null };
}

export async function getPostReactionFlags(
  supabase: SupabaseClient,
  postId: string,
  userId: string | null
): Promise<{ liked: boolean; scrapped: boolean }> {
  if (!userId) return { liked: false, scrapped: false };
  const { data, error } = await supabase
    .from("post_reactions")
    .select("type")
    .eq("post_id", postId)
    .eq("user_id", userId);
  if (error) return { liked: false, scrapped: false };
  const types = ((data as { type: string }[]) ?? []).map((r) => r.type);
  return { liked: types.includes("like"), scrapped: types.includes("scrap") };
}

export async function listUserScrapPosts(
  supabase: SupabaseClient,
  userId: string,
  limit: number
): Promise<{ posts: CommunityBoardPostCard[]; error: string | null }> {
  const { data, error } = await supabase
    .from("post_reactions")
    .select("post_id, created_at")
    .eq("user_id", userId)
    .eq("type", "scrap")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    if (/relation|does not exist/i.test(error.message)) return { posts: [], error: null };
    return { posts: [], error: error.message };
  }
  const ids = ((data as { post_id: string }[]) ?? []).map((r) => r.post_id).filter(Boolean);
  if (!ids.length) return { posts: [], error: null };
  const { data: posts, error: pErr } = await boardPostsView(supabase)
    .select("*")
    .in("id", ids);
  if (pErr) return { posts: [], error: pErr.message };
  const byId = new Map(((posts as Row[]) ?? []).map((r) => [String(r.id), r]));
  const ordered = ids.map((id) => byId.get(id)).filter((r): r is Row => Boolean(r));
  const userMap = await boardAuthorNameMap(supabase, ordered);
  return { posts: await signBoardCardImages(supabase, ordered.map((r) => mapRowToBoardCard(r, userMap))), error: null };
}

export function pickPostBody(row: Row | null): string {
  if (!row) return "";
  return pickBody(row);
}
