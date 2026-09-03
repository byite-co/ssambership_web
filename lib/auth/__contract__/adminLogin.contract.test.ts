// 계약 테스트: 관리자 로그인(PR-12 §3) — 2단계 구조(판정만) · returnTo 허용 목록 · 실패 코드 · 서비스 계정 거부 · 콘솔 색 규격.
// 실행: node --test --experimental-strip-types lib/auth/__contract__/adminLogin.contract.test.ts
//
// 고정하는 것(지시서 §5):
//   ① 2단계 컴포넌트는 `getAuthenticatorAssuranceLevel()` 이 `nextLevel === 'aal2'` 일 때만 렌더 · 미등록(aal1)·조회 실패는 건너뜀
//   ② MFA 구현 없음(challenge/verify/enroll 호출 0) — PR-12b · 2단계 컴포넌트는 자리만(비활성 입력 + `PR-12b에서 활성화` 주석)
//   ③ returnTo(`next`) 허용 목록: /admin·/admin/…(로그인 자신 제외)·/notifications 만 · 그 외는 대시보드
//   ④ 실패는 코드로만(원문 반영 없음) · 학생·멘토 계정 거부 문구 · 세션 만료 문구
//   ⑤ 서비스 로그인(학생 파랑 #2563EB · 멘토 초록 #059669)과 시각적으로 구분 — 콘솔 규격(slate + 운영 배지) · alert 없음

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ADMIN_LOGIN_DEFAULT_PATH,
  ADMIN_LOGIN_ERROR_CODES,
  ADMIN_LOGIN_ERROR_MESSAGES,
  ADMIN_LOGIN_GENERIC_ERROR,
  ADMIN_LOGIN_NEXT_PARAM,
  ADMIN_LOGIN_PATH,
  ADMIN_LOGIN_SERVICE_LOGIN_HREF,
  ADMIN_LOGIN_STEP_VALUES,
  adminLoginDestination,
  adminLoginErrorMessage,
  adminLoginRequiresSecondFactor,
  buildAdminLoginUrl,
  resolveAdminLoginReturnPath,
  resolveAdminLoginStep,
} from "../adminLoginConsole.ts";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const PAGE = "app/(admin)/admin/login/page.tsx";
const ACTION = "lib/auth/adminLoginActions.ts";
const CONSOLE = "lib/auth/adminLoginConsole.ts";
const PASSWORD_STEP = "components/admin/AdminLoginPasswordStep.tsx";
const CODE_STEP = "components/admin/AdminLoginCodeStep.tsx";
const ROUTE_GUARD = "lib/auth/routeGuard.ts";
const ADMIN_LAYOUT = "app/(admin)/layout.tsx";

// ── ① 2단계 판정 ─────────────────────────────────────────────────────────────

test("2단계는 nextLevel === 'aal2' 이고 아직 aal2 가 아닐 때만 — 미등록(aal1→aal1)·이미 aal2·조회 실패(null)는 건너뜀", () => {
  assert.equal(adminLoginRequiresSecondFactor({ currentLevel: "aal1", nextLevel: "aal2" }), true);
  assert.equal(adminLoginRequiresSecondFactor({ currentLevel: "aal1", nextLevel: "aal1" }), false, "등록된 인증 수단 없음(현재 관리자 3명 전원)");
  assert.equal(adminLoginRequiresSecondFactor({ currentLevel: "aal2", nextLevel: "aal2" }), false);
  assert.equal(adminLoginRequiresSecondFactor({ currentLevel: null, nextLevel: null }), false);
  assert.equal(adminLoginRequiresSecondFactor(null), false);
  assert.equal(adminLoginRequiresSecondFactor(undefined), false);
  assert.deepEqual([...ADMIN_LOGIN_STEP_VALUES], ["password", "code"]);
  assert.equal(resolveAdminLoginStep("code"), "code");
  assert.equal(resolveAdminLoginStep("anything"), "password");
  assert.equal(resolveAdminLoginStep(undefined), "password");
});

test("페이지: 2단계 컴포넌트는 aal2 조건(adminLoginRequiresSecondFactor)에서만 렌더 · 아니면 목적지로 redirect · 액션도 같은 판정으로 step=code 로 보낸다", () => {
  const page = stripComments(read(PAGE));
  assert.ok(page.includes("supabase.auth.mfa.getAuthenticatorAssuranceLevel()"), "Supabase AAL 조회");
  assert.ok(page.includes("secondFactor = adminLoginRequiresSecondFactor(aal);"));
  assert.ok(page.includes("if (!secondFactor) redirect(adminLoginDestination(returnPath));"), "건너뜀 = 바로 목적지");
  assert.equal((page.match(/<AdminLoginCodeStep \/>/g) ?? []).length, 1);
  assert.ok(page.includes("{secondFactor ? <AdminLoginCodeStep /> : <AdminLoginPasswordStep"), "2단계는 조건부 렌더 한 곳뿐");
  const action = stripComments(read(ACTION));
  assert.ok(action.includes("supabase.auth.mfa.getAuthenticatorAssuranceLevel()"));
  assert.ok(action.includes("if (adminLoginRequiresSecondFactor(aal)) {") && action.includes('redirect(buildAdminLoginUrl({ next, step: "code" }));'));
  assert.ok(action.includes("redirect(adminLoginDestination(next));"));
});

