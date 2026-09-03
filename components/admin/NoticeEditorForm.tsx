"use client";

/**
 * 공지 작성·수정 폼(PR-10 §1-3) — 제목 · 유형 · 대상 · 기간(시작·종료) · 본문 · **노출 방식(공지 목록에만 / 팝업으로도)** · 활성.
 *
 * - 팝업을 고르면 `미리보기` 버튼이 나오고, 제목·본문을 `NoticePopupPreview`(PR-10b 가 서비스 레이아웃에 마운트할 같은 부품)로 모달 렌더한다.
 * - 폼 상단 안내 `팝업 노출은 서비스 반영 후 적용됩니다.` — PR-10b 머지 전까지(관리자가 팝업을 골랐는데 안 뜬다고 오해하지 않게).
 * - 이미지 첨부는 없다(`image_url` 컬럼·버킷 보류 — DB). 쓰기는 기존 액션 모듈(`adminNoticesActions`)만.
 */
import Link from "next/link";
import { useState } from "react";
import { FormSubmitButton } from "@/components/common/FormSubmitButton";
import { NoticePopupPreview } from "@/components/notices/NoticePopupPreview";
import { submitAdminNoticeDraft, updateAdminNoticeAction } from "@/lib/admin/adminNoticesActions";
import {
  NOTICE_BASE_PATH,
  NOTICE_DISPLAY_MODE_OPTIONS,
  NOTICE_POPUP_HELP,
  NOTICE_POPUP_PENDING_NOTICE,
  NOTICE_TARGET_OPTIONS,
  NOTICE_TITLE_MAX_LENGTH,
  NOTICE_TYPE_TABS,
  noticeTypeLabel,
  resolveNoticeDisplayMode,
  resolveNoticeType,
  type NoticeDisplayMode,
  type NoticeFormDefaults,
  type NoticeType,
} from "@/lib/admin/noticeConsole";

type Props = {
  mode: "create" | "edit";
  noticeId: string | null;
  defaults: NoticeFormDefaults;
  errorMessage: string | null;
};

const LABEL = "block text-xs font-extrabold text-slate-700";
const INPUT = "mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100";

export function NoticeEditorForm({ mode, noticeId, defaults, errorMessage }: Props) {
  const [title, setTitle] = useState(defaults.title);
  const [body, setBody] = useState(defaults.body);
  const [type, setType] = useState<NoticeType>(defaults.type);
  const [displayMode, setDisplayMode] = useState<NoticeDisplayMode>(defaults.displayMode);
  const [previewOpen, setPreviewOpen] = useState(false);

  const isEdit = mode === "edit" && Boolean(noticeId);
  const action = isEdit ? updateAdminNoticeAction : submitAdminNoticeDraft;
  const typeOptions = NOTICE_TYPE_TABS.filter((t) => t.value !== "all");

  return (
    <section id="notice-editor" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" data-notice-editor={mode}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-black text-slate-900">{isEdit ? "공지 수정" : "새 공지"}</h2>
        {isEdit ? (
          <Link href={NOTICE_BASE_PATH} className="text-xs font-bold text-slate-600 hover:underline" prefetch={false}>
            수정 취소 · 새 공지 작성
          </Link>
        ) : null}
      </div>
      <p role="note" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900" data-notice-popup-pending>
        ⓘ {NOTICE_POPUP_PENDING_NOTICE}
      </p>
      {errorMessage ? (
        <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-900">
          {errorMessage}
        </p>
      ) : null}

      <form action={action} className="mt-4 space-y-4">
        {isEdit && noticeId ? <input type="hidden" name="id" value={noticeId} /> : null}
        <input type="hidden" name="resource" value="notice" />

        <label className={LABEL}>
          제목
          <input
            name="title"
            required
            maxLength={NOTICE_TITLE_MAX_LENGTH}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={INPUT}
            placeholder="예: 9월 정기 점검 안내"
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className={LABEL}>
            유형
            <select name="type" value={type} onChange={(e) => setType(resolveNoticeType(e.target.value) ?? "notice")} className={INPUT}>
              {typeOptions.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className={LABEL}>
            대상
            <select name="target" defaultValue={defaults.target} className={INPUT}>
              {NOTICE_TARGET_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className={LABEL}>
            노출 시작
            <input name="start" type="datetime-local" defaultValue={defaults.start} className={INPUT} />
          </label>
          <label className={LABEL}>
            노출 종료
            <input name="end" type="datetime-local" defaultValue={defaults.end} className={INPUT} />
          </label>
        </div>

        <label className={LABEL}>
          본문
          <textarea name="body" rows={6} value={body} onChange={(e) => setBody(e.target.value)} className={INPUT} placeholder="사용자에게 보일 내용" />
        </label>

        <fieldset className="rounded-xl border border-slate-200 bg-slate-50/60 p-3" data-notice-display-mode>
          <legend className="px-1 text-xs font-extrabold text-slate-700">노출 방식</legend>
          <div className="flex flex-wrap items-center gap-4">
            {NOTICE_DISPLAY_MODE_OPTIONS.map((o) => (
              <label key={o.value} className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                <input
                  type="radio"
                  name="display_mode"
                  value={o.value}
                  checked={displayMode === o.value}
                  onChange={() => setDisplayMode(resolveNoticeDisplayMode(o.value))}
                />
                {o.label}
              </label>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-slate-500">{NOTICE_POPUP_HELP}</p>
          {displayMode === "popup" ? (
            <button
              type="button"
              onClick={() => setPreviewOpen(true)}
              className="mt-2 rounded-lg border border-[#1A56DB] bg-white px-3 py-1.5 text-xs font-extrabold text-[#1A56DB] hover:bg-blue-50"
              data-notice-preview-button
            >
              미리보기
            </button>
          ) : null}
        </fieldset>

        <label className="flex items-center gap-2 text-sm text-slate-800">
          <input type="checkbox" name="active" value="on" defaultChecked={defaults.active} />
          활성(저장 즉시 노출 · 팝업은 서비스 반영 후)
        </label>

        <div className="flex items-center gap-2">
          <FormSubmitButton
            idleLabel={isEdit ? "수정 저장" : "공지 등록"}
            pendingLabel="처리 중…"
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white enabled:hover:bg-slate-800 disabled:bg-slate-300"
          />
        </div>
      </form>

      {previewOpen ? (
        <NoticePopupPreview notice={{ title, body, typeLabel: noticeTypeLabel(type) }} onClose={() => setPreviewOpen(false)} preview />
      ) : null}
    </section>
  );
}
