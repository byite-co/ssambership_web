"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * SSR 안전 media query 구독.
 * 서버 스냅샷은 false(데스크탑 기준) → hydration 직후 실제 값으로 보정된다
 * (기존 "초기값=데스크탑, 마운트 후 matchMedia 로 보정" 패턴과 동일한 표시 흐름).
 * effect 안 동기 setState 없이 외부 스토어 구독으로 처리한다(react-hooks/set-state-in-effect 대응).
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    [query]
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false
  );
}
