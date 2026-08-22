import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isIdentityGateEnabled, needsIdentityOnboarding } from "../identityGateFlag.ts";
import type { UserRow } from "../../types/user.ts";

// S-C 게이트 배선 회귀 방지 (소스 스캔 tripwire) + 플래그 의미론.
// 부록 B: 게이트는 (student)·(mentor) 그룹 레이아웃 + 머니패스 서버 가드 — middleware.ts 수정 금지.

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

function withGateEnv(value: string | undefined, fn: () => void) {
  const prev = process.env.IDENTITY_GATE_ENABLED;
  if (value === undefined) {
    delete process.env.IDENTITY_GATE_ENABLED;
  } else {
    process.env.IDENTITY_GATE_ENABLED = value;
  }
  try {
    fn();
  } finally {
    if (prev === undefined) {
      delete process.env.IDENTITY_GATE_ENABLED;
    } else {
      process.env.IDENTITY_GATE_ENABLED = prev;
    }
  }
}

const PROFILE_UNVERIFIED = { id: "u1", role: "student", identity_verified_at: null } as unknown as UserRow;
const PROFILE_VERIFIED = {
  id: "u1",
  role: "student",
  identity_verified_at: "2026-08-21T00:00:00Z",
} as unknown as UserRow;

test("플래그 의미론: 미설정 또는 'true' 외 = OFF (부록 C)", () => {
  withGateEnv(undefined, () => assert.equal(isIdentityGateEnabled(), false));
  withGateEnv("", () => assert.equal(isIdentityGateEnabled(), false));
  withGateEnv("1", () => assert.equal(isIdentityGateEnabled(), false));
  withGateEnv("on", () => assert.equal(isIdentityGateEnabled(), false));
  withGateEnv("TRUE", () => assert.equal(isIdentityGateEnabled(), false, "정확히 'true' 만 — 대문자 불허"));
  withGateEnv("true", () => assert.equal(isIdentityGateEnabled(), true));
  withGateEnv(" true ", () => assert.equal(isIdentityGateEnabled(), true, "trim 허용"));
});

test("게이트 판정: ON+미인증만 true — 비로그인·인증 완료·OFF 는 false", () => {
  withGateEnv("true", () => {
    assert.equal(needsIdentityOnboarding(PROFILE_UNVERIFIED), true);
    assert.equal(needsIdentityOnboarding(PROFILE_VERIFIED), false);
    assert.equal(needsIdentityOnboarding(null), false, "비로그인은 기존 가드 소관");
  });
  withGateEnv(undefined, () => {
    assert.equal(needsIdentityOnboarding(PROFILE_UNVERIFIED), false, "플래그 OFF 면 게이트 없음");
  });
});

test("레이아웃 게이트 배선: (student)·(mentor) 레이아웃이 온보딩 리다이렉트를 건다", () => {
  const student = read("app/(student)/layout.tsx");
  const mentor = read("app/(mentor)/layout.tsx");
  for (const src of [student, mentor]) {
    assert.ok(src.includes("needsIdentityOnboarding"), "게이트 판정 헬퍼가 사라짐");
    assert.ok(src.includes('redirect("/onboarding/verify")'), "온보딩 리다이렉트가 사라짐");
  }
  // (student) 4분기 전부에 게이트 — 분기 수만큼 존재해야 한다.
  assert.equal(
    student.split("needsIdentityOnboarding(").length - 1,
    4,
    "(student) 레이아웃 4분기 게이트 누락/중복"
  );
});

test("탈퇴 경로 게이트 예외: /account/delete 는 미인증도 접근 가능 (오너 확정 2026-08-21)", () => {
  const student = read("app/(student)/layout.tsx");
  assert.ok(
    student.includes("!isAccountDeletePath(pathname) && needsIdentityOnboarding(profile)"),
    "/account/delete 게이트 예외가 사라짐 — 인증 거부 유저의 탈퇴권을 게이트가 막으면 안 된다"
  );
});

test("middleware.ts 무수정 계약: x-pathname 헤더 주입만 — 게이트·세션 접근 금지", () => {
  const src = read("middleware.ts");
  assert.ok(src.includes("x-pathname"), "기존 x-pathname 계약이 사라짐");
  assert.ok(!/identity|onboarding|supabase/i.test(src), "middleware 에 게이트/세션 로직 삽입 금지 (부록 B)");
});

