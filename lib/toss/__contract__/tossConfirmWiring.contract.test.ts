import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
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

test("webhook: 기존 계약 유지 — confirm 코어 미편입·DONE 게이트·record 정본·Cookie/SITE_URL 0", () => {
  const webhook = read("app/api/toss/webhook/route.ts");
  assert.ok(!webhook.includes("confirmCashTopupForCurrentUser"), "webhook 이 인증 세션 confirm 코어에 편입됨");
  assert.ok(webhook.includes("verifyTossWebhookSignature"), "서명 검증 자체가 사라짐");
  assert.ok(webhook.includes('"DONE"') || webhook.includes("'DONE'"), "DONE 게이트가 사라짐");
  assert.ok(webhook.includes("recordCashTopupFromTossOrder"), "원장 멱등 정본 호출이 사라짐");
  assert.ok(!webhook.includes("NEXT_PUBLIC_SITE_URL"), "webhook 에 SITE_URL 의존이 생김");
  assert.ok(!webhook.includes("cookies()") && !webhook.includes("Cookie:"), "webhook 에 사용자 Cookie 의존이 생김");
});

test("webhook 서명 정책: 헤더가 있을 때만 검증한다(Toss 공식 — 결제 이벤트엔 서명이 없다)", () => {
  // 정본: docs.tosspayments.com/reference/using-api/webhook-events
  //   "tosspayments-webhook-signature 는 payout.changed 와 seller.changed 웹훅 헤더에만 포함됩니다."
  // 서명을 무조건 요구하면 PAYMENT_STATUS_CHANGED 는 구조적으로 항상 401 이 되어
  // 이 라우트가 영영 결제를 처리하지 못한다(회귀 시 이 테스트가 먼저 깨진다).
  const webhook = read("app/api/toss/webhook/route.ts");

  // 검증은 조건부여야 한다 — `if (signature)` 안에서만 호출된다.
  const guardIdx = webhook.indexOf("if (signature)");
  const verifyIdx = webhook.indexOf("verifyTossWebhookSignature(rawBody");
  assert.ok(guardIdx > 0, "서명 존재 여부 분기가 없다 — 무조건 검증으로 되돌아갔다");
  assert.ok(verifyIdx > guardIdx, "서명 검증이 존재 분기 밖에서 호출된다(무조건 401 회귀)");

  // 서명이 없다고 401 로 끊으면 안 된다: 401 은 '헤더가 있는데 틀린' 경우 뿐이다.
  assert.ok(
    webhook.includes("invalid signature (header present)"),
    "401 사유가 '헤더 존재 + 불일치'로 좁혀져 있지 않다",
  );

  // 서명이 없는 이벤트의 실제 보안 근거 — 적립 전 Toss 재조회 정본 대조가 남아 있어야 한다.
  assert.ok(
    webhook.includes("verifyWebhookPaymentWithToss"),
    "재조회 정본 대조가 사라졌다 — 서명이 없는 경로에서 페이로드만 믿게 된다",
  );
  // 재조회는 적립(record) 보다 반드시 앞이다.
  const lookupIdx = webhook.indexOf("await verifyWebhookPaymentWithToss");
  const recordIdx = webhook.indexOf("await recordCashTopupFromTossOrder");
  assert.ok(lookupIdx > 0 && recordIdx > 0, "재조회·적립 호출을 찾지 못했다");
  assert.ok(lookupIdx < recordIdx, "적립이 재조회보다 앞선다 — 페이로드만으로 돈이 움직인다");
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

test("Phase 0 토스 게이트: allowlist 배선 — 서버 래퍼·webhook·UI 미렌더", () => {
  const gate = read("lib/payments/tossGate.ts");
  assert.ok(gate.includes("TOSS_REVIEW_ALLOWED_USER_IDS"), "게이트가 env allowlist 를 읽지 않음");
  assert.ok(!gate.includes("NEXT_PUBLIC_"), "allowlist env 가 클라이언트로 승격됨");

  const core = read("lib/toss/tossTopupCore.ts");
  assert.ok(core.includes("toss_not_allowed"), "코어에 게이트 오류 코드가 없음");
  assert.ok(core.includes("isTossAllowedUser"), "코어 포트에 게이트가 없음");

  // confirm(성공 page·라우트 공용)·원장(웹훅 공용) 서버 래퍼 둘 다 게이트를 배선한다.
  const server = read("lib/toss/confirmCashTopupServer.ts");
  assert.ok(server.includes("isTossAllowedUser"), "confirm 서버 래퍼에 게이트 배선이 없음");
  const lib = read("lib/toss/cashTopupFromPayment.ts");
  assert.ok(lib.includes("isTossAllowedUser"), "원장 래퍼(웹훅 공용)에 게이트 배선이 없음");
  // webhook 은 Toss 재조회 전에 조기 게이트로 외부 호출도 차단한다 — 존재만이 아니라
  // '재조회 호출부보다 앞'이라는 순서를 고정한다(뒤로 옮기면 외부 호출 0회 불변식이
  // 조용히 퇴행한다). 함수 정의부가 아닌 await 호출부를 앵커로 쓴다.
  const webhook = read("app/api/toss/webhook/route.ts");
  const gateAt = webhook.indexOf("isTossAllowedUser(");
  const refetchAt = webhook.indexOf("await verifyWebhookPaymentWithToss(");
  assert.ok(gateAt >= 0, "webhook 조기 게이트가 없음");
  assert.ok(refetchAt >= 0, "webhook 의 Toss 재조회 호출부가 사라짐");
  assert.ok(gateAt < refetchAt, "조기 게이트가 Toss 재조회 뒤로 밀림(비허용 유저 외부 호출 발생)");

  // UI: 판정은 서버(page)에서 하고, 클라이언트 위젯은 boolean(tossEnabled)만 받는다.
  const page = read("app/(student)/wallet/charge/page.tsx");
  assert.ok(page.includes("isTossAllowedUser"), "charge page 가 게이트를 판정하지 않음");
  assert.ok(page.includes("tossEnabled"), "charge page 가 tossEnabled 를 내려보내지 않음");
  const view = read("components/cash/WalletChargePageView.tsx");
  assert.ok(view.includes("tossEnabled"), "PageView 가 tossEnabled 를 전달하지 않음");
  const widget = read("components/cash/CashChargeWidget.tsx");
  assert.ok(widget.includes("tossEnabled"), "위젯이 tossEnabled 를 받지 않음");
  assert.ok(!widget.includes("TOSS_REVIEW_ALLOWED_USER_IDS"), "클라이언트 위젯이 서버 env 를 직접 읽음");
  // 게이트 고정 문구는 CONFIRM_ERROR_MESSAGES 단일 소스만 쓴다(리터럴 복제 드리프트 금지).
  assert.ok(
    widget.includes("CONFIRM_ERROR_MESSAGES.toss_not_allowed"),
    "위젯이 게이트 문구를 CONFIRM_ERROR_MESSAGES 에서 가져오지 않음",
  );
  assert.ok(
    !widget.includes("현재 계정에서는 카드 결제를"),
    "위젯에 게이트 문구 리터럴 사본이 있음(단일 소스 위반)",
  );

  // tossGate(서버 env 리더)는 클라이언트 컴포넌트에서 import 금지 — node --test 순수성
  // 제약으로 server-only 를 붙일 수 없으므로 이 tripwire 가 기계적 가드다.
  const clientImporters: string[] = [];
  for (const dir of ["app", "components", "hooks", "lib"]) {
    for (const rel of readdirSync(join(ROOT, dir), { recursive: true }) as string[]) {
      if (!/\.(ts|tsx)$/.test(rel)) continue;
      const src = read(join(dir, rel));
      if (/^\s*["']use client["']/.test(src) && src.includes("payments/tossGate")) {
        clientImporters.push(join(dir, rel));
      }
    }
  }
  assert.deepEqual(clientImporters, [], "클라이언트 컴포넌트가 tossGate(서버 env 리더)를 import 함");
});

test("W3(C7): 운영 Toss 원장은 F11 record_cash_topup_v2 — 레거시 직접 호출·사전 SELECT 0", () => {
  const lib = read("lib/toss/cashTopupFromPayment.ts");
  assert.ok(lib.includes('"record_cash_topup_v2"'), "F11 record_cash_topup_v2 호출이 없음");
  assert.ok(lib.includes("callApiWebV1Rpc"), "공용 envelope helper 미사용(임의 parser 중복 금지 — W3 §9)");
  assert.ok(lib.includes("p_order_ref"), "p_order_ref 인자가 없음(orderId 원문 = 멱등키)");
  assert.ok(!lib.includes('rpc("record_cash_topup"'), "레거시 record_cash_topup 직접 호출이 부활함");
  assert.ok(!lib.includes("ref_id:"), "ref_id 전달이 생김(주문 정본 참조는 idempotency_key — rev 8 A-6)");
  assert.ok(!lib.includes('from("cash_ledger")'), "cash_ledger 사전 SELECT(신규/duplicate 추정)가 부활함");
  assert.ok(!lib.includes("hasCashTopupForOrderId"), "사전 SELECT helper 가 부활함");
  // 테스트 충전은 의도적으로 레거시 유지(rev 8 A-6 정정 2) — F11 로 바꾸면 계약 위반.
  const wallet = read("lib/cash/walletTopupActions.ts");
  assert.ok(wallet.includes('rpc("record_cash_topup"'), "테스트 충전의 레거시 record_cash_topup 이 사라짐");
  assert.ok(!wallet.includes("record_cash_topup_v2"), "테스트 충전이 F11 로 전환됨(금지 — W3 §4.3)");
  assert.ok(wallet.includes("cash_topup_"), "테스트 충전 키 형식(cash_topup_...)이 변경됨");
});
