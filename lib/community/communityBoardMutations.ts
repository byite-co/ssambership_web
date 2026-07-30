import type { SupabaseClient } from "@supabase/supabase-js";
import {
  COMMUNITY_BODY_MIN,
  type CommunityPostCategorySlug,
} from "@/lib/community/communityBoardConstants";
import { callApiWebV1Rpc } from "@/lib/apiWebV1/rpc";

/**
 * S2-2 전환 W2(C5): 게시글 쓰기 정본 — F4/F5/F6 (계약 §7 · §14 · §17 #8).
 * author id·role·label 은 전달하지 않는다(서버가 auth.uid()·users 로 도출).
 * 소유·역할·승인·계정 상태·이미지(소유자/버킷/MIME/크기/개수)·마스킹·멱등 재생은
 * 전부 서버(F4~F6 → core_private B-1~B-4) 판정이며, 직접 INSERT/UPDATE fallback
 * 은 만들지 않는다. envelope 오류코드는 기존 redirect 슬러그로 매핑한다.
 */
export type InsertBoardPostInput = {
  title: string;
  body: string;
  category: CommunityPostCategorySlug;
  imageUrls: string[];
  hashtags: string[];
  status: "draft" | "published";
  /** F4 멱등키(작성 시도당 1회 생성·재시도 재사용 — 계약 §7 F4). */
  createIdempotencyKey?: string | null;
};

/** F4/F5/F6 envelope 코드 → 기존 compose redirect 슬러그. */
function postEnvelopeCodeToSlug(code: string): string {
  switch (code) {
    case "TITLE_REQUIRED":
      return "title";
    case "BODY_TOO_SHORT":
      return "body";
    case "CATEGORY_INVALID":
      return "category";
    case "ACCOUNT_BANNED":
    case "ACCOUNT_SUSPENDED":
    case "ACCOUNT_DELETION_IN_PROGRESS":
      return "account_blocked";
    case "ROLE_NOT_MENTOR":
    case "MENTOR_NOT_APPROVED":
      return "role";
    case "UPDATE_CONFLICT":
      return "conflict";
    default:
      return code.startsWith("IMAGE_") ? "images" : "db";
  }
}

/** 전송·연결 오류(응답 불명확 — 커밋 여부 미확정)인지 구분한다(§14.4 보상 분기 3). */
export type BoardPostWriteFailure = {
  ok: false;
  error: string;
  /** true = 확정 실패 envelope(미커밋 확정 — 신규 업로드 보상 삭제 허용). false = 응답 불명확(삭제 금지·동일 키 재호출). */
  definite: boolean;
};

export async function insertCommunityBoardPost(
  supabase: SupabaseClient,
  userId: string,
  input: InsertBoardPostInput
): Promise<{ ok: true; id: string; idempotentReplay?: boolean } | BoardPostWriteFailure> {
  void userId; // F4 가 auth.uid() 로 작성자를 도출한다(작성자 인자 전달 금지 — W2 §4.1)
  const title = input.title.trim();
  const body = input.body.trim();
  if (title.length < 1) return { ok: false, error: "title", definite: true };
  if (input.status === "published" && body.length < COMMUNITY_BODY_MIN) {
    return { ok: false, error: "body", definite: true };
  }
  if (input.category === "all") return { ok: false, error: "category", definite: true };
  const idemKey = input.createIdempotencyKey?.trim() || null;
  if (!idemKey) return { ok: false, error: "db", definite: true };

  const args = {
    p_title: title,
    p_body: body,
    p_category: input.category,
    p_idempotency_key: idemKey,
    p_image_refs: input.imageUrls,
    p_status: input.status,
  };
  let res = await callApiWebV1Rpc(supabase, "community_post_create", args);
  if (!res.ok && res.message !== null) {
    // 전송·연결 오류(커밋 여부 불명확) — 같은 멱등키로 정확히 1회 재호출(replay-first,
    // §14.4 분기 3). 새 키를 만들지 않고, 재호출 전 Storage 삭제도 하지 않는다.
    res = await callApiWebV1Rpc(supabase, "community_post_create", args);
  }
  if (!res.ok) {
    return { ok: false, error: postEnvelopeCodeToSlug(res.code), definite: res.message === null };
  }
  const id = typeof res.row.post_id === "string" ? res.row.post_id : null;
  if (!id) return { ok: false, error: "db", definite: true };
  return { ok: true, id, idempotentReplay: res.row.idempotent_replay === true };
}

/**
 * 게시글 soft-delete(작성자 전용). hard DELETE 금지 — deleted_at 만 세팅해 행을 보존한다(관리자 감사).
 * 소유권은 `.eq("author_id")` + 0행-실패로 재검사. 이미 삭제된 글은 재삭제 no-op(성공).
 */
export async function softDeleteCommunityBoardPost(
  supabase: SupabaseClient,
  userId: string,
  postId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  void userId; // F6 이 auth.uid() 소유권을 판정한다
  const res = await callApiWebV1Rpc(supabase, "community_post_soft_delete", { p_post_id: postId });
  if (!res.ok) {
    return { ok: false, error: res.code === "POST_NOT_FOUND" ? "not_found" : postEnvelopeCodeToSlug(res.code) };
  }
  // already_deleted:true 도 정상 성공(§8.3 F6 — 멱등 재삭제)
  return { ok: true };
}

export async function updateCommunityBoardPost(
  supabase: SupabaseClient,
  userId: string,
  postId: string,
  input: InsertBoardPostInput,
  /** 낙관 잠금 기준값 — 편집 화면 로드 시점의 updated_at(계약 §7 F5). */
  expectedUpdatedAt: string
): Promise<{ ok: true; id: string; removedImageRefs: string[] } | { ok: false; error: string }> {
  void userId; // F5 가 auth.uid() 소유권을 판정한다
  const title = input.title.trim();
  const body = input.body.trim();
  if (title.length < 1) return { ok: false, error: "title" };
  if (input.status === "published" && body.length < COMMUNITY_BODY_MIN) return { ok: false, error: "body" };
  if (input.category === "all") return { ok: false, error: "category" };
  if (!expectedUpdatedAt.trim()) return { ok: false, error: "conflict" };

  const res = await callApiWebV1Rpc(supabase, "community_post_update", {
    p_post_id: postId,
    p_title: title,
    p_body: body,
    p_category: input.category,
    p_expected_updated_at: expectedUpdatedAt,
    p_image_refs: input.imageUrls,
    p_status: input.status,
  });
  // UPDATE_CONFLICT 는 덮어쓰기·자동 재시도 없이 그대로 실패로 반환한다(§7 F5)
  if (!res.ok) return { ok: false, error: postEnvelopeCodeToSlug(res.code) };
  const id = typeof res.row.post_id === "string" ? res.row.post_id : postId;
  const removed = Array.isArray(res.row.removed_image_refs)
    ? (res.row.removed_image_refs as unknown[]).filter((r): r is string => typeof r === "string")
    : [];
  return { ok: true, id, removedImageRefs: removed };
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
