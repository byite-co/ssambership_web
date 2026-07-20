import type { SupabaseClient } from "@supabase/supabase-js";
import type { ShortformCategorySlug } from "@/lib/community/communityShortformConstants";
import { SHORTFORM_DESC_MAX, SHORTFORM_TAG_MAX, SHORTFORM_TITLE_MAX } from "@/lib/community/communityShortformConstants";

export type InsertShortformInput = {
  title: string;
  category: ShortformCategorySlug;
  videoUrl: string;
  thumbnailUrl: string | null;
  body: string;
  tags: string[];
  source: string;
  status: "draft" | "published";
  authorLabel: string;
  /** 생성 멱등키(uuid). 더블클릭·재시도 중복 INSERT 를 (author_id, key) UNIQUE 로 차단. */
  createIdempotencyKey?: string | null;
};

export async function insertShortformPost(
  supabase: SupabaseClient,
  userId: string,
  input: InsertShortformInput
): Promise<{ ok: true; id: string; created: boolean } | { ok: false; error: string }> {
  const title = input.title.trim().slice(0, SHORTFORM_TITLE_MAX);
  const body = input.body.trim().slice(0, SHORTFORM_DESC_MAX);
  if (!title) return { ok: false, error: "title" };
  if (!input.videoUrl && input.status === "published") return { ok: false, error: "video" };
  const tags = input.tags.slice(0, SHORTFORM_TAG_MAX);
  const key = input.createIdempotencyKey?.trim() || null;

  const payload: Record<string, unknown> = {
    author_id: userId,
    title,
    body,
    category: input.category === "all" ? "study" : input.category,
    source: input.source || null,
    video_url: input.videoUrl,
    thumbnail_url: input.thumbnailUrl,
    tags,
    status: input.status,
    author_role: "mentor",
    author_label: input.authorLabel,
    create_idempotency_key: key,
  };

  // 멱등 경로: (author_id, create_idempotency_key) UNIQUE 에 대해 ON CONFLICT DO NOTHING.
  // 새로 삽입되면 행이 반환되고(created), 이미 있으면(중복 요청) 반환이 비어 기존 행 id 를 되돌린다.
  if (key) {
    const { data, error } = await supabase
      .from("shortform_posts")
      .upsert(payload, { onConflict: "author_id,create_idempotency_key", ignoreDuplicates: true })
      .select("id")
      .maybeSingle();
    if (error) return { ok: false, error: "db" };
    const insertedId = data && typeof (data as { id: string }).id === "string" ? (data as { id: string }).id : "";
    if (insertedId) return { ok: true, id: insertedId, created: true };
    const { data: existing } = await supabase
      .from("shortform_posts")
      .select("id")
      .eq("author_id", userId)
      .eq("create_idempotency_key", key)
      .maybeSingle();
    const existingId = existing && typeof (existing as { id: string }).id === "string" ? (existing as { id: string }).id : "";
    return existingId ? { ok: true, id: existingId, created: false } : { ok: false, error: "db" };
  }

  // 폴백 INSERT 제거: video_url·status·author_label 을 누락한 채 status default('published') 로
  // 강제공개되던 결함 경로를 없앤다. DB 오류는 그대로 실패로 반환한다.
  const { data, error } = await supabase.from("shortform_posts").insert(payload).select("id").maybeSingle();
  if (error) return { ok: false, error: "db" };
  const id = data && typeof (data as { id: string }).id === "string" ? (data as { id: string }).id : "";
  return id ? { ok: true, id, created: true } : { ok: false, error: "db" };
}

export async function updateShortformPost(
  supabase: SupabaseClient,
  userId: string,
  postId: string,
  input: InsertShortformInput
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const title = input.title.trim().slice(0, SHORTFORM_TITLE_MAX);
  const body = input.body.trim().slice(0, SHORTFORM_DESC_MAX);
  if (!title) return { ok: false, error: "title" };
  if (!input.videoUrl && input.status === "published") return { ok: false, error: "video" };
  const tags = input.tags.slice(0, SHORTFORM_TAG_MAX);

  const payload: Record<string, unknown> = {
    title,
    body,
    category: input.category === "all" ? "study" : input.category,
    source: input.source || null,
    video_url: input.videoUrl,
    thumbnail_url: input.thumbnailUrl,
    tags,
    status: input.status,
    author_label: input.authorLabel,
  };

  const { data, error } = await supabase
    .from("shortform_posts")
    .update(payload)
    .eq("id", postId)
    .eq("author_id", userId)
    .select("id")
    .maybeSingle();

  // 0행 UPDATE(비존재·비소유)를 성공으로 오판하지 않는다: 반환 행이 있을 때만 성공.
  if (error) return { ok: false, error: "db" };
  const id = data && typeof (data as { id: string }).id === "string" ? (data as { id: string }).id : "";
  return id ? { ok: true, id } : { ok: false, error: "db" };
}

export async function toggleShortformLike(
  supabase: SupabaseClient,
  userId: string,
  shortformId: string
): Promise<{ ok: true; active: boolean } | { ok: false; error: string }> {
  const { data: existing, error: selectError } = await supabase
    .from("shortform_reactions")
    .select("id")
    .eq("user_id", userId)
    .eq("shortform_id", shortformId)
    .eq("type", "like")
    .maybeSingle();

  if (selectError) {
    return { ok: false, error: selectError.message };
  }

  if (existing?.id) {
    const { error } = await supabase.from("shortform_reactions").delete().eq("id", existing.id);
    if (error) return { ok: false, error: error.message };
    return { ok: true, active: false };
  }

  const { error } = await supabase
    .from("shortform_reactions")
    .insert({ user_id: userId, shortform_id: shortformId, type: "like" });
  if (error) return { ok: false, error: error.message };
  return { ok: true, active: true };
}
