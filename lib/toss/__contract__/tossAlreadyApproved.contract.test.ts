// 계약 테스트(§4-2·4-3·4-4·4-5): Toss 기승인 성공 수렴 · 중복 원장 0 · 사용자 오류 매핑 ·
// recoverPastDueAfterTopup 호출 계약 보존.
// 실행: node --test --experimental-strip-types lib/toss/__contract__/tossAlreadyApproved.contract.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import {
  CONFIRM_ERROR_MESSAGES,
  confirmCashTopupCore,
  isAlreadyApprovedTossCode,
  mapTossErrorCode,
  recordCashTopupCore,
  userMessageForConfirmCode,
  verifyApprovedOrderMatches,
} from "../tossTopupCore.ts";
import type { ConfirmCashTopupPorts, RecordCashTopupPorts } from "../tossTopupCore.ts";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const ORDER = `cash-${USER}-1753300000000`;
const OTHER_ORDER = `cash-${OTHER}-1753300000000`;
const PAY = 30_000;

type Counters = { toss: number; lookup: number; record: number };

function ports(over: Partial<ConfirmCashTopupPorts>, c: Counters): ConfirmCashTopupPorts {
  return {
    getAuthenticatedUserId: async () => USER,
    isAllowedPayKrw: (won) => won === PAY,
    hasTossSecret: () => true,
    // 기본은 '이미 처리된 결제' 응답 — 기승인 수렴 경로를 태운다.
    tossConfirm: async () => {
      c.toss++;
      return { ok: false, data: null, errorCode: "ALREADY_PROCESSED_PAYMENT" };
    },
    tossLookupOrder: async (orderId) => {
      c.lookup++;
      return { ok: true, data: { status: "DONE", orderId, totalAmount: PAY, method: "카드" } };
    },
    recordTopup: async () => {
      c.record++;
      return { ok: true, duplicate: true, amount: PAY, payAmount: PAY };
    },
    ...over,
  };
}

const INPUT = { paymentKey: "pk_test", orderId: ORDER, amount: PAY };

// ── §4-2 기승인 성공 수렴 ────────────────────────────────────────────────────

test("기승인 + 정본 주문 전부 일치 → 성공 수렴(원장은 멱등 duplicate)", async () => {
  const c: Counters = { toss: 0, lookup: 0, record: 0 };
  const out = await confirmCashTopupCore(INPUT, ports({}, c));
  assert.equal(out.ok, true);
  assert.equal(out.ok && out.duplicate, true);
  assert.equal(c.toss, 1);
  assert.equal(c.lookup, 1, "정본 주문 조회는 1회");
  assert.equal(c.record, 1, "멱등 원장 정본을 그대로 통과");
});

test("기승인 대조 불일치는 성공 수렴 금지 — 사유별 차단 + 원장 호출 0", async () => {
  const bads: Array<{ name: string; data: Record<string, unknown>; error: string }> = [
    {
      name: "금액 불일치",
      data: { status: "DONE", orderId: ORDER, totalAmount: PAY + 1 },
      error: "amount_mismatch",
    },
    {
      name: "주문 불일치",
      data: { status: "DONE", orderId: `cash-${USER}-1999999999999`, totalAmount: PAY },
      error: "order_mismatch",
    },
    {
      name: "타인 주문(userId 불일치)",
      data: { status: "DONE", orderId: OTHER_ORDER, totalAmount: PAY },
      error: "order_mismatch",
    },
    {
      name: "상태가 DONE 아님",
      data: { status: "CANCELED", orderId: ORDER, totalAmount: PAY },
      error: "payment_not_done",
    },
    {
      name: "금액 비수치",
      data: { status: "DONE", orderId: ORDER, totalAmount: "삼만원" },
      error: "amount_mismatch",
    },
  ];

  for (const bad of bads) {
    const c: Counters = { toss: 0, lookup: 0, record: 0 };
    const out = await confirmCashTopupCore(
      INPUT,
      ports({ tossLookupOrder: async () => { c.lookup++; return { ok: true, data: bad.data }; } }, c),
    );
    assert.equal(out.ok, false, bad.name);
    assert.equal(!out.ok && out.error, bad.error, bad.name);
    assert.equal(c.record, 0, `${bad.name}: 원장 호출이 발생함`);
  }
});

test("정본 주문 조회 자체가 실패하면 성공 처리하지 않는다", async () => {
  for (const lookup of [
    async () => ({ ok: false, data: null }),
    async () => ({ ok: true, data: null }),
  ]) {
    const c: Counters = { toss: 0, lookup: 0, record: 0 };
    const out = await confirmCashTopupCore(INPUT, ports({ tossLookupOrder: lookup }, c));
    assert.equal(out.ok, false);
    assert.equal(!out.ok && out.error, "payment_lookup_failed");
    assert.equal(c.record, 0);
  }
});