// ── ② MFA 구현 없음 ──────────────────────────────────────────────────────────

test("MFA 구현 없음(PR-12b): challenge·verify·enroll·unenroll 호출 0 · 2단계 컴포넌트는 비활성 입력 + 제출 경로 없음 + `PR-12b에서 활성화` 주석 · 로그아웃은 정본 LogoutButton", () => {
  const all = [PAGE, ACTION, CONSOLE, PASSWORD_STEP, CODE_STEP].map((f) => stripComments(read(f))).join("\n");
  assert.ok(!/mfa\.(challenge|verify|enroll|unenroll|challengeAndVerify|listFactors)\(/.test(all), "MFA 등록·검증 없음");
  const code = read(CODE_STEP);
  assert.ok(code.includes("PR-12b에서 활성화"), "활성화 시점 주석");
  const codeSrc = stripComments(code);
  assert.ok(!codeSrc.startsWith('"use client"'));
  assert.ok(codeSrc.includes("disabled") && !/<form\b/.test(codeSrc) && !/action=/.test(codeSrc), "자리만 — 제출 경로 없음");
  assert.ok(codeSrc.includes("<LogoutButton"), "다른 계정으로 = 정본 로그아웃(POST /logout)");
  assert.ok(!codeSrc.includes('href="/logout"'), "로그아웃을 링크로 두지 않는다(D-13)");
});

// ── ③ returnTo 허용 목록 ────────────────────────────────────────────────────

test("returnTo(next) 허용 목록: /admin · /admin/…(쿼리 유지) · /notifications 만 — 로그인 자신·서비스 경로·외부·프로토콜 상대·상위 경로·배열은 첫 값", () => {
  assert.equal(ADMIN_LOGIN_NEXT_PARAM, "next", "requireRole 이 붙이는 키 그대로");
  assert.equal(resolveAdminLoginReturnPath("/admin/refunds?status=pending"), "/admin/refunds?status=pending");
  assert.equal(resolveAdminLoginReturnPath("/admin"), "/admin");
  assert.equal(resolveAdminLoginReturnPath("/admin/users/abc#frag"), "/admin/users/abc", "해시는 버린다");
  assert.equal(resolveAdminLoginReturnPath("/notifications"), "/notifications");
  assert.equal(resolveAdminLoginReturnPath("/notifications/1"), "/notifications/1");
  assert.equal(resolveAdminLoginReturnPath("/admin/login?next=%2Fadmin"), null, "로그인 자신은 루프");
  assert.equal(resolveAdminLoginReturnPath("/admin/login/"), null);
  assert.equal(resolveAdminLoginReturnPath("/adminx"), null, "접두 일치가 아니라 세그먼트 일치");
  assert.equal(resolveAdminLoginReturnPath("/mypage"), null);
  assert.equal(resolveAdminLoginReturnPath("/mentor/mypage"), null);
  assert.equal(resolveAdminLoginReturnPath("https://evil.example/admin"), null);
  assert.equal(resolveAdminLoginReturnPath("//evil.example/admin"), null);
  assert.equal(resolveAdminLoginReturnPath("%2F%2Fevil.example"), null);
  assert.equal(resolveAdminLoginReturnPath("/admin/../login"), null);
  assert.equal(resolveAdminLoginReturnPath("/admin/x\\y"), null);
  assert.equal(resolveAdminLoginReturnPath(["/admin/sla", "/mypage"]), "/admin/sla");
  assert.equal(resolveAdminLoginReturnPath(""), null);
  assert.equal(resolveAdminLoginReturnPath(null), null);
  assert.equal(adminLoginDestination(null), ADMIN_LOGIN_DEFAULT_PATH);
  assert.equal(adminLoginDestination("/mypage"), "/admin/dashboard");
  assert.equal(adminLoginDestination("/admin/sla"), "/admin/sla");
});

test("페이지·액션·폼 배선: next 는 허용 목록으로만 해석 · hidden next 는 통과한 값만 · routeGuard 는 /admin/login?next= 로 보낸다 · (admin) 레이아웃은 /admin/login 을 가드에서 뺀다", () => {
  const page = stripComments(read(PAGE));
  assert.ok(page.includes("resolveAdminLoginReturnPath(sp[ADMIN_LOGIN_NEXT_PARAM])"));
  assert.ok(!page.includes("safeInternalNextPath") && !page.includes("resolvePostLoginPath"), "일반 경로 해석 대신 허용 목록");
  const form = stripComments(read(PASSWORD_STEP));
  assert.ok(form.includes('{returnPath ? <input type="hidden" name={ADMIN_LOGIN_NEXT_PARAM} value={returnPath} /> : null}'));
  assert.ok(form.includes("ADMIN_LOGIN_RETURN_NOTICE"), "가드가 보낸 경우 안내");
  const action = stripComments(read(ACTION));
  assert.ok(action.includes("buildAdminLoginUrl({ next, error:") && !action.includes("safeInternalNextPath"), "액션의 실패 복귀도 허용 목록 빌더");
  const guard = stripComments(read(ROUTE_GUARD));
  assert.ok(guard.includes('if (r === "admin") return "/admin/login";') && guard.includes("new URLSearchParams({ next: returnTo })"));
  const layout = stripComments(read(ADMIN_LAYOUT));
  assert.ok(layout.includes('pathname === "/admin/login"') && layout.includes("if (!isLogin) {"));
});

// ── ④ 실패 코드 · 문구 ───────────────────────────────────────────────────────

test("실패는 코드로만: invalid · unconfirmed · not_admin · session — 모르는 값은 일반 문구(원문 반영 없음) · 학생·멘토 거부 문구 · URL 빌더", () => {
  assert.deepEqual([...ADMIN_LOGIN_ERROR_CODES], ["invalid", "unconfirmed", "not_admin", "session"]);
  assert.equal(adminLoginErrorMessage("not_admin"), ADMIN_LOGIN_ERROR_MESSAGES.not_admin);
  assert.ok(ADMIN_LOGIN_ERROR_MESSAGES.not_admin.includes("학생·멘토 계정으로는") && ADMIN_LOGIN_ERROR_MESSAGES.not_admin.includes("서비스 로그인"));
  assert.ok(ADMIN_LOGIN_ERROR_MESSAGES.session.includes("세션이 만료"));
  assert.equal(adminLoginErrorMessage("<script>alert(1)</script>"), ADMIN_LOGIN_GENERIC_ERROR, "원문을 비추지 않는다");
  assert.equal(adminLoginErrorMessage(""), null);
  assert.equal(adminLoginErrorMessage(["invalid"]), ADMIN_LOGIN_ERROR_MESSAGES.invalid);
  assert.equal(buildAdminLoginUrl(), ADMIN_LOGIN_PATH);
  assert.equal(buildAdminLoginUrl({ next: "/admin/sla", error: "invalid" }), "/admin/login?error=invalid&next=%2Fadmin%2Fsla");
  assert.equal(buildAdminLoginUrl({ next: "/mypage", error: "not_admin" }), "/admin/login?error=not_admin", "허용 밖 next 는 싣지 않는다");
  assert.equal(buildAdminLoginUrl({ step: "code" }), "/admin/login?step=code");
  assert.equal(buildAdminLoginUrl({ step: "password" }), ADMIN_LOGIN_PATH);
  const action = stripComments(read(ACTION));
  for (const code of ADMIN_LOGIN_ERROR_CODES.filter((c) => c !== "session")) assert.ok(action.includes(`error: "${code}"`), `액션이 코드 ${code} 를 쓴다`);
  assert.ok(!/redirect\([^)]*[가-힣]/.test(action), "redirect 에 한글 원문 없음(코드만)");
  assert.ok(action.includes('profile.role !== "admin"') && action.includes("await supabase.auth.signOut();"), "서비스 계정은 세션을 끊고 거부");
  assert.equal(ADMIN_LOGIN_SERVICE_LOGIN_HREF, "/login");
  assert.ok(stripComments(read(PASSWORD_STEP)).includes("href={ADMIN_LOGIN_SERVICE_LOGIN_HREF}"), "서비스 로그인 안내 링크");
});

// ── ⑤ 콘솔 색 규격 · 금지어 ─────────────────────────────────────────────────

test("서비스 로그인과 구분: 학생 파랑·멘토 초록 CTA 없음 · slate-900 헤더·버튼 + 운영 배지 · 단계 표시 · alert 없음 · 순수 모듈 import 없음", () => {
  const page = stripComments(read(PAGE));
  const form = stripComments(read(PASSWORD_STEP));
  for (const src of [page, form]) {
    assert.ok(!src.includes("#2563EB") && !src.includes("#059669") && !src.includes("bg-indigo") && !src.includes("bg-blue-600"), "서비스 CTA 색 없음");
  }
  assert.ok(page.includes("bg-slate-900") && page.includes("운영") && page.includes("쌤버십 Admin"));
  assert.ok(form.includes("bg-slate-900"), "제출 버튼은 콘솔 규격");
  assert.ok(page.includes('aria-label="로그인 단계"') && page.includes("ADMIN_LOGIN_STEP_LABELS[value]"), "1단계 → 2단계 표시");
  const pure = stripComments(read(CONSOLE));
  assert.ok(!/from "react"|from "@\//.test(pure) && !/^import /m.test(pure), "순수 모듈");
  for (const rel of [PAGE, ACTION, CONSOLE, PASSWORD_STEP, CODE_STEP]) {
    const code = stripComments(read(rel));
    for (const banned of ["선생님", "강사님", "수강생", "과외", "커패니티", "웰버십", "쌤버쉽", "alert("]) {
      assert.ok(!code.includes(banned), `${rel}: 금지 문구 ${banned}`);
    }
  }
});
