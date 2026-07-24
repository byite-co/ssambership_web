import test from "node:test";
import assert from "node:assert/strict";
import {
  confirmCashTopupCore,
  krwWonToCents,
  parseUserIdFromCashOrderId,
  recordCashTopupCore,
} from "../tossTopupCore.ts";
import type { ConfirmCashTopupPorts, RecordCashTopupPorts } from "../tossTopupCore.ts";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const ORDER = `cash-${USER}-1753300000000`;

type Counters = { toss: number; record: number };

function makePorts(over: Partial<ConfirmCashTopupPorts>, counters: Counters): ConfirmCashTopupPorts {
  return {
    getAuthenticatedUserId: async () => USER,
    isAllowedPayKrw: (won) => won === 30_000 || won === 60_000,
    hasTossSecret: () => true,
    tossConfirm: async ({ orderId, amount }) => {
      counters.toss++;
      return { ok: true, data: { status: "DONE", orderId, totalAmount: amount, method: "카드" } };
    },
    recordTopup: async () => {
      counters.record++;
      return { ok: true, duplicate: false, amount: 30_000, payAmount: 30_000 };
    },
    ...over,
  };
}

const GOOD_INPUT = { paymentKey: "pk_test", orderId: ORDER, amount: 30_000 };

test("검증 순서: Toss 호출 전 차단 케이스는 전부 Toss fetch 0", async () => {
  const cases: Array<{ name: string; input?: Partial<typeof GOOD_INPUT>; over?: Partial<ConfirmCashTopupPorts>; error: string; status: number }> = [
    { name: "미로그인", over: { getAuthenticatedUserId: async () => null }, error: "unauthorized", status: 401 },
    { name: "타인 orderId", input: { orderId: `cash-${OTHER}-1753300000000` }, error: "unauthorized", status: 401 },
    { name: "잘못된 orderId 형식", input: { orderId: "weird-order" }, error: "invalid_order", status: 400 },
    { name: "허용되지 않은 package", input: { amount: 31_000 }, error: "invalid_package", status: 400 },
    { name: "secret 누락", over: { hasTossSecret: () => false }, error: "server_config", status: 500 },
    { name: "입력 형식(amount 비수치)", input: { amount: Number.NaN }, error: "invalid_params", status: 400 },
    { name: "입력 형식(paymentKey 공백)", input: { paymentKey: "  " }, error: "invalid_params", status: 400 },
  ];
  for (const c of cases) {
    const counters: Counters = { toss: 0, record: 0 };
    const out = await confirmCashTopupCore({ ...GOOD_INPUT, ...c.input }, makePorts(c.over ?? {}, counters));
    assert.equal(out.ok, false, c.name);
    if (!out.ok) {
      assert.equal(out.error, c.error, c.name);
      assert.equal(out.httpStatus, c.status, c.name);
    }
    assert.equal(counters.toss, 0, `${c.name}: Toss fetch 0 이어야 함`);
    assert.equal(counters.record, 0, `${c.name}: 원장 호출 0 이어야 함`);
  }
});

test("Toss 승인 거부 → payment_failed, 원장 호출 0", async () => {
  const counters: Counters = { toss: 0, record: 0 };
  const out = await confirmCashTopupCore(
    GOOD_INPUT,
    makePorts({ tossConfirm: async () => { counters.toss++; return { ok: false, data: null }; } }, counters),
  );
  assert.deepEqual(out, { ok: false, httpStatus: 400, error: "payment_failed", message: "결제 승인에 실패했습니다." });
  assert.equal(counters.toss, 1);
  assert.equal(counters.record, 0);
});

test("Toss 응답 재검증: 상태·orderId·금액 불일치는 전부 원장 호출 0", async () => {
  const bads: Array<{ name: string; data: Record<string, unknown>; error: string }> = [
    { name: "상태 non-DONE", data: { status: "CANCELED", orderId: ORDER, totalAmount: 30_000 }, error: "payment_not_done" },
    { name: "orderId 불일치", data: { status: "DONE", orderId: "cash-x-1", totalAmount: 30_000 }, error: "order_mismatch" },
    { name: "금액 불일치", data: { status: "DONE", orderId: ORDER, totalAmount: 29_000 }, error: "amount_mismatch" },
    { name: "금액 누락", data: { status: "DONE", orderId: ORDER }, error: "amount_mismatch" },
  ];
  for (const b of bads) {
    const counters: Counters = { toss: 0, record: 0 };
    const out = await confirmCashTopupCore(
      GOOD_INPUT,
      makePorts({ tossConfirm: async () => { counters.toss++; return { ok: true, data: b.data }; } }, counters),
    );
    assert.equal(out.ok, false, b.name);
    if (!out.ok) assert.equal(out.error, b.error, b.name);
    assert.equal(counters.record, 0, b.name);
  }
});

