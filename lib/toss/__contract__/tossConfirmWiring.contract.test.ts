import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Toss 성공 경로 배선 회귀 방지(소스 스캔 tripwire — 판정 로직 자체는
// tossTopupCore.contract.test.ts 가 실제 반환값으로 검증한다).

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

test("success page: localhost self-fetch 제거 — 코어 직접 호출", () => {
  const page = read("app/(student)/wallet/charge/success/page.tsx");
  assert.ok(!page.includes("NEXT_PUBLIC_SITE_URL"), "NEXT_PUBLIC_SITE_URL 의존이 부활함");
  assert.ok(!page.includes("localhost"), "localhost 폴백이 부활함");
  assert.ok(!page.includes("/api/toss/confirm"), "자기 API self-fetch 가 부활함");
  assert.ok(!page.includes("Cookie"), "Cookie 문자열 재전달이 부활함");
  assert.ok(!page.includes('from "next/headers"'), "headers() Cookie 재전달 경로가 부활함");
  assert.ok(page.includes("confirmCashTopupForCurrentUser"), "공용 서버 코어 미사용");
});

test("confirm 라우트: page 와 같은 서버 코어 사용 + 직접 Toss fetch 제거 + revalidate 유지", () => {
  const route = read("app/api/toss/confirm/route.ts");
  assert.ok(route.includes("confirmCashTopupForCurrentUser"), "라우트가 공용 코어 미사용");
  assert.ok(!route.includes("api.tosspayments.com"), "라우트에 Toss 직접 fetch 잔존(코어 밖 이중 경로)");
  assert.ok(route.includes('revalidatePath("/wallet")'), "성공 revalidate 계약이 사라짐");
});

test("webhook: 기존 계약 유지 — confirm 코어 미편입·서명/DONE 게이트·record 정본·Cookie/SITE_URL 0", () => {
  const webhook = read("app/api/toss/webhook/route.ts");
  assert.ok(!webhook.includes("confirmCashTopupForCurrentUser"), "webhook 이 인증 세션 confirm 코어에 편입됨");
  assert.ok(webhook.includes("verifyTossWebhookSignature"), "서명 검증이 사라짐");
  assert.ok(webhook.includes('"DONE"') || webhook.includes("'DONE'"), "DONE 게이트가 사라짐");
  assert.ok(webhook.includes("recordCashTopupFromTossOrder"), "원장 멱등 정본 호출이 사라짐");
  assert.ok(!webhook.includes("NEXT_PUBLIC_SITE_URL"), "webhook 에 SITE_URL 의존이 생김");
  assert.ok(!webhook.includes("cookies()") && !webhook.includes("Cookie:"), "webhook 에 사용자 Cookie 의존이 생김");
});

test("원장 정본 배선: recordCashTopupFromTossOrder 가 순수 코어에 위임(판정 이중화 금지)", () => {
  const lib = read("lib/toss/cashTopupFromPayment.ts");
  assert.ok(lib.includes("recordCashTopupCore"), "원장 판정이 코어 밖에서 이중화됨");
  assert.ok(lib.includes("recoverPastDue:"), "past_due 복구 포트 배선이 사라짐");
  const core = read("lib/toss/tossTopupCore.ts");
  // orderId 파싱 정본 regex 는 코어 단일 소스(라우트·lib 재정의 금지).
  const regex = "/^cash-(.+)-(\\d+)$/";
  assert.ok(core.includes(regex), "코어의 orderId regex 가 변경됨");
  assert.ok(!lib.includes(regex), "lib 에 orderId regex 사본이 부활함");
});