test("기승인이 아닌 실패에서는 정본 주문 조회를 호출하지 않는다(lookup 0)", async () => {
  const c: Counters = { toss: 0, lookup: 0, record: 0 };
  const out = await confirmCashTopupCore(
    INPUT,
    ports({ tossConfirm: async () => { c.toss++; return { ok: false, data: null, errorCode: "REJECT_CARD_COMPANY" }; } }, c),
  );
  assert.equal(out.ok, false);
  assert.equal(c.lookup, 0);
  assert.equal(c.record, 0);
});

test("정상 승인 경로에서도 lookup 은 0회다(추가 외부 호출 없음)", async () => {
  const c: Counters = { toss: 0, lookup: 0, record: 0 };
  const out = await confirmCashTopupCore(
    INPUT,
    ports(
      {
        tossConfirm: async ({ orderId, amount }) => {
          c.toss++;
          return { ok: true, data: { status: "DONE", orderId, totalAmount: amount, method: "카드" } };
        },
        recordTopup: async () => { c.record++; return { ok: true, duplicate: false, amount: PAY, payAmount: PAY }; },
      },
      c,
    ),
  );
  assert.equal(out.ok, true);
  assert.equal(c.lookup, 0);
});

test("Toss 호출 전 차단 케이스는 confirm·lookup 둘 다 0회", async () => {
  const cases: Array<{ name: string; over: Partial<ConfirmCashTopupPorts>; input?: typeof INPUT }> = [
    { name: "미로그인", over: { getAuthenticatedUserId: async () => null } },
    { name: "타인 orderId", over: {}, input: { ...INPUT, orderId: OTHER_ORDER } },
    { name: "secret 누락", over: { hasTossSecret: () => false } },
  ];
  for (const cs of cases) {
    const c: Counters = { toss: 0, lookup: 0, record: 0 };
    const out = await confirmCashTopupCore(cs.input ?? INPUT, ports(cs.over, c));
    assert.equal(out.ok, false, cs.name);
    assert.equal(c.toss, 0, `${cs.name}: toss 호출됨`);
    assert.equal(c.lookup, 0, `${cs.name}: lookup 호출됨`);
  }
});

test("verifyApprovedOrderMatches: 전부 일치할 때만 ok", () => {
  const expected = { orderId: ORDER, userId: USER, amountWon: PAY };
  assert.deepEqual(
    verifyApprovedOrderMatches({ status: "DONE", orderId: ORDER, totalAmount: PAY }, expected),
    { ok: true },
  );
  assert.equal(verifyApprovedOrderMatches(null, expected).ok, false);
  assert.equal(
    verifyApprovedOrderMatches({ status: "DONE", orderId: OTHER_ORDER, totalAmount: PAY }, expected).ok,
    false,
  );
  // orderId 는 같지만 기대 userId 가 다른 경우 → 소유자 불일치로 차단.
  assert.deepEqual(
    verifyApprovedOrderMatches({ status: "DONE", orderId: ORDER, totalAmount: PAY }, { ...expected, userId: OTHER }),
    { ok: false, code: "order_owner_mismatch" },
  );
});

// ── §4-3 중복 원장 0 ────────────────────────────────────────────────────────

