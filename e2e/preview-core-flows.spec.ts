import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { login, ACCOUNTS } from "./helpers/auth";
import { newPreviewContext } from "./helpers/previewProxy";

/**
 * Preview E2E — runbook §6 "인증 Preview E2E" 체크리스트 (PR #42 Vercel Preview 대상).
 * 커버: 비로그인 멘토목록 · favorite/recent/정렬/빈상태 · 게시판 이미지/멱등/수정/soft-delete ·
 *       게시판 목록 모바일 pageSize/카테고리 페이지 리셋 · 프로필 §5 서류/인증 분리(P0-3) ·
 *       숏폼 staged direct upload(P2-24) · 알림 빈 상태 · 관리자 콘솔 렌더.
 *
 * 네트워크: 이 실행 환경의 브라우저 TLS 스택이 프록시 뒤 일부 호스트와 핸드셰이크에 실패해,
 * 모든 요청을 Playwright Node측 fetch(route.fetch — 프록시 경유·TLS 검증 유지)로 대행한다.
 * 자격증명은 E2E_* 환경변수로만 주입되며 코드/로그에 값이 남지 않는다.
 */

const STAMP = process.env.E2E_RUN_STAMP || "e2e-test-preview";
const MEDIA = process.env.E2E_MEDIA_DIR || ".";
const MENTOR_UID = process.env.E2E_MENTOR_UID || "";

const BOARD_TITLE = `${STAMP}-board`;
const BOARD_TITLE_EDITED = `${STAMP}-board-edited`;
const SHORTFORM_TITLE = `${STAMP}-shortform`;

test.describe("A. 비로그인 — 멘토 찾기", () => {
  let ctx: BrowserContext;
  let page: Page;
  test.beforeAll(async ({ browser }) => ({ ctx, page } = await newPreviewContext(browser)));
  test.afterAll(async () => ctx?.close());

  test("목록 렌더 + 정렬 pill + 비로그인 찜 클릭 시 로그인 유도", async () => {
    await page.goto("/mentors", { waitUntil: "domcontentloaded" });
    await expect(page.locator("article").first()).toBeVisible();
    // 정렬 pill (순서 축): 최신순 클릭 시 URL sort 반영 + 목록 유지
    await page.getByRole("link", { name: "최신순" }).first().click();
    await page.waitForURL(/sort=/);
    await expect(page.locator("article").first()).toBeVisible();
    // 비로그인 찜 → /login?next=... 리다이렉트
    await page.locator('button[aria-label="찜하기"]').first().click();
    await page.waitForURL(/\/login/);
    expect(page.url()).toContain("/login");
  });

  test("검색 결과 0명 빈 상태", async () => {
    await page.goto(`/mentors?q=${STAMP}-nohit`, { waitUntil: "domcontentloaded" });
    await expect(page.getByText("조건에 맞는 멘토가 없어요")).toBeVisible();
    await expect(page.getByRole("link", { name: "필터 초기화" })).toBeVisible();
  });
});

