"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  createShortformVideoUploadTicketAction,
  createShortformVideoUploadTicketFromAppAction,
  submitShortformUploadAction,
  submitShortformUploadFromAppAction,
  uploadShortformThumbnailAction,
  uploadShortformThumbnailFromAppAction,
} from "@/lib/community/communityShortformActions";
import { SHORTFORM_CATEGORIES, SHORTFORM_VIDEO_MAX_BYTES } from "@/lib/community/communityShortformConstants";
import { SHORTFORM_VIDEO_BUCKET, SHORTFORM_VIDEO_MIME } from "@/lib/community/shortformVideoRef";
import type { ShortformDraftRow } from "@/lib/community/communityShortformQueries";
import { CommunityComposeTopBar } from "@/components/community/CommunityComposeTopBar";
import { CommunityFileDropzone } from "@/components/community/CommunityFileDropzone";
import { createClient } from "@/lib/supabase/client";
import { AppToast } from "@/components/ui/AppToast";

const FORM_ID = "shortform-upload-form";

const UPLOAD_TIPS = [
  "유익한 내용 — 학습에 도움이 되는 핵심만 담아 주세요",
  "간결하게 전달 — 3분 안에 메시지가 전달되도록 구성해요",
  "선명한 화질 — 밝은 환경에서 촬영하면 좋아요",
  "적절한 길이 — 너무 길면 이탈이 늘 수 있어요",
] as const;

const UPLOAD_BENEFITS = ["정기적으로 우수 콘텐츠가 선정돼요", "배지 및 랭킹에 반영돼요"] as const;

type Props = {
  errorCode: string | null;
  draftSaved: boolean;
  draft: ShortformDraftRow | null;
  /**
   * "app" = 모바일 앱 WebView 표면: 앱 전용 finalize 액션(완료 브릿지 redirect)을 쓰고
   * 뒤로 링크를 숨긴다(취소는 앱 네이티브 UI). 기본값은 웹.
   */
  surface?: "web" | "app";
};

function messageForError(code: string | null): string | null {
  if (!code) return null;
  if (code === "policy") return "외부 연락처·대필 요청은 정책상 제한됩니다.";
  if (code === "mentor_only") return "멘토 계정만 업로드할 수 있어요.";
  if (code === "rights") return "권리 보유 확인이 필요합니다.";
  if (code === "video" || code === "video_upload") return "영상 업로드가 필요합니다.";
  if (code === "video_size") return "영상은 최대 500MB까지입니다.";
  if (code === "account_blocked") return "계정 상태를 확인해 주세요.";
  return "저장에 실패했습니다.";
}

/**
 * [QA-C15] 영상 첫 프레임을 뽑아 JPEG data URL 로 만든다.
 *
 * 왜 클라에서 하나: Vercel 서버리스에는 ffmpeg 이 없고, 영상은 서명 티켓으로 Storage 에
 * 직접 올라가 서버가 바이트를 만지지 않는다. 브라우저(앱 WebView 포함 Chromium)는
 * <video>+<canvas> 로 프레임을 얻을 수 있으므로 여기서 만드는 게 유일하게 짧은 경로다.
 *
 * 실패는 던지지 않고 null 을 돌려준다 — 썸네일이 없다고 글 발행을 막으면 안 된다.
 * 폭은 480px 로 줄여 30~80KB 로 맞춘다(액션 body 상한 512KB 안).
 */
