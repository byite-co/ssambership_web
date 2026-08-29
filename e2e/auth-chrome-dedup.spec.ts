import { test, expect } from "@playwright/test";

/**
 * 비밀번호 재설정 두 화면의 이중 크롬 회귀 방지 — 두 페이지는 라우트 그룹 밖
 * (app/forgot-password, app/auth/update-password)에 있어야 하며, (public)
 * 레이아웃(AppShell+SiteFooter) 안으로 다시 들어가면 헤더·푸터가 각 2개가 된다.
 * 마커: AppShell 루트 = [data-shell-area], AuthTopNav(loginPageNav) 내부
 * nav[aria-label="서비스 메뉴"], LoginPageFooter = footer[aria-label="로그인 페이지 하단"],
 * SiteFooter = footer[role="contentinfo"] (aria-label 없음).
 */
const targets = [
  { route: "/forgot-password", loginFooterCount: 1 },
  { route: "/auth/update-password", loginFooterCount: 0 },
];

for (const { route, loginFooterCount } of targets) {
  test(`${route} — AuthTopNav 1 · LoginPageFooter ${loginFooterCount} · AppShell/SiteFooter 0`, async ({ page }) => {
    await page.goto(route);
    await expect(page.locator("[data-shell-area]")).toHaveCount(0);
    await expect(page.locator("header")).toHaveCount(1);
    await expect(page.locator('header nav[aria-label="서비스 메뉴"]')).toHaveCount(1);
    await expect(page.locator('footer[aria-label="로그인 페이지 하단"]')).toHaveCount(loginFooterCount);
    await expect(page.locator('footer[role="contentinfo"]')).toHaveCount(loginFooterCount);
  });
}
