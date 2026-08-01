import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { ACCOUNTS, login } from "./helpers/auth";

/**
 * F1 — D-13(PREFETCH_SIDE_EFFECT) 회귀 검증.
 *
 * 모바일 메뉴를 열거나 인증 화면 사이를 이동하는 것만으로 /logout 요청 또는
 * signOut 이 실행되는 경로가 0건이어야 한다. 명시적 로그아웃은 POST 1회만.
 */

// 원격 실행 환경 등 사전 설치 브라우저만 있는 곳에서 실행 경로를 주입(미설정 시 기본 동작).
const chromiumExecutable = process.env.F1_CHROMIUM_EXECUTABLE;
test.use(chromiumExecutable ? { launchOptions: { executablePath: chromiumExecutable } } : {});

type LogoutCounts = { get: number; post: number; other: number };

function trackLogoutRequests(context: BrowserContext): LogoutCounts {
  const counts: LogoutCounts = { get: 0, post: 0, other: 0 };
  context.on("request", (req) => {
    let pathname = "";
    try {
      pathname = new URL(req.url()).pathname;
    } catch {
      return;
    }
    if (pathname !== "/logout") return;
    const method = req.method().toUpperCase();
    if (method === "GET") counts.get += 1;
    else if (method === "POST") counts.post += 1;
    else counts.other += 1;
  });
  return counts;
}

/** 현재 페이지(로그인 화면)에서 폼을 채워 로그인 — helpers/auth.login 과 동일한 하이드레이션 보정. */
async function loginOnCurrentPage(page: Page, account: { email: string; pw: string }): Promise<void> {
  const email = page.locator('input[type="email"]').first();
  const pw = page.locator('input[type="password"]').first();
  await email.waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForTimeout(2000);
  await email.fill(account.email);
  await pw.fill(account.pw);
  await page.waitForTimeout(300);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 30_000 });
}

function sessionCookieNames(cookies: Array<{ name: string; value: string }>): string[] {
  return cookies.filter((c) => /^sb-.+-auth-token/.test(c.name) && c.value.length > 0).map((c) => c.name);
}

test.describe("F1 모바일 (375×812)", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("메뉴·네비게이션 30회+ 에서 /logout 0건 · 명시적 로그아웃만 POST 1회", async ({ page, context }) => {
    test.setTimeout(420_000);
    const counts = trackLogoutRequests(context);

    await login(page, ACCOUNTS.student);

    const menuToggle = page
      .locator('button[aria-controls="shell-mobile-nav"], button[aria-controls="landing-mobile-nav"]')
      .first();
    const mobileMenu = page.locator("#shell-mobile-nav, #landing-mobile-nav").first();

    async function openMenuAndAssertLoggedIn(): Promise<void> {
      await menuToggle.click();
      await mobileMenu.waitFor({ state: "visible" });
      // 로그인 상태 점멸 0: 메뉴가 열릴 때마다 로그아웃(로그인 상태)만 보여야 한다.
      await expect(mobileMenu.getByRole("button", { name: "로그아웃" })).toBeVisible();
      await expect(mobileMenu.getByRole("link", { name: "로그인" })).toHaveCount(0);
    }

    async function navViaMenu(label: string, expectPath: string): Promise<void> {
      await openMenuAndAssertLoggedIn();
      await mobileMenu.getByRole("link", { name: label, exact: true }).click();
      await page.waitForURL((url) => url.pathname === expectPath, { timeout: 45_000 });
      await page.waitForTimeout(250);
    }

    // 순환 5회 = 네비게이션 30회 (새로고침 없음, 매회 모바일 메뉴 경유 → prefetch 재현 조건)
    const CYCLE: Array<[string, string]> = [
      ["질문방", "/question-room"],
      ["멘토 찾기", "/mentors"],
      ["커뮤니티", "/community"],
      ["개별 질문", "/individual-questions"],
      ["캐시결제", "/wallet/charge"],
      ["마이페이지", "/mypage"],
    ];
    let navigations = 0;
    for (let round = 0; round < 5; round++) {
      for (const [label, path] of CYCLE) {
        await navViaMenu(label, path);
        navigations += 1;
        expect(counts.get, `round ${round} ${path} 도달 시 GET /logout`).toBe(0);
        expect(counts.post, `round ${round} ${path} 도달 시 POST /logout`).toBe(0);
        expect(page.url()).not.toContain("/login");
      }
    }
    expect(navigations).toBeGreaterThanOrEqual(30);

    // 모바일 메뉴 열기/닫기 10회 — 열린 상태로 짧게 대기(prefetch 유발 시간 확보)
    for (let i = 0; i < 10; i++) {
      await menuToggle.click();
      await mobileMenu.waitFor({ state: "visible" });
      await page.waitForTimeout(400);
      await menuToggle.click();
      await expect(mobileMenu).toBeHidden();
    }

    // 다른 인증 화면 이동
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await page.goto("/signup", { waitUntil: "domcontentloaded" });
    await page.goto("/mypage", { waitUntil: "domcontentloaded" });
    expect(page.url()).not.toContain("/login");

    // 전체 새로고침 1회 — 세션 유지
    await page.reload({ waitUntil: "domcontentloaded" });
    expect(page.url()).not.toContain("/login");

    // 새 탭에서 보호 URL — 세션 유지
    const tab = await context.newPage();
    await tab.goto("/mypage", { waitUntil: "domcontentloaded" });
    expect(tab.url()).not.toContain("/login");
    await tab.close();

    // 명시적 로그아웃 전 집계
    expect(counts.get, "명시적 로그아웃 전 GET /logout").toBe(0);
    expect(counts.post, "명시적 로그아웃 전 POST /logout").toBe(0);
    expect(counts.other).toBe(0);

    // F1-R1 런타임 확인: GET /logout 은 405 + 세션 무변경 (요청 집계와 분리된 API 컨텍스트)
    const before = sessionCookieNames(await context.cookies());
    expect(before.length).toBeGreaterThan(0);
    const getRes = await context.request.get("/logout", { maxRedirects: 0, failOnStatusCode: false });
    expect(getRes.status()).toBe(405);
    expect(sessionCookieNames(await context.cookies())).toEqual(before);
    await page.goto("/mypage", { waitUntil: "domcontentloaded" });
    expect(page.url()).not.toContain("/login");

    // 사용자가 직접 로그아웃 버튼을 누른다 → POST 정확히 1회 → 홈
    await openMenuAndAssertLoggedIn();
    await mobileMenu.getByRole("button", { name: "로그아웃" }).click();
    await page.waitForURL((url) => url.pathname === "/", { timeout: 45_000 });
    expect(counts.post, "명시적 로그아웃 POST").toBe(1);
    expect(counts.get, "명시적 로그아웃 후에도 GET /logout").toBe(0);

    // 보호 라우트 재접근 → 로그인 화면, 세션 cookie 제거
    await page.goto("/mypage", { waitUntil: "domcontentloaded" });
    expect(page.url()).toContain("/login");
    expect(sessionCookieNames(await context.cookies())).toEqual([]);
  });
});

