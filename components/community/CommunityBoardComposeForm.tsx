"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  finalizeCommunityBoardPostAction,
  type BoardFinalizeResult,
} from "@/lib/community/communityBoardActions";
import { createCommunityImageUploadContract } from "@/lib/community/uploadContractActions";
import { discardUploadedContracts, uploadFileViaContract } from "@/lib/community/uploadViaSignedUrl";
import { COMMUNITY_POST_CATEGORIES, COMMUNITY_IMAGE_MAX } from "@/lib/community/communityBoardConstants";
import type { CommunityBoardDraftRow } from "@/lib/community/communityBoardQueries";
import { communityComposePath } from "@/lib/community/communityComposeTab";
import { CommunityCategoryChips } from "@/components/community/CommunityCategoryChips";
import { CommunityComposeTopBar } from "@/components/community/CommunityComposeTopBar";
import { AppToast } from "@/components/ui/AppToast";

const FORM_ID = "board-compose-form";
const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/gif";
const IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

export type ExistingBoardImage = { ref: string; url: string };

type NewImage = { key: string; file: File; previewUrl: string };

type Props = {
  errorCode: string | null;
  draftSaved: boolean;
  draft: CommunityBoardDraftRow | null;
  /** 편집 시 기존 이미지(ref + 미리보기 URL). */
  existingImages?: ExistingBoardImage[];
  /** 게시글(발행됨) 편집이면 true — 라벨/복귀 경로가 달라진다. */
  editingPublished?: boolean;
  returnPath?: string;
};

function mapError(code: string): string {
  switch (code) {
    case "policy":
    case "trust_safety":
      return "외부 연락처·대필 요청은 정책상 제한됩니다.";
    case "title":
      return "제목을 입력해 주세요.";
    case "body":
      return "본문은 최소 10자 이상입니다.";
    case "images":
      return `이미지는 최대 ${COMMUNITY_IMAGE_MAX}장까지입니다.`;
    case "upload":
    case "image_type":
    case "image_size":
      return "이미지 업로드에 실패했습니다.";
    case "account_blocked":
      return "계정 상태로 작성이 제한됩니다.";
    case "not_found":
      return "게시글을 찾을 수 없거나 수정 권한이 없습니다.";
    case "auth":
      return "로그인이 필요합니다.";
    default:
      return "저장에 실패했습니다. 다시 시도해 주세요.";
  }
}

function newIdempotencyKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return "00000000-0000-4000-8000-000000000000".replace(/[08]/g, () =>
      Math.floor(Math.random() * 16).toString(16),
    );
  }
}

