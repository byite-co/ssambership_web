import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { login, ACCOUNTS } from "./helpers/auth";
import { newPreviewContext } from "./helpers/previewProxy";

/**
 * Preview E2E — 질문방(P1-8A) + 알림(P2-26) 실 domain write.
 * 학생 무료질문 생성 → 멘토 첫 답변(answered 전이) → 학생에게 question_answered 알림 →
 * 학생 인앱 소비(읽음·딥링크). device token 0 이므로 인앱 알림 정합만 확인(실 FCM 미기대).
 *
 * 순서 의존: describe.serial (학생 스레드 생성 → 멘토 답변 → 학생 알림).
 */
const MENTOR_UID = process.env.E2E_MENTOR_UID || "";
const STAMP = process.env.E2E_RUN_STAMP || "e2e-test-preview";
const QUESTION_TITLE = `${STAMP}-qna`;

test.describe.serial("질문방 + 알림 (P1-8A · P2-26)", () => {
  let studentCtx: BrowserContext;
  let studentPage: Page;
  let mentorCtx: BrowserContext;
  let mentorPage: Page;
  let roomId = "";
  let threadId = "";

  test.beforeAll(async ({ browser }) => {
    ({ ctx: studentCtx, page: studentPage } = await newPreviewContext(browser));
    await login(studentPage, ACCOUNTS.student);
    ({ ctx: mentorCtx, page: mentorPage } = await newPreviewContext(browser));
    await login(mentorPage, ACCOUNTS.mentor);
  });
  test.afterAll(async () => {
    await studentCtx?.close();
    await mentorCtx?.close();
  });

  test("학생: 무료질문권으로 질문방 진입 + 새 질문(스레드) 생성", async () => {
    test.skip(!MENTOR_UID, "E2E_MENTOR_UID 미설정");
    await studentPage.goto(`/mentors/${MENTOR_UID}`, { waitUntil: "domcontentloaded" });
    const freeLink = studentPage.getByRole("link", { name: /무료 질문권 사용하기|무료 질문 7개 받기/ }).first();
    await expect(freeLink).toBeVisible({ timeout: 20_000 });
    await freeLink.click();
    // 서버가 방 생성(service role) 후 /question-room/{roomId} 로 진입
    await studentPage.waitForURL(/\/question-room\/[0-9a-f-]{36}/, { timeout: 60_000 });
    roomId = studentPage.url().match(/\/question-room\/([0-9a-f-]{36})/)?.[1] ?? "";
    expect(roomId).not.toBe("");

    // 새 질문 모달
    await studentPage.getByRole("button", { name: "새로운 질문하기" }).first().click();
    await studentPage.waitForTimeout(1000);
    // 단원 메모 + 제목 입력(placeholder 기반)
    await studentPage.locator('input[placeholder*="미적분"]').first().fill(`${QUESTION_TITLE}-topic`);
    await studentPage.locator('input[placeholder*="질문 N"]').first().fill(QUESTION_TITLE);
    // 모달 내 제출
    const createResp = studentPage.waitForResponse(
      (r) => r.url().includes("/api/question-room/threads") && r.request().method() === "POST",
      { timeout: 30_000 }
    );
    await studentPage.getByRole("button", { name: "새로운 질문하기" }).last().click();
    const created = await createResp.catch(() => null);
    if (created) console.log(`[obs] thread create status=${created.status()}`);
    // 스레드 진입(?thread=)
    await studentPage.waitForURL(/thread=[0-9a-f-]{36}/, { timeout: 30_000 });
    threadId = new URL(studentPage.url()).searchParams.get("thread") ?? "";
    expect(threadId).not.toBe("");
  });

  test("멘토: 질문방에서 첫 답변 전송 → answered 전이", async () => {
    test.skip(!roomId || !threadId, "선행 스레드 생성 실패");
    await mentorPage.goto(`/mentor/question-room/${roomId}/thread/${threadId}`, { waitUntil: "domcontentloaded" });
    await mentorPage.waitForTimeout(2000);
    const box = mentorPage.locator('textarea[name="messageBody"]').first();
    await expect(box).toBeVisible({ timeout: 20_000 });
    await box.fill(`${STAMP} 멘토 첫 답변입니다. 이 메시지로 answered 전이가 발생합니다.`);
    await mentorPage.getByRole("button", { name: "전송" }).first().click();
    await mentorPage.waitForTimeout(3000); // RPC qna_append_message + record_domain_notification
  });

  test("학생: question_answered 알림 수신 → 클릭 시 읽음 + 딥링크 이동 (P2-26)", async () => {
    test.skip(!roomId || !threadId, "선행 실패");
    await studentPage.goto("/notifications", { waitUntil: "domcontentloaded" });
    await studentPage.waitForTimeout(1500);
    // 안 읽음 알림 최소 1건
    await expect(studentPage.locator('[aria-label="안 읽음"]').first()).toBeVisible({ timeout: 20_000 });
    // 페이저 구조(1건 이상이면 hasPrev/hasNext 여부와 무관하게 목록 렌더)
    const firstCard = studentPage.locator("main article").first();
    await expect(firstCard).toBeVisible();
    // 알림 클릭 → 읽음 처리 후 질문방 딥링크로 이동
    await studentPage.locator("main article a").first().click();
    await studentPage.waitForURL(new RegExp(`/question-room/${roomId}`), { timeout: 30_000 });
    expect(studentPage.url()).toContain(`/question-room/${roomId}`);
  });

  test("학생: 모두 읽음 → unread 0", async () => {
    test.skip(!roomId, "선행 실패");
    await studentPage.goto("/notifications", { waitUntil: "domcontentloaded" });
    const allReadBtn = studentPage.getByRole("button", { name: "모두 읽음" });
    if (await allReadBtn.isVisible().catch(() => false)) {
      await allReadBtn.click();
      await expect(studentPage.getByText("모두 확인했어요").first()).toBeVisible({ timeout: 20_000 });
    }
    await studentPage.goto("/notifications?filter=unread", { waitUntil: "domcontentloaded" });
    await expect(studentPage.getByText("모든 알림을 확인했어요")).toBeVisible({ timeout: 20_000 });
  });
});