async function captureVideoPosterDataUrl(file: File): Promise<string | null> {
  if (typeof document === "undefined") return null;
  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "metadata";

  // 이벤트 하나를 기다리되, 디코딩이 끝나지 않는 코덱에 영원히 매달리지 않는다.
  function waitFor(event: "loadedmetadata" | "seeked", ms: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const done = (ok: boolean) => {
        if (settled) return;
        settled = true;
        video.removeEventListener(event, onEvent);
        video.removeEventListener("error", onError);
        resolve(ok);
      };
      const onEvent = () => done(true);
      const onError = () => done(false);
      video.addEventListener(event, onEvent, { once: true });
      video.addEventListener("error", onError, { once: true });
      setTimeout(() => done(false), ms);
    });
  }

  try {
    video.src = objectUrl;
    // ① 먼저 메타데이터(길이·해상도)를 기다린다. 이걸 기다리지 않고 currentTime 을
    //    설정하면 브라우저가 무시하거나 되돌려서 seek 이 일어나지 않는다.
    if (!(await waitFor("loadedmetadata", 8000))) return null;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return null;

    // ② 0초 프레임은 검은 화면인 경우가 많아 살짝 뒤로 옮긴다(짧은 영상은 중간으로).
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    const target = duration > 0 ? Math.min(0.1, duration / 2) : 0;
    if (target > 0) {
      video.currentTime = target;
      // seek 이 실패해도 0초 프레임으로 진행한다 — 썸네일이 없는 것보다 낫다.
      await waitFor("seeked", 8000);
    }

    const targetW = Math.min(480, vw);
    const targetH = Math.max(1, Math.round((vh / vw) * targetW));
    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, targetW, targetH);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
    return dataUrl.startsWith("data:image/jpeg;base64,") ? dataUrl : null;
  } catch {
    return null;
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(objectUrl);
  }
}

