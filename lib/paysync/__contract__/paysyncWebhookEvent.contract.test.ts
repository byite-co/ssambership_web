// 페이싱크 웹훅 이벤트 파싱·적립 판정 계약 (Phase 1):
//   * 정본 https://docs.paysync.kr/api-reference/webhooks/invoice-paid.md 의 실제 페이로드
//     (리소스 키 `invoice`)를 그대로 처리한다.
//   * 적립은 기본 닫힘 — metadata.userId · ivc_ 접두사 · 패키지 allowlist 를 모두 통과해야 한다.
//   * 거부는 사유 코드로 구분된다(수신 로그로 원인 판별).
// 실행: node --test --experimental-strip-types lib/paysync/__contract__/paysyncWebhookEvent.contract.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import {
  decidePaysyncTopup,
  isKnownPaysyncTrigger,
  parsePaysyncWebhookEvent,
  PAYSYNC_PAID_TRIGGERS,
} from "../paysyncWebhookEvent.ts";
import { cashKrwForPayKrw, isAllowedChargePayKrw } from "../../cash/chargePackages.ts";

const PORTS = { isAllowedPayKrw: isAllowedChargePayKrw, cashKrwForPayKrw };
const USER = "8f14e45f-ceea-4a67-8f2b-1a2b3c4d5e6f";

/** 문서 §페이로드 예시와 같은 형태(금액만 우리 패키지로). */
function paidPayload(over: Record<string, unknown> = {}, invoiceOver: Record<string, unknown> = {}) {
  return {
    type: "invoice.paid",
    invoice: {
      id: "ivc_a1b2c3d4e5f6g7h8i9j0k1l2",
      issuerId: "acc_x9y8z7w6v5u4t3s2r1q0p9o8",
      bankAccountIds: [],
      customer: { name: "홍길동", email: "hong@example.com", phoneNumber: "01012345678" },
      cashReceipt: null,
      amount: 30_000,
      paid: true,
      metadata: { userId: USER, ref: "topup-1" },
      issuedAt: "2026-08-30T03:14:15.926Z",
      expiresAt: "2026-08-31T03:14:15.926Z",
      ...invoiceOver,
    },
    trigger: "AUTOMATIC_MATCHING",
    ...over,
  };
}

test("파싱: 문서 예시 페이로드에서 id·금액·metadata.userId·trigger 를 뽑는다", () => {
  const e = parsePaysyncWebhookEvent(paidPayload());
  assert.equal(e.type, "invoice.paid");
  assert.equal(e.trigger, "AUTOMATIC_MATCHING");
  assert.equal(e.invoice?.id, "ivc_a1b2c3d4e5f6g7h8i9j0k1l2");
  assert.equal(e.invoice?.amountWon, 30_000);
  assert.equal(e.invoice?.paid, true);
  assert.equal(e.invoice?.userId, USER);
  assert.equal(e.invoice?.customerName, "홍길동");
});

test("파싱: 형태가 깨져도 throw 하지 않고 null 필드로 돌려준다", () => {
  for (const raw of [null, undefined, 0, "", "str", [], { type: 1 }]) {
    assert.doesNotThrow(() => parsePaysyncWebhookEvent(raw));
  }
  assert.deepEqual(parsePaysyncWebhookEvent(null), { type: null, invoice: null, trigger: null });
  assert.equal(parsePaysyncWebhookEvent({ type: "invoice.paid" }).invoice, null);
});

test("정상 적립 판정: 허용 패키지 금액이면 지급 캐시까지 계산한다", () => {
  const d = decidePaysyncTopup(parsePaysyncWebhookEvent(paidPayload()), PORTS);
  assert.equal(d.ok, true);
  if (d.ok) {
    assert.equal(d.invoiceId, "ivc_a1b2c3d4e5f6g7h8i9j0k1l2");
    assert.equal(d.userId, USER);
    assert.equal(d.payAmountWon, 30_000);
    assert.equal(d.cashKrw, 30_000);
    assert.equal(d.trigger, "AUTOMATIC_MATCHING");
  }
});

test("보너스 패키지는 지급 캐시가 결제 금액보다 크다(정본 chargePackages 위임)", () => {
  const d = decidePaysyncTopup(parsePaysyncWebhookEvent(paidPayload({}, { amount: 200_000 })), PORTS);
  assert.equal(d.ok, true);
  if (d.ok) assert.equal(d.cashKrw, 206_000);
});

test("invoice.paid 가 아닌 이벤트는 처리하지 않는다(모르는 type 포함)", () => {
  for (const type of ["invoice.created", "invoice.deleted", "invoice.future_event", "", null]) {
    const d = decidePaysyncTopup(parsePaysyncWebhookEvent(paidPayload({ type })), PORTS);
    assert.deepEqual(d, { ok: false, skip: "not_invoice_paid" }, `type=${type}`);
  }
});

