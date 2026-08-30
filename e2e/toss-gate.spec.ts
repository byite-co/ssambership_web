import { expect, test, type Page } from "@playwright/test";
import { ACCOUNTS, login } from "./helpers/auth";
import { CONFIRM_ERROR_MESSAGES } from "../lib/toss/tossTopupCore";

/**
 * 토스 게이트(Phase 0) E2E — /wallet/charge 카드 수단 노출.
 *
 * 두 시나리오는 서버 env(TOSS_REVIEW_ALLOWED_USER_IDS)가 달라야 하므로 러너
 * (scripts/e2e/runTossGateE2e.ts → npm run test:e2e:toss-gate)가 시나리오별로
 * 전용 포트(3210)에 새 서버를 띄워 순차 실행한다(설정: playwright.toss-gate.config.ts).
 * TOSS_GATE_E2E_SCENARIO 없이 직접 실행하면(기본 E2E 스위트 포함) 전부 skip 된다.
 */
const SCENARIO = process.env.TOSS_GATE_E2E_SCENARIO ?? "";
const RUNNER_HINT = "npm run test:e2e:toss-gate 러너로 실행하세요(시나리오별 서버 env 필요).";

// 사용자 노출 문구 단일 소스(CONFIRM_ERROR_MESSAGES) — 문구가 코어에서 바뀌면
// 이 스펙은 자동으로 새 문구를 따라간다(사본 하드코딩 금지).
const GATE_MESSAGE = CONFIRM_ERROR_MESSAGES.toss_not_allowed;

async function openChargePage(page: Page): Promise<void> {
  await login(page, ACCOUNTS.student);
  await page.goto("/wallet/charge", { waitUntil: "domcontentloaded" });
  // 위젯 렌더 완료 대기 — 결제 수단 섹션이 떠야 카드 버튼 부재/존재를 단언할 수 있다.
  await expect(page.getByRole("heading", { name: "결제 수단" })).toBeVisible();
}

test.describe("토스 게이트 — /wallet/charge 카드 수단 노출", () => {
  test("시나리오 A(차단): allowlist 빈 값 → 카드 수단 미렌더 + 단일 소스 안내 문구", async ({ page }) => {
    test.skip(SCENARIO !== "blocked", RUNNER_HINT);

    await openChargePage(page);

    // 카드 결제수단이 DOM 에 아예 없다(숨김 아님, 미렌더). — 게이트의 본질 불변식.
    await expect(page.getByRole("button", { name: "신용/체크카드" })).toHaveCount(0);
    // 안내 문구는 CONFIRM_ERROR_MESSAGES.toss_not_allowed 원문 그대로다.
    await expect(page.getByText(GATE_MESSAGE, { exact: true })).toBeVisible();

    // Phase 3 이후: 비허용 계정에도 **무통장입금**이라는 대체 수단이 열린다.
    // 그래서 "충전 버튼이 비활성"은 더 이상 게이트의 불변식이 아니다(구 단언 폐기 —
    // 그건 무통장입금이 '준비 중'이던 시절의 부수적 사실이었다).
    // 대신 게이트가 지켜야 할 것을 더 정확히 단언한다:
    //   ① 카드 경로가 어떤 형태로도 노출되지 않는다
    //   ② 대체 수단(무통장입금)이 기본 선택되어 사용자가 막히지 않는다
    await expect(page.getByRole("button", { name: "무통장입금" })).toBeVisible();
    await expect(page.getByLabel("입금자명")).toBeVisible();
    // 카드 관련 표면이 DOM 전체에 없다(라벨·배지 어느 형태로도).
    await expect(page.getByText("신용/체크카드", { exact: true })).toHaveCount(0);
  });

  test("시나리오 B(허용): allowlist 등재 계정 → 카드 수단 렌더 + 안내 문구 없음", async ({ page }) => {
    test.skip(SCENARIO !== "allowed", RUNNER_HINT);

    await openChargePage(page);

    await expect(page.getByRole("button", { name: "신용/체크카드" })).toBeVisible();
    await expect(page.getByText(GATE_MESSAGE, { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "캐시 충전하기" })).toBeEnabled();
  });
});
