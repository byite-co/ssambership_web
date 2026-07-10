"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { BrandSymbol } from "@/components/brand/BrandLogo";

const nav = [
  { href: "/login", label: "로그인" },
  { href: "/signup", label: "회원가입" },
];

const loginPageCenter = [
  { href: "/", label: "멘토 찾기" },
  { href: "/", label: "질문방" },
  { href: "/", label: "커뮤니티" },
  { href: "/", label: "캐시결제" },
];

export type AuthTopNavSize = "default" | "hero";

type AuthTopNavProps = {
  size?: AuthTopNavSize;
  showMarketingNav?: boolean;
  contentClassName?: string;
  /**
   * 로그인 시안: 좌 로고 / 중 5개 메뉴 / 우 검색·로그인·가입
   * `true`이면 `showMarketingNav`는 무시
   */
  loginPageNav?: boolean;
};

function linkClassDefault(active: boolean) {
  return [
    "rounded-lg px-3.5 py-2 text-sm font-medium transition",
    active ? "bg-blue-100 text-blue-800" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
  ].join(" ");
}

function linkClassHero(active: boolean) {
  return [
    "rounded-xl px-4 py-2.5 text-base font-semibold transition sm:px-5 sm:py-3 sm:text-[1.05rem]",
    active ? "bg-blue-600 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
  ].join(" ");
}

function SearchIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path
        d="M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15ZM21 21l-4.1-4.1"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function AuthTopNav({ size = "default", showMarketingNav = false, contentClassName, loginPageNav = false }: AuthTopNavProps) {
  const pathname = usePathname();
  const hero = size === "hero";
  const defaultBar = "mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-4 sm:px-6";
  const loginBar = `mx-auto w-full items-center ${contentClassName ?? "max-w-5xl"} px-4 sm:px-5 md:px-6 lg:px-8`;

  if (loginPageNav) {
    const loginActive = pathname === "/login" || (pathname?.startsWith("/login/") ?? false);
    const loginBtnClass = (mobile: boolean) =>
      [
        "inline-flex items-center justify-center font-extrabold text-slate-800 transition",
        mobile
          ? "min-h-10 min-w-[4.25rem] rounded-full border border-slate-200 bg-white px-3 text-sm"
          : "min-h-12 min-w-[5.25rem] rounded-full border border-slate-200/90 bg-white px-4 text-sm shadow-sm sm:px-5 sm:text-base md:min-h-[3.05rem] md:px-6",
        loginActive ? "border-blue-200 bg-sky-50 text-blue-900" : "hover:border-slate-300",
      ].join(" ");
    return (
      // loginPageNav는 forgot/update 비밀번호 화면 전용. 이들은 (public) AppShell 헤더(로고+햄버거)도
      // 함께 렌더돼 모바일에서 헤더가 중복되므로, 이 가로 네비는 모바일에서 숨기고 md(데스크탑)부터 노출.
      <header className="hidden md:block sticky top-0 z-20 w-full border-b border-slate-200/80 bg-white/95 shadow-[0_1px_0_rgba(15,23,42,0.05)] backdrop-blur-sm">
        <div
          className={`${loginBar} ${"flex min-h-[3.5rem] flex-col gap-2.5 py-2.5 sm:min-h-[3.9rem] sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-0"}`}
        >
          <div className="flex min-w-0 items-center justify-between sm:shrink-0 sm:justify-start sm:pr-2 md:pr-4">
            <Link
              href="/"
              className="flex shrink-0 items-center gap-2 pl-0.5 text-xl font-extrabold tracking-[-0.02em] text-slate-900 sm:text-2xl md:text-[1.6rem] lg:text-[1.7rem]"
            >
              <BrandSymbol className="h-8 w-8 sm:h-9 sm:w-9" />
              쌤버십
            </Link>
            <div className="flex items-center gap-1.5 sm:hidden" aria-label="빠른 액션">
              <button
                type="button"
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm"
                aria-label="검색"
              >
                <SearchIcon />
              </button>
              <Link href="/login" className={loginBtnClass(true)}>
                로그인
              </Link>
            </div>
          </div>

          <nav
            className="order-3 flex w-full min-w-0 items-center justify-center gap-1 overflow-x-auto pb-0.5 sm:order-none sm:flex-1 sm:justify-center sm:px-2 sm:pb-0 md:gap-2 lg:gap-2.5"
            aria-label="서비스 메뉴"
          >
            {loginPageCenter.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className="shrink-0 rounded-full px-3 py-1.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 sm:px-3.5 sm:py-2.5 sm:text-[0.95rem] md:px-4 md:py-2.5 md:text-base"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="hidden min-w-0 shrink-0 items-center justify-end gap-2.5 sm:flex sm:gap-3 sm:pl-0.5 md:gap-3.5" aria-label="액세스">
            <button
              type="button"
              className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-slate-200/90 bg-white text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
              aria-label="검색"
            >
              <SearchIcon className="h-5 w-5 sm:h-[1.15rem] sm:w-[1.15rem]" />
            </button>
            <Link href="/login" className={loginBtnClass(false)}>
              로그인
            </Link>
            <Link
              href="/signup"
              className="inline-flex h-12 min-w-[5.5rem] items-center justify-center rounded-full bg-blue-600 px-5 text-sm font-extrabold text-white shadow-sm transition hover:bg-blue-700 sm:min-w-[5.75rem] sm:px-6 sm:text-base"
            >
              회원가입
            </Link>
          </div>
        </div>
      </header>
    );
  }

  return (
    <header
      className={
        hero
          ? "sticky top-0 z-20 w-full border-b border-slate-200/70 bg-white/95 shadow-[0_1px_0_rgba(15,23,42,0.04)] backdrop-blur-md"
          : "sticky top-0 z-20 w-full border-b border-slate-200/80 bg-white/90 backdrop-blur-sm"
      }
    >
      <div
        className={
          hero
            ? "mx-auto flex h-16 w-full max-w-none items-center justify-between gap-6 px-3 sm:h-[4.25rem] sm:px-6 md:px-8 xl:px-12 2xl:px-16"
            : showMarketingNav
              ? `mx-auto flex h-14 w-full items-center justify-between gap-4 px-4 sm:px-6 ${contentClassName ?? "max-w-5xl"}`
              : defaultBar
        }
      >
        <Link
          href="/"
          className={
            hero
              ? "flex items-center gap-2 text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl md:text-[1.65rem]"
              : "flex items-center gap-2 text-lg font-bold tracking-tight text-slate-900"
          }
        >
          <BrandSymbol className={hero ? "h-8 w-8 sm:h-9 sm:w-9" : "h-7 w-7"} />
          쌤버십
        </Link>
        <nav
          className={hero ? "flex flex-wrap items-center justify-end gap-2 sm:gap-3" : "flex flex-wrap items-center justify-end gap-1.5 sm:gap-2"}
          aria-label="주요 메뉴"
        >
          {showMarketingNav
            ? [
                { href: "/", label: "멘토 찾기" },
                { href: "/", label: "질문방" },
              ].map((item) => (
                <Link
                  key={item.label}
                  href={item.href}
                  className="rounded-lg px-2.5 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 sm:px-3"
                >
                  {item.label}
                </Link>
              ))
            : null}
          {nav.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={hero ? linkClassHero(active) : linkClassDefault(active)}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