function cryptoRandomUuid(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function CommunityShortformComposeForm(props: Props) {
  const supabase = useMemo(() => createClient(), []);
  const hasStoredVideo = Boolean(props.draft?.videoUrl);
  const isAppSurface = props.surface === "app";

  const formRef = useRef<HTMLFormElement>(null);
  const videoRefInputRef = useRef<HTMLInputElement>(null);
  const thumbnailRefInputRef = useRef<HTMLInputElement>(null);
  const requestIdInputRef = useRef<HTMLInputElement>(null);
  const intentInputRef = useRef<HTMLInputElement>(null);
  const uploadedGateRef = useRef(false);

  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(messageForError(props.errorCode));
  const [toast, setToast] = useState<string | null>(props.draftSaved ? "임시저장됨" : null);
  const [requestId, setRequestId] = useState<string>("");

  // 단일 영상: 새 선택 시 이전 object URL revoke(교체·언마운트 누수 방지).
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function onPickVideo(list: FileList | null) {
    const file = list?.[0] ?? null;
    if (!file) {
      // 단일 영상 state 는 append 아니라 replace — 선택 취소 시 초기화.
      setVideoFile(null);
      setPreviewUrl(null);
      return;
    }
    if (!SHORTFORM_VIDEO_MIME.has((file.type || "").toLowerCase())) {
      setError("지원하지 않는 영상 형식입니다. (mp4/mov/webm)");
      return;
    }
    if (file.size > SHORTFORM_VIDEO_MAX_BYTES) {
      setError("영상은 최대 500MB까지입니다.");
      return;
    }
    setError(null);
    setVideoFile(file);
    setPreviewUrl(URL.createObjectURL(file)); // 이전 URL 은 effect cleanup 이 revoke.
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const submitterIntent = submitter?.name === "intent" ? submitter.value : "";
    const intent = submitterIntent === "draft" || submitterIntent === "publish" ? submitterIntent : "publish";

    if (uploadedGateRef.current) {
      uploadedGateRef.current = false;
      return;
    }
    e.preventDefault();
    if (busy) return;

    const fd = new FormData(formRef.current ?? undefined);
    const title = String(fd.get("title") ?? "").trim();
    const rights = fd.get("rightsAck") === "on";
    if (!title) {
      setError("제목을 입력해 주세요.");
      return;
    }
    if (intent === "publish" && !rights) {
      setError("권리 보유 확인이 필요합니다.");
      return;
    }
    if (intent === "publish" && !videoFile && !hasStoredVideo) {
      setError("영상 업로드가 필요합니다.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      // 최초 submit 시점의 intent 를 hidden input 에 고정한다 — 업로드 await 이후
      // 재제출이 (busy 재렌더로 disabled 가 된) submitter 전달에 의존하지 않게 하기
      // 위함이다. disabled 컨트롤은 FormData 에 실리지 않아 draft→publish 변질
      // 위험이 있었다.
      if (intentInputRef.current) intentInputRef.current.value = intent;

      let rid = requestId;
      if (!rid) {
        rid = cryptoRandomUuid();
        setRequestId(rid);
      }
      if (videoFile) {
        // 앱 표면은 전용 티켓 액션(쿠키 재발급 시에도 HttpOnly 유지)을 태운다.
        const requestTicket = isAppSurface
          ? createShortformVideoUploadTicketFromAppAction
          : createShortformVideoUploadTicketAction;
        const ticket = await requestTicket({
          contentType: (videoFile.type || "video/mp4").toLowerCase(),
        });
        if (!ticket.ok) {
          setError(messageForError(ticket.error) ?? "영상 업로드 준비에 실패했어요.");
          setBusy(false);
          return;
        }
        const { error: upErr } = await supabase.storage
          .from(SHORTFORM_VIDEO_BUCKET)
          .uploadToSignedUrl(ticket.path, ticket.token, videoFile);
        if (upErr) {
          setError("영상 업로드에 실패했어요. 다시 시도해 주세요.");
          setBusy(false);
          return;
        }
        if (videoRefInputRef.current) videoRefInputRef.current.value = ticket.ref;

        // 썸네일 — 영상 업로드가 끝난 뒤에 만든다(실패해도 발행을 막지 않는다).
        const poster = await captureVideoPosterDataUrl(videoFile);
        if (poster) {
          const uploadThumb = isAppSurface
            ? uploadShortformThumbnailFromAppAction
            : uploadShortformThumbnailAction;
          const thumb = await uploadThumb({ dataUrl: poster });
          if (thumb.ok && thumbnailRefInputRef.current) {
            thumbnailRefInputRef.current.value = thumb.ref;
          }
        }
      } else if (videoRefInputRef.current) {
        videoRefInputRef.current.value = "";
      }
      if (requestIdInputRef.current) requestIdInputRef.current.value = rid;
      // 재제출 직전 한 번 더 못박는다 — 이 줄과 requestSubmit 사이에는 재렌더가 끼어들 수 없다.
      if (intentInputRef.current) intentInputRef.current.value = intent;
      uploadedGateRef.current = true;
      // submitter 를 넘기지 않는다 — 이 시점의 상단바 버튼은 busy 로 disabled 라
      // 넘겨도 entry list 에서 제외된다. intent 는 위 hidden 이 나른다.
      formRef.current?.requestSubmit();
    } catch {
      setError("저장에 실패했어요. 다시 시도해 주세요.");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <CommunityComposeTopBar
        backHref={isAppSurface ? null : "/community/shortform"}
        formId={FORM_ID}
        disabled={busy}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <form
          id={FORM_ID}
          ref={formRef}
          action={isAppSurface ? submitShortformUploadFromAppAction : submitShortformUploadAction}
          onSubmit={onSubmit}
          className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6"
        >
          {props.draft ? <input type="hidden" name="draftId" value={props.draft.id} /> : null}
          {hasStoredVideo ? <input type="hidden" name="videoUrl" value={props.draft?.videoUrl ?? ""} /> : null}
          <input type="hidden" name="videoRef" ref={videoRefInputRef} defaultValue="" />
          {/* QA-C15: 영상 첫 프레임으로 만든 썸네일의 stored ref. 실패하면 빈 값으로 두고
              글은 그대로 발행한다 — 썸네일은 있으면 좋은 값이지 발행 조건이 아니다. */}
          <input type="hidden" name="thumbnailRef" ref={thumbnailRefInputRef} defaultValue="" />
          <input type="hidden" name="requestId" ref={requestIdInputRef} defaultValue="" />
          {/* 최초 submit 의 intent 캡처용 — 서버는 getAll("intent") 중 첫 유효값을 읽어
              JS 비활성(submitter 값)·JS 활성(이 hidden 값) 어느 경로든 의도를 보존한다. */}
          <input type="hidden" name="intent" ref={intentInputRef} defaultValue="" />

          {error ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-900">
              {error}
            </p>
          ) : null}

          <label className="block text-sm font-extrabold text-slate-800">
            제목 (최대 100자)
            <input
              name="title"
              required
              maxLength={100}
              readOnly={busy}
              defaultValue={props.draft?.title ?? ""}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
            />
          </label>

          <label className="block text-sm font-extrabold text-slate-800">
            카테고리
            <select
              name="category"
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
              defaultValue={props.draft?.category ?? "study"}
            >
              {SHORTFORM_CATEGORIES.filter((c) => c.slug !== "all").map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>

          <div>
            <p className="text-sm font-extrabold text-slate-800">영상 (mp4/mov, 최대 3분/500MB)</p>
            {hasStoredVideo ? (
              <p className="mt-1 text-xs text-slate-500">임시저장된 영상이 있습니다. 새 파일을 선택하면 교체됩니다.</p>
            ) : null}
            <div className="mt-2">
              {/* name 미지정: 파일이 폼 FormData 에 구조적으로 실리지 않는다(413 원천 차단).
                  실제 업로드는 서명 티켓 → Storage 직접 업로드 → hidden videoRef 제출.
                  선택 파일명 표기는 Dropzone 내부 label 이 정본(한 줄). */}
              <CommunityFileDropzone
                accept="video/mp4,video/quicktime,video/webm"
                disabled={busy}
                buttonLabel="영상 파일 선택"
                hint="클릭하거나 영상 파일을 끌어다 놓으세요"
                onFilesChange={onPickVideo}
              />
            </div>
          </div>

          <label className="block text-sm font-extrabold text-slate-800">
            설명 (최대 500자)
            <textarea
              name="body"
              maxLength={500}
              rows={4}
              readOnly={busy}
              defaultValue={props.draft?.body ?? ""}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
            />
          </label>

          <label className="block text-sm font-extrabold text-slate-800">
            출처 (선택)
            <input
              name="source"
              readOnly={busy}
              defaultValue={props.draft?.source ?? ""}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
            />
          </label>

          <label className="flex items-start gap-2 text-sm text-slate-800">
            <input type="checkbox" name="rightsAck" value="on" className="mt-1 accent-[#2563EB]" />
            <span>영상 및 콘텐츠의 권리를 보유하며 정책에 맞게 올립니다. (올리기 시 필수)</span>
          </label>
        </form>

        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-extrabold uppercase tracking-wide text-slate-500">미리보기</p>
            <div className="mx-auto mt-3 flex aspect-[9/16] max-h-[360px] w-full max-w-[200px] items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 p-1 text-center">
              {previewUrl ? (
                <video src={previewUrl} controls className="h-full w-full rounded-lg object-contain" />
              ) : hasStoredVideo ? (
                <p className="text-xs font-bold text-slate-700">저장된 영상</p>
              ) : (
                <p className="text-xs leading-relaxed text-slate-500">업로드한 영상의 미리보기가 여기에 표시됩니다.</p>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-sm font-extrabold text-slate-900">업로드 팁</p>
            <ul className="mt-2 space-y-2">
              {UPLOAD_TIPS.map((t) => (
                <li key={t} className="flex gap-2 text-xs text-slate-600">
                  <span className="text-[#2563EB]" aria-hidden>
                    •
                  </span>
                  {t}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-sm font-extrabold text-slate-900">업로드 시 장점</p>
            <ul className="mt-2 space-y-2">
              {UPLOAD_BENEFITS.map((b) => (
                <li key={b} className="flex gap-2 text-xs text-slate-600">
                  <span className="text-[#2563EB]" aria-hidden>
                    •
                  </span>
                  {b}
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
      {toast ? <AppToast message={toast} onDismiss={() => setToast(null)} /> : null}
    </div>
  );
}