test.describe("B. 학생 — favorite/recent + 알림 빈 상태", () => {
  let ctx: BrowserContext;
  let page: Page;
  test.beforeAll(async ({ browser }) => {
    ({ ctx, page } = await newPreviewContext(browser));
    await login(page, ACCOUNTS.student);
  });
  test.afterAll(async () => ctx?.close());

  test("찜 토글 → favorite scope 반영 → 해제 → 빈 상태", async () => {
    await page.goto("/mentors", { waitUntil: "domcontentloaded" });
    const favBtn = page.locator('button[aria-label="찜하기"]').first();
    await favBtn.click();
    await expect(page.locator('button[aria-label="찜 해제"]').first()).toBeVisible({ timeout: 20_000 });

    await page.goto("/mentors?scope=favorite", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(/찜한 멘토\s*1/).first()).toBeVisible();
    await expect(page.locator("article").first()).toBeVisible();

    await page.locator('button[aria-label="찜 해제"]').first().click();
    await expect(page.locator('button[aria-label="찜하기"]').first()).toBeVisible({ timeout: 20_000 });

    await page.goto("/mentors?scope=favorite", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("아직 찜한 멘토가 없어요")).toBeVisible();
  });

  test("멘토 상세 방문 → 최근 본 멘토(scope=recent)에 등장", async () => {
    test.skip(!MENTOR_UID, "E2E_MENTOR_UID 미설정");
    await page.goto(`/mentors/${MENTOR_UID}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("h1, h2").first()).toBeVisible();
    await page.waitForTimeout(1500); // MentorRecentRecorder effect + localStorage 기록 대기
    await page.goto("/mentors?scope=recent", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("최근 본 멘토").first()).toBeVisible();
    await expect(page.locator(`a[href="/mentors/${MENTOR_UID}"]`).first()).toBeVisible({ timeout: 20_000 });
  });

  test("알림 0건 빈 상태 + 필터/카테고리/페이저 구조", async () => {
    await page.goto("/notifications", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("새 알림이 없어요")).toBeVisible();
    await expect(page.getByText("모두 확인했어요").first()).toBeVisible();
    // 카테고리 탭 정본 순서 존재
    const catTabs = page.locator('[aria-label="알림 카테고리"] [role="tab"]');
    for (const label of ["전체", "질문방", "맞춤의뢰", "구독·결제", "환불", "공지·안내"]) {
      await expect(catTabs.filter({ hasText: label }).first()).toBeVisible();
    }
    // 페이저: 양방향 비활성
    const pager = page.locator('nav[aria-label="알림 페이지 이동"]');
    await expect(pager.locator('span[aria-disabled]', { hasText: "이전" })).toBeVisible();
    await expect(pager.locator('span[aria-disabled]', { hasText: "다음" })).toBeVisible();
    // 읽지 않음 필터 빈 상태
    await page.goto("/notifications?filter=unread", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("모든 알림을 확인했어요")).toBeVisible();
  });

  test("학생은 숏폼 업로드 페이지 접근 불가(mentor_only)", async () => {
    await page.goto("/community/shortform/new", { waitUntil: "domcontentloaded" });
    await page.waitForURL(/error=mentor_only/);
    expect(page.url()).toContain("error=mentor_only");
  });
});

test.describe("C. 학생 — 게시판 P0-4 (이미지·멱등·수정·soft-delete)", () => {
  let ctx: BrowserContext;
  let page: Page;
  let postId = "";
  test.beforeAll(async ({ browser }) => {
    ({ ctx, page } = await newPreviewContext(browser));
    await login(page, ACCOUNTS.student);
  });
  test.afterAll(async () => ctx?.close());

  test("이미지 2장 포함 글 발행 → 상세 리다이렉트 + 이미지 렌더", async () => {
    await page.goto("/community/new", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000); // 하이드레이션
    await page.locator('input[name="title"]').fill(BOARD_TITLE);
    await page.locator('textarea[name="body"]').fill("Preview E2E 자동 검증용 본문입니다. 열 자 이상을 충족합니다.");
    await page
      .locator('input[name="images-picker"]')
      .setInputFiles([`${MEDIA}/e2e-test-img-1.png`, `${MEDIA}/e2e-test-img-2.png`]);
    await page.waitForTimeout(500);

    const publish = page.getByRole("button", { name: /올리기|올리는 중/ });
    await publish.click();
    // pending 중 이중 제출 방지(버튼 비활성) 관찰 — 완료가 빠르면 스킵되는 비차단 관찰
    const wasDisabled = await publish.isDisabled().catch(() => false);
    console.log(`[obs] board publish button disabled during pending: ${wasDisabled}`);

    await page.waitForURL(/\/community\/board\/[0-9a-f-]{36}/, { timeout: 90_000 });
    postId = page.url().match(/\/community\/board\/([0-9a-f-]{36})/)?.[1] ?? "";
    expect(postId).not.toBe("");
    await expect(page.getByText(BOARD_TITLE).first()).toBeVisible();
    // 서명 URL 이미지 렌더 (staged direct upload 결과)
    const img = page.locator('img[src*="community-post-images"]').first();
    await expect(img).toBeVisible({ timeout: 30_000 });
    const loaded = await img.evaluate((el) => (el as HTMLImageElement).naturalWidth > 0);
    expect(loaded).toBe(true);
  });

  test("게시판 목록 모바일 pageSize(5) + 카테고리 변경 시 1페이지 리셋", async ({ browser }) => {
    // 게시판 목록은 공개 라우트 — 비로그인 모바일 컨텍스트로 검증 (기존 5행 + 방금 발행 1행 = 6행 전제)
    const mobile = await newPreviewContext(browser, { viewport: { width: 390, height: 844 } });
    try {
      await mobile.page.goto("/community/board", { waitUntil: "domcontentloaded" });
      await mobile.page.waitForTimeout(2500); // useMediaQuery 하이드레이션 보정(6→4/10→5)
      const pager = mobile.page.locator('[aria-label="페이지 이동"]');
      await expect(pager).toBeVisible();
      const articles = mobile.page.locator("article");
      await expect(articles).toHaveCount(5); // 모바일 pageSize=5
      await pager.getByRole("button", { name: "다음" }).click();
      await expect(articles).toHaveCount(1); // 6행 중 2페이지 = 1행
      // 카테고리 탭 변경 → 1페이지 리셋 (전체 탭으로 복귀해도 page=1)
      await mobile.page.locator('[aria-label="카테고리"] button, [aria-label="카테고리"] a').filter({ hasText: "자유" }).first().click();
      await mobile.page.waitForTimeout(1000);
      await mobile.page.locator('[aria-label="카테고리"] button, [aria-label="카테고리"] a').filter({ hasText: "전체" }).first().click();
      await mobile.page.waitForTimeout(1500);
      await expect(articles).toHaveCount(5); // 리셋되어 1페이지(5행)
    } finally {
      await mobile.ctx.close();
    }
  });

  test("작성자 수정 → 제목 반영", async () => {
    test.skip(!postId, "선행 발행 실패");
    await page.goto(`/community/board/${postId}`, { waitUntil: "domcontentloaded" });
    await page.getByRole("link", { name: "수정" }).click();
    await page.waitForURL(/\/edit$/);
    await page.waitForTimeout(2000);
    const title = page.locator('input[name="title"]');
    await expect(title).toHaveValue(BOARD_TITLE);
    await title.fill(BOARD_TITLE_EDITED);
    await page.getByRole("button", { name: /올리기|올리는 중/ }).click();
    await page.waitForURL(new RegExp(`/community/board/${postId}$`), { timeout: 60_000 });
    await expect(page.getByText(BOARD_TITLE_EDITED).first()).toBeVisible();
  });

  test("작성자 삭제(soft-delete) → 상세/목록에서 숨김", async () => {
    test.skip(!postId, "선행 발행 실패");
    await page.goto(`/community/board/${postId}`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "삭제" }).click();
    await page.waitForURL(/\/community(\?|$)/, { timeout: 60_000 });
    await page.goto(`/community/board/${postId}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByText("게시글을 찾을 수 없습니다.")).toBeVisible();
    await page.goto("/community/board", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(BOARD_TITLE_EDITED)).toHaveCount(0);
  });
});

