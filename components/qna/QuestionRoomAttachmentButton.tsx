"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Paperclip, X } from "lucide-react";
import { sendQuestionAttachmentAction } from "@/lib/qna/questionRoomActions";

/**
 * 채팅 입력바 첨부 버튼. 메시지 폼 내부에 위치하므로 자체 <form> 을 두지 않고
 * 서버 액션을 직접 호출(transition)해 파일을 업로드·전송한다.
 *
 * 선택 즉시 전송하지 않는다 — 파일을 잡아 두고(전송 전 단계) 파일명·이미지 썸네일
 * 미리보기 칩을 보여 첨부 여부를 확인시킨 뒤, [전송] 을 눌러야 실제 전송한다.
 * (개별질문 폼의 IqAttachmentField 와 동일한 체감 — 서버 액션·업로드 경로는 불변.)
 */
export function QuestionRoomAttachmentButton(props: {
  roomId: string;
  threadId: string | null;
  actor: "student" | "mentor";
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [held, setHeld] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const disabled = !props.threadId || pending;

  // objectURL 은 교체·언마운트 시 해제(effect cleanup 이 이전 URL 을 회수).
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !props.threadId) return;
    if (file.size > 20 * 1024 * 1024) {
      setError("파일은 20MB 이하만 첨부할 수 있어요.");
      return;
    }
    setError(null);
    setHeld(file);
    setPreviewUrl(file.type.startsWith("image/") ? URL.createObjectURL(file) : null);
  }

  function clearHeld() {
    setHeld(null);
    setPreviewUrl(null);
  }

  function sendHeld() {
    if (!held || !props.threadId) return;
    const fd = new FormData();
    fd.append("attachment", held);
    fd.append("roomId", props.roomId);
    fd.append("threadId", props.threadId);
    fd.append("actor", props.actor);
    fd.append("contextThreadId", props.threadId);
    startTransition(() => {
      void sendQuestionAttachmentAction(fd);
    });
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf,.doc,.docx,.ppt,.pptx,.zip"
        className="hidden"
        onChange={onPick}
      />
      {held ? (
        <div className="flex min-w-0 shrink items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-1.5 py-1">
          {previewUrl ? (
            // objectURL 로컬 미리보기 — next/image 대상 아님(원격 최적화 불필요)
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewUrl}
              alt="첨부 이미지 미리보기"
              className="h-9 w-9 shrink-0 rounded-md border border-slate-200 object-cover"
            />
          ) : (
            <Paperclip className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
          )}
          <span className="max-w-[96px] truncate text-[11px] font-bold text-slate-700">{held.name}</span>
          <button
            type="button"
            onClick={sendHeld}
            disabled={pending}
            className={`shrink-0 rounded-md px-2 py-1 text-[11px] font-extrabold text-white transition disabled:cursor-not-allowed disabled:opacity-60 ${
              props.actor === "mentor" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-blue-600 hover:bg-blue-700"
            }`}
          >
            {pending ? "전송 중…" : "전송"}
          </button>
          <button
            type="button"
            onClick={clearHeld}
            disabled={pending}
            aria-label="첨부 취소"
            className="shrink-0 rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 disabled:opacity-40"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          title={props.threadId ? "파일·사진 첨부" : "질문을 먼저 선택해 주세요"}
          aria-label="파일·사진 첨부"
          className="shrink-0 rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Paperclip className="h-5 w-5" />
        </button>
      )}
      {error ? (
        <span className="absolute -top-6 left-2 rounded bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-700">
          {error}
        </span>
      ) : null}
    </>
  );
}
