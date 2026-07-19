"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServerAuthUser } from "@/lib/auth/getCurrentUser";
import { getUserProfileById } from "@/lib/auth/getCurrentProfile";
import { authorStoredLabelFromProfile } from "@/lib/community/communityAuthorLabels";
import { communityComposePath } from "@/lib/community/communityComposeTab";
import {
  insertShortformPost,
  toggleShortformLike,
  updateShortformPost,
} from "@/lib/community/communityShortformMutations";
import type { ShortformCategorySlug } from "@/lib/community/communityShortformConstants";
import {
  deleteShortformVideoStoredRef,
  isShortformStoredVideoRef,
  uploadShortformVideo,
} from "@/lib/community/communityShortformStorage";
import { createClient } from "@/lib/supabase/server";
import { assertAccountActive } from "@/lib/auth/accountStatus";
import {
  TRUST_SAFETY_COMMUNITY_ERROR_CODE,
  findRestrictedPhraseInText,
  maskContactInUserText,
} from "@/lib/safety/trustSafetyText";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function err(path: string, code: string): never {
  redirect(`${path}?error=${encodeURIComponent(code)}`);
}

function safeShortformReturnPath(raw: string): string {
  const path = raw.trim();
  return path.startsWith("/community/shortform") ? path : "/community/shortform";
}

function appendQuery(path: string, key: string, value: string): string {
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}${key}=${encodeURIComponent(value)}`;
}

// 이번 요청에서 새로 업로드했으나 DB write 가 실패한 video 객체를 보상 삭제한다.
// 삭제 실패는 은폐하지 않고 구조화 로그로 남긴다(primary 오류는 호출자가 redirect 로 전달).
async function compensateNewShortformVideo(
  supabase: Awaited<ReturnType<typeof createClient>>,
  uploadedRef: string | null
): Promise<void> {
  if (!uploadedRef) return;
  const del = await deleteShortformVideoStoredRef(supabase, uploadedRef);
  if (!del.ok) {
    console.error("[shortform] orphan video 보상 삭제 실패", { uploadedRef, error: del.error });
  }
}

export async function submitShortformUploadAction(formData: FormData) {
  const returnPath = communityComposePath("shortform");
  const { user } = await getServerAuthUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(returnPath)}`);

  const supabase = await createClient();
  const acctGate = await assertAccountActive(supabase, user.id);
  if (!acctGate.ok) redirect("/community/shortform?error=account_blocked");
  const { data: profile } = await getUserProfileById(supabase, user.id);
  if (profile?.role !== "mentor") redirect("/community/shortform?error=mentor_only");

  const intent = String(formData.get("intent") ?? "publish");
  const status = intent === "draft" ? "draft" : "published";
  const draftId = String(formData.get("draftId") ?? "").trim();
  const isUpdate = Boolean(draftId) && UUID_RE.test(draftId);
  const title = String(formData.get("title") ?? "").trim();
  const category = String(formData.get("category") ?? "study") as ShortformCategorySlug;
  const body = String(formData.get("body") ?? "").trim();
  const source = String(formData.get("source") ?? "").trim();
  const rights = formData.get("rightsAck") === "on";

  // 인증·입력 검증은 업로드 전에 끝낸다(고아 업로드 방지).
  if (!rights && status === "published") err(returnPath, "rights");
  if (!title) err(returnPath, "title");
  if (findRestrictedPhraseInText(title, body)) err(returnPath, TRUST_SAFETY_COMMUNITY_ERROR_CODE);

  const safeTitle = maskContactInUserText(title);
  const safeBody = maskContactInUserText(body);

  // UPDATE 경로: 새 업로드 전에 소유권 조건으로 기존 video_url 을 조회한다(교체 시 구파일 차집합 삭제용).
  let oldVideoRef: string | null = null;
  if (isUpdate) {
    const { data: existing } = await supabase
      .from("shortform_posts")
      .select("video_url")
      .eq("id", draftId)
      .eq("author_id", user.id)
      .maybeSingle();
    const ev = existing && typeof (existing as { video_url?: unknown }).video_url === "string"
      ? (existing as { video_url: string }).video_url
      : null;
    oldVideoRef = ev;
  }

  const videoFile = formData.get("video");
  let videoUrl = String(formData.get("videoUrl") ?? "").trim();
  let uploadedRef: string | null = null; // 이번 요청에서 새로 업로드한 ref(실패 시 보상 대상)
  if (videoFile instanceof File && videoFile.size > 0) {
    const buf = Buffer.from(await videoFile.arrayBuffer());
    const up = await uploadShortformVideo(supabase, user.id, buf, videoFile.type || "video/mp4");
    if (up.error) err(returnPath, up.error === "size" ? "video_size" : "video_upload");
    videoUrl = up.url ?? "";
    uploadedRef = up.url ?? null;
  }
  if (!videoUrl && status === "published") {
    // 아직 DB write 전. 방금 업로드한 새 객체가 있으면 고아 방지 위해 보상 삭제 후 오류.
    await compensateNewShortformVideo(supabase, uploadedRef);
    err(returnPath, "video");
  }

  const label = authorStoredLabelFromProfile(profile);
  const payload = {
    title: safeTitle,
    category,
    videoUrl,
    thumbnailUrl: null as string | null,
    body: safeBody,
    tags: [] as string[],
    source,
    status: status as "draft" | "published",
    authorLabel: label,
  };

  const r = isUpdate
    ? await updateShortformPost(supabase, user.id, draftId, payload)
    : await insertShortformPost(supabase, user.id, payload);

  if (!r.ok) {
    // DB 실패(INSERT/UPDATE 오류·UPDATE 0행) → 이번 요청 신규 video 고아 방지 보상 삭제.
    await compensateNewShortformVideo(supabase, uploadedRef);
    err(returnPath, r.error);
  }

  // DB 성공 → 교체된 구영상 차집합 삭제(old != final 이고 old 가 우리 stored video ref 일 때만).
  // 썸네일은 현재 액션이 업로드하지 않으므로 보상 대상 제외.
  if (isUpdate && oldVideoRef && oldVideoRef !== videoUrl && isShortformStoredVideoRef(oldVideoRef)) {
    const del = await deleteShortformVideoStoredRef(supabase, oldVideoRef);
    if (!del.ok) {
      // post-commit 실패는 DB 성공을 되돌릴 수 없다 → 구조화 경고 로그, 은폐 금지, 재정리 대상.
      console.error("[shortform] 교체 구영상 정리 실패", { postId: r.id, oldVideoRef, error: del.error });
    }
  }

  revalidatePath("/community/shortform");
  revalidatePath("/community");
  revalidatePath("/community/me");

  if (status === "published") redirect(`/community/shortform/${r.id}`);
  redirect(communityComposePath("shortform", { draft: "1", draftId: r.id }));
}

export async function toggleShortformLikeAction(formData: FormData) {
  const postId = String(formData.get("postId") ?? "").trim();
  const returnPath = safeShortformReturnPath(String(formData.get("returnPath") ?? "/community/shortform"));

  const { user } = await getServerAuthUser();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(returnPath)}`);
  }
  if (!UUID_RE.test(postId)) {
    redirect(returnPath);
  }

  const supabase = await createClient();
  const result = await toggleShortformLike(supabase, user.id, postId);

  revalidatePath(returnPath);
  revalidatePath(`/community/shortform/${postId}`);
  revalidatePath("/community/shortform");
  revalidatePath("/community");

  if (!result.ok) {
    redirect(appendQuery(returnPath, "likeError", "not_ready"));
  }
  redirect(returnPath);
}
