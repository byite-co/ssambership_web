"use client";

import Image from "next/image";
import { useSyncExternalStore } from "react";
import { STORE_LINKS } from "@/lib/appStore/storeLinks";

type StoreKind = "google" | "apple";

/** 모바일 OS 판별 — 데스크톱이면 "desktop". iPadOS 13+ 는 Mac UA 로 위장하므로 터치 지원 여부로 보정한다. */
function detectStoreTarget(): StoreKind | "desktop" {
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return "google";
  if (/iphone|ipad|ipod/i.test(ua)) return "apple";
  if (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1) return "apple";
  return "desktop";
}

const emptySubscribe = () => () => {};

/**
 * SSR 안전 스토어 타깃 구독 — 서버 스냅샷은 "ssr"(렌더 억제) → hydration 직후 실제 UA 로 보정된다.
 * effect 안 동기 setState 없이 처리한다(react-hooks/set-state-in-effect 대응, useMediaQuery 패턴).
 */
function useStoreTarget(): StoreKind | "desktop" | "ssr" {
  return useSyncExternalStore(emptySubscribe, detectStoreTarget, () => "ssr" as const);
}

const BADGES: Record<StoreKind, { src: string; alt: string; label: string }> = {
  google: {
    src: "/brand/badge-google-play.png",
    alt: "Google Play 다운로드",
    label: "Google Play에서 쌤버십 앱 다운로드",
  },
  apple: {
    src: "/brand/badge-app-store.svg",
    alt: "App Store에서 다운로드",
    label: "App Store에서 쌤버십 앱 다운로드",
  },
};

function StoreBadgeLink(props: { kind: StoreKind }) {
  const badge = BADGES[props.kind];
  return (
    <a
      href={STORE_LINKS[props.kind]}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={badge.label}
      className="block drop-shadow-lg transition hover:scale-105"
    >
      <Image src={badge.src} alt={badge.alt} width={150} height={50} className="h-auto w-[150px]" />
    </a>
  );
}

/**
 * 우측 하단 플로팅 스토어 버튼 — LandingLayout 전용.
 * 데스크톱은 두 배지 세로 스택, 모바일은 해당 OS 스토어 1개만 노출한다.
 * SSR 하이드레이션 불일치를 피하기 위해 마운트 후에만 렌더한다.
 */
export function FloatingStoreButtons() {
  const target = useStoreTarget();

  if (target === "ssr") return null;

  return (
    <div
      className="fixed right-6 z-40 flex flex-col items-end gap-2 bottom-[calc(1.5rem+env(safe-area-inset-bottom))] sm:right-8 sm:bottom-[calc(2rem+env(safe-area-inset-bottom))]"
      aria-label="쌤버십 앱 다운로드"
    >
      {target === "desktop" ? (
        <>
          <StoreBadgeLink kind="google" />
          <StoreBadgeLink kind="apple" />
        </>
      ) : (
        <StoreBadgeLink kind={target} />
      )}
    </div>
  );
}
