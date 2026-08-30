// 토스 게이트 E2E 러너 — 실행: npm run test:e2e:toss-gate
//
// 두 시나리오는 서버 env(TOSS_REVIEW_ALLOWED_USER_IDS)가 달라야 하므로 playwright 를
// 시나리오별 env 로 2회 순차 실행한다(설정: playwright.toss-gate.config.ts).
//   A(차단): TOSS_REVIEW_ALLOWED_USER_IDS=""            → 카드 미렌더 + 고정 문구
//   B(허용): TOSS_REVIEW_ALLOWED_USER_IDS=<E2E 학생 UUID> → 카드 렌더
// 학생 UUID 는 하드코딩하지 않고 e2e/helpers/db.ts(userIdByEmail)로 E2E_STUDENT_EMAIL
// 에서 조회한다. env 섞임 방지 장치는 playwright.toss-gate.config.ts 헤더 주석 참조
// (전용 포트 3210 · reuseExistingServer:false · webServer.env 명시 설정).
//
// 옵션: --skip-build  (직전 next build 산출물 재사용 — 코드 변경 후에는 빌드 생략 금지)

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvLocal } from "../../e2e/helpers/env.ts";
import { userIdByEmail } from "../../e2e/helpers/db.ts";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const CONFIG = "playwright.toss-gate.config.ts";
const SKIP_BUILD = process.argv.includes("--skip-build");

function step(name: string, args: string[], extraEnv: Record<string, string>): number {
  console.log(`\n[toss-gate e2e] ▶ ${name}`);
  const r = spawnSync("npx", args, {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
    // Windows 에서 npx(.cmd) 실행을 위해 shell 필요(레포 로컬 개발 환경은 Windows).
    shell: process.platform === "win32",
  });
  return r.status ?? 1;
}

function fail(message: string): never {
  console.error(`[toss-gate e2e] ✗ ${message}`);
  process.exit(1);
}

// 1) 사전 점검 — 자격 문제는 빌드 전에 빠르게 알린다(값은 로그에 남기지 않는다).
const envLocal = loadEnvLocal();
const studentEmail = envLocal.E2E_STUDENT_EMAIL ?? process.env.E2E_STUDENT_EMAIL ?? "";
if (!studentEmail) {
  fail(".env.local 에 E2E_STUDENT_EMAIL 이 필요합니다(허용 시나리오의 allowlist 대상).");
}

// 2) 허용 시나리오용 학생 UUID 조회 — e2e/helpers/db.ts 재사용(하드코딩 금지).
//    NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 부재 시 여기서 명확히 실패한다.
const studentId = await userIdByEmail(studentEmail);
console.log(`[toss-gate e2e] E2E 학생 UUID 확보: ${studentId.slice(0, 8)}…`);

// 3) 프로덕션 빌드 — 서버는 next start 로 뜬다(기본 E2E 설정과 동일 계약).
//    TOSS_REVIEW_ALLOWED_USER_IDS 는 서버 런타임에 읽는 값이라 시나리오 간 재빌드는 불필요.
if (SKIP_BUILD) {
  if (!existsSync(join(ROOT, ".next", "BUILD_ID"))) {
    fail("--skip-build 를 줬지만 .next 빌드 산출물이 없습니다. 먼저 next build 하세요.");
  }
  console.log("[toss-gate e2e] --skip-build: 기존 .next 산출물 재사용");
} else if (step("next build", ["next", "build"], {}) !== 0) {
  fail("next build 실패");
}

// 4) 시나리오 순차 실행 — 각 실행이 전용 포트에 자기 서버를 띄우고 내린다.
const blocked = step(
  "시나리오 A(차단) — TOSS_REVIEW_ALLOWED_USER_IDS 빈 값",
  ["playwright", "test", "--config", CONFIG],
  { TOSS_GATE_E2E_SCENARIO: "blocked", TOSS_REVIEW_ALLOWED_USER_IDS: "" },
);
const allowed = step(
  "시나리오 B(허용) — allowlist=E2E 학생 UUID",
  ["playwright", "test", "--config", CONFIG],
  { TOSS_GATE_E2E_SCENARIO: "allowed", TOSS_REVIEW_ALLOWED_USER_IDS: studentId },
);

console.log(
  `\n[toss-gate e2e] 결과 — 차단: ${blocked === 0 ? "PASS" : "FAIL"} · 허용: ${allowed === 0 ? "PASS" : "FAIL"}`,
);
process.exit(blocked === 0 && allowed === 0 ? 0 : 1);
