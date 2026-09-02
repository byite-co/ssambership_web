"use client";

/**
 * 관리자 확인 다이얼로그 — `ConfirmSubmitButton` 이 띄우는 모달. 단독 사용도 가능.
 *
 * 규칙(지시서 §2 · PRD §5-1):
 * - critical: 대상 요약(summary) + 금액 등 재표시(details) + 사유 입력 필수 + 확인
 * - destructive: 대상 이름 재입력(confirmText) + 확인
 * - stateChange: 한 줄 확인
 * - **자동 포커스를 확인 버튼에 두지 않는다.** 초기 포커스는 사유 입력 → 재입력 → 취소 버튼 순.
 *   다이얼로그 안에는 `<form>` 이 없어 Enter 가 submit 을 일으키지 않고, INPUT 의 Enter 는 추가로 막는다.
 *   → Enter 한 번으로는 실행되지 않는다.
 * - Esc·백드롭 클릭으로 닫힘(pending 중 제외) · 포커스 트랩 · aria-labelledby/describedby.
 *
 * 사유 프리셋(PR-2 §7, 선택): `reasonPresets` 를 넘기면 사유 입력 자리에 칩을 그린다. **칩 클릭 = 그 사유로 즉시 확인**
 * (타이핑 없이 한 번 더 클릭으로 끝난다). "직접 입력" 칩만 텍스트 필드를 연다. 프리셋 모드에서는 초기 포커스를
 * 취소 버튼에 둔다 — 칩은 사실상 확인 버튼이므로 Enter 한 번으로 실행되면 안 된다.
 *
 * 판정 로직은 `lib/admin/adminConfirmPolicy.ts`(순수)에 있고, 이 파일은 렌더만 담당한다.
 */
import { createPortal } from "react-dom";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import {
  ADMIN_CONFIRM_REASON_MIN_LENGTH,
  adminConfirmInitialFocus,
  evaluateAdminConfirm,
  shouldBlockAdminConfirmEnterKey,
  type AdminConfirmRequirements,
  type AdminConfirmTone,
} from "@/lib/admin/adminConfirmPolicy";

export type AdminConfirmDetail = { label: string; value: ReactNode };

export type AdminConfirmDialogProps = {
  open: boolean;
  requirements: AdminConfirmRequirements;
  /** "김OO 학생에게 84,900원을 환불합니다" — 자금 관련은 방향을 문장으로 */
  summary?: string;
  /** 대상·금액 재표시 행 */
  details?: AdminConfirmDetail[];
  confirmLabel: string;
  cancelLabel?: string;
  reasonLabel?: string;
  reasonPlaceholder?: string;
  /** 사유 입력값(부모가 hidden input 으로 폼에 실어야 하므로 부모 상태) */
  reason: string;
  onReasonChange: (value: string) => void;
  /** 사유 프리셋 — reasonRequired 일 때만 의미 있다. 칩 클릭은 `onConfirm(preset)` 으로 즉시 확인한다. */
  reasonPresets?: readonly string[];
  /** 프리셋 모드에서 텍스트 필드를 여는 칩 문구(기본 "직접 입력") */
  customReasonLabel?: string;
  pending: boolean;
  errorMessage?: string | null;
  onCancel: () => void;
  /** presetReason 이 있으면 그 사유로 확인(칩 클릭). 없으면 부모 상태의 reason 으로 확인. */
  onConfirm: (presetReason?: string) => void;
};

const CONFIRM_BUTTON_TONE: Record<AdminConfirmTone, string> = {
  danger: "bg-red-600 text-white hover:bg-red-700 disabled:bg-red-200 disabled:text-white",
  warning: "bg-amber-500 text-white hover:bg-amber-600 disabled:bg-amber-200 disabled:text-white",
  neutral: "bg-slate-900 text-white hover:bg-slate-800 disabled:bg-slate-300 disabled:text-white",
};

const TITLE_TONE: Record<AdminConfirmTone, string> = {
  danger: "text-red-700",
  warning: "text-amber-700",
  neutral: "text-slate-900",
};

