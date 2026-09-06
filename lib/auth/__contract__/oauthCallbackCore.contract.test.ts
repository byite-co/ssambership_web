// 계약 테스트: 소셜 로그인(OAuth · PKCE) 콜백 코어 — 웹 PR-2 §1.
// 실행: node --test --experimental-strip-types lib/auth/__contract__/oauthCallbackCore.contract.test.ts
//
// 고정하는 것: redirectTo 조립(next sanitize · role_hint 유효값만) · 코드 교환 실패 복귀 ·
// 미완성(profile_completed_at NULL / role NULL / 행 없음) → /complete-profile · 완성 → post-login.
// 콜백 라우트 소스는 세션 교환 외 어떤 저장도 하지 않는다(206 트리거가 users 행을 만든다).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  OAUTH_CALLBACK_PATH,
  SOCIAL_LOGIN_PROVIDERS,
  buildOAuthRedirectTo,
  isSocialLoginProvider,
  oauthFailureLoginPath,
  resolveOAuthCallbackDestination,
} from "../oauthCallbackCore.ts";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

test("제공자 3종 고정(카카오·구글·애플) — Supabase provider id 그대로", () => {
  assert.deepEqual([...SOCIAL_LOGIN_PROVIDERS], ["kakao", "google", "apple"]);
  assert.equal(isSocialLoginProvider("kakao"), true);
  assert.equal(isSocialLoginProvider("naver"), false);
  assert.equal(OAUTH_CALLBACK_PATH, "/auth/callback");
});

test("redirectTo: origin + /auth/callback · next 는 안전한 내부 경로만 · role_hint 는 유효값만", () => {
  assert.equal(buildOAuthRedirectTo("https://ssambership.com"), "https://ssambership.com/auth/callback");
  assert.equal(
    buildOAuthRedirectTo("https://ssambership.com/", { next: "/mentors?tier=standard", roleHint: "mentor" }),
    "https://ssambership.com/auth/callback?next=%2Fmentors%3Ftier%3Dstandard&role_hint=mentor",
  );
  // open redirect · 잘못된 힌트는 버린다
  assert.equal(buildOAuthRedirectTo("http://localhost:3000", { next: "https://evil.example", roleHint: "admin" }), "http://localhost:3000/auth/callback");
  assert.equal(buildOAuthRedirectTo("http://localhost:3000", { next: "//evil.example/x" }), "http://localhost:3000/auth/callback");
});

test("코드 교환 실패·코드 없음·프로필 조회 실패 → /login/<role_hint|student>?error=oauth (사유 원문 없음)", () => {
  assert.equal(
    resolveOAuthCallbackDestination({ hasCode: false, exchangeOk: false, profile: null }),
    "/login/student?error=oauth",
  );
  assert.equal(
    resolveOAuthCallbackDestination({ hasCode: true, exchangeOk: false, profile: null, roleHint: "mentor", next: "/mentor/mypage" }),
    "/login/mentor?error=oauth&next=%2Fmentor%2Fmypage",
  );
  assert.equal(
    resolveOAuthCallbackDestination({ hasCode: true, exchangeOk: true, profile: null, profileLookupFailed: true }),
    "/login/student?error=oauth",
  );
  assert.equal(oauthFailureLoginPath("weird", "javascript:alert(1)"), "/login/student?error=oauth");
});

test("미완성 분기: profile_completed_at NULL · role NULL · 행 없음(트리거 지연) → /complete-profile(role_hint·next 유지)", () => {
  assert.equal(
    resolveOAuthCallbackDestination({
      hasCode: true,
      exchangeOk: true,
      profile: { role: null, profile_completed_at: null },
      roleHint: "student",
      next: "/mentors",
    }),
    "/complete-profile?role_hint=student&next=%2Fmentors",
  );
  // role 이 있어도 완성 시각이 NULL 이면 미완성(정본 컬럼은 profile_completed_at)
  assert.equal(
    resolveOAuthCallbackDestination({ hasCode: true, exchangeOk: true, profile: { role: "student", profile_completed_at: null } }),
    "/complete-profile",
  );
  assert.equal(
    resolveOAuthCallbackDestination({ hasCode: true, exchangeOk: true, profile: null }),
    "/complete-profile",
  );
});

test("완성 분기: resolvePostLoginPath(next, role) — 역할 밖 next 는 기본 홈", () => {
  assert.equal(
    resolveOAuthCallbackDestination({
      hasCode: true,
      exchangeOk: true,
      profile: { role: "student", profile_completed_at: "2026-09-06T00:00:00Z" },
      next: "/mentors",
    }),
    "/mentors",
  );
  assert.equal(
    resolveOAuthCallbackDestination({
      hasCode: true,
      exchangeOk: true,
      profile: { role: "student", profile_completed_at: "2026-09-06T00:00:00Z" },
      next: "/mentor/mypage",
    }),
    "/mypage",
  );
  assert.equal(
    resolveOAuthCallbackDestination({
      hasCode: true,
      exchangeOk: true,
      profile: { role: "mentor", profile_completed_at: "2026-09-06T00:00:00Z" },
    }),
    "/mentor/mypage",
  );
  // 이메일 유무는 분기에 영향이 없다(이메일 선택 · 오너 결정 2026-09-06)
  assert.equal(
    resolveOAuthCallbackDestination({
      hasCode: true,
      exchangeOk: true,
      profile: { role: "student", profile_completed_at: "2026-09-06T00:00:00Z" },
    }),
    "/mypage",
  );
});

test("콜백 라우트 배선: PKCE 교환 + 분기 코어 사용 · users 저장 0 · no-store", () => {
  const route = read("app/auth/callback/route.ts");
  assert.ok(route.includes("exchangeCodeForSession(code)"), "PKCE 코드 교환이 없음");
  assert.ok(route.includes("resolveOAuthCallbackDestination"), "분기 코어 미사용");
  assert.ok(route.includes('"Cache-Control", "no-store"'), "no-store 누락");
  assert.ok(!/\.from\(["']users["']\)[\s\S]{0,200}?\.(update|upsert|insert)\(/.test(route), "콜백이 users 를 직접 쓴다(206 트리거가 정본)");
  assert.ok(!/user\.email|\.email\b\s*[!=]==?/.test(route), "콜백은 이메일 유무로 아무것도 결정하지 않는다");
});

test("소셜 버튼 배선: 로그인 폼(학생·멘토 공용)과 가입 화면 상단 · signInWithOAuth · 로고를 코드로 그리지 않는다", () => {
  const buttons = read("components/auth/SocialLoginButtons.tsx");
  assert.ok(buttons.includes("signInWithOAuth"), "signInWithOAuth 호출이 없음");
  assert.ok(buttons.includes("buildOAuthRedirectTo(window.location.origin"), "redirectTo 는 코어 빌더 + 브라우저 origin");
  assert.ok(!buttons.includes("<svg"), "제공자 로고를 코드로 그리면 안 된다(공식 배포 에셋만)");
  const login = read("components/auth/RoleLoginForm.tsx");
  assert.ok(login.includes("<SocialLoginButtons roleHint={role}"), "로그인 폼에 소셜 버튼 미배선");
  assert.ok(login.includes("signInWithPassword({ email, password })"), "이메일 로그인 경로는 그대로");
  const signup = read("app/signup/page.tsx");
  assert.ok(signup.includes("<SocialLoginButtons"), "가입 화면에 소셜 버튼 미배선");
  assert.ok(signup.includes("buildSignupUserMetadata("), "이메일 가입 메타 경로는 그대로");
});
