import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { login, ACCOUNTS } from "./helpers/auth";
import { newPreviewContext } from "./helpers/previewProxy";

/**
 * Preview E2E — 알림 허브 cursor 페이지네이션/카테고리/unread (runbook §6).
 * 선행 조건: 학생 계정 앞으로 12건의 알림이 시드되어 있어야 한다
 * (qna 6 · subscription 4 · system 2, 전부 unread, event_key LIKE '<STAMP>-%').
 * 시드/정리는 오케스트레이션(SQL)에서 수행 — 이 스펙은 UI 검증만 한다.
 */

test.describe("알림 허브 — cursor/category/unread", () => {
  let ctx: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    ({ ctx, page } = await newPreviewContext(browser));
    await login(page, ACCOUNTS.student);
  });
  test.afterAll(async () => ctx?.close());

  const unreadDots = () => page.locator('[aria-label="안 읽음"]');

  test("1페이지 10건 + 다음/이전 cursor 왕복", async () => {
    await page.goto("/notifications", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(/안 읽음/).first()).toBeVisible();
    await expect(page.getByText("12").first()).toBeVisible();
    await expect(unreadDots()).toHaveCount(10); // 기본 pageSize=10

    const pager = page.locator('nav[aria-label="알림 페이지 이동"]');
    await expect(pager.locator('span[aria-disabled]', { hasText: "이전" })).toBeVisible(); // 1페이지: 이전 비활성
    await pager.locator('a[rel="next"]').click();
    await page.waitForURL(/dir=next&cursor=|cursor=/);
    await expect(unreadDots()).toHaveCount(2); // 2페이지: 12-10
    await pager.locator('a[rel="prev"]').click();
    await page.waitForURL(/dir=prev/);
    await expect(unreadDots()).toHaveCount(10); // 복귀
  });

  test("카테고리 필터: 질문방 6 · 구독·결제 4 · 공지·안내 2 (cursor 리셋)", async () => {
    await page.goto("/notifications", { waitUntil: "domcontentloaded" });
    const catTabs = page.locator('[aria-label="알림 카테고리"] [role="tab"]');
    await catTabs.filter({ hasText: "질문방" }).first().click();
    await page.waitForURL(/category=qna/);
    expect(page.url()).not.toContain("cursor="); // 카테고리 변경 시 cursor 미포함
    await expect(unreadDots()).toHaveCount(6);
    await catTabs.filter({ hasText: "구독·결제" }).first().click();
    await page.waitForURL(/category=subscription/);
    await expect(unreadDots()).toHaveCount(4);
    await catTabs.filter({ hasText: "공지·안내" }).first().click();
    await page.waitForURL(/category=system/);
    await expect(unreadDots()).toHaveCount(2);
  });

  test("unread 필터 + 개별 읽음 + 모두 읽음", async () => {
    await page.goto("/notifications?filter=unread", { waitUntil: "domcontentloaded" });
    await expect(unreadDots()).toHaveCount(10); // unread 12건 중 1페이지 10

    // 개별 읽음 1건 → 카운트 11
    await page.getByRole("button", { name: "읽음", exact: true }).first().click();
    await expect(page.getByText("11").first()).toBeVisible({ timeout: 20_000 });

    // 모두 읽음 → 헤더 갱신 + unread 빈 상태
    await page.getByRole("button", { name: "모두 읽음" }).click();
    await expect(page.getByText("모두 확인했어요").first()).toBeVisible({ timeout: 20_000 });
    await page.goto("/notifications?filter=unread", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("모든 알림을 확인했어요")).toBeVisible();
    await expect(unreadDots()).toHaveCount(0);
  });
});
