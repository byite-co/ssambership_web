// 계약 테스트: 프로필 완성 가드(DB-5 206) — 웹 PR-2 §2.
// 실행: node --test --experimental-strip-types lib/auth/__contract__/profileCompletion.contract.test.ts
//
// 고정하는 것: 미완성 판정(profile_completed_at NULL / role NULL) · 역할 페이지 가드 → /complete-profile?next=
// · 완성 화면 자체 분기(비로그인 → 로그인 · 완성 → post-login · 미완성 → 렌더) · getPostLoginPath(null) 은 더 이상 "/" 가 아니다
// · (public) 레이아웃 예외 경로 · 배선(requireRole · 로그인 페이지 · 레이아웃 · users select 컬럼).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  completeProfilePageDecision,
  completedProfileOrNull,
  isProfileCompletionExemptPublicPath,
  isProfileIncomplete,
  profileCompletionGuard,
} from "../profileCompletion.ts";
import {
  COMPLETE_PROFILE_PATH,
  completeProfilePath,
  getPostLoginPath,
  parseProfileRoleHint,
  resolvePostLoginPath,
} from "../getPostLoginPath.ts";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const DONE = "2026-09-06T01:00:00Z";

test("미완성 판정: profile_completed_at NULL 또는 role NULL → 미완성 · 컬럼 미조회(undefined)는 role 만 본다", () => {
  assert.equal(isProfileIncomplete({ role: null, profile_completed_at: null }), true);
  assert.equal(isProfileIncomplete({ role: "student", profile_completed_at: null }), true);
  assert.equal(isProfileIncomplete({ role: null }), true);
  assert.equal(isProfileIncomplete({ role: "student", profile_completed_at: DONE }), false);
  assert.equal(isProfileIncomplete({ role: "mentor" }), false, "컬럼을 select 하지 않은 호출부는 role 로 판정");
  assert.equal(isProfileIncomplete(null), false, "비로그인·프로필 부재는 기존 가드 소관");
  assert.equal(completedProfileOrNull({ role: "admin", profile_completed_at: DONE })?.role, "admin");
  assert.equal(completedProfileOrNull({ role: null, profile_completed_at: null }), null);
});

test("역할 페이지 가드: 미완성 → /complete-profile?next=<복귀> · 완성 → role", () => {
  assert.deepEqual(profileCompletionGuard({ role: null, profile_completed_at: null }, { next: "/mypage" }), {
    kind: "incomplete",
    redirectTo: "/complete-profile?next=%2Fmypage",
  });
  assert.deepEqual(profileCompletionGuard({ role: "mentor", profile_completed_at: DONE }, { next: "/mentor/mypage" }), {
    kind: "complete",
    role: "mentor",
  });
  // 인증·완성 화면 자기참조 next 는 싣지 않는다(루프 방지)
  assert.equal(completeProfilePath({ next: "/login/student" }), COMPLETE_PROFILE_PATH);
  assert.equal(completeProfilePath({ next: "/complete-profile?next=%2Fx" }), COMPLETE_PROFILE_PATH);
  assert.equal(completeProfilePath({ next: "https://evil.example" }), COMPLETE_PROFILE_PATH);
  assert.equal(completeProfilePath({ roleHint: "mentor", next: "/mentors" }), "/complete-profile?role_hint=mentor&next=%2Fmentors");
  assert.equal(parseProfileRoleHint("ADMIN"), null);
  assert.equal(parseProfileRoleHint(" Student "), "student");
});

test("getPostLoginPath(null) 은 완성 화면이다 — 구 '/' 분기 교체 · resolvePostLoginPath 도 next 를 실어 보낸다", () => {
  assert.equal(getPostLoginPath(null), COMPLETE_PROFILE_PATH);
  assert.equal(getPostLoginPath(undefined), COMPLETE_PROFILE_PATH);
  assert.equal(resolvePostLoginPath("/mentors", null), "/complete-profile?next=%2Fmentors");
  assert.equal(resolvePostLoginPath("/complete-profile", "student"), "/mypage", "완성된 사용자의 next=완성 화면은 홈으로");
  // 기존 역할 분기는 그대로
  assert.equal(getPostLoginPath("student"), "/mypage");
  assert.equal(getPostLoginPath("mentor"), "/mentor/mypage");
  assert.equal(getPostLoginPath("admin"), "/admin");
});

