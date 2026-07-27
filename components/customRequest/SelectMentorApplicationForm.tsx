"use client";

import { useState } from "react";
import { FormSubmitButton } from "@/components/common/FormSubmitButton";
import { selectMentorApplicationForOrder } from "@/lib/customRequest/customRequestOrderActions";

export function SelectMentorApplicationForm(props: {
  postId: string;
  applicationId: string;
  disabled?: boolean;
  mentorName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (props.disabled || !props.applicationId) {
    return (
      <button
        type="button"
        disabled
        className="min-h-[44px] cursor-not-allowed rounded-xl bg-slate-200 px-4 py-2.5 text-sm font-bold text-slate-500"
      >
        선택 불가
      </button>
    );
  }

  const label = props.mentorName ? `${props.mentorName} 멘토` : "이 멘토";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-[48px] w-full rounded-xl bg-[#2563EB] px-5 py-3 text-sm font-extrabold text-white shadow-sm hover:bg-blue-700 sm:w-auto"
      >
        이 멘토 선택
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="select-mentor-title"
        >
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
            <h3 id="select-mentor-title" className="text-lg font-black text-slate-900">
              멘토를 선택할까요?
            </h3>
            <p className="mt-2 text-sm font-medium text-slate-600">
              {label}의 제안으로 주문을 시작합니다. 선택 후에는 주문방에서 작업이 이어져요.
            </p>
            <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                disabled={submitting}
                onClick={() => setOpen(false)}
                className="min-h-[44px] rounded-xl border border-slate-200 bg-white px-5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                취소
              </button>
              <form action={selectMentorApplicationForOrder} className="inline" onSubmit={() => setSubmitting(true)}>
                <input type="hidden" name="postId" value={props.postId} />
                <input type="hidden" name="applicationId" value={props.applicationId} />
                <FormSubmitButton
                  idleLabel="선택 확정"
                  pendingLabel="처리 중…"
                  disabled={submitting}
                  className="min-h-[44px] w-full rounded-xl bg-[#2563EB] px-6 py-2.5 text-sm font-extrabold text-white hover:bg-blue-700 sm:w-auto"
                />
              </form>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
