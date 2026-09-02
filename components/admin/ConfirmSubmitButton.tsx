"use client";

/**
 * 버튼 교체형 확인 다이얼로그 — 기존 `<button type="submit">` 자리에 그대로 끼워 넣는다.
 *
 * 관리자 mutation 은 대부분 Server Component 안의 `<form action={서버액션}>` + 버튼별 `formAction`/`name`/`value` 다
 * (분석 §2-2). 폼을 뜯지 않고 확인 절차를 끼우기 위해 이 컴포넌트는:
 *   1) 트리거 버튼을 `type="submit"` 으로 렌더하되 클릭을 `preventDefault` 하고 다이얼로그를 연다
 *   2) 확인되면 `form.requestSubmit(button)` 으로 **그 버튼을 submitter 로** 재제출한다
 *      → React 가 submitter 의 `formAction`·`name`·`value` 를 그대로 적용한다
 *   3) 사유는 버튼 옆 `<input type="hidden" name={reasonFieldName}>` 으로 같은 폼에 실린다
 * 클라이언트 폼(예: DisputeEscrowSplitPanel)은 `onConfirm` 을 넘기면 폼 제출 대신 그 함수를 호출한다.
 *
 * level 별 요구는 `lib/admin/adminConfirmPolicy.ts` 가 결정한다. `immediate` 는 다이얼로그 없이 버튼 그대로.
 * 사유 프리셋(`reasonPresets`, PR-2 §7): 다이얼로그가 칩을 그리고 칩 클릭 = 그 사유로 즉시 확인 → 같은 폼으로 제출된다.
 * (PR-1: 신설 · PR-2: 멘토 승인 작업대의 승인·반려·재제출·등급 확정에 연결.)
 */
