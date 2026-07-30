"use server";

import { redirect } from "next/navigation";
import { getServerAuthUser } from "@/lib/auth/getCurrentUser";
import { getUserProfileById } from "@/lib/auth/getCurrentProfile";
import { authorStoredLabelFromProfile } from "@/lib/community/communityAuthorLabels";
import { normalizeCommunityPostCategory } from "@/lib/community/communityBoardConstants";
import {
  insertBoardComment,
  insertCommunityBoardPost,
  softDeleteBoardComment,
  softDeleteCommunityBoardPost,
  togglePostReaction,
  updateCommunityBoardPost,
} from "@/lib/community/communityBoardMutations";
import { communityComposePath } from "@/lib/community/communityComposeTab";
import { revalidateCommunityPaths } from "@/lib/community/communityRevalidate";
import { deleteCommunityImageStoredRefs } from "@/lib/community/communityImageStorage";
import { createClient } from "@/lib/supabase/server";
import { assertAccountActive } from "@/lib/auth/accountStatus";
import {
  TRUST_SAFETY_COMMUNITY_ERROR_CODE,
  findRestrictedPhraseInText,
  maskContactInUserText,
  sanitizeTrustSafetyText,
} from "@/lib/safety/trustSafetyText";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_RETURN = "/community/new";

function safeReturnPath(raw: string): string {
  const path = raw.trim();
  if (path.startsWith("/community")) return path;
  return DEFAULT_RETURN;
}

