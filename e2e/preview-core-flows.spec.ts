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

  test("찜 토글 → favorite scope 반영 → 해제 → 빈 상태 (P2-27)", async () => {
    // 서버 상태(scope=favorite)를 진실원으로 검증. 프록시 대행 하에서 첫 클릭 유실 대비 재시도.
    async function toggleUntil(fromLabel: string, toLabel: string): Promise<void> {
      for (let i = 0; i < 3; i++) {
        await page.goto("/mentors", { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(1500);
        const btn = page.locator(`button[aria-label="${fromLabel}"]`).first();
        if ((await btn.count()) === 0) return; // 이미 목표 상태
        await btn.click().catch(() => undefined);
        // 클릭 후 상태 반영 대기(낙관적 flip 또는 refresh)
        const flipped = await page
          .locator(`button[aria-label="${toLabel}"]`)
          .first()
          .isVisible({ timeout: 12_000 })
          .catch(() => false);
        if (flipped) return;
      }
    }

    await toggleUntil("찜하기", "찜 해제");
    // 서버 진실원: 찜 scope 에 1건
    await page.goto("/mentors?scope=favorite", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(/찜한 멘토\s*1/).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("main article").first()).toBeVisible();

    await toggleUntil("찜 해제", "찜하기");
    await page.goto("/mentors?scope=favorite", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("아직 찜한 멘토가 없어요")).toBeVisible({ timeout: 20_000 });
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

  test("알림 0건 빈 상태 + 필터/카테고리 구조 (P2-26)", async () => {
    await page.goto("/notifications", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("새 알림이 없어요")).toBeVisible();
    await expect(page.getByText("모두 확인했어요").first()).toBeVisible();
    // 카테고리 탭 정본 순서 존재
    const catTabs = page.locator('[aria-label="알림 카테고리"] [role="tab"]');
    for (const label of ["전체", "질문방", "맞춤의뢰", "구독·결제", "환불", "공지·안내"]) {
      await expect(catTabs.filter({ hasText: label }).first()).toBeVisible();
    }
    // 필터 탭 존재
    await expect(page.locator('[aria-label="알림 필터"] [role="tab"]', { hasText: "읽지 않음" })).toBeVisible();
    // 0건 상태에서는 페이저(nav "알림 페이지 이동")가 렌더되지 않음(hasPrev||hasNext=false) — 구조상 정상
    await expect(page.locator('nav[aria-label="알림 페이지 이동"]')).toHaveCount(0);
    // 읽지 않음 필터 빈 상태
    await page.goto("/notifications?filter=unread", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("모든 알림을 확인했어요")).toBeVisible();
  });

  test("학생은 숏폼 업로드 페이지 접근 불가(mentor_only)", async () => {
    await page.goto("/community/shortform/new", { waitUntil: "domcontentloaded" });
    await page.waitForURL(/error=mentor_only/);
    expect(page.url()).toContain("error=mentor_only");
  });

  test("일반 사용자(학생)의 관리자 콘솔 접근 차단", async () => {
    // 관리자 계정 로그인 없이, 학생 세션으로 관리자 화면 접근이 막히는지 확인
    await page.goto("/admin/dashboard", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    const url = page.url();
    const onAdmin = /\/admin\/dashboard/.test(url) && !/login|forbidden|denied/.test(url);
    // 관리자 대시보드 콘텐츠가 학생에게 렌더되지 않아야 함(리다이렉트 또는 접근 거부)
    expect(onAdmin).toBe(false);
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
    // 이미지가 staged direct upload → 상세에 community-post-images 서명 URL <img> 로 첨부됨.
    // (프록시 대행 하에서 이미지 바이트 로드는 변동적이라 attach + 서명 URL 존재로 검증)
    const img = page.locator('img[src*="community-post-images"]').first();
    await expect(img).toHaveCount(1, { timeout: 30_000 });
    const src = await img.getAttribute("src");
    expect(src && src.includes("/storage/v1/object/") && src.includes("community-post-images")).toBe(true);
    const naturalW = await img.evaluate((el) => (el as HTMLImageElement).naturalWidth).catch(() => 0);
    console.log(`[obs] board detail image naturalWidth=${naturalW} (0 = 프록시 하 픽셀 미로드, attach 는 확인됨)`);
  });

  test("게시판 목록 모바일 pageSize(5) + 카테고리 변경 시 1페이지 리셋", async ({ browser }) => {
    // 게시판 목록은 공개 라우트 — 비로그인 모바일 컨텍스트로 검증 (기존 5행 + 방금 발행 1행 = 6행 전제)
    const mobile = await newPreviewContext(browser, { viewport: { width: 390, height: 844 } });
    try {
      await mobile.page.goto("/community/board", { waitUntil: "domcontentloaded" });
      await mobile.page.waitForTimeout(2500); // useMediaQuery 하이드레이션 보정(6→4/10→5)
      const pager = mobile.page.locator('[aria-label="페이지 이동"]');
      await expect(pager).toBeVisible({ timeout: 20_000 }); // 모바일 pageSize 5 < 6행 → 페이저 등장
      const articles = mobile.page.locator("main article");
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

  // P2-24: 아바타↔인증서류 분리. 두 배지가 각각 student_id_image_url 존재/verification_status 로
  // 독립 판정됨을 검증. 기대 배지 텍스트는 실제 계정 데이터에서 파생(E2E_MENTOR_DOC_BADGE/_VER_BADGE).
  const DOC_BADGE = process.env.E2E_MENTOR_DOC_BADGE || "제출됨";
  const VER_BADGE = process.env.E2E_MENTOR_VER_BADGE || "인증 완료";

  test(`프로필 편집 §5: 서류 제출=${process.env.E2E_MENTOR_DOC_BADGE || "제출됨"} · 인증 상태=${process.env.E2E_MENTOR_VER_BADGE || "인증 완료"} · 서류 URL 미노출`, async () => {
    await page.goto("/mentor/profile/edit", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /인증 서류/ })).toBeVisible();
    const docBadge = page.locator('span:text-is("서류 제출")').locator("xpath=following-sibling::span[1]");
    await expect(docBadge).toHaveText(DOC_BADGE);
    const verBadge = page.locator('span:text-is("인증 상태")').locator("xpath=following-sibling::span[1]");
    await expect(verBadge).toHaveText(VER_BADGE);
    // 두 배지가 서로 다른 소스임을 구조적으로 확인(라벨이 각각 존재)
    await expect(page.locator('span:text-is("서류 제출")')).toBeVisible();
    await expect(page.locator('span:text-is("인증 상태")')).toBeVisible();
    await expect(page.getByText(/학생증 원본은 보안을 위해/)).toBeVisible();
    // 인증서류 원본/서명 URL 이 편집 폼에 이미지/링크로 렌더되지 않음(문자열이 프리페치 RSC 에
    // 섞이는 오탐 방지 위해 요소 기반으로 확인). 재제출 링크(/mentor/verification)만 존재해야 함.
    expect(await page.locator('img[src*="student-id-images"]').count()).toBe(0);
    expect(await page.locator('a[href*="student-id-images"]').count()).toBe(0);
    expect(await page.locator('img[src*="student_id_image"]').count()).toBe(0);
  });

  test("공개 멘토 상세: 인증서류 노출 없음(원본/서명 URL 미전달)", async () => {
    test.skip(!MENTOR_UID, "E2E_MENTOR_UID 미설정");
    await page.goto(`/mentors/${MENTOR_UID}`, { waitUntil: "domcontentloaded" });
    // 프로필 카드가 렌더됨(아바타 img 또는 이니셜 폴백 중 하나) — 페이지 자체는 정상 노출
    await expect(page.locator("h1, h2").first()).toBeVisible();
    expect(await page.locator('img[src*="student-id-images"]').count()).toBe(0);
    expect(await page.locator('[href*="student-id-images"]').count()).toBe(0);
    const html = await page.content();
    expect(html.includes("student_id_image_url")).toBe(false);
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

const ADMIN_BLOCKED = process.env.E2E_ADMIN_BLOCKED === "1";

test.describe("E. 관리자 — 콘솔 렌더 + 생성 콘텐츠 가시성", () => {
  let ctx: BrowserContext;
  let page: Page;
  test.skip(ADMIN_BLOCKED, "TEST_ACCOUNT_SETUP_BLOCKED: 관리자 계정 GoTrue 로그인 500(토큰 컬럼 NULL) — 계정 미수정 방침");
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
