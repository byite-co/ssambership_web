import type { SupabaseClient } from "@supabase/supabase-js";
import { canAuthorViewHiddenDetail } from "@/lib/community/communityModerationVisibility";
import type { ShortformCategorySlug } from "@/lib/community/communityShortformConstants";
import {
  collectAuthorIdsNeedingLookup,
  fetchCommunityAuthorNamesByIds,
  resolveCommunityAuthorLabel,
  type CommunityAuthorNameRow,
} from "@/lib/community/communityAuthorLabels";
import { pickAuthorRoleSummary, pickTitle } from "@/lib/community/communityQueries";
import {
  resolveShortformThumbnailUrl,
  resolveShortformVideoUrl,
} from "@/lib/community/communityShortformStorage";
import { viewEventKeyFor } from "@/lib/community/viewEventKey";

type Row = Record<string, unknown>;

export type ShortformCard = {
  id: string;
  title: string;
  /** W-blocks(v1): 차단 필터용 — 표시에는 미사용(additive, 스펙 §3) */
  authorId?: string | null;
  authorLabel: string;
  authorRole: string | null;
  category: string | null;
  thumbnailUrl: string | null;
  videoUrl: string | null;
  description: string;
  tags: string[];
  viewCount: number;
  likeCount: number;
  createdAtLabel: string;
};

async function shortformAuthorNameMap(
  supabase: SupabaseClient,
  rows: Row[]
): Promise<Map<string, CommunityAuthorNameRow>> {
  return fetchCommunityAuthorNamesByIds(supabase, collectAuthorIdsNeedingLookup(rows));
}