test("정상 승인 → Toss 1회·원장 1회·method 전달", async () => {
  const counters: Counters = { toss: 0, record: 0 };
  const out = await confirmCashTopupCore(GOOD_INPUT, makePorts({}, counters));
  assert.deepEqual(out, { ok: true, duplicate: false, amount: 30_000, payAmount: 30_000, method: "카드" });
  assert.equal(counters.toss, 1);
  assert.equal(counters.record, 1);
});

test("duplicate 재호출 → 원장 정본이 duplicate 반환, 이중 적립 없음(ok+duplicate)", async () => {
  const counters: Counters = { toss: 0, record: 0 };
  const out = await confirmCashTopupCore(
    GOOD_INPUT,
    makePorts({ recordTopup: async () => { counters.record++; return { ok: true, duplicate: true, amount: 30_000, payAmount: 30_000 }; } }, counters),
  );
  assert.equal(out.ok, true);
  if (out.ok) assert.equal(out.duplicate, true);
});

// ── 원장 코어(webhook 회귀 — recordCashTopupFromTossOrder 의 판정 정본) ────────

function topupPorts(over: Partial<RecordCashTopupPorts>, calls: { rpc: number; recover: number }): RecordCashTopupPorts {
  return {
    isAllowedPayKrw: (won) => won === 30_000,
    cashKrwForPayKrw: (won) => (won === 30_000 ? 30_000 : null),
    hasTopupForOrderId: async () => false,
    recordTopupRpc: async () => { calls.rpc++; return { error: false }; },
    recoverPastDue: async () => { calls.recover++; },
    ...over,
  };
}

test("webhook 회귀: 신규 적립 → RPC 1회 + past_due 복구 정확히 1회", async () => {
  const calls = { rpc: 0, recover: 0 };
  const out = await recordCashTopupCore(ORDER, 30_000, topupPorts({}, calls));
  assert.deepEqual(out, { ok: true, duplicate: false, amount: 30_000, payAmount: 30_000, userId: USER });
  assert.equal(calls.rpc, 1);
  assert.equal(calls.recover, 1);
});

test("webhook 회귀: duplicate(동일 orderId) → RPC 0·복구 0·이중 적립 0(기존 계약 유지)", async () => {
  const calls = { rpc: 0, recover: 0 };
  const out = await recordCashTopupCore(ORDER, 30_000, topupPorts({ hasTopupForOrderId: async () => true }, calls));
  assert.deepEqual(out, { ok: true, duplicate: true, amount: 30_000, payAmount: 30_000, userId: USER });
  assert.equal(calls.rpc, 0);
  assert.equal(calls.recover, 0);
});

test("webhook 회귀: 복구 실패(throw)는 적립 성공을 되돌리지 않는다(best-effort 유지)", async () => {
  const calls = { rpc: 0, recover: 0 };
  const out = await recordCashTopupCore(
    ORDER,
    30_000,
    topupPorts({ recoverPastDue: async () => { calls.recover++; throw new Error("recover down"); } }, calls),
  );
  assert.equal(out.ok, true);
  if (out.ok) assert.equal(out.duplicate, false);
  assert.equal(calls.rpc, 1);
  assert.equal(calls.recover, 1);
});

test("webhook 회귀: RPC 실패 → ledger_failed, 복구 미호출", async () => {
  const calls = { rpc: 0, recover: 0 };
  const out = await recordCashTopupCore(ORDER, 30_000, topupPorts({ recordTopupRpc: async () => { calls.rpc++; return { error: true }; } }, calls));
  assert.deepEqual(out, { ok: false, code: "ledger_failed", message: "충전 기록에 실패했습니다." });
  assert.equal(calls.recover, 0);
});

test("원장 코어 입력 매핑: 비허용 금액·주문 형식 오류", async () => {
  const calls = { rpc: 0, recover: 0 };
  const badPkg = await recordCashTopupCore(ORDER, 31_000, topupPorts({}, calls));
  assert.equal(badPkg.ok, false);
  if (!badPkg.ok) assert.equal(badPkg.code, "invalid_package");
  const badOrder = await recordCashTopupCore("nope", 30_000, topupPorts({}, calls));
  assert.equal(badOrder.ok, false);
  if (!badOrder.ok) assert.equal(badOrder.code, "invalid_order");
  assert.equal(calls.rpc, 0);
  assert.equal(calls.recover, 0);
});

test("순수 유틸: orderId 파싱·원→센트", () => {
  assert.equal(parseUserIdFromCashOrderId(ORDER), USER);
  assert.equal(parseUserIdFromCashOrderId("cash--123"), null);
  assert.equal(parseUserIdFromCashOrderId(""), null);
  assert.equal(krwWonToCents(30_000), 3_000_000);
  assert.equal(krwWonToCents(0), 0);
  assert.equal(krwWonToCents(10_000_001), 0);
});
