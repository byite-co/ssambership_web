// 계약 테스트: 개인정보처리방침 소셜 로그인 개정 시행일(2026-09-13 KST) — 방침 페이지와 소셜 버튼 게이트의 단일 소스.
// 실행: node --test --experimental-strip-types lib/legal/__contract__/socialLoginRevision.contract.test.ts
//
// 고정하는 것: (1) 시행 전 미노출 · 시행 후 노출(KST 달력 경계 포함) (2) ISO ↔ 표기 라벨 파생 (3) 배선 —
// 방침 페이지가 공용 상수를 쓰고 로컬 빈 문자열 상수를 되살리지 않는다 · 버튼 컴포넌트가 게이트로 null 을 돌려준다 ·
// 로그인·가입 화면 배선은 그대로 (4) 소셜 버튼 공식 에셋 3종의 파일명·경로·alt.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SOCIAL_LOGIN_REVISION_ACTIVE,
  SOCIAL_LOGIN_REVISION_EFFECTIVE_DATE_ISO,
  SOCIAL_LOGIN_REVISION_EFFECTIVE_DATE_LABEL,
  formatRevisionDateLabel,
  isSocialLoginRevisionEffective,
  kstCalendarDate,
} from "../socialLoginRevision.ts";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

test("시행일 상수: 2026-09-13(KST) · 표기 라벨은 ISO 에서 파생 · ACTIVE", () => {
  assert.equal(SOCIAL_LOGIN_REVISION_EFFECTIVE_DATE_ISO, "2026-09-13");
  assert.equal(SOCIAL_LOGIN_REVISION_EFFECTIVE_DATE_LABEL, "2026년 9월 13일");
  assert.equal(formatRevisionDateLabel("2026-09-01"), "2026년 9월 1일");
  assert.equal(SOCIAL_LOGIN_REVISION_ACTIVE, true);
});

test("시행 전 미노출: 시행일 전날 KST 23:59:59 까지 false", () => {
  assert.equal(isSocialLoginRevisionEffective(new Date("2026-09-06T03:00:00Z")), false, "착수일(2026-09-06)");
  assert.equal(isSocialLoginRevisionEffective(new Date("2026-09-12T14:59:59Z")), false, "09-12 23:59:59 KST");
  assert.equal(kstCalendarDate(new Date("2026-09-12T14:59:59Z")), "2026-09-12");
});

test("시행 후 노출: 시행일 KST 0시부터 true(UTC 로는 전날 15:00)", () => {
  assert.equal(isSocialLoginRevisionEffective(new Date("2026-09-12T15:00:00Z")), true, "09-13 00:00:00 KST");
  assert.equal(kstCalendarDate(new Date("2026-09-12T15:00:00Z")), "2026-09-13");
  assert.equal(isSocialLoginRevisionEffective(new Date("2026-09-13T12:00:00Z")), true);
  assert.equal(isSocialLoginRevisionEffective(new Date("2027-01-01T00:00:00Z")), true);
});

test("배선: 방침 페이지는 공용 상수(라벨·ACTIVE)를 쓰고 로컬 빈 문자열 상수를 되살리지 않는다", () => {
  const page = read("app/(public)/legal/privacy/page.tsx");
  assert.ok(page.includes('from "@/lib/legal/socialLoginRevision"'), "방침 페이지가 공용 모듈을 import 하지 않음");
  assert.ok(page.includes("const REVISION_SOCIAL_LOGIN_EFFECTIVE_DATE: string = SOCIAL_LOGIN_REVISION_EFFECTIVE_DATE_LABEL;"), "시행일 표기가 공용 라벨이 아님");
  assert.ok(!page.includes('REVISION_SOCIAL_LOGIN_EFFECTIVE_DATE: string = ""'), "오너 입력용 빈 문자열 상수가 되살아남");
  assert.ok(page.includes("const SOCIAL_LOGIN_REVISION_ACTIVE = SOCIAL_LOGIN_REVISION_ACTIVE_SHARED;"), "ACTIVE 스위치가 공용 값이 아님");
});

