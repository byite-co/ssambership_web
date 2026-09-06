import {
  completeProfilePath,
  parseProfileRoleHint,
  resolvePostLoginPath,
  safeInternalNextPath,
  type ProfileRoleHint,
} from "./getPostLoginPath.ts";
import { completedProfileOrNull, type ProfileCompletionRow } from "./profileCompletion.ts";

/**
 * 소셜 로그인(OAuth · PKCE) 순수 코어 — redirectTo 조립 · 콜백 분기. supabase·next 미의존.
 *
 * 흐름: 버튼 → `signInWithOAuth({ provider, options: { redirectTo: <origin>/auth/callback?next=<safe>&role_hint=<student|mentor> } })`
 *   → 제공자 → `/auth/callback?code=…` → `exchangeCodeForSession(code)`
 *   → 실패: `/login/<role_hint|student>?error=oauth`
 *   → 성공: users 본인 행 `role · profile_completed_at` → 미완성이면 `/complete-profile?role_hint=…&next=…`, 완성이면 post-login(`next` 존중)
 *
 * 콜백은 아무것도 저장하지 않는다 — 206 트리거가 auth.users.email·provider 이름을 users 행에 넣는다.
 * 이메일이 없는 계정(카카오 미동의)도 그대로 진행한다(이메일은 선택 · 오너 결정 2026-09-06).
 */

export const OAUTH_CALLBACK_PATH = "/auth/callback";
export const OAUTH_ERROR_QUERY = "oauth";

export const SOCIAL_LOGIN_PROVIDERS = ["kakao", "google", "apple"] as const;
export type SocialLoginProvider = (typeof SOCIAL_LOGIN_PROVIDERS)[number];

export function isSocialLoginProvider(v: unknown): v is SocialLoginProvider {
  return v === "kakao" || v === "google" || v === "apple";
}

/**
 * `signInWithOAuth` 의 redirectTo. origin 은 호출부(브라우저 `window.location.origin`)가 준다.
 * next 는 안전한 내부 경로만, role_hint 는 유효값만 싣는다.
 */
export function buildOAuthRedirectTo(origin: string, opts?: { next?: string | null; roleHint?: unknown }): string {
  const base = origin.replace(/\/+$/, "");
  const params = new URLSearchParams();
  const next = safeInternalNextPath(opts?.next);
  if (next) params.set("next", next);
  const hint = parseProfileRoleHint(opts?.roleHint);
  if (hint) params.set("role_hint", hint);
  const q = params.toString();
  return q ? `${base}${OAUTH_CALLBACK_PATH}?${q}` : `${base}${OAUTH_CALLBACK_PATH}`;
}

/** 콜백 실패 복귀 — 역할 힌트가 있으면 그 역할의 로그인 화면으로. 실패 사유 원문은 URL 에 싣지 않는다. */
export function oauthFailureLoginPath(roleHint: unknown, next?: string | null): string {
  const hint: ProfileRoleHint = parseProfileRoleHint(roleHint) ?? "student";
  const params = new URLSearchParams({ error: OAUTH_ERROR_QUERY });
  const safeNext = safeInternalNextPath(next);
  if (safeNext) params.set("next", safeNext);
  return `/login/${hint}?${params.toString()}`;
}

export type OAuthCallbackInput = {
  /** `?code` 존재 여부(없으면 제공자 취소·오류 복귀) */
  hasCode: boolean;
  /** exchangeCodeForSession 성공 여부 */
  exchangeOk: boolean;
  /** 교환 후 본인 users 행(조회 실패·행 부재 = null) */
  profile: ProfileCompletionRow | null;
  /** 프로필 조회 자체가 실패했는가(행 부재와 구분 — 실패는 로그인 실패로 되돌린다) */
  profileLookupFailed?: boolean;
  next?: string | null;
  roleHint?: unknown;
};

/**
 * 콜백 이동 경로 결정.
 * - 코드 없음·교환 실패·프로필 조회 실패 → `/login/<hint>?error=oauth`
 * - 행 없음(트리거 지연 등)·미완성 → 완성 화면(role_hint·next 유지)
 * - 완성 → `resolvePostLoginPath(next, role)`
 */
export function resolveOAuthCallbackDestination(input: OAuthCallbackInput): string {
  if (!input.hasCode || !input.exchangeOk || input.profileLookupFailed) {
    return oauthFailureLoginPath(input.roleHint, input.next);
  }
  const completed = completedProfileOrNull(input.profile);
  if (!completed) {
    return completeProfilePath({ roleHint: input.roleHint, next: input.next });
  }
  return resolvePostLoginPath(input.next, completed.role);
}
