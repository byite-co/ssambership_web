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
  createShortformVideoUploadTicket,
  deleteShortformVideoStoredRef,
  isShortformStoredVideoRef,
  shortformVideoRefBelongsToUser,
} from "@/lib/community/communityShortformStorage";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { assertAccountActive } from "@/lib/auth/accountStatus";
import {
  APP_SHORTFORM_COMPOSE_PATH,
  appBridgeCompletePath,
  appBridgeErrorPath,
} from "@/lib/appSession/appSurfacePaths";
import { extractShortformSubmitFields } from "@/lib/community/shortformSubmitFields";
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

/**
 * 숏폼 finalize 공통 코어 — surface 에 따라 인증 실패·성공 redirect 대상만 달라진다.
 * - web: 기존 동작 그대로(로그인 유도·피드 오류쿼리·상세/작성 화면 복귀).
 * - app: 앱 WebView 표면 — 실패는 고정 오류 페이지, 성공은 완료 브릿지(enum 경로)로.
 * FormData 는 허용 키 10종의 문자열 값만 사용한다(File/Blob 비신뢰 — shortformSubmitFields).
 */
async function submitShortformUploadCore(surface: "web" | "app", formData: FormData) {
  const isApp = surface === "app";
  const returnPath = isApp ? APP_SHORTFORM_COMPOSE_PATH : communityComposePath("shortform");
  const { user } = await getServerAuthUser();
  if (!user) {
    if (isApp) redirect(appBridgeErrorPath("session_expired"));
    redirect(`/login?next=${encodeURIComponent(returnPath)}`);
  }

  const supabase = await createClient();
  const acctGate = await assertAccountActive(supabase, user.id);
  if (!acctGate.ok) {
    redirect(isApp ? appBridgeErrorPath("account_blocked") : "/community/shortform?error=account_blocked");
  }
  const { data: profile } = await getUserProfileById(supabase, user.id);
  if (profile?.role !== "mentor") {
    redirect(isApp ? appBridgeErrorPath("mentor_only") : "/community/shortform?error=mentor_only");
  }

  const fields = extractShortformSubmitFields(formData);
  const status = fields.intent === "draft" ? "draft" : "published";
  const draftId = fields.draftId;
  const isUpdate = Boolean(draftId) && UUID_RE.test(draftId);
  const title = fields.title;
  const category = fields.category as ShortformCategorySlug;
  const body = fields.body;
  const source = fields.source;
  const rights = fields.rightsAck;

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

  // [staged upload] 영상은 액션 body 로 받지 않는다(413 회피). 클라가 서명 티켓으로 Storage 에 직접
  // 업로드하고 ref(텍스트)만 보낸다. videoUrl=기존 유지분(임시저장), newVideoRef=이번 신규 업로드.
  let videoUrl = fields.videoUrl;
  let uploadedRef: string | null = null; // 이번 요청 신규 업로드 ref(본인 소유일 때만 — 실패 시 보상 대상)
  const newVideoRef = fields.videoRef;
  if (newVideoRef) {
    // 위조 ref(타인 경로) 차단 — 타인 객체는 보상 삭제하지 않는다(RLS delete 도 owner-scoped).
    if (!shortformVideoRefBelongsToUser(newVideoRef, user.id)) err(returnPath, "video_upload");
    videoUrl = newVideoRef;
    uploadedRef = newVideoRef;
  }
  if (!videoUrl && status === "published") {
    // 아직 DB write 전. 방금 업로드한 새 객체가 있으면 고아 방지 위해 보상 삭제 후 오류.
    await compensateNewShortformVideo(supabase, uploadedRef);
    err(returnPath, "video");
  }

  // 요청 UUID → 멱등 키(더블클릭·재시도에도 1행). 없거나 형식 오류면 null(레거시 무검사).
  const requestId = fields.requestId;
  const createIdempotencyKey = requestId && UUID_RE.test(requestId) ? requestId : null;

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
    createIdempotencyKey,
  };

  const r = isUpdate
    ? await updateShortformPost(supabase, user.id, draftId, payload)
    : await insertShortformPost(supabase, user.id, payload);

  if (!r.ok) {
    // DB 실패(INSERT/UPDATE 오류·UPDATE 0행) → 이번 요청 신규 video 고아 방지 보상 삭제.
    await compensateNewShortformVideo(supabase, uploadedRef);
    err(returnPath, r.error);
  }

  // 중복 제출 멱등 재생: 기존 글이 반환됐다면 이번 중복 업로드 영상은 고아 → 보상 삭제 후 기존 글로 이동.
  if (!isUpdate && "idempotentReplay" in r && r.idempotentReplay) {
    await compensateNewShortformVideo(supabase, uploadedRef);
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

  // 앱 표면: 성공은 완료 브릿지(서버 enum 경로)로 — 앱이 이 URL 을 intercept 해 WebView 를 닫는다.
  if (isApp) {
    redirect(appBridgeCompletePath("shortform", status === "published" ? "published" : "draft"));
  }

  if (status === "published") redirect(`/community/shortform/${r.id}`);
  redirect(communityComposePath("shortform", { draft: "1", draftId: r.id }));
}

/** 웹 표면 finalize(기존 계약 유지). */
export async function submitShortformUploadAction(formData: FormData) {
  await submitShortformUploadCore("web", formData);
}

/** 앱 WebView 표면 finalize — 실패는 고정 오류 페이지, 성공은 완료 브릿지로 이동한다. */
export async function submitShortformUploadFromAppAction(formData: FormData) {
  await submitShortformUploadCore("app", formData);
}

/**
 * 숏폼 영상 직접 업로드용 서명 티켓 발급(413 회피). 멘토·계정활성만 발급하며 경로는 서버가 본인 userId 로 통제한다.
 * 클라는 반환된 path·token 으로 브라우저에서 Storage 에 직접 업로드하고, finalize 에는 ref 만 넘긴다.
 */
export async function createShortformVideoUploadTicketAction(input: {
  contentType: string;
}): Promise<{ ok: true; path: string; token: string; ref: string } | { ok: false; error: string }> {
  const { user } = await getServerAuthUser();
  if (!user) return { ok: false, error: "auth" };
  const supabase = await createClient();
  const acct = await assertAccountActive(supabase, user.id);
  if (!acct.ok) return { ok: false, error: "account_blocked" };
  const { data: profile } = await getUserProfileById(supabase, user.id);
  if (profile?.role !== "mentor") return { ok: false, error: "mentor_only" };

  // 서명은 service-role 권장(경로는 서버가 본인 userId 로 통제). 없으면 사용자 클라로 폴백.
  let signer = supabase;
  try {
    signer = createServiceRoleClient();
  } catch {
    signer = supabase;
  }
  const ticket = await createShortformVideoUploadTicket(signer, user.id, input.contentType);
  if (!ticket.ok) return { ok: false, error: ticket.error };
  return { ok: true, path: ticket.path, token: ticket.token, ref: ticket.ref };
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