test("머니패스 가드 배선: 4 진입점 전부 requireVerifiedIdentity 경유", () => {
  const entries = [
    "app/api/subscribe/checkout/route.ts",
    "lib/individualQuestion/individualQuestionActions.ts",
    "lib/customRequest/customRequestOrderActions.ts",
    "lib/customRequest/customRequestApplicationActions.ts",
  ];
  for (const rel of entries) {
    assert.ok(read(rel).includes("requireVerifiedIdentity"), `${rel} 에 머니패스 가드가 없음`);
  }
  // IQ 는 결제 발생 지점 2곳(직접·공개 생성) 모두
  const iq = read("lib/individualQuestion/individualQuestionActions.ts");
  assert.equal(iq.split("requireVerifiedIdentity(").length - 1, 2, "IQ 생성 2경로 가드 누락/과잉");
});

test("403 계약: message 는 IDENTITY_REQUIRED 선두 대문자 토큰으로 시작 (앱 에러 매퍼 계약)", () => {
  const gate = read("lib/identity/identityGate.ts");
  assert.ok(/IDENTITY_REQUIRED_MESSAGE\s*=\s*\n?\s*"IDENTITY_REQUIRED[:\s]/.test(gate), "message 선두 토큰 규칙 위반");
  assert.ok(gate.includes("status: 403"), "403 상태코드가 사라짐");
  // DB/RPC 레벨 가드 금지 — 가드는 users 판독만, .rpc( 호출 0
  assert.ok(!gate.includes(".rpc("), "가드에 RPC 호출 금지 (부록 B — DB/RPC 레벨 가드 절대 금지)");
});

test("server-only 경계: env·DB 접근 모듈 전부 부착 (IMPACT #16)", () => {
  for (const rel of [
    "lib/nice/client.ts",
    "lib/identity/encryption.ts",
    "lib/identity/service.ts",
    "lib/identity/identityGate.ts",
  ]) {
    assert.ok(read(rel).includes('import "server-only"'), `${rel} 에 server-only 미부착`);
  }
  // 순수 계산 모듈(유닛 게이트 대상)은 env/DB/네트워크 접근이 없어야 한다.
  for (const rel of ["lib/nice/crypto.ts", "lib/identity/identityCrypto.ts", "lib/identity/age.ts"]) {
    const src = read(rel);
    assert.ok(!src.includes("process.env"), `${rel} 순수 모듈에 env 접근 금지`);
    assert.ok(!src.includes("fetch("), `${rel} 순수 모듈에 네트워크 접근 금지`);
    assert.ok(!src.includes("supabase"), `${rel} 순수 모듈에 DB 접근 금지`);
  }
});

test("앱 표면 게이트 비대상 보장: 앱 WebView·부트스트랩 경로에 게이트 import 0 (부록 B ①)", () => {
  for (const rel of [
    "app/api/app-session/bootstrap/route.ts",
    "app/app/community/shortform/new/page.tsx",
  ]) {
    const src = read(rel);
    assert.ok(!src.includes("identityGate"), `${rel} 은 게이트 비대상 — 앱 유저는 영구 미인증으로 정상 사용`);
    assert.ok(!src.includes("needsIdentityOnboarding"), `${rel} 은 게이트 비대상`);
  }
});

test("NICE 호출 경계: NICE_API_BASE 외 도메인 직접 호출 금지 · 시크릿 하드코드 0", () => {
  const client = read("lib/nice/client.ts");
  assert.ok(!/https?:\/\/[a-z0-9.-]*nice/i.test(client), "NICE 도메인 하드코드 금지 — 프록시(NICE_API_BASE) 경유만");
  assert.ok(client.includes("NICE_API_BASE"), "프록시 base env 참조가 사라짐");
  assert.ok(client.includes("X-Proxy-Key"), "프록시 공유 시크릿 헤더가 사라짐");
  assert.ok(client.includes('svc_types: ["M"]'), "svc_types [\"M\"] 고정(카논)이 사라짐");
});