import { useEffect, useRef, useState, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { AdminConfirmDialog, type AdminConfirmDetail } from "@/components/admin/AdminConfirmDialog";
import { resolveAdminConfirmRequirements, type AdminConfirmLevel } from "@/lib/admin/adminConfirmPolicy";

type ButtonPassthrough = Pick<
  ComponentPropsWithoutRef<"button">,
  "formAction" | "name" | "value" | "form" | "className" | "disabled" | "title" | "aria-label" | "id"
>;

type CommonProps = ButtonPassthrough & {
  /** 다이얼로그 확인 버튼 문구(예: "환불 승인") */
  confirmLabel: string;
  /** 트리거 버튼 내용 */
  children: ReactNode;
  /**
   * 넘기면 폼 제출 대신 이 함수를 호출한다(클라이언트 폼용). reason 은 trim 후 비어 있으면 undefined.
   * 넘기지 않으면 소속 폼을 `requestSubmit(button)` 으로 제출한다(Server Component 폼용).
   */
  onConfirm?: (reason?: string) => Promise<void>;
  /** 사유 입력 요구 — critical 은 기본 true */
  reasonRequired?: boolean;
  /** 다이얼로그 제목(기본: 등급별 제목) */
  dialogTitle?: string;
  cancelLabel?: string;
  /** 사유가 실릴 hidden input 의 name(기본 "reason") — 서버 액션이 읽는 필드명에 맞춘다 */
  reasonFieldName?: string;
  reasonLabel?: string;
  reasonPlaceholder?: string;
  /** 대상·금액 재표시 행 */
  details?: AdminConfirmDetail[];
  /** 제출 중 트리거 버튼 문구(기본: children 그대로) */
  pendingLabel?: ReactNode;
  /** 사유 프리셋 — reasonRequired 와 함께 쓴다. 칩 클릭 = 그 사유로 즉시 확인(타이핑 없이 한 번 더 클릭으로 끝) */
  reasonPresets?: readonly string[];
  /** 프리셋 모드에서 텍스트 필드를 여는 칩 문구(기본 "직접 입력") */
  customReasonLabel?: string;
};

export type ConfirmSubmitButtonProps =
  | (CommonProps & { level: "immediate"; summary?: string; confirmText?: never })
  | (CommonProps & { level: "stateChange"; summary?: string; confirmText?: never })
  | (CommonProps & { level: "critical"; summary: string; confirmText?: never })
  | (CommonProps & { level: "destructive"; summary: string; confirmText: string });

export type { AdminConfirmLevel };

const FALLBACK_ERROR = "처리에 실패했습니다. 다시 시도해 주세요.";

export function ConfirmSubmitButton(props: ConfirmSubmitButtonProps) {
  const {
    level,
    summary,
    confirmLabel,
    children,
    onConfirm,
    reasonRequired,
    dialogTitle,
    cancelLabel,
    reasonFieldName = "reason",
    reasonLabel,
    reasonPlaceholder,
    details,
    pendingLabel,
    reasonPresets,
    customReasonLabel,
    formAction,
    name,
    value,
    form,
    className,
    disabled,
    title,
    id,
    "aria-label": ariaLabel,
  } = props;
  const confirmText = props.level === "destructive" ? props.confirmText : null;
  const requirements = resolveAdminConfirmRequirements({ level, reasonRequired, confirmText, title: dialogTitle });

  const buttonRef = useRef<HTMLButtonElement>(null);
  const hiddenReasonRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { pending: formPending } = useFormStatus();
  const pending = formPending || submitting;

  // 서버 액션이 redirect 없이 끝나 돌아온 경우(pending true→false) 다이얼로그를 닫는다.
  const wasFormPending = useRef(false);
  useEffect(() => {
    if (wasFormPending.current && !formPending && submitting && !onConfirm) {
      setSubmitting(false);
      setOpen(false);
    }
    wasFormPending.current = formPending;
  }, [formPending, submitting, onConfirm]);

  // immediate — 확인 절차 없음. 기존 버튼과 완전히 동일하게 동작한다.
  if (!requirements.needsDialog) {
    if (onConfirm) {
      return (
        <button
          ref={buttonRef}
          type="button"
          id={id}
          className={className}
          disabled={disabled || pending}
          title={title}
          aria-label={ariaLabel}
          onClick={() => {
            setSubmitting(true);
            void onConfirm().finally(() => setSubmitting(false));
          }}
        >
          {pending && pendingLabel ? pendingLabel : children}
        </button>
      );
    }
    return (
      <button
        type="submit"
        id={id}
        formAction={formAction}
        name={name}
        value={value}
        form={form}
        className={className}
        disabled={disabled || pending}
        title={title}
        aria-label={ariaLabel}
      >
        {pending && pendingLabel ? pendingLabel : children}
      </button>
    );
  }

  const closeAndRestoreFocus = () => {
    setOpen(false);
    setError(null);
    buttonRef.current?.focus();
  };

  const handleConfirm = async (presetReason?: string) => {
    // 프리셋 칩 클릭은 사유 상태가 반영(re-render)되기 전에 제출되므로 인자로 받은 사유를 우선한다.
    const trimmedReason = (presetReason ?? reason).trim();
    if (presetReason !== undefined) setReason(presetReason);
    setError(null);

    if (onConfirm) {
      setSubmitting(true);
      try {
        await onConfirm(trimmedReason || undefined);
        setOpen(false);
      } catch (e) {
        setError(e instanceof Error && e.message ? e.message : FALLBACK_ERROR);
      } finally {
        setSubmitting(false);
      }
      return;
    }

    const button = buttonRef.current;
    const ownerForm = button?.form ?? null;
    if (!button || !ownerForm) {
      setError("연결된 폼을 찾을 수 없습니다.");
      return;
    }
    // hidden input 은 제어 컴포넌트라 상태 반영 전에는 옛 값이다 — 제출 직전에 DOM 값을 직접 맞춘다.
    if (hiddenReasonRef.current) hiddenReasonRef.current.value = trimmedReason;
    setSubmitting(true);
    try {
      // submitter 를 넘겨 이 버튼의 formAction·name·value 가 그대로 적용되게 한다.
      ownerForm.requestSubmit(button);
    } catch {
      try {
        ownerForm.requestSubmit();
      } catch {
        setSubmitting(false);
        setError(FALLBACK_ERROR);
      }
    }
  };

  return (
    <>
      <button
        ref={buttonRef}
        type={onConfirm ? "button" : "submit"}
        id={id}
        formAction={onConfirm ? undefined : formAction}
        name={onConfirm ? undefined : name}
        value={onConfirm ? undefined : value}
        form={onConfirm ? undefined : form}
        className={className}
        disabled={disabled || pending}
        title={title}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={(e) => {
          // 클릭은 제출이 아니라 다이얼로그 열기. 실제 제출은 확인 후 requestSubmit(button) 으로만 일어난다.
          e.preventDefault();
          if (disabled || pending) return;
          setReason("");
          setError(null);
          setOpen(true);
        }}
      >
        {pending && pendingLabel ? pendingLabel : children}
      </button>
      {requirements.reasonRequired && !onConfirm ? (
        <input type="hidden" name={reasonFieldName} value={reason} ref={hiddenReasonRef} form={form} />
      ) : null}
      <AdminConfirmDialog
        open={open}
        requirements={requirements}
        summary={summary}
        details={details}
        confirmLabel={confirmLabel}
        cancelLabel={cancelLabel}
        reasonLabel={reasonLabel}
        reasonPlaceholder={reasonPlaceholder}
        reason={reason}
        onReasonChange={setReason}
        reasonPresets={reasonPresets}
        customReasonLabel={customReasonLabel}
        pending={pending}
        errorMessage={error}
        onCancel={closeAndRestoreFocus}
        onConfirm={(presetReason) => void handleConfirm(presetReason)}
      />
    </>
  );
}
