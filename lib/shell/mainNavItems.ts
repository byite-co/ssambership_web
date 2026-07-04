import type { AppRole } from "@/lib/types/user";
import { isCustomRequestFeatureEnabled } from "@/lib/shell/featureFlags";

export type MainNavItem = { href: string; label: string };

/**
 * 멘토가 접근하면 대시보드로 보낼 캐시·지갑 경로 (충전은 네비 허용).
 * W-05: /cash 는 /wallet/charge 로 리다이렉트되는 레거시 URL — 멘토는 리다이렉트 후
 * 충전 화면 도달이 허용(requireWalletChargeAccess)이므로 차단 목록에서 유지할 필요가
 * 없어졌으나, /wallet/ledger(원장)는 계속 차단한다. /cash 매칭은 레거시 보호용 유지.
 */
export const MENTOR_BLOCKED_CASH_PATHS = ["/cash", "/wallet/ledger"] as const;

export function isCashNavHref(href: string): boolean {
  return (
    href === "/cash" || // 레거시 URL 매칭 유지 (W-05 리다이렉트 경유 보호)
    href.startsWith("/wallet") ||
    MENTOR_BLOCKED_CASH_PATHS.some((p) => href === p || href.startsWith(`${p}/`))
  );
}

function isCashNavItem(item: MainNavItem): boolean {
  if (item.href === "/wallet/charge") return false;
  if (isCashNavHref(item.href)) return true;
  const label = item.label.trim();
  return label === "캐시결제" || label === "캐시 충전" || label === "지갑";
}

function isPayoutNavItem(item: MainNavItem): boolean {
  return (
    item.href.startsWith("/mentor/payouts") ||
    item.label === "정산" ||
    item.label === "정산/수익" ||
    item.label === "캐시정산"
  );
}

/**
 * [맞춤의뢰 출시 준비 중] 네비에서 임시로 숨긴다. 라우트·기존 주문 데이터는 보존하며,
 * 정식 오픈 시 이 필터(아래 getMainNavForRole/getLandingNavForProfile 적용분)만 제거하면 된다.
 * admin 은 운영(검수·지원)을 위해 그대로 노출한다.
 */
function isCustomRequestNavItem(item: MainNavItem): boolean {
  return item.href.startsWith("/custom-request") || item.href.startsWith("/mentor/custom-request") || item.label === "맞춤의뢰";
}

export const publicMainNav: MainNavItem[] = [
  { href: "/mentors", label: "멘토 찾기" },
  { href: "/question-room", label: "질문방" },
  { href: "/individual-questions", label: "개별 질문" },
  { href: "/community", label: "커뮤니티" },
  { href: "/custom-request", label: "맞춤의뢰" },
  { href: "/wallet/charge", label: "캐시결제" },
];

export const studentMainNav: MainNavItem[] = [
  { href: "/mentors", label: "멘토 찾기" },
  { href: "/question-room", label: "질문방" },
  { href: "/individual-questions", label: "개별 질문" },
  { href: "/community", label: "커뮤니티" },
  { href: "/custom-request", label: "맞춤의뢰" },
  { href: "/wallet/charge", label: "캐시결제" },
  { href: "/mypage", label: "마이페이지" },
];

/** 멘토 상단 헤더 네비 (잠금값 — 대시보드 제외) */
export const mentorHeaderNav: MainNavItem[] = [
  { href: "/mentor/question-room", label: "질문방" },
  { href: "/mentor/individual-questions", label: "개별 질문" },
  { href: "/mentor/custom-request/dashboard", label: "맞춤의뢰" },
  { href: "/community", label: "커뮤니티" },
  { href: "/mentor/payouts", label: "정산" },
  { href: "/mentor/profile/edit", label: "내 프로필" },
  { href: "/mentor/mypage", label: "마이페이지" },
];

/** 멘토 사이드바·내부 메뉴 — 마이페이지(통합 홈) 포함 */
export const mentorMainNav: MainNavItem[] = [
  { href: "/mentor/mypage", label: "마이페이지" },
  ...mentorHeaderNav.filter((item) => item.href !== "/mentor/mypage"),
];

export const adminMainNav: MainNavItem[] = [
  { href: "/mentors", label: "멘토 찾기" },
  { href: "/question-room", label: "질문방" },
  { href: "/community", label: "커뮤니티" },
  { href: "/custom-request", label: "맞춤의뢰" },
  { href: "/wallet/charge", label: "캐시결제" },
  { href: "/admin", label: "관리" },
];

/** 랜딩(비로그인·학생) 상단 — 마이페이지 제외 */
export const landingGuestNav: MainNavItem[] = [
  { href: "/mentors", label: "멘토 찾기" },
  { href: "/question-room", label: "질문방" },
  { href: "/individual-questions", label: "개별 질문" },
  { href: "/community", label: "커뮤니티" },
  { href: "/custom-request", label: "맞춤의뢰" },
  { href: "/wallet/charge", label: "캐시결제" },
  { href: "/mypage", label: "마이페이지" },
];

export function getMainNavForRole(sessionRole: AppRole | null | undefined): MainNavItem[] {
  let items: MainNavItem[];
  if (sessionRole == null) {
    items = publicMainNav;
  } else if (sessionRole === "mentor") {
    items = mentorHeaderNav;
  } else if (sessionRole === "admin") {
    items = adminMainNav;
  } else {
    items = studentMainNav;
  }

  if (sessionRole === "mentor") {
    items = items.filter((item) => !isCashNavItem(item));
  }
  if (sessionRole === "student") {
    items = items.filter((item) => !isPayoutNavItem(item));
  }
  // 맞춤의뢰 출시 준비 중 — admin 외 전 역할 네비에서 임시 숨김.
  // NEXT_PUBLIC_FEATURE_CUSTOM_REQUEST=on 으로 켜면 노출(로컬/스테이징).
  if (sessionRole !== "admin" && !isCustomRequestFeatureEnabled()) {
    items = items.filter((item) => !isCustomRequestNavItem(item));
  }
  return items;
}

export function getLandingNavForProfile(role: AppRole | null | undefined): MainNavItem[] {
  if (role === "mentor") {
    return getMainNavForRole("mentor");
  }
  if (isCustomRequestFeatureEnabled()) {
    return landingGuestNav;
  }
  // 학생·비로그인 랜딩 네비에서도 맞춤의뢰 임시 숨김.
  return landingGuestNav.filter((item) => !isCustomRequestNavItem(item));
}

export function mentorBlockedCashPath(pathname: string): boolean {
  return MENTOR_BLOCKED_CASH_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
