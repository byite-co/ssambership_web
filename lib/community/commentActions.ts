"use server";

import { redirect } from "next/navigation";
import { revalidateCommunityPaths } from "@/lib/community/communityRevalidate";
import { getServerAuthUser } from "@/lib/auth/getCurrentUser";
import { createClient } from "@/lib/supabase/server";
import { insertCommunityComment } from "@/lib/community/communityMutations";
import { assertAccountActive } from "@/lib/auth/accountStatus";
import { TRUST_SAFETY_COMMUNITY_ERROR_CODE, sanitizeTrustSafetyText } from "@/lib/safety/trustSafetyText";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function buildCommentRedirect(path: string, err: string) {
  const q = new URLSearchParams();
  q.set("commentError", err);
  return `${path}?${q.toString()}`;
}

export async function submitCommunityCommentAction(formData: FormData) {
  const postType = String(formData.get("postType") ?? "").trim();
  const postId = String(formData.get("postId") ?? "").trim();
  const body = String(formData.get("body") ?? "");
  const returnPath = String(formData.get("returnPath") ?? "").trim();

  const { user } = await getServerAuthUser();
  if (!user) {
    if (returnPath.startsWith("/")) {
      redirect(`/login?next=${encodeURIComponent(returnPath)}`);
    }
    redirect("/login");
  }

  if (postType !== "board" && postType !== "shortform") {
    redirect(buildCommentRedirect(returnPath || "/community", "invalid"));
  }
  if (!UUID_RE.test(postId)) {
    redirect(buildCommentRedirect(returnPath || "/community", "invalid"));
  }
  if (!returnPath.startsWith("/")) {
    redirect("/community");
  }

  const t = body.trim();
  if (t.length < 1 || t.length > 1000) {
    redirect(buildCommentRedirect(returnPath, "length"));
  }
  const safety = sanitizeTrustSafetyText(t);
  if (!safety.ok) {
    redirect(buildCommentRedirect(returnPath, TRUST_SAFETY_COMMUNITY_ERROR_CODE));
  }

  const supabase = await createClient();

  // D-CM-7: 게시판 댓글(submitBoardCommentAction)과 동일하게 계정 상태 게이트를 통과해야 한다.
  // 이 검사가 없어 정지·탈퇴 진행 계정이 숏폼에 공개 댓글을 계속 남길 수 있었다.
  const acctGate = await assertAccountActive(supabase, user.id);
  if (!acctGate.ok) {
    redirect(buildCommentRedirect(returnPath, "account_blocked"));
  }

  // author_label 은 서버 트리거가 users 정본에서 파생한다(수렴 §10.6) — 전송 0.
  const r = await insertCommunityComment(supabase, user.id, {
    postType,
    postId,
    body: safety.text,
  });

  if (!r.ok) {
    if (r.error === "validation") {
      redirect(buildCommentRedirect(returnPath, "length"));
    }
    redirect(buildCommentRedirect(returnPath, "save"));
  }

  revalidateCommunityPaths({
    mutation: "comment_create",
    kind: postType === "board" ? "board" : "shortform",
    postId,
    extraPaths: [returnPath],
  });

  redirect(returnPath);
}

/**
 * 숏폼 댓글 삭제(작성자 전용) — D-CM-8. 숏폼 댓글은 `community_comments` 정본에 저장되고
 * 정본 삭제 RPC `community_comment_soft_delete_self`(소유·계정 게이트·moderation 유지·멱등 재삭제)
 * 가 있는데도 삭제 액션·UI 가 없어 작성자가 자기 댓글을 지울 방법이 없었다. RPC 를 그대로 호출하고
 * 실패는 무음으로 삼키지 않고 오류 쿼리스트링으로 표면화한다(게시판 댓글 삭제와 동일 계약).
 */
export async function deleteShortformCommentAction(formData: FormData) {
  const commentId = String(formData.get("commentId") ?? "").trim();
  const returnPath = String(formData.get("returnPath") ?? "").trim();

  const { user } = await getServerAuthUser();
  if (!user) {
    if (returnPath.startsWith("/")) redirect(`/login?next=${encodeURIComponent(returnPath)}`);
    redirect("/login");
  }
  if (!UUID_RE.test(commentId) || !returnPath.startsWith("/")) {
    redirect(buildCommentRedirect(returnPath || "/community", "invalid"));
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("community_comment_soft_delete_self", { p_comment_id: commentId });
  if (error) {
    redirect(buildCommentRedirect(returnPath, "delete"));
  }

  revalidateCommunityPaths({
    mutation: "comment_delete",
    kind: "shortform",
    extraPaths: [returnPath],
  });
  redirect(returnPath);
}
