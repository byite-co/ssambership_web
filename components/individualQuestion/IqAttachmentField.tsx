"use client";

import { useEffect, useRef, useState } from "react";
import { Paperclip, X } from "lucide-react";

/**
 * 개별질문 메시지 폼의 파일 첨부 필드 — 선택 즉시 파일명(이미지는 썸네일 미리보기)을
 * 보여 전송 전에 첨부 여부를 확인할 수 있게 한다. input 은 폼의 일부로 남아
 * 제출 시 함께 전송되며(name="attachment"), 서버 액션·업로드 경로는 불변이다.
 */
export function IqAttachmentField(props: { iconClassName: string; accept: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // objectURL 은 교체·언마운트 시 해제(effect cleanup 이 이전 URL 을 회수).
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function onChange(event: React.ChangeEvent<HTMLInputElement>) {
    const next = event.target.files?.[0] ?? null;
    setFile(next);
    setPreviewUrl(next && next.type.startsWith("image/") ? URL.createObjectURL(next) : null);
  }

  function clear() {
    if (inputRef.current) inputRef.current.value = "";
    setFile(null);
    setPreviewUrl(null);
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <label className="inline-flex w-fit cursor-pointer items-center gap-2 text-xs font-bold text-slate-600">
        <Paperclip className={`h-4 w-4 ${props.iconClassName}`} aria-hidden />
        <span>파일 첨부</span>
        <input
          ref={inputRef}
          type="file"
          name="attachment"
          accept={props.accept}
          className="sr-only"
          onChange={onChange}
        />
      </label>
      {file ? (
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
          {previewUrl ? (
            // objectURL 로컬 미리보기 — next/image 대상 아님(원격 최적화 불필요)
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewUrl}
              alt="첨부 이미지 미리보기"
              className="h-12 w-12 shrink-0 rounded-lg border border-slate-200 object-cover"
            />
          ) : (
            <Paperclip className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
          )}
          <span className="min-w-0 flex-1 truncate text-xs font-bold text-slate-700">{file.name}</span>
          <button
            type="button"
            onClick={clear}
            aria-label="첨부 제거"
            className="shrink-0 rounded-md p-1 text-slate-400 transition hover:bg-slate-200 hover:text-slate-600"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      ) : null}
    </div>
  );
}