test("기본 닫힘: 우리 주문이 아니면 적립하지 않는다", () => {
  const cases: Array<[Record<string, unknown>, string]> = [
    // metadata 자체가 없음 — 대시보드에서 수기 발행된 주문
    [{ metadata: null }, "user_id_missing"],
    [{ metadata: { orderId: "ORDER-1" } }, "user_id_missing"],
    [{ metadata: { userId: "   " } }, "user_id_missing"],
    // 주문 ID 접두사가 다름
    [{ id: "abc" }, "invoice_id_invalid"],
    [{ id: "" }, "invoice_id_invalid"],
    [{ id: null }, "invoice_id_invalid"],
    // paid 플래그 위조 방지
    [{ paid: false }, "not_paid"],
    [{ paid: "true" }, "not_paid"],
  ];
  for (const [invoiceOver, skip] of cases) {
    const d = decidePaysyncTopup(parsePaysyncWebhookEvent(paidPayload({}, invoiceOver)), PORTS);
    assert.deepEqual(d, { ok: false, skip }, JSON.stringify(invoiceOver));
  }
});

test("invoice 객체가 없으면 invoice_missing", () => {
  const d = decidePaysyncTopup(parsePaysyncWebhookEvent({ type: "invoice.paid" }), PORTS);
  assert.deepEqual(d, { ok: false, skip: "invoice_missing" });
});

test("금액: 패키지 allowlist 밖이면 적립하지 않는다", () => {
  // 1,000원 실입금 스모크 테스트는 서명·수신까지만 검증된다 — 최소 패키지가 30,000원이라
  // 적립 단계는 amount_not_allowed 로 닫힌다. (이 계약이 바뀌면 테스트가 먼저 깨진다.)
  for (const amount of [1_000, 29_999, 30_001, 500_000]) {
    const d = decidePaysyncTopup(parsePaysyncWebhookEvent(paidPayload({}, { amount })), PORTS);
    assert.deepEqual(d, { ok: false, skip: "amount_not_allowed" }, `amount=${amount}`);
  }
});

test("금액: 정수 양수가 아니면 amount_invalid", () => {
  for (const amount of [0, -30_000, 30_000.5, "30000", null, undefined]) {
    const d = decidePaysyncTopup(parsePaysyncWebhookEvent(paidPayload({}, { amount })), PORTS);
    assert.deepEqual(d, { ok: false, skip: "amount_invalid" }, `amount=${String(amount)}`);
  }
});

test("판정 순서: 금액이 틀려도 우리 주문이 아니면 신원 사유가 먼저 보고된다", () => {
  const d = decidePaysyncTopup(
    parsePaysyncWebhookEvent(paidPayload({}, { metadata: null, amount: 1_000 })),
    PORTS,
  );
  assert.deepEqual(d, { ok: false, skip: "user_id_missing" });
});

test("trigger 는 분기하지 않고 감사용으로만 보존한다(문서 4종 + 미지값)", () => {
  assert.deepEqual([...PAYSYNC_PAID_TRIGGERS], [
    "AUTOMATIC_MATCHING",
    "MANUAL_MATCHING",
    "MANUAL_APPROVE",
    "API_CALL",
  ]);
  for (const trigger of PAYSYNC_PAID_TRIGGERS) {
    assert.equal(isKnownPaysyncTrigger(trigger), true);
    const d = decidePaysyncTopup(parsePaysyncWebhookEvent(paidPayload({ trigger })), PORTS);
    assert.equal(d.ok, true, `trigger=${trigger} 는 적립 판정을 막지 않는다`);
  }
  // 킥오프 문서 §3 가 적은 BANK_TRANSACTION·MARK_AS_PAID 는 문서에 없는 값이다 —
  // 미지 trigger 로 취급하되 적립은 막지 않는다.
  for (const trigger of ["BANK_TRANSACTION", "MARK_AS_PAID", "", null]) {
    assert.equal(isKnownPaysyncTrigger(trigger), false, `trigger=${String(trigger)}`);
  }
  const unknown = decidePaysyncTopup(parsePaysyncWebhookEvent(paidPayload({ trigger: "BANK_TRANSACTION" })), PORTS);
  assert.equal(unknown.ok, true);
});

test("킥오프 문서의 `data.metadata` 표기는 실제 페이로드와 다르다(회귀 방지)", () => {
  // 리소스 키는 `invoice` 다. `data` 로 보낸 페이로드는 우리 주문으로 인정되지 않는다.
  const wrongShape = { type: "invoice.paid", data: { id: "ivc_x", amount: 30_000, paid: true, metadata: { userId: USER } } };
  const d = decidePaysyncTopup(parsePaysyncWebhookEvent(wrongShape), PORTS);
  assert.deepEqual(d, { ok: false, skip: "invoice_missing" });
});