function pickThumb(row: Row): string | null {
  for (const k of ["thumbnail_url", "thumbnailUrl", "cover_url"] as const) {
    const v = row[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function pickVideo(row: Row): string | null {
  for (const k of ["video_url", "videoUrl", "source_url", "source"] as const) {
    const v = row[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function relTime(iso: string): string {
  try {
    const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (m < 60) return `${m}분 전`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}시간 전`;
    return new Date(iso).toLocaleDateString("ko-KR");
  } catch {
    return "";
  }
}

export function mapShortformRow(row: Row, userMap?: Map<string, CommunityAuthorNameRow>): ShortformCard {
  const created = typeof row.created_at === "string" ? row.created_at : new Date().toISOString();
  const tags = Array.isArray(row.tags) ? row.tags.map(String).filter(Boolean) : [];
  const authorId = typeof row.author_id === "string" ? row.author_id : null;
  const user = authorId && userMap ? userMap.get(authorId) : undefined;
  return {
    id: String(row.id ?? ""),
    title: pickTitle(row),
    authorId,
    authorLabel: resolveCommunityAuthorLabel(row, user),
    authorRole: pickAuthorRoleSummary(row),
    category: typeof row.category === "string" ? row.category : null,
    thumbnailUrl: pickThumb(row),
    videoUrl: pickVideo(row),
    description: typeof row.body === "string" ? row.body : "",
    tags,
    viewCount: typeof row.view_count === "number" ? row.view_count : 0,
    likeCount: typeof row.like_count === "number" ? row.like_count : 0,
    createdAtLabel: relTime(created),
  };
}

async function resolveShortformCardMedia(
  supabase: SupabaseClient,
  card: ShortformCard
): Promise<ShortformCard> {
  const [thumbnailUrl, videoUrl] = await Promise.all([
    resolveShortformThumbnailUrl(supabase, card.thumbnailUrl),
    resolveShortformVideoUrl(supabase, card.videoUrl),
  ]);
  return {
    ...card,
    thumbnailUrl,
    videoUrl,
  };
}

/**
 * 목록 카드용 미디어 해석(D-CM-10) — 썸네일만 서명한다. 목록(limit 48)에서 카드마다 영상까지
 * 서명하면 요청당 최대 96회 Storage createSignedUrl fan-out 이 나는데, 목록 카드는 영상을
 * 재생하지 않으므로(상세에서 발급) 영상 서명이 불필요하다. videoUrl 은 null 로 비운다.
 */
async function resolveShortformCardThumbnailOnly(
  supabase: SupabaseClient,
  card: ShortformCard
): Promise<ShortformCard> {
  const thumbnailUrl = await resolveShortformThumbnailUrl(supabase, card.thumbnailUrl);
  return { ...card, thumbnailUrl, videoUrl: null };
}

export type ShortformFeedSort = "all" | "latest" | "popular";

function buildShortformFeedQuery(
  supabase: SupabaseClient,
  opts: { category?: ShortformCategorySlug; limit: number; sort: ShortformFeedSort }
) {
  let q =
    opts.sort === "popular"
      ? supabase
          .from("shortform_posts")
          .select("*")
          .order("like_count", { ascending: false })
          .order("view_count", { ascending: false })
          .order("created_at", { ascending: false })
      : supabase.from("shortform_posts").select("*").order("created_at", { ascending: false });
  // D-CM-9: published 필터를 쿼리 조건으로 올린다(구현은 정상 경로에서만 JS 후처리했고 폴백
  // 분기에서는 아예 생략돼 작성자 본인 draft/hidden 이 공개 피드로 새어 나갔다). 레거시 null
  // status 행은 공개로 간주하던 기존 동작을 보존하려고 `status IS NULL` 도 함께 허용한다.
  q = q.or("status.eq.published,status.is.null");
  q = q.limit(opts.limit);
  if (opts.category && opts.category !== "all") q = q.eq("category", opts.category);
  return q;
}

export async function listShortformFeed(
  supabase: SupabaseClient,
  opts: { category?: ShortformCategorySlug; limit?: number; sort?: ShortformFeedSort }
): Promise<{ items: ShortformCard[]; error: string | null }> {
  const limit = opts.limit ?? 40;
  const sort = opts.sort ?? "all";
  const q = buildShortformFeedQuery(supabase, { category: opts.category, limit, sort });
  const { data, error } = await q;
  if (error) {
    // 카테고리 조건 쿼리 실패 시 카테고리 없이 재조회. D-CM-9: published 필터는 쿼리
    // 빌더가 이미 강제하므로(정상·폴백 동일) draft/hidden 이 폴백으로 새지 않는다.
    const fb = await buildShortformFeedQuery(supabase, { limit, sort });
    if (fb.error) return { items: [], error: fb.error.message };
    const fbRows = (fb.data as Row[]) ?? [];
    const userMap = await shortformAuthorNameMap(supabase, fbRows);
    // D-CM-10: 목록은 썸네일만 서명(영상 서명 fan-out 제거).
    const cards = await Promise.all(
      fbRows.map((r) => resolveShortformCardThumbnailOnly(supabase, mapShortformRow(r, userMap)))
    );
    return { items: cards, error: null };
  }
  const rows = (data as Row[]) ?? [];
  const userMap = await shortformAuthorNameMap(supabase, rows);
  const cards = await Promise.all(
    rows.map((r) => resolveShortformCardThumbnailOnly(supabase, mapShortformRow(r, userMap)))
  );
  return { items: cards, error: null };
}

export async function getShortformDetail(
  supabase: SupabaseClient,
  id: string,
  /** 로그인 사용자 id. 작성자 본인이면 숨김 숏폼도 배지와 함께 열람할 수 있다. */
  viewerId?: string | null
): Promise<{ item: ShortformCard | null; row: Row | null; error: string | null }> {
  const { data, error } = await supabase.from("shortform_posts").select("*").eq("id", id).maybeSingle();
  if (error) return { item: null, row: null, error: error.message };
  if (!data) return { item: null, row: null, error: null };
  const row = data as Row;
  // 타인·비로그인에게는 기존 not-found 그대로. 작성자 본인만 행이 유지된다.
  if (row.status === "hidden" && !canAuthorViewHiddenDetail(row, viewerId)) {
    return { item: null, row, error: null };
  }
  const userMap = await shortformAuthorNameMap(supabase, [row]);
  return { item: await resolveShortformCardMedia(supabase, mapShortformRow(row, userMap)), row, error: null };
}

export async function getShortformReactionFlags(
  supabase: SupabaseClient,
  shortformId: string,
  userId: string | null
): Promise<{ liked: boolean }> {
  if (!userId) return { liked: false };
  const { data, error } = await supabase
    .from("shortform_reactions")
    .select("id")
    .eq("shortform_id", shortformId)
    .eq("user_id", userId)
    .eq("type", "like")
    .maybeSingle();
  if (error) return { liked: false };
  return { liked: Boolean(data) };
}

export type ShortformDraftRow = {
  id: string;
  title: string;
  body: string;
  category: string;
  videoUrl: string;
  source: string;
};

export async function getShortformDraft(
  supabase: SupabaseClient,
  userId: string,
  draftId: string
): Promise<{ draft: ShortformDraftRow | null; error: string | null }> {
  const { data, error } = await supabase
    .from("shortform_posts")
    .select("id, title, body, category, video_url, source, status, author_id")
    .eq("id", draftId)
    .eq("author_id", userId)
    .eq("status", "draft")
    .maybeSingle();
  if (error) return { draft: null, error: error.message };
  if (!data) return { draft: null, error: null };
  const row = data as Row;
  return {
    draft: {
      id: String(row.id ?? ""),
      title: typeof row.title === "string" ? row.title : "",
      body: typeof row.body === "string" ? row.body : "",
      category: typeof row.category === "string" ? row.category : "study",
      videoUrl: typeof row.video_url === "string" ? row.video_url : "",
      source: typeof row.source === "string" ? row.source : "",
    },
    error: null,
  };
}

/**
 * 숏폼 view 계수 v2 (수렴 §10.5) — impression 당 event key 1개의 멱등 계약.
 * event_key 는 (글 + 뷰어 + 시간버킷)에서 결정적으로 파생한다(D-CM-3, viewEventKeyFor).
 * 구현이 매 호출 crypto.randomUUID() 를 넘겨 같은 뷰어의 새로고침·재검증·프리페치가 전부
 * 별개 조회로 계수돼 멱등 계약이 무력화됐다. 이제 같은 뷰어·같은 시간대 재조회는 1회로 접힌다.
 * 실패는 조용히 무시하되(계수는 비핵심) 같은 impression 에서 새 key 로 재시도하지 않는다.
 */
export async function incrementShortformView(
  supabase: SupabaseClient,
  id: string,
  viewerId: string | null | undefined
): Promise<void> {
  await supabase.rpc("shortform_view_record_v2", {
    p_post_id: id,
    p_event_key: viewEventKeyFor(id, viewerId ?? null),
  });
}
