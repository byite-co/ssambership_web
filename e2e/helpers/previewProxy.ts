import type { Browser, BrowserContext, Page } from "@playwright/test";

/**
 * Preview E2E 네트워크 대행 헬퍼.
 *
 * 이 관리형 실행 환경은 모든 egress 가 TLS 재종단 프록시를 경유하는데, Chromium 의
 * TLS 핸드셰이크가 일부 호스트(vercel.app / supabase.co)에서 프록시에 의해 리셋된다
 * (curl/Node fetch 는 정상). 그래서 브라우저의 모든 요청을 Playwright Node측
 * APIRequestContext(route.fetch — 프록시 경유·TLS 검증 유지)로 대행한다.
 *
 * 리다이렉트 처리: 내비게이션 요청의 3xx 를 그대로 fulfill 하면 브라우저가 후속
 * 리다이렉트를 인터셉션 밖(직접 네트워크)에서 시도해 실패한다. 따라서 내비게이션
 * 3xx 는 JS location.replace 페이지로 변환해 새 내비게이션(역시 인터셉트됨)으로
 * 잇는다 — waitForURL 등 URL 의미론이 보존된다. 서브리소스(fetch/XHR)는 Node측에서
 * 리다이렉트를 따라간 최종 응답을 반환한다(브라우저 fetch 의 기본 follow 와 동일).
 */
export async function installPreviewRouting(ctx: BrowserContext): Promise<void> {
  await ctx.route("**/*", async (route) => {
    const req = route.request();
    try {
      if (req.isNavigationRequest()) {
        const resp = await route.fetch({ maxRedirects: 0 });
        const status = resp.status();
        const loc = resp.headers()["location"];
        if (status >= 300 && status < 400 && loc) {
          const target = new URL(loc, req.url()).toString();
          await route.fulfill({
            status: 200,
            contentType: "text/html; charset=utf-8",
            body: `<!doctype html><meta charset="utf-8"><script>location.replace(${JSON.stringify(target)})</script>`,
          });
          return;
        }
        await route.fulfill({ response: resp });
        return;
      }
      const resp = await route.fetch();
      await route.fulfill({ response: resp });
    } catch {
      await route.abort().catch(() => undefined);
    }
  });
}

/** Preview 컨텍스트 생성 + Vercel Deployment Protection 공유 링크 쿠키 부트스트랩. */
export async function newPreviewContext(
  browser: Browser,
  opts?: { viewport?: { width: number; height: number } }
): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({
    baseURL: process.env.E2E_PREVIEW_BASE_URL,
    viewport: opts?.viewport ?? { width: 1360, height: 900 },
    proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined,
  });
  await installPreviewRouting(ctx);
  const page = await ctx.newPage();
  const share = process.env.E2E_PREVIEW_SHARE_URL;
  if (share) {
    await page.goto(share, { waitUntil: "domcontentloaded" });
    // 공유 링크 302 → JS 리다이렉트 체인이 끝날 때까지 대기
    await page
      .waitForURL((u) => !u.href.includes("_vercel_share"), { timeout: 30_000 })
      .catch(() => undefined);
    await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  }
  return { ctx, page };
}
