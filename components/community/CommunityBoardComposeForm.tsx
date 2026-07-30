"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { submitCommunityBoardPostAction } from "@/lib/community/communityBoardActions";
import { COMMUNITY_POST_CATEGORIES, COMMUNITY_IMAGE_MAX } from "@/lib/community/communityBoardConstants";
import type { CommunityBoardDraftRow } from "@/lib/community/communityBoardQueries";
import { COMMUNITY_BOARD_COMPOSE_PATH } from "@/lib/community/communityComposeTab";
import {
  uploadCommunityImagesFromBrowser,
  validateCommunityImageFile,
} from "@/lib/community/communityImageClientUpload";
import { CommunityCategoryChips } from "@/components/community/CommunityCategoryChips";
import { CommunityComposeTopBar } from "@/components/community/CommunityComposeTopBar";
import { CommunityFileDropzone } from "@/components/community/CommunityFileDropzone";
import { createClient } from "@/lib/supabase/client";
import { AppToast } from "@/components/ui/AppToast";

const FORM_ID = "board-compose-form";

type Props = {
  userId: string;
  errorCode: string | null;
  draftSaved: boolean;
  draft: CommunityBoardDraftRow | null;
  returnPath?: string;
};

function messageForError(code: string | null): string | null {
  if (!code) return null;
  if (code === "policy") return "외부 연락처·대필 요청은 정책상 제한됩니다.";
  if (code === "title") return "제목을 입력해 주세요.";
  if (code === "body") return "본문은 최소 10자 이상입니다.";
  if (code === "upload") return "이미지 업로드에 실패했습니다.";
  if (code === "images") return `이미지 첨부가 올바르지 않습니다(최대 ${COMMUNITY_IMAGE_MAX}장·본인 업로드만).`;
  if (code === "conflict") return "다른 곳에서 먼저 수정된 글입니다. 새로고침 후 다시 수정해 주세요.";
  if (code === "role") return "게시글 작성은 승인된 멘토만 할 수 있어요.";
  if (code === "network") return "네트워크 오류로 저장 여부를 확인하지 못했습니다. 같은 화면에서 다시 시도해 주세요.";
  return "저장에 실패했습니다. 다시 시도해 주세요.";
}

