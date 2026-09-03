"use client";

/**
 * 질문 상세의 첨부·필기 주석 갤러리(§4) — 인라인 썸네일, 클릭하면 PR-2 `DocumentViewer` 로 확대(오버레이). 서명 URL 은 서버가 발급해 넘긴다.
 * 이미지가 아닌 파일(PDF·zip·docx)은 파일 칩으로 보이고, 눌러도 같은 뷰어(PDF → iframe · 그 외 새 탭)로 연다.
 * 서명 URL 만료·실패 재요청은 `refreshSource`(질문 첨부 버킷 허용 목록 전용 읽기 액션)로 — 뷰어 부품은 그대로다.
 */
import { useEffect, useState } from "react";
import { DocumentViewer } from "@/components/admin/DocumentViewer";
import type { DocumentViewerSource } from "@/lib/admin/documentViewerModel";
import { cn } from "@/lib/utils/cn";

export type QuestionGalleryItem = {
  id: string;
  /** 파일명 또는 주석 라벨 */
  label: string;
  /** 썸네일 아래 보조 문구(작성자 · 시각) */
  caption: string | null;
  isImage: boolean;
  source: DocumentViewerSource;
};

type Props = {
  items: QuestionGalleryItem[];
  refreshSource: (storedRef: string) => Promise<DocumentViewerSource>;
  /** 썸네일 크기 — 메시지 안(sm) · 별도 블록(md) */
  size?: "sm" | "md";
  className?: string;
};

export function QuestionAttachmentGallery({ items, refreshSource, size = "sm", className }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = openId ? (items.find((i) => i.id === openId) ?? null) : null;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!items.length) return null;
  const thumb = size === "md" ? "h-40 w-40" : "h-28 w-28";

  return (
    <div className={cn("flex flex-wrap gap-2", className)} data-question-gallery data-item-count={items.length}>
      {items.map((item) => {
        const url = item.source.signedUrl;
        return (
          <figure key={item.id} className="w-fit max-w-full">
            <button
              type="button"
              onClick={() => setOpenId(item.id)}
              className={cn(
                "group relative flex items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50 text-left transition hover:border-slate-400",
                item.isImage ? thumb : "h-auto w-auto px-3 py-2"
              )}
              title={`${item.label} — 클릭하면 확대`}
              data-gallery-item={item.id}
            >
              {item.isImage && url ? (
                // eslint-disable-next-line @next/next/no-img-element -- 비공개 버킷 서명 URL(외부 스토리지) · 썸네일
                <img src={url} alt={item.label} className="h-full w-full object-cover" loading="lazy" draggable={false} />
              ) : (
                <span className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                  <span aria-hidden="true">{item.isImage ? "🖼" : "📎"}</span>
                  <span className="max-w-[220px] truncate">{item.label}</span>
                  {!url ? <span className="text-[10px] font-semibold text-amber-700">링크 발급 실패</span> : null}
                </span>
              )}
            </button>
            {item.caption ? <figcaption className="mt-0.5 max-w-[10rem] truncate text-[10px] text-slate-500">{item.caption}</figcaption> : null}
          </figure>
        );
      })}

      {open ? (
        <div className="fixed inset-0 z-40 flex flex-col bg-slate-950/90 p-3 sm:p-6" role="dialog" aria-modal="true" aria-label={`${open.label} 확대 보기`} data-question-gallery-overlay>
          <div className="mb-2 flex items-center justify-between gap-2 text-xs text-slate-200">
            <p className="min-w-0 truncate font-bold">
              {open.label}
              {open.caption ? <span className="ml-2 font-medium text-slate-400">{open.caption}</span> : null}
            </p>
            <button type="button" onClick={() => setOpenId(null)} className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-1 font-extrabold text-slate-100 hover:bg-slate-700">
              닫기 (Esc)
            </button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col">
            <DocumentViewer
              key={open.id}
              storagePath={open.source.storedRef}
              fileSizeBytes={open.source.sizeBytes}
              alt={open.label}
              initialSource={open.source}
              refreshSource={refreshSource}
              className="min-h-[60vh]"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