test("완성 화면 분기: 비로그인 → /login?next=/complete-profile · 완성 → post-login(next 존중) · 미완성 → 렌더(role_hint)", () => {
  assert.deepEqual(completeProfilePageDecision({ loggedIn: false, profile: null }), {
    kind: "login",
    redirectTo: "/login?next=%2Fcomplete-profile",
  });
  assert.deepEqual(
    completeProfilePageDecision({ loggedIn: true, profile: { role: "student", profile_completed_at: DONE }, next: "/mentors" }),
    { kind: "already_complete", redirectTo: "/mentors" },
  );
  assert.deepEqual(
    completeProfilePageDecision({ loggedIn: true, profile: { role: "mentor", profile_completed_at: DONE }, next: "/mypage" }),
    { kind: "already_complete", redirectTo: "/mentor/mypage" },
  );
  assert.deepEqual(
    completeProfilePageDecision({ loggedIn: true, profile: { role: null, profile_completed_at: null }, roleHint: "mentor" }),
    { kind: "render", roleHint: "mentor" },
  );
  assert.deepEqual(completeProfilePageDecision({ loggedIn: true, profile: null, roleHint: "x" }), { kind: "render", roleHint: null });
});

test("(public) 레이아웃 예외: 법적 고지·안내 페이지만 — 그 외 공개 경로는 완성 화면으로", () => {
  for (const p of ["/legal/terms", "/legal/privacy", "/about", "/notices", "/notices/1"]) {
    assert.equal(isProfileCompletionExemptPublicPath(p), true, p);
  }
  for (const p of ["/community", "/mentors", "/custom-request", "/legalx"]) {
    assert.equal(isProfileCompletionExemptPublicPath(p), false, p);
  }
});

test("배선: users select 에 profile_completed_at · requireRole/QnA/지갑 가드 · 로그인 페이지 · (public) 레이아웃 · 온보딩 2화면", () => {
  assert.ok(read("lib/auth/getCurrentProfile.ts").includes("profile_completed_at"), "USER_SELECT 에 완성 컬럼 없음");
  const guard = read("lib/auth/routeGuard.ts");
  assert.ok(guard.includes("profileCompletionGuard("), "requireRole 완성 게이트 미배선");
  assert.equal(guard.split("requireCompletedProfile(").length - 1, 4, "requireRole·requireWalletChargeAccess·requireQnaActor 3곳 + 정의");
  for (const rel of ["app/login/page.tsx", "app/login/student/page.tsx", "app/login/mentor/page.tsx"]) {
    assert.ok(read(rel).includes("resolvePostLoginPath(initialNext, profile.role)"), `${rel}: 로그인 페이지 D-AU-12 분기(완성 전은 resolvePostLoginPath 가 완성 화면으로 보낸다)`);
  }
  const pub = read("app/(public)/layout.tsx");
  assert.ok(pub.includes("isProfileIncomplete(profile)") && pub.includes("isProfileCompletionExemptPublicPath(pathname)"), "(public) 레이아웃 완성 게이트");
  for (const rel of ["app/onboarding/verify/page.tsx", "app/onboarding/guardian/page.tsx"]) {
    assert.ok(read(rel).includes("isProfileIncomplete(profile)"), `${rel}: 완성 전 온보딩 차단`);
  }
  const page = read("app/complete-profile/page.tsx");
  assert.ok(page.includes("completeProfilePageDecision("), "완성 화면이 분기 코어를 쓰지 않음");
  const form = read("components/auth/CompleteProfileForm.tsx");
  assert.ok(form.includes('.schema(COMPLETE_PROFILE_RPC_SCHEMA)') && form.includes(".rpc(COMPLETE_PROFILE_RPC,"), "complete_profile RPC 호출 없음");
  assert.ok(!form.includes("user_consent_records"), "동의 원장은 RPC 가 남긴다 — 웹이 직접 쓰지 않는다");
  assert.ok(!/type=["']file["']/.test(form), "완성 화면에 파일 업로드(학생증)를 넣지 않는다");
});
