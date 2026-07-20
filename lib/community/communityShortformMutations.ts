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
  /** 클라 요청 UUID(중복 업로드 방지). null 이면 멱등 검사 없음(레거시). */
  createIdempotencyKey?: string | null;
};

function isUniqueViolation(err: { code?: string } | null): boolean {
  return err?.code === "23505";
}

export async function insertShortformPost(
  supabase: SupabaseClient,
  userId: string,
  input: InsertShortformInput
): Promise<{ ok: true; id: string; idempotentReplay?: boolean } | { ok: false; error: string }> {
  const title = input.title.trim().slice(0, SHORTFORM_TITLE_MAX);
  const body = input.body.trim().slice(0, SHORTFORM_DESC_MAX);
  if (!title) return { ok: false, error: "title" };
  if (!input.videoUrl && input.status === "published") return { ok: false, error: "video" };
  const tags = input.tags.slice(0, SHORTFORM_TAG_MAX);

  const idemKey = input.createIdempotencyKey && input.createIdempotencyKey.trim() ? input.createIdempotencyKey.trim() : null;
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
    create_idempotency_key: idemKey,
  };

  // 폴백 INSERT 제거: video_url·status·author_label 을 누락한 채 status default('published') 로
  // 강제공개되던 결함 경로를 없앤다. DB 오류는 그대로 실패로 반환한다.
  const { data, error } = await supabase.from("shortform_posts").insert(payload).select("id").maybeSingle();
  if (error) {
    // 중복 제출(동일 author+요청키) → UNIQUE(23505). 기존 행을 찾아 반환(멱등 재생, 1행 유지).
    if (idemKey && isUniqueViolation(error as { code?: string })) {
      const { data: existing } = await supabase
        .from("shortform_posts")
        .select("id")
        .eq("author_id", userId)
        .eq("create_idempotency_key", idemKey)
        .maybeSingle();
      const existingId =
        existing && typeof (existing as { id: string }).id === "string" ? (existing as { id: string }).id : "";
      if (existingId) return { ok: true, id: existingId, idempotentReplay: true };
    }
    return { ok: false, error: "db" };
  }
  const id = data && typeof (data as { id: string }).id === "string" ? (data as { id: string }).id : "";
  return id ? { ok: true, id } : { ok: false, error: "db" };
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
