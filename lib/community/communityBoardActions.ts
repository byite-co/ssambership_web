"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServerAuthUser } from "@/lib/auth/getCurrentUser";
import { getUserProfileById } from "@/lib/auth/getCurrentProfile";
import { authorStoredLabelFromProfile } from "@/lib/community/communityAuthorLabels";
import {
  COMMUNITY_IMAGE_MAX,
  normalizeCommunityPostCategory,
} from "@/lib/community/communityBoardConstants";
import {
  insertBoardComment,
  insertCommunityBoardPost,
  softDeleteBoardComment,
  softDeleteCommunityBoardPost,
  togglePostReaction,
  updateCommunityBoardPost,
} from "@/lib/community/communityBoardMutations";
import { getCommunityBoardEditablePost } from "@/lib/community/communityBoardQueries";
import { COMMUNITY_POST_IMAGES_BUCKET } from "@/lib/community/communityStorage";
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

async function authorLabelFor(userId: string): Promise<{ label: string; role: string | null }> {
  const supabase = await createClient();
  const { data: profile } = await getUserProfileById(supabase, userId);
  const label = authorStoredLabelFromProfile(profile);
  // DB CHECK(community_posts_author_role_chk)는 영문 mentor/student/admin/user 만 허용한다.
  // 한글('멘토'/'학생')을 저장하면 INSERT 가 CHECK 를 위반하므로 영문으로 정규화한다(그 외는 null).
  const role = profile?.role === "mentor" ? "mentor" : profile?.role === "student" ? "student" : null;
  return { label, role };
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

export type BoardFinalizeInput = {
  intent: "draft" | "publish";
  /** 편집 대상 글(초안·게시) id. 신규 작성이면 비움. */
  postId?: string | null;
  title: string;
  body: string;
  category: string;
  /** 편집 시 유지하는 기존 이미지 ref(서버가 실제 소유 글의 image_urls 와 교집합만 인정). */
  existingImageRefs?: string[];
  /** 이번 요청에서 직접 업로드한 이미지 ref(`community-post-images/{uid}/...`). */
  newImageRefs?: string[];
  /** 생성 멱등키(uuid) — 더블클릭·재시도 중복 INSERT 차단. */
  idempotencyKey: string;
};

export type BoardFinalizeResult =
  | { ok: true; id: string; status: "draft" | "published" }
  | { ok: false; error: string };

/** ref 가 정확히 `community-post-images/{uid}/...` 형식인지(임의 bucket/path·타인 폴더 차단). */
function isOwnedCommunityImageRef(ref: string, uid: string): boolean {
  return ref.startsWith(`${COMMUNITY_POST_IMAGES_BUCKET}/${uid}/`);
}

/**
 * 게시판 finalize — 이미지 File 을 받지 않는다. 브라우저가 서명 계약으로 Storage 에 직접 올린 뒤
 * 텍스트 metadata + 이미지 ref 만 넘긴다. 여기서 DB 행을 원자 생성(멱등키)·수정한다.
 */
export async function finalizeCommunityBoardPostAction(
  input: BoardFinalizeInput,
): Promise<BoardFinalizeResult> {
  const { user } = await getServerAuthUser();
  if (!user) return { ok: false, error: "auth" };

  const supabase = await createClient();
  const acctGate = await assertAccountActive(supabase, user.id);
  if (!acctGate.ok) return { ok: false, error: "account_blocked" };

  const status: "draft" | "published" = input.intent === "draft" ? "draft" : "published";
  const postId = String(input.postId ?? "").trim();
  const isUpdate = Boolean(postId) && UUID_RE.test(postId);
  const title = String(input.title ?? "").trim();
  const body = String(input.body ?? "").trim();
  const category = normalizeCommunityPostCategory(String(input.category ?? "free"));
  const idemKey = String(input.idempotencyKey ?? "").trim();

  // 이번 요청 신규 업로드 ref — 형식·소유 검증된 것만(임의 ref 저장·삭제 차단).
  const newRefs = (input.newImageRefs ?? [])
    .filter((r): r is string => typeof r === "string" && r.trim().length > 0)
    .filter((r) => isOwnedCommunityImageRef(r, user.id));

  const compensate = async () => {
    if (newRefs.length > 0) await compensateNewBoardImages(supabase, newRefs);
  };

  if (!idemKey || !UUID_RE.test(idemKey)) {
    await compensate();
    return { ok: false, error: "invalid_request" };
  }
  if (!title) {
    await compensate();
    return { ok: false, error: "title" };
  }
  if (body.length < 10 && status === "published") {
    await compensate();
    return { ok: false, error: "body" };
  }
  if (findRestrictedPhraseInText(title, body)) {
    await compensate();
    return { ok: false, error: TRUST_SAFETY_COMMUNITY_ERROR_CODE };
  }

  // 편집 시: 실제 소유 글(삭제 안 됨)의 image_urls 를 authoritative 로 조회한다.
  // 클라이언트가 보낸 existingImageRefs 는 이 실제 목록과의 교집합만 인정(임의 ref 주입 차단).
  let oldImageRefs: string[] = [];
  let keptExisting: string[] = [];
  if (isUpdate) {
    const editable = await getCommunityBoardEditablePost(supabase, user.id, postId);
    if (editable.error || !editable.draft) {
      await compensate();
      return { ok: false, error: "not_found" };
    }
    oldImageRefs = editable.draft.imageUrls.filter((u) => typeof u === "string" && u.trim().length > 0);
    const oldSet = new Set(oldImageRefs);
    keptExisting = (input.existingImageRefs ?? []).filter(
      (r): r is string => typeof r === "string" && oldSet.has(r),
    );
  }

  const imageRefs = [...keptExisting, ...newRefs].slice(0, COMMUNITY_IMAGE_MAX);
  if (keptExisting.length + newRefs.length > COMMUNITY_IMAGE_MAX) {
    await compensate();
    return { ok: false, error: "images" };
  }

  const { label, role } = await authorLabelFor(user.id);
  const payload = {
    title: maskContactInUserText(title),
    body: maskContactInUserText(body),
    category,
    imageUrls: imageRefs,
    hashtags: [] as string[],
    status,
    authorLabel: label,
    authorRole: role,
    createIdempotencyKey: idemKey,
  };

  const r = isUpdate
    ? await updateCommunityBoardPost(supabase, user.id, postId, payload)
    : await insertCommunityBoardPost(supabase, user.id, payload);

  if (!r.ok) {
    await compensate();
    return { ok: false, error: r.error };
  }

  // 멱등키가 기존 행을 되돌린 동시 중복요청: 이번 요청 신규 업로드 이미지는 어디에도 참조 안 됨 → 고아 정리.
  if (!isUpdate && "created" in r && r.created === false && newRefs.length > 0) {
    await compensateNewBoardImages(supabase, newRefs);
  }

  // DB 성공(UPDATE) → 제거된 구이미지 차집합(old − final) 삭제. 삭제는 owner-scoped RLS 로 본인 객체만.
  if (isUpdate && oldImageRefs.length > 0) {
    const finalSet = new Set(imageRefs);
    const removed = oldImageRefs.filter((ref) => !finalSet.has(ref));
    if (removed.length > 0) {
      const del = await deleteCommunityImageStoredRefs(supabase, removed);
      if (!del.ok) {
        console.error("[board] 교체 구이미지 정리 실패", { postId: r.id, removed, error: del.error });
      }
    }
  }

  revalidatePath("/community");
  revalidatePath("/community/board");
  revalidatePath("/community/me");
  if (r.id) revalidatePath(`/community/board/${r.id}`);

  return { ok: true, id: r.id, status };
}

/**
 * 게시글 소프트삭제 액션 — hard DELETE 금지. 작성자 본인만, deleted_at 채워 숨김(감사 보존).
 */
export async function softDeleteCommunityBoardPostAction(input: {
  postId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { user } = await getServerAuthUser();
  if (!user) return { ok: false, error: "auth" };
  const postId = String(input.postId ?? "").trim();
  if (!UUID_RE.test(postId)) return { ok: false, error: "invalid_request" };

  const supabase = await createClient();
  const r = await softDeleteCommunityBoardPost(supabase, user.id, postId);
  if (!r.ok) return { ok: false, error: r.error };

  revalidatePath("/community");
  revalidatePath("/community/board");
  revalidatePath("/community/me");
  revalidatePath(`/community/board/${postId}`);
  return { ok: true };
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

  revalidatePath(returnPath);
  revalidatePath(`/community/board/${postId}`);
  revalidatePath("/community");
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

  revalidatePath(`/community/board/${postId}`);
  revalidatePath("/community");
  redirect(returnPath);
}

export async function deleteBoardCommentAction(formData: FormData) {
  const commentId = String(formData.get("commentId") ?? "").trim();
  const returnPath = String(formData.get("returnPath") ?? "").trim();
  const { user } = await getServerAuthUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(returnPath)}`);
  if (!UUID_RE.test(commentId)) redirect(returnPath);

  const supabase = await createClient();
  await softDeleteBoardComment(supabase, user.id, commentId);
  revalidatePath(returnPath);
  redirect(returnPath);
}
