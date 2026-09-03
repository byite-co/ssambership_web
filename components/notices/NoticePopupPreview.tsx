"use client";

/**
 * 공지 팝업(PR-10 §1-3) — 관리자 폼의 **미리보기**와 PR-10b 의 **실제 서비스 팝업**이 같은 부품을 쓴다.
 * 그래서 관리자 모듈을 import 하지 않고, 데이터는 제목·본문·유형 라벨만 받는다.
 *
 * - `preview` 면 상단에 미리보기 배지를 보이고 `오늘 하루 보지 않기` 는 눌리지 않는다(서비스 반영 후 동작).
 * - PR-10b: 서비스 레이아웃이 활성+기간 내 `display_mode='popup'` 공지를 anon RLS 로 읽어 이 컴포넌트를 마운트하고,
 *   `onDismissToday` 에서 localStorage(`notice-popup-dismissed:<id>` = KST 날짜)를 기록한다.
 * - Esc·백드롭 클릭으로 닫힘 · role=dialog · 초기 포커스는 닫기 버튼.
 */
import { createPortal } from "react-dom";
import { useEffect, useId, useRef, type KeyboardEvent } from "react";

export type NoticePopupContent = {
  title: string;
  body: string;
  /** 사전 라벨(공지 · 이벤트 · 점검 · 업데이트) */
  typeLabel: string;
};

export type NoticePopupPreviewProps = {
  notice: NoticePopupContent;
  onClose: () => void;
  /** `오늘 하루 보지 않기` — PR-10b 가 localStorage 처리로 연결한다. 없고 preview 도 아니면 버튼을 그리지 않는다 */
  onDismissToday?: () => void;
  /** 관리자 미리보기 표시 */
  preview?: boolean;
};

export const NOTICE_POPUP_DISMISS_TODAY_LABEL = "오늘 하루 보지 않기";
export const NOTICE_POPUP_CLOSE_LABEL = "닫기";
export const NOTICE_POPUP_PREVIEW_BADGE = "미리보기 — 실제 서비스 팝업과 같은 형태입니다";

export function NoticePopupPreview({ notice, onClose, onDismissToday, preview = false }: NoticePopupPreviewProps) {
  const titleId = useId();
  const bodyId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => closeRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  const showDismiss = preview || typeof onDismissToday === "function";
  const title = notice.title.trim() || "제목 없음";
  const body = notice.body.trim();

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" data-notice-popup={preview ? "preview" : "live"}>
      <button type="button" className="absolute inset-0 bg-slate-900/50" aria-label={NOTICE_POPUP_CLOSE_LABEL} tabIndex={-1} onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        onKeyDown={handleKeyDown}
        className="relative z-10 flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl"
      >
        {preview ? (
          <p className="bg-amber-50 px-5 py-2 text-[11px] font-bold text-amber-900" data-notice-popup-preview-badge>
            {NOTICE_POPUP_PREVIEW_BADGE}
          </p>
        ) : null}
        <div className="border-b border-slate-100 px-5 pb-4 pt-5">
          <span className="inline-block rounded-md bg-[#EBF1FE] px-2 py-0.5 text-[11px] font-extrabold text-[#1A56DB]">{notice.typeLabel}</span>
          <h2 id={titleId} className="mt-2 text-lg font-black leading-snug text-slate-900">
            {title}
          </h2>
        </div>
        <div id={bodyId} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {body ? (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{body}</p>
          ) : (
            <p className="text-sm text-slate-500">본문이 없습니다.</p>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-3">
          {showDismiss ? (
            <button
              type="button"
              onClick={preview ? undefined : onDismissToday}
              disabled={preview}
              title={preview ? "서비스 반영 후 동작합니다." : undefined}
              className="text-xs font-bold text-slate-600 hover:text-slate-900 disabled:cursor-not-allowed disabled:text-slate-400"
            >
              {NOTICE_POPUP_DISMISS_TODAY_LABEL}
            </button>
          ) : (
            <span />
          )}
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="rounded-xl bg-[#1A56DB] px-4 py-2 text-sm font-bold text-white hover:bg-[#3F83F8]"
          >
            {NOTICE_POPUP_CLOSE_LABEL}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
