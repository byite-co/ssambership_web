"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServerAuthUser } from "@/lib/auth/getCurrentUser";
import { getUserProfileById } from "@/lib/auth/getCurrentProfile";
import { authorStoredLabelFromProfile } from "@/lib/community/communityAuthorLabels";
import {
  insertShortformPost,
  toggleShortformLike,
  updateShortformPost,
} from "@/lib/community/communityShortformMutations";
import type { ShortformCategorySlug } from "@/lib/community/communityShortformConstants";
import {
  deleteShortformVideoStoredRef,
  isShortformStoredVideoRef,
} from "@/lib/community/communityShortformStorage";
import { SHORTFORM_VIDEO_BUCKET } from "@/lib/community/communityShortformConstants";
import { createClient } from "@/lib/supabase/server";
import { assertAccountActive } from "@/lib/auth/accountStatus";
import {
  TRUST_SAFETY_COMMUNITY_ERROR_CODE,
  findRestrictedPhraseInText,
  maskContactInUserText,
} from "@/lib/safety/trustSafetyText";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

export type ShortformFinalizeInput = {
  intent: "draft" | "publish";
  draftId?: string | null;
  title: string;
  category: string;
  body?: string;
  source?: string;
  rightsAck: boolean;
  /** 저장할 최종 video ref(`shortform-videos/{uid}/...`). draft 유지 시 기존 ref. */
  videoRef?: string | null;
  /** 이번 요청에서 새로 직접 업로드한 ref(있으면 실패 시 보상 삭제 대상). */
  newVideoRef?: string | null;
  /** 생성 멱등키(uuid) — 더블클릭·재시도 중복 INSERT 차단. */
  idempotencyKey: string;
};

export type ShortformFinalizeResult =
  | { ok: true; id: string; status: "draft" | "published" }
  | { ok: false; error: string };

/** ref 가 정확히 `shortform-videos/{uid}/...` 형식인지(임의 bucket/path·타인 폴더 차단). */
function isOwnedShortformVideoRef(ref: string, uid: string): boolean {
  return ref.startsWith(`${SHORTFORM_VIDEO_BUCKET}/${uid}/`);
}

/**
 * 숏폼 finalize — 영상 File 을 받지 않는다. 브라우저가 서명 계약으로 Storage 에 직접 올린 뒤
 * 텍스트 metadata + storage ref 만 이 액션에 전달한다. 여기서 DB 행을 원자 생성(멱등키)한다.
 */
export async function finalizeShortformUploadAction(
  input: ShortformFinalizeInput,
): Promise<ShortformFinalizeResult> {
  const { user } = await getServerAuthUser();
  if (!user) return { ok: false, error: "auth" };

  const supabase = await createClient();
  const acctGate = await assertAccountActive(supabase, user.id);
  if (!acctGate.ok) return { ok: false, error: "account_blocked" };
  const { data: profile } = await getUserProfileById(supabase, user.id);
  if (profile?.role !== "mentor") return { ok: false, error: "mentor_only" };

  const status: "draft" | "published" = input.intent === "draft" ? "draft" : "published";
  const draftId = String(input.draftId ?? "").trim();
  const isUpdate = Boolean(draftId) && UUID_RE.test(draftId);
  const title = String(input.title ?? "").trim();
  const category = String(input.category ?? "study") as ShortformCategorySlug;
  const body = String(input.body ?? "").trim();
  const source = String(input.source ?? "").trim();
  const idemKey = String(input.idempotencyKey ?? "").trim();

  const newVideoRef = String(input.newVideoRef ?? "").trim() || null;
  const videoRef = String(input.videoRef ?? "").trim() || null;

  // 이번 요청 신규 업로드 객체의 보상 삭제 헬퍼(형식·소유 검증된 것만).
  const compensate = async () => {
    if (newVideoRef && isOwnedShortformVideoRef(newVideoRef, user.id)) {
      await compensateNewShortformVideo(supabase, newVideoRef);
    }
  };

  if (!idemKey || !UUID_RE.test(idemKey)) {
    await compensate();
    return { ok: false, error: "invalid_request" };
  }
  // ref 형식·소유 검증 — 임의 bucket/path 저장 차단.
  if (videoRef && !isOwnedShortformVideoRef(videoRef, user.id)) {
    await compensate();
    return { ok: false, error: "video_upload" };
  }
  if (input.intent === "publish" && !input.rightsAck) {
    await compensate();
    return { ok: false, error: "rights" };
  }
  if (!title) {
    await compensate();
    return { ok: false, error: "title" };
  }
  if (findRestrictedPhraseInText(title, body)) {
    await compensate();
    return { ok: false, error: TRUST_SAFETY_COMMUNITY_ERROR_CODE };
  }
  if (!videoRef && status === "published") {
    await compensate();
    return { ok: false, error: "video" };
  }

  // UPDATE 경로: 소유권 조건으로 기존 video_url 을 조회(교체 시 구파일 차집합 삭제용).
  let oldVideoRef: string | null = null;
  if (isUpdate) {
    const { data: existing } = await supabase
      .from("shortform_posts")
      .select("video_url")
      .eq("id", draftId)
      .eq("author_id", user.id)
      .maybeSingle();
    oldVideoRef =
      existing && typeof (existing as { video_url?: unknown }).video_url === "string"
        ? (existing as { video_url: string }).video_url
        : null;
  }

  const label = authorStoredLabelFromProfile(profile);
  const payload = {
    title: maskContactInUserText(title),
    category,
    videoUrl: videoRef ?? "",
    thumbnailUrl: null as string | null,
    body: maskContactInUserText(body),
    tags: [] as string[],
    source,
    status,
    authorLabel: label,
    createIdempotencyKey: idemKey,
  };

  const r = isUpdate
    ? await updateShortformPost(supabase, user.id, draftId, payload)
    : await insertShortformPost(supabase, user.id, payload);

  if (!r.ok) {
    await compensate();
    return { ok: false, error: r.error };
  }

  // 멱등키가 기존 행을 되돌린 동시 중복요청: 이번 요청이 올린 새 객체는 어디에도 참조되지 않는 고아 → 정리.
  if (!isUpdate && "created" in r && r.created === false && newVideoRef && isOwnedShortformVideoRef(newVideoRef, user.id)) {
    await compensateNewShortformVideo(supabase, newVideoRef);
  }

  // DB 성공 → 교체된 구영상 차집합 삭제(old != final 이고 old 가 우리 stored video ref 일 때만).
  if (isUpdate && oldVideoRef && oldVideoRef !== payload.videoUrl && isShortformStoredVideoRef(oldVideoRef)) {
    const del = await deleteShortformVideoStoredRef(supabase, oldVideoRef);
    if (!del.ok) {
      console.error("[shortform] 교체 구영상 정리 실패", { postId: r.id, oldVideoRef, error: del.error });
    }
  }

  revalidatePath("/community/shortform");
  revalidatePath("/community");
  revalidatePath("/community/me");
  if (r.id) revalidatePath(`/community/shortform/${r.id}`);

  return { ok: true, id: r.id, status };
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
