import type { AppRole, UserRow } from "@/lib/types/user";
import { COMPLETE_PROFILE_PATH, completeProfilePath, resolvePostLoginPath } from "./getPostLoginPath.ts";

/**
 * 프로필 완성 판정(DB-5 206) — 순수 모듈(next·supabase 미의존 · 계약 테스트 공용).
 *
 * 소셜 가입 직후 `users` 행은 `role NULL · profile_completed_at NULL` 이고, 완성 전엔 DB 가
 * 쓰기 정책 18종 + RPC impl 로 전부 거부한다. 웹은 그 전에 가드(requireRole · 로그인 페이지 ·
 * (public) 레이아웃)로 완성 화면에 보내 RLS 오류 화면이 뜨지 않게 한다.
 *
 * 판정 컬럼은 `profile_completed_at` 이 정본이고, `role NULL` 은 CHECK
 * (`users_role_required_when_completed`) 로 완성 전에만 가능하므로 함께 본다(둘 중 하나라도 NULL → 미완성).
 * `profile_completed_at` 을 아직 select 하지 않은 호출부(컬럼 undefined)는 role 만으로 판정한다.
 */
export type ProfileCompletionRow = Pick<UserRow, "role"> & { profile_completed_at?: string | null };

/** 완성된 프로필 — 역할이 반드시 있다. */
export type CompletedProfile<T extends ProfileCompletionRow = UserRow> = T & { role: AppRole };

export function isProfileIncomplete(profile: ProfileCompletionRow | null | undefined): boolean {
  if (!profile) return false; // 비로그인/프로필 부재는 기존 가드(requireRole·login) 소관
  if (profile.role == null) return true;
  if ("profile_completed_at" in profile && profile.profile_completed_at === null) return true;
  return false;
}

/** 완성된 프로필이면 역할이 좁혀진 값을, 아니면 null 을 돌려준다(가드에서 redirect 분기용). */
export function completedProfileOrNull<T extends ProfileCompletionRow>(profile: T | null | undefined): CompletedProfile<T> | null {
  if (!profile || isProfileIncomplete(profile) || profile.role == null) return null;
  return profile as CompletedProfile<T>;
}

export type ProfileCompletionGuardDecision =
  | { kind: "complete"; role: AppRole }
  | { kind: "incomplete"; redirectTo: string };

/**
 * 역할 페이지 가드(`requireRole` 등)의 완성 분기 — 미완성이면 `/complete-profile?next=<복귀 경로>`.
 * (비로그인·프로필 부재는 호출부가 먼저 처리한다.)
 */
export function profileCompletionGuard(
  profile: ProfileCompletionRow,
  opts?: { next?: string | null; roleHint?: unknown },
): ProfileCompletionGuardDecision {
  if (isProfileIncomplete(profile) || profile.role == null) {
    return { kind: "incomplete", redirectTo: completeProfilePath({ next: opts?.next, roleHint: opts?.roleHint }) };
  }
  return { kind: "complete", role: profile.role };
}

export type CompleteProfilePageDecision =
  | { kind: "login"; redirectTo: string }
  | { kind: "already_complete"; redirectTo: string }
  | { kind: "render"; roleHint: "student" | "mentor" | null };

/**
 * `/complete-profile` 페이지 자체의 분기 — 비로그인 → 로그인(next=완성 화면) · 완성된 사용자 →
 * post-login 경로(`next` 존중) · 미완성 → 렌더.
 */
export function completeProfilePageDecision(input: {
  loggedIn: boolean;
  profile: ProfileCompletionRow | null;
  next?: string | null;
  roleHint?: unknown;
}): CompleteProfilePageDecision {
  if (!input.loggedIn) {
    return { kind: "login", redirectTo: `/login?next=${encodeURIComponent(COMPLETE_PROFILE_PATH)}` };
  }
  const completed = completedProfileOrNull(input.profile);
  if (completed) {
    return { kind: "already_complete", redirectTo: resolvePostLoginPath(input.next, completed.role) };
  }
  const hint = typeof input.roleHint === "string" && (input.roleHint === "student" || input.roleHint === "mentor") ? input.roleHint : null;
  return { kind: "render", roleHint: hint };
}

/**
 * (public) 레이아웃의 완성 게이트 예외 — 완성 화면에서 링크되는 법적 고지·안내 페이지는
 * 미완성 사용자도 읽을 수 있어야 한다(약관·개인정보 링크가 완성 화면으로 되돌아오면 동의를 못 읽는다).
 */
export function isProfileCompletionExemptPublicPath(pathname: string): boolean {
  const p = pathname.split("?")[0] ?? pathname;
  return p === "/legal" || p.startsWith("/legal/") || p === "/about" || p.startsWith("/about/") || p === "/notices" || p.startsWith("/notices/");
}
