import { defineConfig } from "@playwright/test";

/**
 * 토스 게이트 E2E 전용 설정 — 시나리오(차단/허용)마다 서버 env
 * (TOSS_REVIEW_ALLOWED_USER_IDS)가 달라야 하므로 기본 설정과 분리한다.
 * 실행은 러너(scripts/e2e/runTossGateE2e.ts → npm run test:e2e:toss-gate)가 한다.
 *
 * env 섞임 방지(★):
 *  - 전용 포트(기본 3210): 개발/기본 E2E 서버(3000)를 절대 재사용하지 않는다.
 *  - reuseExistingServer: false — 포트에 무언가 떠 있으면(직전 시나리오 잔여 서버 등)
 *    재사용하지 않고 즉시 실패한다(fail-loud). 각 playwright 실행이 자기 서버를
 *    띄우고 종료 시 함께 내리므로 시나리오 간 서버 env 가 격리된다.
 *  - webServer.env 는 TOSS_REVIEW_ALLOWED_USER_IDS 를 **항상 명시적으로**(빈 문자열
 *    포함) 설정한다 — process.env 에 존재하는 키는 next start 가 .env.local 의
 *    동명 변수로 덮어쓰지 않으므로, 로컬 .env.local 값이 차단 시나리오로 새지 않는다.
 */
const PORT = Number(process.env.TOSS_GATE_E2E_PORT ?? 3210);

export default defineConfig({
  testDir: "./e2e",
  testMatch: /toss-gate\.spec\.ts/,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    actionTimeout: 25_000,
    navigationTimeout: 45_000,
    trace: "retain-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : undefined,
  },
  webServer: {
    command: "npm run start",
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      PORT: String(PORT),
      TOSS_REVIEW_ALLOWED_USER_IDS: process.env.TOSS_REVIEW_ALLOWED_USER_IDS ?? "",
    },
  },
});
