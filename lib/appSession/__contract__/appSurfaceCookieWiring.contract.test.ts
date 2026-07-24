import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// 앱 표면 쿠키 배선 회귀 방지(소스 스캔 tripwire):
// 1) 일반 웹 helper(lib/supabase/server.ts)는 쿠키 속성을 건드리지 않는다(전역 불변).
// 2) 앱 전용 helper(appSurfaceServer)는 허용된 앱 표면 파일에서만 import 된다.
// 3) bootstrap 라우트·앱 helper 는 appSurfaceCookies 정본 harden 경로를 쓰고,
//    콘솔 로그(토큰 유출 표면)를 갖지 않는다.

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    // __contract__: 계약테스트 자신(이 파일 포함)은 배선 스캔 대상이 아니다.
    if (entry === "node_modules" || entry === ".next" || entry === "__contract__" || entry.startsWith(".")) {
      continue;
    }
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...collectSourceFiles(p));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(p);
  }
  return out;
}

test("일반 웹 helper 는 쿠키 옵션 무변경(httpOnly 미등장) — 웹 로그인 계약 유지", () => {
  const webHelper = read("lib/supabase/server.ts");
  assert.ok(!webHelper.includes("httpOnly"), "lib/supabase/server.ts 에 쿠키 속성 오버라이드가 생김");
  assert.ok(!webHelper.includes("appSurface"), "일반 웹 helper 가 앱 표면 모듈을 참조함");
});

test("앱 전용 helper import 는 앱 표면 파일 allowlist 에서만", () => {
  const allowed = new Set([
    "app/api/app-session/bootstrap/route.ts", // (직접 harden 사용 — helper import 는 없음)
    "app/app/community/shortform/new/page.tsx",
    "lib/community/communityShortformActions.ts",
    "lib/supabase/appSurfaceServer.ts",
  ]);
  const importers: string[] = [];
  for (const dir of ["app", "lib", "components"]) {
    for (const file of collectSourceFiles(join(ROOT, dir))) {
      const text = readFileSync(file, "utf8");
      if (text.includes("supabase/appSurfaceServer")) {
        importers.push(relative(ROOT, file).replaceAll("\\", "/"));
      }
    }
  }
  for (const f of importers) {
    assert.ok(allowed.has(f), `앱 표면 밖 파일이 앱 전용 쿠키 helper 를 사용: ${f}`);
  }
  // 핵심 배선 존재 확인(빠뜨림 방지).
  assert.ok(importers.includes("app/app/community/shortform/new/page.tsx"), "앱 작성 표면 미배선");
  assert.ok(importers.includes("lib/community/communityShortformActions.ts"), "앱 wrapper 액션 미배선");
});

test("bootstrap 라우트: 정본 harden 경로 사용 + 실패 응답 쿠키 미부착 구조 + 콘솔 로그 0", () => {
  const route = read("app/api/app-session/bootstrap/route.ts");
  assert.ok(route.includes("hardenAppSurfaceCookieWrites"), "정본 harden 미사용");
  assert.ok(!route.includes("httpOnly: true,") || route.includes("hardenAppSurfaceCookieWrites"),
    "인라인 속성 하드코딩으로 회귀");
  // 실패 redirect 헬퍼는 쿠키를 만지지 않는다(버퍼 폐기 불변식의 소스 레벨 방증).
  const errorHelper = route.slice(route.indexOf("function errorRedirect"), route.indexOf("function methodNotAllowed"));
  assert.ok(!errorHelper.includes("cookies.set"), "실패 redirect 가 쿠키를 부착함");
  assert.ok(!/console\.(log|info|debug|warn|error)/.test(route), "bootstrap 라우트에 콘솔 출력(토큰 유출 표면) 존재");
});

test("앱 helper: 모든 쓰기가 harden 경유 + 콘솔 로그 0", () => {
  const helper = read("lib/supabase/appSurfaceServer.ts");
  assert.ok(helper.includes("hardenAppSurfaceCookieOptions"), "helper 가 정본 harden 미사용");
  assert.ok(!/console\.(log|info|debug|warn|error)/.test(helper), "앱 helper 에 콘솔 출력 존재");
});

test("앱 표면 액션 배선: finalize·티켓의 app wrapper 가 앱 클라이언트를 쓴다", () => {
  const actions = read("lib/community/communityShortformActions.ts");
  assert.ok(actions.includes("createAppSurfaceClient"), "액션에 앱 클라이언트 미배선");
  assert.ok(actions.includes("createShortformVideoUploadTicketFromAppAction"), "앱 티켓 액션 부재");
  // 웹 경로 회귀 방지: 일반 createClient 도 여전히 존재(웹 표면은 전역 helper 유지).
  assert.ok(actions.includes('from "@/lib/supabase/server"'), "웹 표면 전역 helper 가 제거됨");
});

test("앱 표면 계정 게이트 배선: strict(fail-closed)가 bootstrap·페이지·티켓·finalize 에, 웹은 기존 가드 유지", () => {
  // (판정 로직 자체는 appSurfaceAccountGate.contract.test.ts 가 table-driven 으로 검증 —
  //  여기는 '어느 표면이 어느 게이트를 쓰는가' 배선만 회귀 감시한다.)
  const route = read("app/api/app-session/bootstrap/route.ts");
  assert.ok(route.includes("assertAppSurfaceAccountActiveStrict"), "bootstrap 이 strict 게이트 미사용");
  assert.ok(!route.includes("assertAccountActive("), "bootstrap 이 fail-open 가드로 회귀");
  assert.ok(route.includes("strictMentorRoleDecision"), "bootstrap role 게이트 미배선");

  const page = read("app/app/community/shortform/new/page.tsx");
  assert.ok(page.includes("assertAppSurfaceAccountActiveStrict"), "앱 작성 표면이 strict 게이트 미사용");
  assert.ok(!page.includes('from "@/lib/auth/accountStatus"'), "앱 작성 표면이 fail-open 가드를 import");

  const actions = read("lib/community/communityShortformActions.ts");
  assert.ok(actions.includes("assertAppSurfaceAccountActiveStrict"), "앱 wrapper 액션이 strict 게이트 미사용");
  // 일반 웹 wrapper 는 기존 fail-open 가드를 계속 쓴다(웹 동작 불변).
  assert.ok(actions.includes("assertAccountActive(supabase"), "웹 표면 기존 가드가 제거됨");

  // 기존 fail-open helper 자체는 불변(전역 의미 변경 금지) — fail-open 시그니처 잔존 확인.
  const legacy = read("lib/auth/accountStatus.ts");
  assert.ok(legacy.includes("return { ok: true };"), "전역 assertAccountActive 의미가 변경됨");
  assert.ok(!legacy.includes("Strict"), "전역 helper 에 strict 모드가 섞임");
});
