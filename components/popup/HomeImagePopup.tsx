"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { X } from "lucide-react";
import { HOME_POPUP_CONFIG, type HomePopupConfig } from "@/lib/popup/homePopupConfig";

/**
 * 홈 이미지 팝업 (간단버전)
 *
 * - 설정 정본: `lib/popup/homePopupConfig.ts` (이 컴포넌트는 로직만 담당)
 * - 첫 렌더는 null → useEffect 에서 노출 조건 판정 후 open (SSR 하이드레이션 불일치 방지)
 * - "오늘 하루 보지 않기": localStorage 에 당일 자정까지의 만료 시각 저장.
 *   키에 config.id 가 포함되므로 팝업 교체(id 변경) 시 자동으로 다시 노출된다.
 * - 오버레이 방식이라 레이아웃을 밀지 않는다(CLS 없음). 다른 코드 의존 없음.
 */

const STORAGE_KEY_PREFIX = "ssambership:home-popup:";

function storageKey(id: string): string {
  return `${STORAGE_KEY_PREFIX}${id}`;
}

/** 당일 자정(다음 날 00:00 로컬 기준)의 epoch ms */
function endOfTodayMs(): number {
  const d = new Date();
  d.setHours(24, 0, 0, 0);
  return d.getTime();
}

/** 노출 조건 3종 판정 — enabled · 기간 · 숨김 기록. localStorage 접근은 실패해도 노출로 폴백. */
function shouldShowPopup(config: HomePopupConfig, now: number): boolean {
  if (!config.enabled) return false;

  if (config.startsAt) {
    const startMs = Date.parse(config.startsAt);
    if (Number.isFinite(startMs) && now < startMs) return false;
  }
  if (config.endsAt) {
    const endMs = Date.parse(config.endsAt);
    if (Number.isFinite(endMs) && now > endMs) return false;
  }

  try {
    const raw = window.localStorage.getItem(storageKey(config.id));
    if (raw) {
      const hideUntil = Number(raw);
      if (Number.isFinite(hideUntil) && now < hideUntil) return false;
      // 만료된 기록은 정리
      window.localStorage.removeItem(storageKey(config.id));
    }
  } catch {
    // localStorage 불가 환경(일부 시크릿 모드 등)에서는 그냥 노출
  }

  return true;
}

export function HomeImagePopup() {
  const config = HOME_POPUP_CONFIG;
  const [open, setOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  // 마운트 후 노출 판정 — localStorage(클라이언트 전용)라 effect 에서만 결정한다(SSR 하이드레이션 안전).
  // 판정·상태 갱신을 비동기 콜백에서 수행(효과 본문 동기 setState 회피 — RecentMentorsScope 와 동일 패턴).
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      if (shouldShowPopup(config, Date.now())) setOpen(true);
    });
    return () => {
      cancelled = true;
    };
  }, [config]);

  // 열림 동안: ESC 닫기 + 배경 스크롤 잠금 + 닫기 버튼 포커스
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    closeButtonRef.current?.focus();

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  const hideForToday = () => {
    try {
      window.localStorage.setItem(storageKey(config.id), String(endOfTodayMs()));
    } catch {
      // 저장 실패해도 이번 세션에서는 닫는다
    }
    setOpen(false);
  };

  if (!open) return null;

  const image = (
    <Image
      src={config.imageSrc}
      alt={config.imageAlt}
      width={config.imageWidth}
      height={config.imageHeight}
      priority
      className="h-auto w-full rounded-t-2xl"
    />
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        // 카드 바깥(오버레이) 클릭 시에만 닫기
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div
        role="dialog"
        aria-modal
        aria-label={config.imageAlt}
        className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-xl sm:max-w-md"
      >
        <div className="relative">
          {config.linkHref ? (
            <Link href={config.linkHref} onClick={() => setOpen(false)} aria-label={`${config.imageAlt} 자세히 보기`}>
              {image}
            </Link>
          ) : (
            image
          )}
          <button
            ref={closeButtonRef}
            type="button"
            onClick={() => setOpen(false)}
            aria-label="팝업 닫기"
            className="absolute right-2 top-2 rounded-lg bg-white/90 p-1 text-slate-700 shadow-sm transition hover:bg-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3">
          <button
            type="button"
            onClick={hideForToday}
            className="text-xs font-semibold text-slate-500 transition hover:text-slate-700"
          >
            오늘 하루 보지 않기
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-xs font-bold text-slate-700 transition hover:text-slate-900"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
