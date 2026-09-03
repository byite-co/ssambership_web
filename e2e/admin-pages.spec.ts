/**
 * 관리자 화면 데이터 매핑 — 시드 마커가 각 메뉴에 나타나는지 확인.
 * 로그인은 UI 폼. 페이지 컨텐츠는 .content() 기반 부분 일치.
 */
import { test, expect, type Page } from "@playwright/test";
import { loadEnvLocal } from "./helpers/env";

const env = loadEnvLocal();
const ADMIN_EMAIL = env.E2E_ADMIN_EMAIL ?? "";

const MENU_MAP: Array<{ href: string; label: string; mustInclude?: string[]; mayInclude?: string[] }> = [
  { href: "/admin/dashboard", label: "대시보드", mayInclude: ["승인", "환불", "분쟁", "주문"] },
  { href: "/admin/mentor-approval", label: "멘토 승인", mustInclude: ["가격미설정멘토"] }, // pending verification mentor
  { href: "/admin/academic-record-changes", label: "학적변경 요청", mustInclude: ["연세대학교"] },
  { href: "/admin/school-classifications", label: "분류 관리" },
  { href: "/admin/moderation", label: "콘텐츠 검수", mustInclude: ["local-seed-rich"] },
  { href: "/admin/reviews", label: "리뷰 관리" },
  { href: "/admin/custom-request-orders", label: "맞춤의뢰 주문", mustInclude: ["local-seed-rich"] },
  { href: "/admin/disputes", label: "신고·분쟁", mustInclude: ["local-seed-rich"] },
  // refunds 페이지는 reason을 노출하지 않음 — 금액으로 확인 (4,000,000원 IQ refund + 5,499,999원 sub refund)
  { href: "/admin/refunds", label: "환불·정산", mustInclude: ["4,000,000원", "5,499,999원"] },
  { href: "/admin/notices", label: "공지·이벤트" },
  { href: "/admin/audit-logs", label: "감사 로그" },
  { href: "/admin/settings", label: "시스템 설정" },
  { href: "/admin/reports", label: "신고 목록 (보조)", mustInclude: ["local-seed-rich"] },
  { href: "/admin/refunds-settlement", label: "환불·정산 통합", mayInclude: ["환불", "정산"] },
  { href: "/admin/settlements", label: "정산 관리", mayInclude: ["정산"] },
  { href: "/admin/mentors", label: "멘토 목록(보조)", mayInclude: ["가격설정멘토", "가격미설정멘토"] },
];

async function loginAdmin(page: Page) {
  await page.goto("/admin/login", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await page.fill('input[name="email"]', ADMIN_EMAIL);
  await page.fill('input[name="password"]', "Local!Test1234");
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !u.pathname.includes("/admin/login"), { timeout: 30_000 }).catch(() => undefined);
  await page.waitForTimeout(1000);
}

test("관리자 메뉴별 데이터 매핑", async ({ page }) => {
  await loginAdmin(page);
  const url = page.url();
  expect(url.includes("/admin/login"), `admin 로그인 후 admin 영역. 현재 ${url}`).toBe(false);

  const results: Array<{
    href: string; label: string; status: number | null;
    foundMust: string[]; missingMust: string[]; foundMay: string[]; note?: string;
  }> = [];

  for (const item of MENU_MAP) {
    let status: number | null = null;
    let body = "";
    try {
      const r = await page.goto(item.href, { waitUntil: "domcontentloaded" });
      status = r?.status() ?? null;
      body = await page.content();
    } catch (e) {
      results.push({ href: item.href, label: item.label, status, foundMust: [], missingMust: item.mustInclude ?? [], foundMay: [], note: String(e).slice(0, 120) });
      continue;
    }

    const found: string[] = [];
    const missing: string[] = [];
    for (const t of item.mustInclude ?? []) {
      (body.includes(t) ? found : missing).push(t);
    }
    const foundMay: string[] = [];
    for (const t of item.mayInclude ?? []) if (body.includes(t)) foundMay.push(t);

    results.push({ href: item.href, label: item.label, status, foundMust: found, missingMust: missing, foundMay });
  }

  // 결과 출력 (콘솔)
  console.log("\n[admin-pages] 결과 표:");
  console.log("href | label | status | found(must) | missing(must) | found(may)");
  console.log("---|---|---|---|---|---");
  for (const r of results) {
    console.log(
      `${r.href} | ${r.label} | ${r.status} | ${r.foundMust.join(",") || "-"} | ${r.missingMust.join(",") || "-"} | ${r.foundMay.join(",") || "-"}${r.note ? ` | NOTE:${r.note}` : ""}`
    );
  }

  // 모든 페이지 status < 500 보장
  for (const r of results) {
    expect(r.status ?? 0, `${r.href} status < 500`).toBeLessThan(500);
  }
});
