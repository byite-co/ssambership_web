"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  finalizeShortformUploadAction,
  type ShortformFinalizeResult,
} from "@/lib/community/communityShortformActions";
import { createShortformVideoUploadContract } from "@/lib/community/uploadContractActions";
import { uploadFileViaContract } from "@/lib/community/uploadViaSignedUrl";
import { SHORTFORM_CATEGORIES, SHORTFORM_VIDEO_MAX_BYTES } from "@/lib/community/communityShortformConstants";
import { communityComposePath } from "@/lib/community/communityComposeTab";
import type { ShortformDraftRow } from "@/lib/community/communityShortformQueries";
import { CommunityComposeTopBar } from "@/components/community/CommunityComposeTopBar";
import { AppToast } from "@/components/ui/AppToast";

const FORM_ID = "shortform-upload-form";
const VIDEO_ACCEPT = "video/mp4,video/quicktime,video/webm";
const VIDEO_MIME = new Set(["video/mp4", "video/quicktime", "video/webm"]);

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
};

function mapError(code: string): string {
  switch (code) {
    case "policy":
    case "trust_safety":
      return "외부 연락처·대필 요청은 정책상 제한됩니다.";
    case "mentor_only":
      return "멘토 계정만 업로드할 수 있어요.";
    case "account_blocked":
      return "계정 상태로 업로드가 제한됩니다.";
    case "rights":
      return "권리 보유 확인이 필요합니다.";
    case "title":
      return "제목을 입력해 주세요.";
    case "video":
    case "video_upload":
      return "영상 업로드가 필요합니다.";
    case "video_type":
      return "mp4/mov/webm 형식의 영상만 올릴 수 있어요.";
    case "video_size":
      return "영상은 최대 500MB까지입니다.";
    case "auth":
      return "로그인이 필요합니다.";
    default:
      return "저장에 실패했습니다.";
  }
}

function newIdempotencyKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    // 매우 구형 환경 폴백(보안 컨텍스트 아님) — 충돌 확률 무시 가능한 난수 UUID v4 형태.
    return "00000000-0000-4000-8000-000000000000".replace(/[08]/g, () =>
      Math.floor(Math.random() * 16).toString(16),
    );
  }
}

