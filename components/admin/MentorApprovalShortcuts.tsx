"use client";

/**
 * 멘토 승인 작업대 — 단축키(PR-2 §8). 화면 하단에 사용 가능한 키를 항상 표시한다.
 *
 * 안전장치:
 *   1) 입력 요소(input·textarea·select·contenteditable)에 포커스가 있으면 **핸들러 첫 줄에서** 전부 끈다.
 *   2) 확인 다이얼로그가 열려 있으면 끈다 · Ctrl/Alt/Meta 조합 · IME 조합 중도 끈다.
 *   3) 승인·반려·재제출 키(A/R/D)는 트리거 버튼을 click 해 **확인 모달을 열 뿐** 실행하지 않는다.
 *      (`ConfirmSubmitButton` 의 트리거 onClick 은 preventDefault 후 다이얼로그를 연다 — 제출은 확인 뒤 requestSubmit 만.)
 */
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { DOCUMENT_VIEWER_FULLSCREEN_EVENT } from "@/lib/admin/documentViewerModel";
import {
  MENTOR_APPROVAL_SHORTCUTS,
  MENTOR_DECISION_BUTTON_IDS,
  resolveMentorApprovalShortcut,
  shouldIgnoreMentorApprovalShortcut,
  type MentorApprovalShortcutAction,
} from "@/lib/admin/mentorApprovalDecision";

type Props = {
  prevHref: string | null;
  nextHref: string | null;
  nextPendingHref: string | null;
  /** 선택 건에 결정 버튼이 있는가(없으면 A/R/D 는 아무 일도 하지 않는다) */
  canDecide: boolean;
};

function openDecisionDialog(id: string) {
  const el = document.getElementById(id);
  if (el instanceof HTMLButtonElement && !el.disabled) el.click();
}

export function MentorApprovalShortcuts(props: Props) {
  const { prevHref, nextHref, nextPendingHref, canDecide } = props;
  const router = useRouter();

  useEffect(() => {
    for (const href of [prevHref, nextHref, nextPendingHref]) if (href) router.prefetch(href);
  }, [prevHref, nextHref, nextPendingHref, router]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // 첫 줄: 입력 중·다이얼로그 열림·조합키·IME 조합 → 모든 단축키 무시.
      if (
        shouldIgnoreMentorApprovalShortcut({
          tagName: target?.tagName,
          isContentEditable: Boolean(target?.isContentEditable),
          hasModifier: e.ctrlKey || e.altKey || e.metaKey,
          dialogOpen: Boolean(document.querySelector('[role="dialog"][aria-modal="true"]')),
          isComposing: e.isComposing,
        })
      ) {
        return;
      }
      const action: MentorApprovalShortcutAction | null = resolveMentorApprovalShortcut(e.key);
      if (!action) return;

      switch (action) {
        case "next":
          if (nextHref) {
            e.preventDefault();
            router.push(nextHref);
          }
          return;
        case "prev":
          if (prevHref) {
            e.preventDefault();
            router.push(prevHref);
          }
          return;
        case "nextPending":
          if (nextPendingHref) {
            e.preventDefault();
            router.push(nextPendingHref);
          }
          return;
        case "fullscreen":
          e.preventDefault();
          window.dispatchEvent(new CustomEvent(DOCUMENT_VIEWER_FULLSCREEN_EVENT));
          return;
        case "openApprove":
        case "openReject":
        case "openResubmit": {
          if (!canDecide) return;
          e.preventDefault();
          // 확인 모달만 연다 — 실행은 모달 안 확인(또는 사유 프리셋 선택) 뒤에만 일어난다.
          const id =
            action === "openApprove"
              ? MENTOR_DECISION_BUTTON_IDS.approve
              : action === "openReject"
                ? MENTOR_DECISION_BUTTON_IDS.reject
                : MENTOR_DECISION_BUTTON_IDS.resubmit;
          openDecisionDialog(id);
          return;
        }
        default:
          return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [prevHref, nextHref, nextPendingHref, canDecide, router]);

  return (
    <footer
      className="sticky bottom-0 z-10 -mx-1 mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-slate-200 bg-white/95 px-3 py-2 text-[11px] font-semibold text-slate-600 shadow-sm backdrop-blur"
      aria-label="단축키"
    >
      <span className="font-black text-slate-800">단축키</span>
      {MENTOR_APPROVAL_SHORTCUTS.map((s) => {
        const enabled =
          s.action === "next"
            ? Boolean(nextHref)
            : s.action === "prev"
              ? Boolean(prevHref)
              : s.action === "nextPending"
                ? Boolean(nextPendingHref)
                : s.action === "fullscreen"
                  ? true
                  : canDecide;
        return (
          <span key={s.key} className={enabled ? "" : "opacity-40"}>
            <kbd className="rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] font-bold text-slate-800">{s.key}</kbd>{" "}
            {s.label}
          </span>
        );
      })}
      <span className="ml-auto text-slate-400">입력 중에는 단축키가 꺼집니다 · A/R/D 는 확인 창만 엽니다</span>
    </footer>
  );
}
