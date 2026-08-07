"use client";

import { useEffect, useRef } from "react";

/**
 * 채팅 타임라인 끝 앵커 — 내 전송 직후(active)에만 최하단으로 정렬한다.
 * 텍스트 전송과 달리 이미지 첨부는 썸네일이 로드된 뒤에야 높이가 생겨 하단이
 * 밀려나므로, 미로드 이미지의 load/error 마다 정렬을 반복해 체감을 통일한다.
 * active=false(열람·상대 메시지 갱신)에서는 스크롤을 건드리지 않는다.
 */
export function ChatBottomAnchor(props: { anchorKey: string | null; active: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const { anchorKey, active } = props;

  useEffect(() => {
    if (!active || !anchorKey) return;
    const el = ref.current;
    if (!el) return;
    const scroll = () => el.scrollIntoView({ block: "end" });
    scroll();
    const scope = el.parentElement;
    const pending = Array.from(scope?.querySelectorAll("img") ?? []).filter((img) => !img.complete);
    if (pending.length === 0) return;
    const onSettled = () => scroll();
    for (const img of pending) {
      img.addEventListener("load", onSettled);
      img.addEventListener("error", onSettled);
    }
    return () => {
      for (const img of pending) {
        img.removeEventListener("load", onSettled);
        img.removeEventListener("error", onSettled);
      }
    };
  }, [anchorKey, active]);

  return <div ref={ref} aria-hidden />;
}