/** 게시글 id 확보: 폼 필드 우선, 없으면 `/community/board/{uuid}` returnPath 에서 복구. */
function boardPostIdFrom(rawPostId: string, returnPath: string): string | null {
  const direct = rawPostId.trim();
  if (UUID_RE.test(direct)) return direct;
  const m = /^\/community\/board\/([^/?#]+)/.exec(returnPath.trim());
  const fromPath = m?.[1] ? decodeURIComponent(m[1]) : "";
  return UUID_RE.test(fromPath) ? fromPath : null;
}

function errRedirect(returnPath: string, code: string) {
  const sep = returnPath.includes("?") ? "&" : "?";
  return `${returnPath}${sep}error=${encodeURIComponent(code)}`;
}

/** 댓글(레거시 유지 경로) 전용 — 게시글은 F4/F5 가 서버에서 라벨·역할을 도출한다(W2 C5). */
async function authorLabelFor(userId: string): Promise<{ label: string }> {
  const supabase = await createClient();
  const { data: profile } = await getUserProfileById(supabase, userId);
  return { label: authorStoredLabelFromProfile(profile) };
}

// 이번 요청에서 새로 업로드했으나 DB write 가 실패한 이미지 객체를 보상 삭제한다.
// 삭제 실패는 은폐하지 않고 구조화 로그로 남긴다(primary 오류는 호출자가 redirect 로 전달).
async function compensateNewBoardImages(
  supabase: Awaited<ReturnType<typeof createClient>>,
  newRefs: readonly string[]
): Promise<void> {
  if (newRefs.length === 0) return;
  const del = await deleteCommunityImageStoredRefs(supabase, newRefs);
  if (!del.ok) {
    console.error("[board] orphan 이미지 보상 삭제 실패", { newRefs, error: del.error });
  }
}

export async function submitCommunityBoardPostAction(formData: FormData) {
  const { user } = await getServerAuthUser();
  const returnPath = safeReturnPath(String(formData.get("returnPath") ?? DEFAULT_RETURN));
  if (!user) redirect(`/login?next=${encodeURIComponent(returnPath.split("?")[0] ?? returnPath)}`);

  {
    const supabaseAcct = await createClient();
    const acctGate = await assertAccountActive(supabaseAcct, user.id);
    if (!acctGate.ok) redirect(errRedirect(returnPath, "account_blocked"));
  }

  const intent = String(formData.get("intent") ?? "publish");
  const status = intent === "draft" ? "draft" : "published";
  const draftId = String(formData.get("draftId") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const category = normalizeCommunityPostCategory(String(formData.get("category") ?? "free"));

  if (!title) redirect(errRedirect(returnPath, "title"));
  if (body.length < 10 && status === "published") redirect(errRedirect(returnPath, "body"));
  if (findRestrictedPhraseInText(title, body)) redirect(errRedirect(returnPath, TRUST_SAFETY_COMMUNITY_ERROR_CODE));

  const safeTitle = maskContactInUserText(title);
  const safeBody = maskContactInUserText(body);

  const supabase = await createClient();
  const isUpdate = Boolean(draftId) && UUID_RE.test(draftId);

  // W2(C5): 구 image_urls 사전 조회(community_posts 직접 읽기)는 제거 — 교체 제거분은
  // F5 성공 응답의 removed_image_refs 만 후속 Storage 정리 대상으로 삼는다(계약 §7 F5).

  // 저장 형식은 `bucket/path` ref. 편집 시 유지되는 기존 이미지는 ref 또는 (레거시) http URL 둘 다 수용.
  const imageRefs: string[] = [];
  const existingImagesRaw = String(formData.get("existingImageUrls") ?? "").trim();
  if (existingImagesRaw) {
    try {
      const parsed = JSON.parse(existingImagesRaw) as unknown;
      if (Array.isArray(parsed)) {
        imageRefs.push(...parsed.filter((u): u is string => typeof u === "string" && u.trim().length > 0));
      }
    } catch {
      /* ignore */
    }
  }

  // [staged upload] 파일은 액션 body 로 받지 않는다(413 회피). 클라가 Storage 로 직접 업로드하고
  // ref(텍스트)만 imageRefs 로 보낸다. 소유자·버킷·MIME·크기·개수 판정은 F4/F5(B-4)가 정본이다.
  const newUploadedRefs: string[] = [];
  const newImagesRaw = String(formData.get("imageRefs") ?? "").trim();
  if (newImagesRaw) {
    try {
      const parsed = JSON.parse(newImagesRaw) as unknown;
      if (Array.isArray(parsed)) {
        for (const r of parsed) {
          if (typeof r === "string" && r.trim().length > 0) newUploadedRefs.push(r.trim());
        }
      }
    } catch {
      /* ignore */
    }
  }
  imageRefs.push(...newUploadedRefs);

  // 요청 UUID → F4 멱등키(작성 시도당 1회 생성 — 폼이 생성·재시도 재사용). 없으면 이번
  // 시도 한정으로 서버에서 1회 발급한다(새 키 재발급 재시도 금지 — 계약 §7 F4).
  const requestId = String(formData.get("requestId") ?? "").trim();
  const createIdempotencyKey = requestId && UUID_RE.test(requestId) ? requestId : crypto.randomUUID();
  const expectedUpdatedAt = String(formData.get("expectedUpdatedAt") ?? "").trim();

  const payload = {
    title: safeTitle,
    body: safeBody,
    category,
    imageUrls: imageRefs,
    hashtags: [] as string[],
    status: status as "draft" | "published",
    createIdempotencyKey,
  };

  const r = isUpdate
    ? await updateCommunityBoardPost(supabase, user.id, draftId, payload, expectedUpdatedAt)
    : await insertCommunityBoardPost(supabase, user.id, payload);

  if (!r.ok) {
    // §14.4 보상 분기: 확정 실패 envelope(미커밋 확정)에서만 이번 요청 신규 업로드분을
    // 보상 삭제한다. 응답 불명확(전송 오류 — mutation 이 동일 키로 1회 재호출까지 실패)
    // 이면 삭제하지 않고 같은 멱등키 재시도를 안내한다(선삭제 금지).
    const definite = !("definite" in r) || r.definite !== false;
    if (definite) {
      await compensateNewBoardImages(supabase, newUploadedRefs);
      redirect(errRedirect(returnPath, r.error));
    }
    redirect(errRedirect(returnPath, "network"));
  }

  // 멱등 재생 성공(F4 idempotent_replay:true) = 성공 — 객체를 삭제하지 않는다(§14.4 분기 4).
  // 확정 rollback·미커밋 케이스에서만 보상 삭제가 일어난다(위 분기).

  // F5 성공 → 서버가 판정한 removed_image_refs 만 후속 정리(post-commit 실패는 구조화 로그).
  if (isUpdate && "removedImageRefs" in r && r.removedImageRefs.length > 0) {
    const del = await deleteCommunityImageStoredRefs(supabase, r.removedImageRefs);
    if (!del.ok) {
      console.error("[board] 교체 구이미지 정리 실패", { postId: r.id, removed: r.removedImageRefs, error: del.error });
    }
  }

  // 매트릭스: 글 작성/수정 × (공개 목록·상세·내 활동·관리자). 수정 시 상세도 함께 갱신한다.
  revalidateCommunityPaths({
    mutation: isUpdate ? "post_update" : "post_create",
    kind: "board",
    postId: r.id,
  });

  if (status === "published") redirect(`/community/board/${r.id}`);

  const draftReturn = communityComposePath("board", { draft: "1", draftId: r.id });
  redirect(draftReturn);
}

/**
 * 게시글 삭제(작성자 전용). soft-delete(deleted_at) — hard DELETE 금지, 행 보존(관리자 감사).
 * 서버에서 소유권 재검사(mutation 이 author_id 스코프). 삭제 후 목록/상세에서 제외된다.
 * 이미지 객체는 삭제하지 않는다(감사·복구 여지 · owner-scoped 정리는 별도).
 */
export async function deleteCommunityBoardPostAction(formData: FormData) {
  const postId = String(formData.get("postId") ?? "").trim();
  const returnPath = String(formData.get("returnPath") ?? "/community").trim();
  const safeReturn = returnPath.startsWith("/") ? returnPath : "/community";

  const { user } = await getServerAuthUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(safeReturn)}`);
  if (!UUID_RE.test(postId)) redirect(safeReturn);

  const supabase = await createClient();
  const r = await softDeleteCommunityBoardPost(supabase, user.id, postId);
  if (!r.ok) {
    redirect(errRedirect(safeReturn, "delete"));
  }

  revalidateCommunityPaths({ mutation: "post_delete", kind: "board", postId });
  redirect("/community");
}

export async function toggleCommunityPostReactionAction(formData: FormData) {
  const postId = String(formData.get("postId") ?? "").trim();
  const type = String(formData.get("type") ?? "") as "like" | "scrap";
  const returnPath = String(formData.get("returnPath") ?? "/community").trim();

  const { user } = await getServerAuthUser();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(returnPath)}`);
  }
  if (!UUID_RE.test(postId) || (type !== "like" && type !== "scrap")) {
    redirect(returnPath.startsWith("/") ? returnPath : "/community");
  }

  const supabase = await createClient();
  await togglePostReaction(supabase, user.id, postId, type);

  revalidateCommunityPaths({
    mutation: "reaction_toggle",
    kind: "board",
    postId,
    extraPaths: [returnPath],
  });
  redirect(returnPath);
}