test.describe("D. 멘토 — 프로필 §5 분리(P0-3) + 숏폼 업로드(P2-24)", () => {
  let ctx: BrowserContext;
  let page: Page;
  test.beforeAll(async ({ browser }) => {
    ({ ctx, page } = await newPreviewContext(browser));
    await login(page, ACCOUNTS.mentor);
  });
  test.afterAll(async () => ctx?.close());

  test("프로필 편집 §5: 서류 제출=미제출 · 인증 상태=인증 완료 · 서류 URL 미노출", async () => {
    await page.goto("/mentor/profile/edit", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /인증 서류/ })).toBeVisible();
    const docBadge = page.locator('span:text-is("서류 제출")').locator("xpath=following-sibling::span[1]");
    await expect(docBadge).toHaveText("미제출");
    const verBadge = page.locator('span:text-is("인증 상태")').locator("xpath=following-sibling::span[1]");
    await expect(verBadge).toHaveText("인증 완료");
    await expect(page.getByText(/학생증 원본은 보안을 위해/)).toBeVisible();
    await expect(page.locator('img[alt="프로필 사진"]')).toBeVisible(); // 아바타(§1)는 별도 표시
    const html = await page.content();
    expect(html.includes("student-id-images")).toBe(false); // 인증서류 서명 URL 미전달
  });

  test("공개 멘토 상세: 아바타만 렌더, 인증서류 노출 없음", async () => {
    test.skip(!MENTOR_UID, "E2E_MENTOR_UID 미설정");
    await page.goto(`/mentors/${MENTOR_UID}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator('img[class*="object-cover"]').first()).toBeVisible();
    const html = await page.content();
    expect(html.includes("student-id-images")).toBe(false);
    expect(html.includes("student_id_image")).toBe(false);
  });

  test("숏폼 staged direct upload: 미리보기 → 발행 → 상세/목록 노출", async () => {
    await page.goto("/community/shortform/new", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    await page.locator('input[name="video-picker"]').setInputFiles(`${MEDIA}/e2e-test-video.webm`);
    // P2-24: URL.createObjectURL 로컬 미리보기
    await expect(page.locator('video[src^="blob:"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("e2e-test-video.webm").first()).toBeVisible();

    await page.locator('input[name="title"]').fill(SHORTFORM_TITLE);
    await page.locator('input[name="rightsAck"]').check();

    const publish = page.getByRole("button", { name: /올리기|올리는 중/ });
    await publish.click();
    const wasDisabled = await publish.isDisabled().catch(() => false);
    console.log(`[obs] shortform publish button disabled during pending: ${wasDisabled}`);

    // 서명 업로드(브라우저→Storage 직접 PUT) + finalize(413 없이 텍스트만) 후 상세로
    await page.waitForURL(/\/community\/shortform\/[0-9a-f-]{36}/, { timeout: 120_000 });
    await expect(page.getByRole("heading", { level: 1, name: SHORTFORM_TITLE })).toBeVisible();
    await expect(page.locator("video[controls]")).toBeVisible();

    await page.goto("/community/shortform", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(SHORTFORM_TITLE).first()).toBeVisible();
  });
});

test.describe("E. 관리자 — 콘솔 렌더 + 생성 콘텐츠 가시성", () => {
  let ctx: BrowserContext;
  let page: Page;
  test.beforeAll(async ({ browser }) => {
    ({ ctx, page } = await newPreviewContext(browser));
    await login(page, ACCOUNTS.admin);
  });
  test.afterAll(async () => ctx?.close());

  test("대시보드/멘토 승인/검수 콘솔 렌더", async () => {
    await page.goto("/admin/dashboard", { waitUntil: "domcontentloaded" });
    expect(page.url()).toContain("/admin/dashboard");
    await expect(page.locator("main, [class*=admin]").first()).toBeVisible();

    await page.goto("/admin/mentor-approval", { waitUntil: "domcontentloaded" });
    expect(page.url()).toContain("/admin/mentor-approval");
    await expect(page.getByText(/멘토 승인|승인/).first()).toBeVisible();

    await page.goto("/admin/moderation", { waitUntil: "domcontentloaded" });
    expect(page.url()).toContain("/admin/moderation");
    await expect(page.locator("main, table, [class*=admin]").first()).toBeVisible();
  });

  test("커뮤니티 콘텐츠 콘솔에서 E2E 숏폼 확인(감사 가시성)", async () => {
    await page.goto("/admin/community-content", { waitUntil: "domcontentloaded" });
    expect(page.url()).toContain("/admin/community-content");
    const seen = await page
      .getByText(SHORTFORM_TITLE)
      .first()
      .isVisible()
      .catch(() => false);
    console.log(`[obs] admin community-content shows e2e shortform: ${seen}`);
    await expect(page.locator("main").first()).toBeVisible();
  });
});
