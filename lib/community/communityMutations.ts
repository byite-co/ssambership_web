import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 숏폼 댓글(및 레거시 board 경로) 정본 저장 — `public.community_comments`.
 *
 * D-CM-14 정리: 구 `insertMentorShortformPost`(컬럼 후보 payload 6종을 순차 시도하는 프로빙
 * INSERT)와 그 헬퍼(insertWithCandidates)는 현행 스키마와 불일치하고 어떤 후보가 성공하는지에
 * 따라 저장 컬럼이 달라져 RPC-정본 정책을 우회했다. 유일한 호출부였던 사장 폼(MentorCommunity
 * ComposeForm)·액션(communityComposeActions)과 함께 삭제했다. 숏폼 작성 정본은
 * communityShortformActions → communityShortformMutations 이다.
 */

export type InsertCommunityCommentInput = {
  postType: "board" | "shortform";
  postId: string;
  body: string;
};

/**
 * public.community_comments — 016 SQL 선행. author_id = 로그인 사용자(액션에서 전달)
 */
export async function insertCommunityComment(
  supabase: SupabaseClient,
  userId: string,
  input: InsertCommunityCommentInput
): Promise<{ ok: true } | { ok: false; error: "validation" | "db" }> {
  const { postType, postId, body } = input;
  const trimmed = body.trim();
  if (trimmed.length < 1 || trimmed.length > 1000) {
    return { ok: false, error: "validation" };
  }
  // author_label 은 클라이언트가 보내지 않는다 — 서버 트리거가 users 정본에서
  // 파생한다(board·shortform 공통, 수렴 §10.6).
  const { error } = await supabase.from("community_comments").insert({
    post_type: postType,
    post_id: postId,
    author_id: userId,
    body: trimmed,
    status: "visible",
  });
  if (error) {
    return { ok: false, error: "db" };
  }
  return { ok: true };
}