export async function submitBoardCommentAction(formData: FormData) {
  const postId = String(formData.get("postId") ?? "").trim();
  const parentId = String(formData.get("parentId") ?? "").trim() || null;
  const content = String(formData.get("content") ?? "");
  const returnPath = String(formData.get("returnPath") ?? "").trim();

  const { user } = await getServerAuthUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(returnPath)}`);

  if (!UUID_RE.test(postId) || !returnPath.startsWith("/")) redirect("/community");

  const safety = sanitizeTrustSafetyText(content.trim());
  if (!safety.ok) {
    const q = new URLSearchParams();
    q.set("commentError", TRUST_SAFETY_COMMUNITY_ERROR_CODE);
    redirect(`${returnPath}?${q.toString()}`);
  }

  const { label } = await authorLabelFor(user.id);
  const supabase = await createClient();
  const acctGate = await assertAccountActive(supabase, user.id);
  if (!acctGate.ok) {
    const q = new URLSearchParams();
    q.set("commentError", "account_blocked");
    redirect(`${returnPath}?${q.toString()}`);
  }
  const r = await insertBoardComment(supabase, user.id, {
    postId,
    parentId: parentId && UUID_RE.test(parentId) ? parentId : null,
    content: safety.text,
    authorLabel: label,
  });

  if (!r.ok) {
    const q = new URLSearchParams();
    q.set("commentError", r.error);
    redirect(`${returnPath}?${q.toString()}`);
  }

  revalidateCommunityPaths({
    mutation: "comment_create",
    kind: "board",
    postId,
    extraPaths: [returnPath],
  });
  redirect(returnPath);
}

export async function deleteBoardCommentAction(formData: FormData) {
  const commentId = String(formData.get("commentId") ?? "").trim();
  const returnPath = String(formData.get("returnPath") ?? "").trim();
  // 댓글 삭제도 글 상세·목록·내 활동을 함께 갱신하려면 소속 글 id 가 필요하다.
  // 폼이 넘겨주지 않는 레거시 호출을 위해 returnPath 에서도 복구한다.
  const postId = boardPostIdFrom(String(formData.get("postId") ?? ""), returnPath);
  const { user } = await getServerAuthUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(returnPath)}`);
  if (!UUID_RE.test(commentId)) redirect(returnPath);

  const supabase = await createClient();
  await softDeleteBoardComment(supabase, user.id, commentId);
  revalidateCommunityPaths({
    mutation: "comment_delete",
    kind: "board",
    postId,
    extraPaths: [returnPath],
  });
  redirect(returnPath);
}