test("기승인 수렴이 반복돼도 원장은 1행뿐이다(idempotency_key=orderId 조기 반환)", async () => {
  // 실제 원장 정본(recordCashTopupCore)을 그대로 물려 중복 기록 여부를 센다.
  const rpcCalls: Array<{ userId: string; cents: number; key: string }> = [];
  const recovered: string[] = [];
  const ledgerKeys = new Set<string>();

  const recordPorts: RecordCashTopupPorts = {
    isAllowedPayKrw: (won) => won === PAY,
    cashKrwForPayKrw: () => PAY,
    hasTopupForOrderId: async (id) => ledgerKeys.has(id),
    recordTopupRpc: async (userId, cents, key) => {
      rpcCalls.push({ userId, cents, key });
      ledgerKeys.add(key); // UNIQUE(idempotency_key) 재현
      return { error: false };
    },
    recoverPastDue: async (userId) => { recovered.push(userId); },
  };

  const c: Counters = { toss: 0, lookup: 0, record: 0 };
  const confirmPorts = ports(
    {
      recordTopup: async (orderId, won) => {
        c.record++;
        const r = await recordCashTopupCore(orderId, won, recordPorts);
        return r.ok
          ? { ok: true, duplicate: r.duplicate, amount: r.amount, payAmount: r.payAmount }
          : { ok: false, code: r.code, message: r.message };
      },
    },
    c,
  );

  // 1회차: 아직 원장이 없으므로 신규 기록 → duplicate=false
  const first = await confirmCashTopupCore(INPUT, confirmPorts);
  assert.equal(first.ok, true);
  assert.equal(first.ok && first.duplicate, false);

  // 2~4회차: 기승인 수렴이 반복돼도 조기 반환으로 duplicate=true
  for (let i = 0; i < 3; i++) {
    const again = await confirmCashTopupCore(INPUT, confirmPorts);
    assert.equal(again.ok, true, `재시도 ${i + 1}`);
    assert.equal(again.ok && again.duplicate, true, `재시도 ${i + 1} duplicate`);
  }

  assert.equal(rpcCalls.length, 1, "원장 INSERT 는 정확히 1회여야 한다(중복 원장 0)");
  assert.equal(rpcCalls[0]?.key, ORDER, "idempotency_key 는 orderId 계약");
  assert.equal(rpcCalls[0]?.userId, USER);
  assert.equal(ledgerKeys.size, 1);
});

// ── §4-5 recoverPastDueAfterTopup 회귀 ──────────────────────────────────────

test("past_due 복구는 신규 적립 성공 시 1회, duplicate 재호출에서는 미호출", async () => {
  const recovered: string[] = [];
  const ledgerKeys = new Set<string>();
  const p: RecordCashTopupPorts = {
    isAllowedPayKrw: (won) => won === PAY,
    cashKrwForPayKrw: () => PAY,
    hasTopupForOrderId: async (id) => ledgerKeys.has(id),
    recordTopupRpc: async (_u, _c, key) => { ledgerKeys.add(key); return { error: false }; },
    recoverPastDue: async (userId) => { recovered.push(userId); },
  };

  const first = await recordCashTopupCore(ORDER, PAY, p);
  assert.equal(first.ok && first.duplicate, false);
  assert.deepEqual(recovered, [USER], "신규 적립 후 정확히 1회");

  const second = await recordCashTopupCore(ORDER, PAY, p);
  assert.equal(second.ok && second.duplicate, true);
  assert.deepEqual(recovered, [USER], "duplicate 에서는 복구를 재실행하지 않는다");
});

test("past_due 복구 실패는 적립 결과를 되돌리지 않는다(best-effort 유지)", async () => {
  const p: RecordCashTopupPorts = {
    isAllowedPayKrw: (won) => won === PAY,
    cashKrwForPayKrw: () => PAY,
    hasTopupForOrderId: async () => false,
    recordTopupRpc: async () => ({ error: false }),
    recoverPastDue: async () => { throw new Error("복구 실패"); },
  };
  const r = await recordCashTopupCore(ORDER, PAY, p);
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.duplicate, false);
});

test("원장 RPC 실패는 ledger_failed 이고 복구를 호출하지 않는다", async () => {
  const recovered: string[] = [];
  const p: RecordCashTopupPorts = {
    isAllowedPayKrw: (won) => won === PAY,
    cashKrwForPayKrw: () => PAY,
    hasTopupForOrderId: async () => false,
    recordTopupRpc: async () => ({ error: true }),
    recoverPastDue: async (u) => { recovered.push(u); },
  };
  const r = await recordCashTopupCore(ORDER, PAY, p);
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.code, "ledger_failed");
  assert.deepEqual(recovered, []);
});

// ── §4-4 사용자 오류 매핑 ───────────────────────────────────────────────────

test("Toss 오류 코드 → 내부 코드·HTTP 상태 매핑", () => {
  assert.deepEqual(mapTossErrorCode("REJECT_CARD_COMPANY"), { code: "card_declined", httpStatus: 400 });
  assert.deepEqual(mapTossErrorCode("NOT_ENOUGH_BALANCE"), { code: "card_limit", httpStatus: 400 });
  assert.deepEqual(mapTossErrorCode("NOT_FOUND_PAYMENT"), { code: "payment_not_found", httpStatus: 400 });
  assert.deepEqual(mapTossErrorCode("PROVIDER_ERROR"), { code: "provider_error", httpStatus: 400 });
  // 서버 설정 문제는 500 이고 원인을 사용자에게 알리지 않는다.
  assert.deepEqual(mapTossErrorCode("UNAUTHORIZED_KEY"), { code: "server_config", httpStatus: 500 });
  // 미등록·빈 코드는 일반 실패로 폴백.
  assert.deepEqual(mapTossErrorCode("SOME_NEW_CODE_2027"), { code: "payment_failed", httpStatus: 400 });
  assert.deepEqual(mapTossErrorCode(null), { code: "payment_failed", httpStatus: 400 });
  // 대소문자·공백에 견고해야 한다.
  assert.deepEqual(mapTossErrorCode("  reject_card_company "), { code: "card_declined", httpStatus: 400 });
});

