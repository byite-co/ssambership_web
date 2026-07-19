import type { SupabaseClient } from "@supabase/supabase-js";
import {
  COMMUNITY_BODY_MIN,
  COMMUNITY_HASHTAG_MAX,
  type CommunityPostCategorySlug,
} from "@/lib/community/communityBoardConstants";

export type InsertBoardPostInput = {
  title: string;
  body: string;
  category: CommunityPostCategorySlug;
  imageUrls: string[];
  hashtags: string[];
  status: "draft" | "published";
  authorLabel: string;
  authorRole: string | null;
};

export async function insertCommunityBoardPost(
  supabase: SupabaseClient,
  userId: string,
  input: InsertBoardPostInput
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const title = input.title.trim();
  const body = input.body.trim();
  if (title.length < 1) return { ok: false, error: "title" };
  if (input.status === "published" && body.length < COMMUNITY_BODY_MIN) return { ok: false, error: "body" };
  if (input.category === "all") return { ok: false, error: "category" };

  const hashtags = input.hashtags.map((t) => t.replace(/^#/, "").trim()).filter(Boolean).slice(0, COMMUNITY_HASHTAG_MAX);

  const payload: Record<string, unknown> = {
    author_id: userId,
    title,
    body,
    content: body,
    category: input.category,
    image_urls: input.imageUrls,
    hashtags,
    status: input.status,
    author_label: input.authorLabel,
    author_role: input.authorRole,
  };

  // 폴백 INSERT 제거: image_urls·status·author_label·author_role 을 누락한 채
  // status default('published') 로 강제공개되던 경로를 없앤다. DB 오류는 그대로 실패.
  const { data, error } = await supabase.from("community_posts").insert(payload).select("id").maybeSingle();
  if (error) return { ok: false, error: "db" };
  const id = data && typeof (data as { id: string }).id === "string" ? (data as { id: string }).id : null;
  if (!id) return { ok: false, error: "db" };
  return { ok: true, id };
}

export async function updateCommunityBoardPost(
  supabase: SupabaseClient,
  userId: string,
  postId: string,
  input: InsertBoardPostInput
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const title = input.title.trim();
  const body = input.body.trim();
  if (title.length < 1) return { ok: false, error: "title" };
  if (input.status === "published" && body.length < COMMUNITY_BODY_MIN) return { ok: false, error: "body" };
  if (input.category === "all") return { ok: false, error: "category" };

  const hashtags = input.hashtags.map((t) => t.replace(/^#/, "").trim()).filter(Boolean).slice(0, COMMUNITY_HASHTAG_MAX);

  const payload: Record<string, unknown> = {
    title,
    body,
    content: body,
    category: input.category,
    image_urls: input.imageUrls,
    hashtags,
    status: input.status,
    author_label: input.authorLabel,
    author_role: input.authorRole,
  };

  const { data, error } = await supabase
    .from("community_posts")
    .update(payload)
    .eq("id", postId)
    .eq("author_id", userId)
    .select("id")
    .maybeSingle();

  // 0행 UPDATE(비존재·비소유)를 성공으로 오판하지 않는다: 반환 행이 있을 때만 성공.
  if (error) return { ok: false, error: "db" };
  const id = data && typeof (data as { id: string }).id === "string" ? (data as { id: string }).id : null;
  if (!id) return { ok: false, error: "db" };
  return { ok: true, id };
}

export async function togglePostReaction(
  supabase: SupabaseClient,
  userId: string,
  postId: string,
  type: "like" | "scrap"
): Promise<{ ok: true; active: boolean } | { ok: false; error: string }> {
  const { data: existing } = await supabase
    .from("post_reactions")
    .select("id")
    .eq("user_id", userId)
    .eq("post_id", postId)
    .eq("type", type)
    .maybeSingle();

  if (existing?.id) {
    const { error } = await supabase.from("post_reactions").delete().eq("id", existing.id);
    if (error) return { ok: false, error: error.message };
    return { ok: true, active: false };
  }

  const { error } = await supabase.from("post_reactions").insert({ user_id: userId, post_id: postId, type });
  if (error) return { ok: false, error: error.message };
  return { ok: true, active: true };
}

export async function insertBoardComment(
  supabase: SupabaseClient,
  userId: string,
  input: { postId: string; parentId: string | null; content: string; authorLabel: string }
): Promise<{ ok: true } | { ok: false; error: "validation" | "depth" | "db" }> {
  const content = input.content.trim();
  if (content.length < 1 || content.length > 2000) return { ok: false, error: "validation" };

  if (input.parentId) {
    const { data: parent } = await supabase
      .from("comments")
      .select("id, parent_id")
      .eq("id", input.parentId)
      .eq("post_id", input.postId)
      .maybeSingle();
    if (!parent) return { ok: false, error: "validation" };
    if (parent.parent_id) return { ok: false, error: "depth" };
  }

  const { error } = await supabase.from("comments").insert({
    post_id: input.postId,
    author_id: userId,
    parent_id: input.parentId,
    content,
    author_label: input.authorLabel,
  });
  if (error) return { ok: false, error: "db" };
  return { ok: true };
}

export async function softDeleteBoardComment(
  supabase: SupabaseClient,
  userId: string,
  commentId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase
    .from("comments")
    .update({ is_deleted: true, content: "\uC0AD\uC81C\uB41C \uB313\uAE00\uC785\uB2C8\uB2E4." })
    .eq("id", commentId)
    .eq("author_id", userId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function incrementPostView(supabase: SupabaseClient, postId: string): Promise<void> {
  await supabase.rpc("increment_community_post_view", { p_post_id: postId });
}