export function CommunityBoardComposeForm(props: Props) {
  const supabase = useMemo(() => createClient(), []);
  const returnPath = props.returnPath ?? COMMUNITY_BOARD_COMPOSE_PATH;

  const formRef = useRef<HTMLFormElement>(null);
  const imageRefsInputRef = useRef<HTMLInputElement>(null);
  const requestIdInputRef = useRef<HTMLInputElement>(null);
  // 2단 제출 플래그: 클라 업로드가 끝난 뒤 requestSubmit 으로 네이티브 제출을 통과시킨다.
  const uploadedGateRef = useRef(false);

  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<{ url: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(messageForError(props.errorCode));
  // draftSaved 는 서버 props(재진입 시 remount) → 초기 state 로 파생(effect setState 회피).
  const [toast, setToast] = useState<string | null>(props.draftSaved ? "임시저장됨" : null);
  // 요청 UUID(중복 제출 방지). 첫 제출 시 lazy 생성해 저장(재시도는 동일 키 재사용 → 멱등),
  // 성공/검증실패 redirect → remount 시 "" 로 초기화되어 다음 제출에서 새 UUID 발급.
  const [requestId, setRequestId] = useState<string>("");

  // 미리보기 object URL 은 previews 교체/언마운트 시 revoke(누수 방지).
  useEffect(() => {
    return () => {
      previews.forEach((p) => URL.revokeObjectURL(p.url));
    };
  }, [previews]);

  const existingCount = props.draft?.imageUrls.length ?? 0;

  function onFilesChange(list: FileList | null) {
    const picked = Array.from(list ?? []);
    const room = Math.max(0, COMMUNITY_IMAGE_MAX - existingCount);
    const next = picked.slice(0, room);
    for (const f of next) {
      const invalid = validateCommunityImageFile(f);
      if (invalid) {
        setError(invalid);
        return;
      }
    }
    setError(null);
    // 단일 영상과 달리 게시판은 복수 이미지 — 새 선택으로 교체(append 아님). 이전 미리보기 revoke.
    setFiles(next);
    setPreviews(next.map((f) => ({ url: URL.createObjectURL(f), name: f.name })));
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const intent = submitter?.name === "intent" ? submitter.value : "publish";

    // 2단계 통과: 업로드 완료 후 requestSubmit 로 재진입 → 네이티브 제출(서버액션 redirect) 진행.
    if (uploadedGateRef.current) {
      uploadedGateRef.current = false;
      return;
    }

    e.preventDefault();
    if (busy) return;

    // 클라 검증(서버 title/body redirect 전에 걸러 업로드 고아 방지).
    const fd = new FormData(formRef.current ?? undefined);
    const title = String(fd.get("title") ?? "").trim();
    const body = String(fd.get("body") ?? "").trim();
    if (!title) {
      setError("제목을 입력해 주세요.");
      return;
    }
    if (intent === "publish" && body.length < 10) {
      setError("본문은 최소 10자 이상입니다.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      let refs: string[] = [];
      if (files.length) {
        const up = await uploadCommunityImagesFromBrowser(supabase, props.userId, files);
        if (!up.ok) {
          setError(up.error);
          setBusy(false);
          return;
        }
        refs = up.refs;
      }
      let rid = requestId;
      if (!rid) {
        rid = cryptoRandomUuid();
        setRequestId(rid);
      }
      if (imageRefsInputRef.current) imageRefsInputRef.current.value = JSON.stringify(refs);
      if (requestIdInputRef.current) requestIdInputRef.current.value = rid;
      uploadedGateRef.current = true;
      // 동일 intent 로 네이티브 제출 재개(파일은 body 로 안 감 — imageRefs 텍스트만).
      formRef.current?.requestSubmit(submitter ?? undefined);
    } catch {
      setError("저장에 실패했어요. 다시 시도해 주세요.");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <CommunityComposeTopBar backHref="/community/board" formId={FORM_ID} disabled={busy} />
      <form
        id={FORM_ID}
        ref={formRef}
        action={submitCommunityBoardPostAction}
        onSubmit={onSubmit}
        className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6"
      >
        <input type="hidden" name="returnPath" value={returnPath} />
        <input type="hidden" name="requestId" ref={requestIdInputRef} defaultValue="" />
        <input type="hidden" name="imageRefs" ref={imageRefsInputRef} defaultValue="[]" />
        {props.draft ? (
          <>
            <input type="hidden" name="draftId" value={props.draft.id} />
            <input type="hidden" name="existingImageUrls" value={JSON.stringify(props.draft.imageUrls)} />
            <input type="hidden" name="expectedUpdatedAt" value={props.draft.updatedAt} />
          </>
        ) : null}

        {error ? (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-900">{error}</p>
        ) : null}

        <label className="block text-sm font-extrabold text-slate-800">
          제목
          <input
            name="title"
            required
            readOnly={busy}
            defaultValue={props.draft?.title ?? ""}
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
          />
        </label>

        <CommunityCategoryChips
          categories={COMMUNITY_POST_CATEGORIES}
          name="category"
          defaultSlug={props.draft?.category ?? "study"}
        />

        <label className="block text-sm font-extrabold text-slate-800">
          본문 (올리기 시 최소 10자)
          <textarea
            name="body"
            rows={8}
            readOnly={busy}
            defaultValue={props.draft?.body ?? ""}
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
          />
        </label>

        <div>
          <p className="text-sm font-extrabold text-slate-800">{`이미지 (최대 ${COMMUNITY_IMAGE_MAX}장)`}</p>
          {existingCount ? (
            <p className="mt-1 text-xs text-slate-500">기존 {existingCount}장 유지 · 새로 선택하면 나머지 칸에 추가됩니다.</p>
          ) : null}
          <div className="mt-2">
            <CommunityFileDropzone
              name="images-picker"
              accept="image/jpeg,image/png,image/webp,image/gif"
              multiple
              disabled={busy}
              buttonLabel="이미지 첨부"
              maxFiles={Math.max(0, COMMUNITY_IMAGE_MAX - existingCount)}
              onFilesChange={onFilesChange}
            />
          </div>
          {previews.length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {previews.map((p) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={p.url}
                  src={p.url}
                  alt={p.name}
                  className="h-20 w-20 rounded-lg border border-slate-200 object-cover"
                />
              ))}
            </div>
          ) : null}
        </div>
      </form>
      {toast ? <AppToast message={toast} onDismiss={() => setToast(null)} /> : null}
    </div>
  );
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
