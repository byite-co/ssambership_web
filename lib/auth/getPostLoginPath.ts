import type { AppRole } from "@/lib/types/user";

/**
 * `?next=` / open redirect 방지: 같은 오리진 상대 경로만 허용
 */
export function safeInternalNextPath(v: string | null | undefined): string | null {
  if (v == null) return null;
  let t: string;
  try {
    t = decodeURIComponent(String(v)).trim();
  } catch {
    return null;
  }
  if (!t.startsWith("/") || t.startsWith("//")) return null;
  if (t.includes("://") || t.includes("..") || /[\0\r\n]/.test(t)) return null;
  return t;
}

/** 프로필 완성 화면(DB-5 206 · 소셜 가입 직후 `role NULL · profile_completed_at NULL`). */
export const COMPLETE_PROFILE_PATH = "/complete-profile";

/** 완성 화면의 역할 기본값 힌트(`?role_hint=`) — 소셜 버튼을 누른 로그인 화면의 역할. */
export type ProfileRoleHint = Extract<AppRole, "student" | "mentor">;

export function parseProfileRoleHint(v: unknown): ProfileRoleHint | null {
  const t = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (t === "student" || t === "mentor") return t;
  return null;
}

function isAuthOrCompletionPath(p: string): boolean {
  const pathOnly = p.split("?")[0] ?? p;
  if (pathOnly === "/login" || pathOnly.startsWith("/login/")) return true;
  if (pathOnly === "/signup" || pathOnly.startsWith("/signup/")) return true;
  if (pathOnly === "/admin/login") return true;
  if (pathOnly === "/auth/callback") return true;
  if (pathOnly === COMPLETE_PROFILE_PATH || pathOnly.startsWith(`${COMPLETE_PROFILE_PATH}/`)) return true;
  return false;
}

/**
 * `/complete-profile?role_hint=<student|mentor>&next=<safe>` — role_hint 는 유효값만, next 는
 * `safeInternalNextPath` 통과 + 인증·완성 화면 자기참조가 아닌 경로만 싣는다.
 */
export function completeProfilePath(opts?: { roleHint?: unknown; next?: string | null | undefined }): string {
  const params = new URLSearchParams();
  const hint = parseProfileRoleHint(opts?.roleHint);
  if (hint) params.set("role_hint", hint);
  const next = safeInternalNextPath(opts?.next);
  if (next && !isAuthOrCompletionPath(next)) params.set("next", next);
  const q = params.toString();
  return q ? `${COMPLETE_PROFILE_PATH}?${q}` : COMPLETE_PROFILE_PATH;
}

/**
 * `next`가 없거나 거부될 때 쓰는 **일반 로그인·권한 복귀** 기본 경로.
 * 멘토는 `/mentor/mypage` (마이페이지 = 통합 홈)를 쓴다.
 *
 * `role === null`(DB-5: 프로필 완성 전)은 완성 화면으로 보낸다 — 구 `/` 분기를 교체했다.
 *
 * **회원가입 직후** 기본 멘토 목적지는 `getSignUpSuccessPath`에서 `/mentor/profile/edit`로
 * 별도 처리한다(프로필·인증 보강 우선). 가입 플로우는 그 함수만 사용할 것.
 */
export function getPostLoginPath(role: AppRole | null | undefined): string {
  if (role === "student") return "/mypage";
  if (role === "mentor") return "/mentor/mypage";
  if (role === "admin") return "/admin";
  return COMPLETE_PROFILE_PATH;
}

/**
 * 로그인/가입·requireRole `next` 복귀: `next`는 안전한 상대 경로일 때만, 역할과 맞지 않으면 기본 홈으로.
 * 완성 전(role NULL)은 `next` 를 완성 화면에 실어 완성 후 복귀시킨다.
 */
export function resolvePostLoginPath(nextRaw: string | null | undefined, role: AppRole | null | undefined): string {
  if (role == null) {
    return completeProfilePath({ next: nextRaw });
  }
  const s = safeInternalNextPath(nextRaw);
  if (!s) {
    return getPostLoginPath(role);
  }
  if (s === "/login" || s.startsWith("/login/") || s.startsWith("/login?")) {
    return getPostLoginPath(role);
  }
  if (s === "/signup" || s.startsWith("/signup/") || s.startsWith("/signup?")) {
    return getPostLoginPath(role);
  }
  if (s === COMPLETE_PROFILE_PATH || s.startsWith(`${COMPLETE_PROFILE_PATH}?`) || s.startsWith(`${COMPLETE_PROFILE_PATH}/`)) {
    return getPostLoginPath(role);
  }
  if (role === "student") {
    const isMentorApp = s === "/mentor" || s.startsWith("/mentor/") || s.startsWith("/mentor?");
    if (isMentorApp || s.startsWith("/admin")) {
      return getPostLoginPath(role);
    }
    return s;
  }
  if (role === "mentor") {
    if (s.startsWith("/admin")) {
      return getPostLoginPath(role);
    }
    if (
      s === "/home" ||
      s.startsWith("/home?") ||
      s.startsWith("/home/") ||
      s.startsWith("/mypage") ||
      s.startsWith("/subscribe") ||
      s.startsWith("/question-room") ||
      s.startsWith("/wallet") ||
      s === "/cash" ||
      s.startsWith("/cash?") ||
      s.startsWith("/cash/") ||
      s.startsWith("/cash-history")
    ) {
      return getPostLoginPath(role);
    }
    if (s.startsWith("/support/") && !s.startsWith("/mentor/")) {
      return getPostLoginPath(role);
    }
    return s;
  }
  if (role === "admin") {
    if (s === "/admin/login" || s.startsWith("/admin/login?")) {
      return "/admin";
    }
    if (s.startsWith("/admin") || s === "/notifications" || s.startsWith("/notifications/")) {
      return s;
    }
    return getPostLoginPath(role);
  }
  return getPostLoginPath(role);
}

/**
 * 회원가입 **성공 + session 있음** 직후 이동.
 * - `next`가 안전한 내부 경로이면 `resolvePostLoginPath(next, role)` (로그인과 동일한 분기 규칙)
 * - 없을 때: 학생 `/mypage`, 멘토 `/mentor/profile` (로그인 기본 `getPostLoginPath(mentor)`의 `/mentor/mypage`와 구분)
 */
export function getSignUpSuccessPath(role: Extract<AppRole, "student" | "mentor">, nextRaw: string | null | undefined): string {
  const s = safeInternalNextPath(nextRaw);
  if (s) {
    return resolvePostLoginPath(nextRaw, role);
  }
  if (role === "mentor") {
    return "/mentor/profile/edit";
  }
  return "/mypage";
}
