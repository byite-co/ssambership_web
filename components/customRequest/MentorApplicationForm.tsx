"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { FormSubmitButton } from "@/components/common/FormSubmitButton";
import { submitMentorCustomRequestApplication } from "@/lib/customRequest/customRequestApplicationActions";
import type { MentorPostSummaryDisplay } from "@/components/customRequest/MentorPostReadonlySummary";
import {
  APPLICATION_ATTACHMENT_ACCEPT,
  APPLICATION_ATTACHMENT_MAX_FILES,
} from "@/lib/customRequest/applicationAttachmentConstants";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function fieldBlock(props: { label: string; hint?: string; children: ReactNode; landing?: boolean }) {
  if (props.landing) {
    return (
      <div className="apply-form-field">
        <div className="form-field-head">
          <span className="form-label flush">{props.label}</span>
          {props.hint ? <span className="form-hint">{props.hint}</span> : null}
        </div>
        {props.children}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex flex-col gap-0.5 sm:flex-row sm:flex-wrap sm:items-baseline sm:justify-between sm:gap-x-3 sm:gap-y-0">
        <span className="text-sm font-semibold text-slate-800">{props.label}</span>
        {props.hint ? <span className="text-xs text-slate-400">{props.hint}</span> : null}
      </div>
      {props.children}
    </div>
  );
}

export function MentorApplicationForm(props: {
  postId: string;
  returnContext: "mentor" | "public";
  postSummary?: MentorPostSummaryDisplay;
  /** apply 페이지: 상단 요약과 한 카드로 이어 붙일 때 */
  embedded?: boolean;
  /** apply 페이지: 랜딩 톤 UI */
  landing?: boolean;
}) {
  const budgetHint =
    props.postSummary?.budgetLine &&
    props.postSummary.budgetLine !== "—" &&
    props.postSummary.budgetLine !== "금액 협의"
      ? `희망 예산 ${props.postSummary.budgetLine}`
      : undefined;
  const deadlineHint =
    props.postSummary?.deadline && props.postSummary.deadline !== "—"
      ? `희망 납기 ${props.postSummary.deadline}`
      : undefined;

  const inputClass = props.landing
    ? "form-input"
    : "h-11 w-full rounded-lg border border-ds-border-subtle px-3 py-2 text-sm text-slate-900 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20";
  const textareaClass = props.landing
    ? "form-textarea"
    : "w-full resize-y rounded-lg border border-ds-border-subtle px-3 py-2.5 text-sm leading-relaxed text-slate-900 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20";
  const textareaSmClass = props.landing ? "form-textarea sm" : textareaClass;
  const [selectedFiles, setSelectedFiles] = useState<{ name: string; size: number }[]>([]);
  const fileInputClass = props.landing
    ? "form-file-input"
    : "mt-2 w-full text-sm file:mr-3 file:rounded-xl file:border file:border-ds-border-subtle file:bg-white file:px-4 file:py-2.5 file:text-xs file:font-extrabold file:text-slate-700";

  const formBody = (
    <>
      {props.landing ? (
        <div className="apply-form-head">
          <h3>지원서</h3>
          <p>
            <span className="md:hidden">입력 내용은 학생 비교 화면에 표시돼요.</span>
            <span className="hidden md:inline">제안가·납기·제안 내용은 의뢰자(학생)의 비교 화면에 표시돼요.</span>
          </p>
        </div>
      ) : (
        <div>
          <h2 className="ds-text-h2">지원서</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-slate-600">
            제안가·납기·제안 내용은 의뢰자(학생)의 비교 화면에 표시돼요.
          </p>
        </div>
      )}

      <input type="hidden" name="postId" value={props.postId} />
      <input type="hidden" name="returnContext" value={props.returnContext} />

      <div className={props.landing ? "apply-form-grid" : "grid grid-cols-1 gap-4 sm:grid-cols-2"}>
        {fieldBlock({
          landing: props.landing,
          label: "제안 금액(캐시)",
          hint: budgetHint,
          children: (
            <input
              name="proposedPrice"
              type="number"
              min={0}
              required
              suppressHydrationWarning
              placeholder={budgetHint ? undefined : "금액을 입력해 주세요"}
              className={inputClass}
            />
          ),
        })}

        {fieldBlock({
          landing: props.landing,
          label: "예상 납기(완료 예정일)",
          hint: deadlineHint,
          children: (
            <input
              name="deliveryAt"
              type="date"
              required
              suppressHydrationWarning
              className={inputClass}
            />
          ),
        })}
      </div>

      {fieldBlock({
        landing: props.landing,
        label: "제안 내용",
        children: (
          <textarea
            name="coverNote"
            required
            rows={5}
            suppressHydrationWarning
            placeholder="범위, 진행 방식, 질의응답, 전달 방식을 구체적으로 적어 주세요."
            className={textareaClass}
          />
        ),
      })}

      {fieldBlock({
        landing: props.landing,
        label: "추가 메모(선택)",
        children: <textarea name="extraAnswers" rows={3} suppressHydrationWarning className={textareaSmClass} />,
      })}

      {fieldBlock({
        landing: props.landing,
        label: "포트폴리오·참고 파일 (선택)",
        hint: `PDF/PPT/DOCX/이미지 · 최대 ${APPLICATION_ATTACHMENT_MAX_FILES}개 · 각 20MB · 학생 비교 화면에 표시돼요.`,
        children: (
          <>
            <input
              type="file"
              name="applicationAttachmentFiles"
              multiple
              accept={APPLICATION_ATTACHMENT_ACCEPT}
              suppressHydrationWarning
              onChange={(e) => {
                const files = e.target.files;
                if (!files?.length) {
                  setSelectedFiles([]);
                  return;
                }
                setSelectedFiles(Array.from(files).map((f) => ({ name: f.name, size: f.size })));
              }}
              className={props.landing ? "form-file-input mt-2" : fileInputClass}
            />
            {selectedFiles.length > 0 ? (
              <ul className={props.landing ? "form-file-list" : "mt-2 space-y-1.5"}>
                {selectedFiles.map((f) => (
                  <li
                    key={`${f.name}-${f.size}`}
                    className={props.landing ? undefined : "text-xs font-medium text-slate-600"}
                  >
                    {f.name} ({formatFileSize(f.size)})
                  </li>
                ))}
              </ul>
            ) : (
              <p className={props.landing ? "form-hint mt-2" : "mt-1 text-xs text-slate-500"}>선택된 파일 없음</p>
            )}
          </>
        ),
      })}

      <div
        className={
          props.landing
            ? "apply-form-footer"
            : "flex flex-col gap-3 border-t border-ds-border-subtle pt-4 sm:flex-row sm:items-center sm:justify-between"
        }
      >
        <p className={props.landing ? "form-hint" : "text-[12px] text-slate-500"}>
          제출 후에는 동일 의뢰에 다시 제출할 수 없어요.
        </p>
        <FormSubmitButton
          idleLabel="지원서 제출하기"
          pendingLabel="제출 중…"
          className={
            props.landing
              ? "btn btn-success w-full sm:w-auto disabled:cursor-not-allowed"
              : "inline-flex h-11 shrink-0 items-center justify-center rounded-xl bg-emerald-600 px-6 text-sm font-bold text-white enabled:hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          }
        />
      </div>
    </>
  );

  if (props.landing) {
    return (
      <form action={submitMentorCustomRequestApplication} className="apply-form">
        {formBody}
      </form>
    );
  }

  return (
    <div className={props.embedded ? "" : "space-y-4"}>
      <form
        action={submitMentorCustomRequestApplication}
        className={[
          "space-y-4",
          props.embedded
            ? "border-0 p-4 sm:p-5"
            : "rounded-2xl border border-ds-border-subtle p-4 sm:p-5",
        ].join(" ")}
      >
        {formBody}
      </form>
    </div>
  );
}
