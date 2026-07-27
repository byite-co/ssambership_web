import { defineConfig } from "@playwright/test";

/**
 * Preview E2E — Vercel Preview 배포(원격) 대상 인증 회귀.
 * - 대상: PR #42 브랜치의 Vercel Preview (E2E_PREVIEW_BASE_URL).
 * - Vercel SSO 보호는 공유 링크(E2E_PREVIEW_SHARE_URL)로 우회 — 스펙에서 쿠키 부트스트랩.
 * - 계정: E2E_STUDENT/MENTOR/ADMIN_EMAIL/_PW (환경변수 주입, 코드/로그에 값 미기록).
 * - 공유 staging DB에 쓰기가 발생하므로 순차 실행(workers:1).
 * - 관리형 컨테이너: 브라우저는 사전 설치본을 사용(executablePath 고정).
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: /preview-.*\.spec\.ts/,
  timeout: 240_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir: process.env.E2E_OUTPUT_DIR || "./test-results",
  use: {
    baseURL: process.env.E2E_PREVIEW_BASE_URL || "http://localhost:3000",
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : undefined,
  },
});