const PRESET_CHIP_TONE: Record<AdminConfirmTone, string> = {
  danger: "border-red-300 text-red-800 hover:bg-red-50",
  warning: "border-amber-300 text-amber-900 hover:bg-amber-50",
  neutral: "border-slate-300 text-slate-800 hover:bg-slate-50",
};

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function AdminConfirmDialog(props: AdminConfirmDialogProps) {
  const {
    open,
    requirements,
    summary,
    details,
    confirmLabel,
    cancelLabel = "취소",
    reasonLabel = "사유",
    reasonPlaceholder = "처리 사유를 입력해 주세요.",
    reason,
    onReasonChange,
    reasonPresets,
    customReasonLabel = "직접 입력",
    pending,
    errorMessage,
    onCancel,
    onConfirm,
  } = props;

  const titleId = useId();
  const descriptionId = useId();
  const reasonId = useId();
  const confirmTextId = useId();

  const dialogRef = useRef<HTMLDivElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const confirmTextRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const [typedConfirmText, setTypedConfirmText] = useState("");
  const [customReasonOpen, setCustomReasonOpen] = useState(false);

  const presets: readonly string[] = requirements.reasonRequired && Array.isArray(reasonPresets) ? reasonPresets : [];
  const hasPresets = presets.length > 0;
  // 프리셋 모드: 칩이 곧 확인이다. 텍스트 필드·확인 버튼은 "직접 입력" 을 누른 뒤에만 나온다.
  const presetsMode = hasPresets && !customReasonOpen;

  // 열림 전이마다 재입력 필드·직접 입력 모드를 비운다 — effect 가 아니라 렌더 중 상태 조정(React "adjusting state on prop change").
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setTypedConfirmText("");
      setCustomReasonOpen(false);
    }
  }

  // 열릴 때 초기 포커스를 준다 — 확인 버튼에는 절대 두지 않는다. 프리셋 모드에서는 칩도 확인이므로 취소 버튼으로.
  // (requirements 객체가 아니라 문자열 판정값에 의존해, 부모 재렌더마다 포커스가 튀지 않게 한다)
  const initialFocus = presetsMode ? "cancel" : adminConfirmInitialFocus(requirements);
  useEffect(() => {
    if (!open) return;
    const el =
      initialFocus === "reason"
        ? reasonRef.current
        : initialFocus === "confirmText"
          ? confirmTextRef.current
          : cancelRef.current;
    const frame = requestAnimationFrame(() => el?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open, initialFocus]);

  if (!open || !requirements.needsDialog) return null;

  const evaluation = evaluateAdminConfirm(requirements, { reason, typedConfirmText });
  const canConfirm = evaluation.ok && !pending;
  const reasonBlocked = evaluation.blockedBy.includes("reason");
  const confirmTextBlocked = evaluation.blockedBy.includes("confirmText");

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null;
    if (e.key === "Escape") {
      e.preventDefault();
      if (!pending) onCancel();
      return;
    }
    if (
      shouldBlockAdminConfirmEnterKey({
        key: e.key,
        tagName: target?.tagName ?? "",
        isComposing: e.nativeEvent.isComposing,
      })
    ) {
      e.preventDefault();
      return;
    }
    if (e.key === "Tab") {
      const root = dialogRef.current;
      if (!root) return;
      const focusable = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || !root.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/40"
        aria-label="닫기"
        tabIndex={-1}
        onClick={pending ? undefined : onCancel}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={summary ? descriptionId : undefined}
        onKeyDown={handleKeyDown}
        className="relative z-10 w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"
      >
        <h2 id={titleId} className={cn("text-lg font-black", TITLE_TONE[requirements.tone])}>
          {requirements.title}
        </h2>
        {summary ? (
          <p id={descriptionId} className="mt-2 text-sm font-semibold leading-6 text-slate-800">
            {summary}
          </p>
        ) : null}

        {details && details.length > 0 ? (
          <dl className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-slate-50 text-sm">
            {details.map((row) => (
              <div key={row.label} className="flex items-start justify-between gap-3 px-3 py-2">
                <dt className="shrink-0 text-xs font-bold text-slate-500">{row.label}</dt>
                <dd className="text-right font-extrabold text-slate-900">{row.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        {requirements.reasonRequired && hasPresets ? (
          <div className="mt-4">
            <p className="text-xs font-bold text-slate-700">
              {reasonLabel} <span className="text-red-600">(필수)</span>
            </p>
            <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label={`${reasonLabel} 프리셋`}>
              {presets.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  disabled={pending}
                  onClick={() => onConfirm(preset)}
                  className={cn(
                    "rounded-xl border bg-white px-3 py-2 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-60",
                    PRESET_CHIP_TONE[requirements.tone]
                  )}
                >
                  {preset}
                </button>
              ))}
              {!customReasonOpen ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    setCustomReasonOpen(true);
                    requestAnimationFrame(() => reasonRef.current?.focus());
                  }}
                  className="rounded-xl border border-dashed border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {customReasonLabel}
                </button>
              ) : null}
            </div>
            {presetsMode ? <p className="mt-2 text-[11px] text-slate-500">사유를 누르면 바로 처리됩니다.</p> : null}
          </div>
        ) : null}

        {requirements.reasonRequired && !presetsMode ? (
          <div className={hasPresets ? "mt-3" : "mt-4"}>
            <label htmlFor={reasonId} className="text-xs font-bold text-slate-700">
              {hasPresets ? customReasonLabel : reasonLabel} <span className="text-red-600">(필수)</span>
            </label>
            <textarea
              id={reasonId}
              ref={reasonRef}
              rows={3}
              value={reason}
              onChange={(e) => onReasonChange(e.target.value)}
              placeholder={reasonPlaceholder}
              disabled={pending}
              aria-invalid={reasonBlocked && reason.length > 0 ? true : undefined}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
            <p className="mt-1 text-[11px] text-slate-500">{ADMIN_CONFIRM_REASON_MIN_LENGTH}자 이상 입력해야 확인할 수 있습니다.</p>
          </div>
        ) : null}

        {requirements.confirmText !== null ? (
          <div className="mt-4">
            <label htmlFor={confirmTextId} className="text-xs font-bold text-slate-700">
              아래 값을 정확히 입력해 주세요:{" "}
              <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-900">
                {requirements.confirmText}
              </code>
            </label>
            <input
              id={confirmTextId}
              ref={confirmTextRef}
              type="text"
              value={typedConfirmText}
              onChange={(e) => setTypedConfirmText(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              disabled={pending}
              aria-invalid={confirmTextBlocked && typedConfirmText.length > 0 ? true : undefined}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
          </div>
        ) : null}

        {errorMessage ? (
          <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-800">
            {errorMessage}
          </p>
        ) : null}

        <div className="mt-5 flex gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="flex-1 rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            {cancelLabel}
          </button>
          {!presetsMode ? (
            <button
              type="button"
              onClick={() => onConfirm()}
              disabled={!canConfirm}
              aria-disabled={!canConfirm}
              className={cn(
                "flex-1 rounded-xl py-2.5 text-sm font-bold transition disabled:cursor-not-allowed",
                CONFIRM_BUTTON_TONE[requirements.tone]
              )}
            >
              {pending ? "처리 중…" : confirmLabel}
            </button>
          ) : pending ? (
            <span className="flex flex-1 items-center justify-center rounded-xl bg-slate-100 py-2.5 text-sm font-bold text-slate-500">
              처리 중…
            </span>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  );
}