test.describe("F1 오라우팅 보조 — 로그인 후 next 목적지 복원", () => {
  const PROTECTED_PATHS = ["/question-room", "/individual-questions/new", "/wallet/charge", "/mypage"];

  for (const target of PROTECTED_PATHS) {
    test(`비로그인 → ${target} → 로그인 → 원주소 복귀`, async ({ browser }) => {
      const context = await browser.newContext();
      const counts = trackLogoutRequests(context);
      const page = await context.newPage();

      await page.goto(target, { waitUntil: "domcontentloaded" });
      await page.waitForURL((url) => url.pathname.includes("/login"), { timeout: 45_000 });
      const loginUrl = new URL(page.url());
      expect(loginUrl.searchParams.get("next"), `${target} 의 next 보존`).toBe(target);

      await loginOnCurrentPage(page, ACCOUNTS.student);
      expect(new URL(page.url()).pathname, `${target} 복귀`).toBe(target);
      expect(counts.get + counts.post).toBe(0);

      await context.close();
    });
  }
});

test.describe("F1 데스크톱 회귀 (1440×900)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("학생: prefetch 0 · 로그아웃 버튼 POST 1회 · 이후 보호 화면 차단", async ({ page, context }) => {
    const counts = trackLogoutRequests(context);
    await login(page, ACCOUNTS.student);

    for (const path of ["/question-room", "/mentors", "/mypage"]) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      expect(page.url()).not.toContain("/login");
    }
    expect(counts.get + counts.post, "로그아웃 전 /logout 요청").toBe(0);

    await page.getByRole("button", { name: "로그아웃" }).first().click();
    await page.waitForURL((url) => url.pathname === "/", { timeout: 45_000 });
    expect(counts.post).toBe(1);
    expect(counts.get).toBe(0);

    await page.goto("/mypage", { waitUntil: "domcontentloaded" });
    expect(page.url()).toContain("/login");
  });

  test("멘토: 헤더 로그아웃 POST 1회", async ({ page, context }) => {
    const counts = trackLogoutRequests(context);
    await login(page, ACCOUNTS.mentor);
    await page.goto("/mentor/mypage", { waitUntil: "domcontentloaded" });
    expect(counts.get + counts.post).toBe(0);

    await page.getByRole("button", { name: "로그아웃" }).first().click();
    await page.waitForURL((url) => url.pathname === "/", { timeout: 45_000 });
    expect(counts.post).toBe(1);
    expect(counts.get).toBe(0);
  });

  test("관리자: 콘솔 로그아웃 POST 1회", async ({ page, context }) => {
    const counts = trackLogoutRequests(context);
    await login(page, ACCOUNTS.admin);
    expect(counts.get + counts.post).toBe(0);

    await page.getByRole("button", { name: "로그아웃" }).first().click();
    await page.waitForURL((url) => url.pathname === "/", { timeout: 45_000 });
    expect(counts.post).toBe(1);
    expect(counts.get).toBe(0);
  });
});