test("기승인 코드 판정은 대소문자·공백에 견고하다", () => {
  assert.equal(isAlreadyApprovedTossCode("ALREADY_PROCESSED_PAYMENT"), true);
  assert.equal(isAlreadyApprovedTossCode(" already_processed_payment "), true);
  assert.equal(isAlreadyApprovedTossCode("REJECT_CARD_COMPANY"), false);
  assert.equal(isAlreadyApprovedTossCode(null), false);
  assert.equal(isAlreadyApprovedTossCode(undefined), false);
});

test("카드사 거절 코드는 사용자에게 매핑된 안내 문구로 나온다", async () => {
  const c: Counters = { toss: 0, lookup: 0, record: 0 };
  const out = await confirmCashTopupCore(
    INPUT,
    ports({ tossConfirm: async () => { c.toss++; return { ok: false, data: null, errorCode: "REJECT_CARD_COMPANY" }; } }, c),
  );
  assert.equal(out.ok, false);
  assert.equal(!out.ok && out.error, "card_declined");
  assert.equal(!out.ok && out.message, CONFIRM_ERROR_MESSAGES.card_declined);
});

test("사용자 노출 문구에 Toss 원문·코드·내부 메시지가 섞이지 않는다", async () => {
  const leaky = "TOSS_RAW: card issuer said NO (trace=abc123)";
  const c: Counters = { toss: 0, lookup: 0, record: 0 };
  const out = await confirmCashTopupCore(
    INPUT,
    ports({ tossConfirm: async () => { c.toss++; return { ok: false, data: null, errorCode: leaky }; } }, c),
  );
  assert.equal(out.ok, false);
  const message = !out.ok ? out.message : "";
  assert.equal(message.includes(leaky), false, "원문이 사용자 문구로 유출됨");
  assert.equal(message.includes("trace"), false);
  // 반환 문구는 반드시 고정 매핑 표 안의 값이어야 한다.
  assert.ok(Object.values(CONFIRM_ERROR_MESSAGES).includes(message), "고정 문구 표 밖의 메시지");
});

test("모든 실패 경로의 message 는 고정 매핑 표 안의 값이다", async () => {
  const scenarios: Array<{ name: string; over: Partial<ConfirmCashTopupPorts>; input?: typeof INPUT }> = [
    { name: "미로그인", over: { getAuthenticatedUserId: async () => null } },
    { name: "형식 오류", over: {}, input: { ...INPUT, orderId: "weird" } },
    { name: "타인 주문", over: {}, input: { ...INPUT, orderId: OTHER_ORDER } },
    { name: "비허용 금액", over: {}, input: { ...INPUT, amount: 31_000 } },
    { name: "secret 누락", over: { hasTossSecret: () => false } },
    { name: "카드 한도", over: { tossConfirm: async () => ({ ok: false, data: null, errorCode: "NOT_ENOUGH_BALANCE" }) } },
    { name: "조회 실패", over: { tossLookupOrder: async () => ({ ok: false, data: null }) } },
    {
      name: "금액 불일치",
      over: { tossLookupOrder: async () => ({ ok: true, data: { status: "DONE", orderId: ORDER, totalAmount: 999 } }) },
    },
    { name: "원장 실패", over: { recordTopup: async () => ({ ok: false, code: "ledger_failed", message: "충전 기록에 실패했습니다." }) } },
  ];
  const allowed = new Set(Object.values(CONFIRM_ERROR_MESSAGES));
  for (const s of scenarios) {
    const c: Counters = { toss: 0, lookup: 0, record: 0 };
    const out = await confirmCashTopupCore(s.input ?? INPUT, ports(s.over, c));
    assert.equal(out.ok, false, s.name);
    assert.ok(allowed.has(!out.ok ? out.message : ""), `${s.name}: 고정 문구 표 밖의 메시지`);
  }
});

test("미등록 내부 코드는 일반 실패 문구로 폴백한다", () => {
  assert.equal(userMessageForConfirmCode("some_unknown_code"), CONFIRM_ERROR_MESSAGES.payment_failed);
  assert.equal(userMessageForConfirmCode("card_limit"), CONFIRM_ERROR_MESSAGES.card_limit);
});
