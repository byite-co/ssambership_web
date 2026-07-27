"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";

export function ApplicationAttachmentLightbox(props: {
  open: boolean;
  filename: string;
  imageUrl: string | null;
  loading: boolean;
  onClose: () => void;
}) {
  const { open, onClose } = props;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, open]);

  if (!props.open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="cr-att-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={`${props.filename} 미리보기`}
      onClick={props.onClose}
    >
      <button type="button" className="cr-att-lightbox-close btn btn-ghost" onClick={props.onClose}>
        닫기
      </button>
      <div className="cr-att-lightbox-body" onClick={(e) => e.stopPropagation()}>
        {props.loading ? (
          <p className="cr-att-lightbox-status">불러오는 중…</p>
        ) : props.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={props.imageUrl} alt={props.filename} className="cr-att-lightbox-img" />
        ) : null}
      </div>
    </div>,
    document.body
  );
}