test("배선: 소셜 버튼은 게이트로 null 을 돌려준다 · 로그인 폼·가입 화면 배선은 그대로", () => {
  const buttons = read("components/auth/SocialLoginButtons.tsx");
  assert.ok(buttons.includes('from "@/lib/legal/socialLoginRevision"'), "버튼이 공용 게이트를 import 하지 않음");
  assert.ok(buttons.includes("if (!isSocialLoginRevisionEffective()) return null;"), "시행 전 미노출 게이트가 없음");
  const gateIdx = buttons.indexOf("if (!isSocialLoginRevisionEffective()) return null;");
  const returnIdx = buttons.indexOf("return (\n    <div className=\"space-y-3\">");
  assert.ok(gateIdx > 0 && returnIdx > gateIdx, "게이트가 렌더보다 앞에 있어야 한다");
  assert.ok(buttons.lastIndexOf("useState", gateIdx) > 0, "훅 호출 뒤에 게이트(훅 순서 고정)");
  assert.ok(read("components/auth/RoleLoginForm.tsx").includes("<SocialLoginButtons roleHint={role}"), "로그인 폼 배선 변경");
  assert.ok(read("app/signup/page.tsx").includes("<SocialLoginButtons"), "가입 화면 배선 변경");
});

test("평가 시점: 게이트는 빌드가 아니라 요청 시점 — /signup 세그먼트 force-dynamic(로그인 3페이지는 쿠키로 동적) · 게이트가 모듈 상수가 아닌 함수 호출", () => {
  const layout = read("app/signup/layout.tsx");
  assert.ok(layout.includes('export const dynamic = "force-dynamic";'), "/signup 이 정적 프리렌더로 돌아가면 게이트 값이 빌드 시점에 박힌다");
  const buttons = read("components/auth/SocialLoginButtons.tsx");
  assert.ok(buttons.includes("isSocialLoginRevisionEffective()"), "렌더마다 호출(요청 시점 평가)");
  const fnIdx = buttons.indexOf("export function SocialLoginButtons");
  const callIdx = buttons.indexOf("isSocialLoginRevisionEffective()");
  assert.ok(fnIdx > 0 && callIdx > fnIdx, "모듈 스코프에서 한 번만 평가하면 안 된다(컴포넌트 본문 안에서 호출)");
  // 방침 페이지는 날짜 게이트가 아니라 ACTIVE 상수(고지 확정) 스위치 — 시행일 전에도 개정 내용·시행일을 미리 보여준다(제12조 7일 사전 공지).
  const privacy = read("app/(public)/legal/privacy/page.tsx");
  assert.ok(!privacy.includes("isSocialLoginRevisionEffective"), "방침 페이지는 시행일 전에도 개정 고지를 보여야 한다(날짜 게이트 금지)");
  assert.ok(read("app/(public)/layout.tsx").includes('export const dynamic = "force-dynamic";'), "(public) 레이아웃 동적 고정");
});

test("공식 에셋 3종: 파일 존재 · 경로·alt 고정 · 로고를 코드로 그리지 않는다 · 높이 48px 컨테이너", () => {
  const buttons = read("components/auth/SocialLoginButtons.tsx");
  const assets: Array<[string, string]> = [
    ["public/auth/kakao_login_wide.png", "/auth/kakao_login_wide.png"],
    ["public/auth/google_signin_light_pill.svg", "/auth/google_signin_light_pill.svg"],
    ["public/auth/apple_logo_white.svg", "/auth/apple_logo_white.svg"],
  ];
  for (const [file, url] of assets) {
    assert.ok(existsSync(join(ROOT, file)), `${file} 부재`);
    assert.ok(buttons.includes(`src: "${url}"`), `${url} 미배선`);
  }
  assert.ok(buttons.includes('alt: "카카오로 계속하기"') && buttons.includes('alt: "Google로 로그인"'), "카카오·구글 alt");
  assert.ok(buttons.includes('label: "Apple로 계속하기"'), "애플 라벨");
  assert.ok(!buttons.includes("<svg"), "제공자 로고를 코드로 그리면 안 된다");
  assert.ok(buttons.includes("h-12 w-full") && buttons.includes("object-contain"), "48px 고정 높이 + object-contain");
  assert.ok(buttons.includes("onError={() => markAssetFailed(provider)}"), "에셋 로드 실패 텍스트 폴백");
  // 구글 공식 SVG 는 텍스트가 패스라 <text> 0(폰트 의존 없음) · 카카오 PNG 600×90.
  assert.equal((read("public/auth/google_signin_light_pill.svg").match(/<text/g) ?? []).length, 0);
  const png = readFileSync(join(ROOT, "public/auth/kakao_login_wide.png"));
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [600, 90]);
});
