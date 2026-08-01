"use client";

import type { ReactNode } from "react";

type Props = {
  className: string;
  /** 드로어/메뉴 닫기 등 제출 직후 부가 동작. */
  onNavigate?: () => void;
  children?: ReactNode;
};

/**
 * 로그아웃 제출 정본 — 반드시 `<form method="post" action="/logout">` 로 제출한다.
 * /logout 을 `<Link>`/`<a>` 로 링크하는 것은 금지: Link prefetch 가 GET 을 쏘아
 * 세션을 파기하는 D-13(PREFETCH_SIDE_EFFECT) 재발 경로다(정적 tripwire 로 감시).
 */
export function LogoutButton({ className, onNavigate, children = "로그아웃" }: Props) {
  return (
    <form action="/logout" method="post" className="contents">
      <button
        type="submit"
        // onNavigate 를 동기 실행하면 상태 갱신이 form 을 unmount 해 브라우저 기본
        // 제출이 중단될 수 있어, 제출 default action 이후로 미룬다.
        onClick={onNavigate ? () => window.setTimeout(onNavigate, 0) : undefined}
        className={`cursor-pointer ${className}`}
      >
        {children}
      </button>
    </form>
  );
}
