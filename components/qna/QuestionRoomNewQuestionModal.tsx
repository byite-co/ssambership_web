"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { QuestionRoomStudentThreadForm } from "@/components/qna/QuestionRoomStudentThreadForm";
import type { WeeklyUsageSnapshot } from "@/lib/qna/weeklyQuestionUsageDisplay";

export function QuestionRoomNewQuestionModal(props: {
  open: boolean;
  onClose: () => void;
  roomId: string;
  contextThreadId?: string | null;
  usage: WeeklyUsageSnapshot | null;
  usageLoading?: boolean;
  subjectOptions?: string[];
}) {
  useEffect(() => {
    if (!props.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.open, props.onClose]);

  if (!props.open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/40"
        aria-label="닫기"
        onClick={props.onClose}
      />
      <div
        role="dialog"
        aria-modal
        aria-labelledby="new-question-title"
        className="relative z-10 w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"
      >
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 id="new-question-title" className="text-[16px] font-black text-slate-900">
            새로운 질문하기
          </h2>
          <button
            type="button"
            onClick={props.onClose}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="mb-4 text-[12px] font-medium leading-relaxed text-slate-500">
          과목·메모·제목은 모두 선택이에요. 제목을 비우면 “질문 N”으로 자동 생성됩니다. 질문을 등록하는 순간 주간 한도가 차감됩니다(확인 여부와 무관).
        </p>
        <QuestionRoomStudentThreadForm
          roomId={props.roomId}
          contextThreadId={props.contextThreadId}
          usage={props.usage}
          usageLoading={props.usageLoading}
          subjectOptions={props.subjectOptions}
          variant="modal"
          onSuccess={props.onClose}
        />
      </div>
    </div>
  );
}