export function CommunityBoardComposeForm(props: Props) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const idemKeyRef = useRef<string>(newIdempotencyKey());

  const [keptExisting, setKeptExisting] = useState<ExistingBoardImage[]>(props.existingImages ?? []);
  const [newImages, setNewImages] = useState<NewImage[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(props.errorCode ? mapError(props.errorCode) : null);
  const [toastDismissed, setToastDismissed] = useState(false);
  const showDraftToast = props.draftSaved && !toastDismissed;

  // 새 이미지 objectURL 은 언마운트 시 전부 해제.
  useEffect(() => {
    return () => {
      newImages.forEach((n) => URL.revokeObjectURL(n.previewUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalCount = keptExisting.length + newImages.length;

  const addFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList?.length) return;
      setError(null);
      setNewImages((prev) => {
        const remaining = COMMUNITY_IMAGE_MAX - keptExisting.length - prev.length;
        if (remaining <= 0) {
          setError(`이미지는 최대 ${COMMUNITY_IMAGE_MAX}장까지입니다.`);
          return prev;
        }
        // 같은 change 이벤트가 중복 state 를 만들지 않도록 name+size+lastModified 로 dedupe.
        const seen = new Set(prev.map((n) => `${n.file.name}:${n.file.size}:${n.file.lastModified}`));
        const additions: NewImage[] = [];
        for (const file of Array.from(fileList)) {
          if (additions.length >= remaining) break;
          if (!IMAGE_MIME.has(file.type)) {
            setError("jpg/png/webp/gif 이미지만 올릴 수 있어요.");
            continue;
          }
          if (file.size > IMAGE_MAX_BYTES) {
            setError("이미지는 장당 5MB 이하로 올려주세요.");
            continue;
          }
          const sig = `${file.name}:${file.size}:${file.lastModified}`;
          if (seen.has(sig)) continue;
          seen.add(sig);
          additions.push({ key: `${sig}:${Math.random()}`, file, previewUrl: URL.createObjectURL(file) });
        }
        return additions.length ? [...prev, ...additions] : prev;
      });
    },
    [keptExisting.length],
  );

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    addFiles(e.target.files);
    // 같은 파일 재선택도 change 가 발생하도록 입력값 초기화(그리고 중복 append 방지는 위 dedupe 가 담당).
    e.target.value = "";
  };

  const removeNew = (key: string) => {
    setNewImages((prev) => {
      const target = prev.find((n) => n.key === key);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((n) => n.key !== key);
    });
  };

  const removeExisting = (ref: string) => {
    setKeptExisting((prev) => prev.filter((e) => e.ref !== ref));
  };

  async function orchestrate(intent: "draft" | "publish") {
    if (pending) return;
    const form = formRef.current;
    if (!form) return;
    const fd = new FormData(form);
    const title = String(fd.get("title") ?? "").trim();
    const body = String(fd.get("body") ?? "").trim();
    const category = String(fd.get("category") ?? "free");

    if (!title) {
      setError("제목을 입력해 주세요.");
      return;
    }
    if (intent === "publish" && body.length < 10) {
      setError("본문은 최소 10자 이상입니다.");
      return;
    }
    if (totalCount > COMMUNITY_IMAGE_MAX) {
      setError(`이미지는 최대 ${COMMUNITY_IMAGE_MAX}장까지입니다.`);
      return;
    }

    setPending(true);
    setError(null);

    // 이번 요청 신규 업로드(성공분) — finalize 실패 전이나 부분 실패 시 정리 대상.
    const uploaded: { bucket: string; path: string; ref: string }[] = [];
    try {
      for (const item of newImages) {
        const contract = await createCommunityImageUploadContract({
          contentType: item.file.type,
          sizeBytes: item.file.size,
          fileName: item.file.name,
        });
        if (!contract.ok) {
          await discardUploadedContracts(uploaded);
          setError(mapError(contract.error));
          setPending(false);
          return;
        }
        const up = await uploadFileViaContract(contract, item.file);
        if (!up.ok) {
          // 부분 업로드 실패 — 이미 올라간 이번 요청 신규 객체만 즉시 정리(orphan 0).
          await discardUploadedContracts(uploaded);
          setError("이미지 업로드에 실패했습니다. 잠시 후 다시 시도해 주세요.");
          setPending(false);
          return;
        }
        uploaded.push({ bucket: contract.bucket, path: contract.path, ref: contract.ref });
      }

      const res: BoardFinalizeResult = await finalizeCommunityBoardPostAction({
        intent,
        postId: props.draft?.id ?? null,
        title,
        body,
        category,
        existingImageRefs: keptExisting.map((e) => e.ref),
        newImageRefs: uploaded.map((u) => u.ref),
        idempotencyKey: idemKeyRef.current,
      });

      if (!res.ok) {
        // finalize 실패 시 서버가 이번 요청 신규 ref 를 보상 삭제한다 → 재시도는 새로 업로드.
        setError(mapError(res.error));
        setPending(false);
        return;
      }

      if (res.status === "published") {
        router.push(`/community/board/${res.id}`);
        return;
      }
      idemKeyRef.current = newIdempotencyKey();
      router.push(communityComposePath("board", { draft: "1", draftId: res.id }));
      router.refresh();
    } catch {
      await discardUploadedContracts(uploaded);
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

  return (
    <div className="space-y-4">
      <CommunityComposeTopBar backHref="/community/board" formId={FORM_ID} pending={pending} />
      <form
        id={FORM_ID}
        ref={formRef}
        onSubmit={handleSubmit}
        className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6"
      >
        {error ? (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-900">{error}</p>
        ) : null}

        <label className="block text-sm font-extrabold text-slate-800">
          제목
          <input
            name="title"
            required
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
            defaultValue={props.draft?.body ?? ""}
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
          />
        </label>

        <div>
          <p className="text-sm font-extrabold text-slate-800">{`이미지 (최대 ${COMMUNITY_IMAGE_MAX}장) · ${totalCount}/${COMMUNITY_IMAGE_MAX}`}</p>

          {(keptExisting.length > 0 || newImages.length > 0) && (
            <ul className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
              {keptExisting.map((img) => (
                <li key={img.ref} className="relative overflow-hidden rounded-xl border border-slate-200">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.url} alt="" className="aspect-square w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removeExisting(img.ref)}
                    disabled={pending}
                    className="absolute right-1 top-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-bold text-white disabled:opacity-50"
                  >
                    제거
                  </button>
                </li>
              ))}
              {newImages.map((img) => (
                <li key={img.key} className="relative overflow-hidden rounded-xl border border-emerald-200">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.previewUrl} alt="" className="aspect-square w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removeNew(img.key)}
                    disabled={pending}
                    className="absolute right-1 top-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-bold text-white disabled:opacity-50"
                  >
                    제거
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-2">
            <input
              ref={fileInputRef}
              type="file"
              accept={IMAGE_ACCEPT}
              multiple
              onChange={onFileChange}
              disabled={pending || totalCount >= COMMUNITY_IMAGE_MAX}
              className="sr-only"
              id="board-image-input"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={pending || totalCount >= COMMUNITY_IMAGE_MAX}
              className="w-full rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/60 px-4 py-6 text-center text-sm font-bold text-slate-800 transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="rounded-xl border border-slate-200 bg-white px-4 py-2">이미지 첨부</span>
              <span className="mt-2 block text-xs font-medium text-slate-500">클릭해서 이미지를 선택하세요 (장당 5MB 이하)</span>
            </button>
          </div>
        </div>
      </form>
      {showDraftToast ? <AppToast message="임시저장됨" onDismiss={() => setToastDismissed(true)} /> : null}
    </div>
  );
}
