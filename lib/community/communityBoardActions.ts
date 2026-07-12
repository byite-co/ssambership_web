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
  togglePostReaction,
  updateCommunityBoardPost,
} from "@/lib/community/communityBoardMutations";
import { communityComposePath } from "@/lib/community/communityComposeTab";
import { uploadCommunityPostImages } from "@/lib/community/communityStorage";
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

function errRedirect(returnPath: string, code: string) {
  const sep = returnPath.includes("?") ? "&" : "?";
  return `${returnPath}${sep}error=${encodeURIComponent(code)}`;
}

async function authorLabelFor(userId: string): Promise<{ label: string; role: string | null }> {
  const supabase = await createClient();
  const { data: profile } = await getUserProfileById(supabase, userId);
  const label = authorStoredLabelFromProfile(profile);
  const role = profile?.role === "mentor" ? "멘토" : profile?.role === "student" ? "학생" : null;
  return { label, role };
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
  // 저장 형식은 이제 `bucket/path` ref(BUG-B). 편집 시 유지되는 기존 이미지는
  // ref 또는 (레거시) http URL 둘 다 수용 — 빈 문자열만 제외.
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

  const files = formData.getAll("images").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length + imageRefs.length > COMMUNITY_IMAGE_MAX) redirect(errRedirect(returnPath, "images"));

  if (files.length) {
    const buffers = await Promise.all(
      files.slice(0, COMMUNITY_IMAGE_MAX - imageRefs.length).map(async (f) => ({
        buffer: Buffer.from(await f.arrayBuffer()),
        mime: (f.type || "image/jpeg").toLowerCase(),
        name: f.name || "image",
      }))
    );
    const up = await uploadCommunityPostImages(supabase, user.id, buffers);
    if (up.error) redirect(errRedirect(returnPath, "upload"));
    imageRefs.push(...up.refs);
  }

  const { label, role } = await authorLabelFor(user.id);
  const payload = {
    title: safeTitle,
    body: safeBody,
    category,
    imageUrls: imageRefs,
    hashtags: [] as string[],
    status: status as "draft" | "published",
    authorLabel: label,
    authorRole: role,
  };

  const r =
    draftId && UUID_RE.test(draftId)
      ? await updateCommunityBoardPost(supabase, user.id, draftId, payload)
      : await insertCommunityBoardPost(supabase, user.id, payload);

  if (!r.ok) redirect(errRedirect(returnPath, r.error));

  revalidatePath("/community");
  revalidatePath("/community/board");
  revalidatePath("/community/me");

  if (status === "published") redirect(`/community/board/${r.id}`);

  const draftReturn = communityComposePath("board", { draft: "1", draftId: r.id });
  redirect(draftReturn);
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
