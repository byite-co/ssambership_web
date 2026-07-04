import type { AppRole } from "@/lib/types/user";

/** Which top-nav variant is shown (matches `AppShell` nav arrays). */
export type MainNavAudience = "public" | "student" | "mentor" | "admin";

export function mainNavAudience(sessionRole: AppRole | null | undefined): MainNavAudience {
  if (sessionRole === "mentor") return "mentor";
  if (sessionRole === "admin") return "admin";
  if (sessionRole === "student") return "student";
  return "public";
}

/**
 * Whether the main header link `itemHref` should show active styling for `pathname`.
 * Prefix-based; alias question-room routes included.
 */
export function isMainNavItemActive(pathname: string, itemHref: string, audience: MainNavAudience): boolean {
  const p = pathname;

  switch (itemHref) {
    case "/mentors":
      return p === "/mentors" || p.startsWith("/mentors/");
    case "/question-room":
      if (audience === "mentor") return false;
      return (
        p === "/question-room" ||
        p.startsWith("/question-room/") ||
        p === "/questions" ||
        p.startsWith("/questions/")
      );
    case "/mentor/question-room":
      return (
        p === "/mentor/question-room" ||
        p.startsWith("/mentor/question-room/") ||
        p === "/mentor/questions" ||
        p.startsWith("/mentor/questions/")
      );
    case "/community":
      return p === "/community" || p.startsWith("/community/");
    case "/custom-request":
    case "/mentor/custom-request":
    case "/mentor/custom-request/dashboard":
      return (
        p === "/custom-request" ||
        p.startsWith("/custom-request/") ||
        p === "/mentor/custom-request" ||
        p.startsWith("/mentor/custom-request/")
      );
    case "/cash": // 레거시 href (W-05 이전 네비 배열 호환)
    case "/wallet/charge": // W-05: 정식 '캐시결제' href
      // 글로벌 "캐시결제"는 실제 충전·결제 화면에서만 활성.
      // /wallet/ledger·/cash-history(마이페이지 "캐시 내역" 서브탭)는 마이페이지 컨텍스트라 제외.
      return (
        p === "/cash" ||
        p === "/wallet" ||
        p === "/wallet/charge" ||
        p.startsWith("/wallet/charge/") ||
        p === "/payments" ||
        p === "/pricing"
      );
    case "/mypage":
      // 마이페이지 대시보드 셸 서브탭(캐시 내역·원장)도 마이페이지 컨텍스트로 활성.
      return (
        p === "/mypage" ||
        p.startsWith("/mypage/") ||
        p === "/wallet/ledger" ||
        p === "/cash-history"
      );
    case "/mentor/payouts":
      return p === "/mentor/payouts" || p.startsWith("/mentor/payouts/");
    case "/mentor/reviews":
      return p === "/mentor/reviews" || p.startsWith("/mentor/reviews/");
    case "/mentor/profile":
      return p === "/mentor/profile" || p.startsWith("/mentor/profile/");
    case "/admin":
      return p === "/admin" || p.startsWith("/admin/");
    default:
      return p === itemHref || p.startsWith(`${itemHref}/`);
  }
}