export function CommunityShortformComposeForm(props: Props) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const idemKeyRef = useRef<string>(newIdempotencyKey());

  const hasStoredVideo = Boolean(props.draft?.videoUrl);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(props.errorCode ? mapError(props.errorCode) : null);
  const [toastDismissed, setToastDismissed] = useState(false);
  const showDraftToast = props.draftSaved && !toastDismissed;

  // 미리보기 objectURL 은 교체·언마운트 시 해제(메모리 누수 방지).
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const setVideo = useCallback((file: File | null) => {
    // 단일 입력: 새 파일은 이전 선택을 replace 하고, 이전 objectURL 을 즉시 해제한다(중복 state 방지).
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return file ? URL.createObjectURL(file) : null;
    });
    setVideoFile(file);
  }, []);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    if (file && !VIDEO_MIME.has(file.type)) {
      setError("mp4/mov/webm 형식의 영상만 올릴 수 있어요.");
      e.target.value = "";
      setVideo(null);
      return;
    }
    if (file && file.size > SHORTFORM_VIDEO_MAX_BYTES) {
      setError("영상은 최대 500MB까지입니다.");
      e.target.value = "";
      setVideo(null);
      return;
    }
    setError(null);
    setVideo(file);
  };

  async function orchestrate(intent: "draft" | "publish") {
    if (pending) return;
    const form = formRef.current;
    if (!form) return;
    const fd = new FormData(form);
    const title = String(fd.get("title") ?? "").trim();
    const category = String(fd.get("category") ?? "study");
    const body = String(fd.get("body") ?? "");
    const source = String(fd.get("source") ?? "");
    const rightsAck = fd.get("rightsAck") === "on";

    if (!title) {
      setError("제목을 입력해 주세요.");
      return;
    }
    if (intent === "publish" && !videoFile && !hasStoredVideo) {
      setError("영상을 선택해 주세요.");
      return;
    }
    if (intent === "publish" && !rightsAck) {
      setError("권리 보유 확인이 필요합니다.");
      return;
    }

    setPending(true);
    setError(null);
    try {
      let newVideoRef: string | null = null;
      let videoRef: string | null = props.draft?.videoUrl ?? null;

      if (videoFile) {
        const contract = await createShortformVideoUploadContract({
          contentType: videoFile.type,
          sizeBytes: videoFile.size,
        });
        if (!contract.ok) {
          setError(mapError(contract.error));
          setPending(false);
          return;
        }
        const up = await uploadFileViaContract(contract, videoFile);
        if (!up.ok) {
          setError("영상 업로드에 실패했습니다. 잠시 후 다시 시도해 주세요.");
          setPending(false);
          return;
        }
        newVideoRef = up.ref;
        videoRef = up.ref;
      }

      const res: ShortformFinalizeResult = await finalizeShortformUploadAction({
        intent,
        draftId: props.draft?.id ?? null,
        title,
        category,
        body,
        source,
        rightsAck,
        videoRef,
        newVideoRef,
        idempotencyKey: idemKeyRef.current,
      });

      if (!res.ok) {
        // finalize 실패 시 서버가 이번 요청의 신규 객체를 보상 삭제하므로, 재시도는 새로 업로드해야 한다.
        setError(mapError(res.error));
        setPending(false);
        return;
      }

      if (res.status === "published") {
        router.push(`/community/shortform/${res.id}`);
        return;
      }
      // 임시저장: 초안 경로로 이동(같은 초안 id 로 이어서 편집). 성공했으므로 다음 생성은 새 멱등키.
      idemKeyRef.current = newIdempotencyKey();
      router.push(communityComposePath("shortform", { draft: "1", draftId: res.id }));
      router.refresh();
    } catch {
      setError("저장에 실패했습니다. 다시 시도해 주세요.");
      setPending(false);
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const intent = submitter?.value === "draft" ? "draft" : "publish";
    void orchestrate(intent);
  }

  const previewName = videoFile?.name ?? (hasStoredVideo ? "저장된 영상" : null);

  return (
    <div className="space-y-4">
      <CommunityComposeTopBar backHref="/community/shortform" formId={FORM_ID} pending={pending} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <form
          id={FORM_ID}
          ref={formRef}
          onSubmit={handleSubmit}
          className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6"
        >
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
            {hasStoredVideo && !videoFile ? (
              <p className="mt-1 text-xs text-slate-500">임시저장된 영상이 있습니다. 새 파일을 선택하면 교체됩니다.</p>
            ) : null}
            <div className="mt-2">
              <input
                ref={fileInputRef}
                type="file"
                accept={VIDEO_ACCEPT}
                onChange={onFileChange}
                disabled={pending}
                className="sr-only"
                id="shortform-video-input"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={pending}
                className="w-full rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/60 px-4 py-8 text-center text-sm font-bold text-slate-800 transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="rounded-xl border border-slate-200 bg-white px-4 py-2">영상 파일 선택</span>
                <span className="mt-2 block text-xs font-medium text-slate-500">클릭해서 영상 파일을 선택하세요</span>
              </button>
            </div>
            {previewName ? (
              <p className="mt-1 text-xs font-semibold text-slate-700">{previewName}</p>
            ) : null}
          </div>

          <label className="block text-sm font-extrabold text-slate-800">
            설명 (최대 500자)
            <textarea
              name="body"
              maxLength={500}
              rows={4}
              defaultValue={props.draft?.body ?? ""}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
            />
          </label>

          <label className="block text-sm font-extrabold text-slate-800">
            출처 (선택)
            <input
              name="source"
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
                // 로컬 영상 미리보기 — objectURL 을 <video> 로 재생. 교체·언마운트 시 revoke.
                <video src={previewUrl} controls playsInline className="h-full w-full rounded-lg object-contain" />
              ) : previewName ? (
                <p className="p-4 text-xs font-bold text-slate-700">{previewName}</p>
              ) : (
                <p className="p-4 text-xs leading-relaxed text-slate-500">업로드한 영상의 미리보기가 여기에 표시됩니다.</p>
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
      {showDraftToast ? <AppToast message="임시저장됨" onDismiss={() => setToastDismissed(true)} /> : null}
    </div>
  );
}
