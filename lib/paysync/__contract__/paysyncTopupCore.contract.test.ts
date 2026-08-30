// 페이싱크 적립 코어 계약 (Phase 2):
//   * 검증 순서 — 로컬 조회 → 이미 적립됨 → 소유자 → **재조회** → 원격 paid·금액 → F11.
//   * 비허용 케이스에서 외부 호출 0회 / F11 호출 0회를 **횟수로** 검증한다(§1 계약).
//   * 웹훅 페이로드의 paid 는 근거가 아니다 — 적립 근거는 재조회 결과다(실측 반영).
//   * 멱등: duplicate 는 정상 성공이며 past_due 복구를 재실행하지 않는다.
// 실행: node --test --experimental-strip-types lib/paysync/__contract__/paysyncTopupCore.contract.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import {
  krwWonToCents,
  recordPaysyncTopupCore,
  type LocalPaysyncInvoice,
  type PaysyncTopupPorts,
} from "../paysyncTopupCore.ts";
import { krwWonToCents as tossKrwWonToCents } from "../../toss/tossTopupCore.ts";

const USER = "8f14e45f-ceea-4a67-8f2b-1a2b3c4d5e6f";
const INVOICE = "ivc_hjjwt6ux9g9ltplsqofn02ct";

function localRow(over: Partial<LocalPaysyncInvoice> = {}): LocalPaysyncInvoice {
  return {
    id: "row-1",
    userId: USER,
    paysyncInvoiceId: INVOICE,
    ledgerOrderRef: `cash-${USER}-01756543210123`,
    payKrw: 200_000,
    cashKrw: 206_000,
    status: "pending",
    ...over,
  };
}

/** 호출 횟수를 세는 스파이 포트. */
function makePorts(over: {
  local?: LocalPaysyncInvoice | null;
  remote?: { ok: true; invoice: { paid: boolean; amountWon: number } } | { ok: false; code: string };
  rpc?: { ok: true; duplicate: boolean } | { ok: false; code: string };
} = {}) {
  const calls = { findLocal: 0, fetchRemote: 0, recordTopup: 0, markPaid: 0, recoverPastDue: 0 };
  const marked: Array<{ id: string; trigger: string | null }> = [];
  const recorded: Array<{ userId: string; cents: number; ref: string }> = [];

  const ports: PaysyncTopupPorts = {
    findLocalInvoice: async () => {
      calls.findLocal += 1;
      return over.local === undefined ? localRow() : over.local;
    },
    fetchRemoteInvoice: async () => {
      calls.fetchRemote += 1;
      return over.remote ?? { ok: true as const, invoice: { paid: true, amountWon: 200_000 } };
    },
    recordTopupV2: async (userId, cents, ref) => {
      calls.recordTopup += 1;
      recorded.push({ userId, cents, ref });
      return over.rpc ?? { ok: true as const, duplicate: false };
    },
    markLocalPaid: async (id, trigger) => {
      calls.markPaid += 1;
      marked.push({ id, trigger });
    },
    recoverPastDue: async () => {
      calls.recoverPastDue += 1;
    },
  };
  return { ports, calls, marked, recorded };
}

const INPUT = { paysyncInvoiceId: INVOICE, eventUserId: USER, trigger: "AUTOMATIC_MATCHING" };

test("정상 적립: 재조회 통과 후 F11 → 로컬 전이 → past_due 복구 1회", async () => {
  const { ports, calls, marked, recorded } = makePorts();
  const r = await recordPaysyncTopupCore(INPUT, ports);

  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.duplicate, false);
    assert.equal(r.userId, USER);
    assert.equal(r.cashKrw, 206_000);
    assert.equal(r.staleStatus, null);
  }
  assert.deepEqual(calls, { findLocal: 1, fetchRemote: 1, recordTopup: 1, markPaid: 1, recoverPastDue: 1 });
  // 멱등키는 로컬에 고정 저장된 ledger_order_ref 다(주문당 1개).
  assert.deepEqual(recorded, [{ userId: USER, cents: 20_600_000, ref: `cash-${USER}-01756543210123` }]);
  assert.deepEqual(marked, [{ id: "row-1", trigger: "AUTOMATIC_MATCHING" }]);
});

test("로컬에 없는 주문: 외부 호출 0 · F11 0 (대시보드 수기 발행 주문 차단)", async () => {
  const { ports, calls } = makePorts({ local: null });
  const r = await recordPaysyncTopupCore(INPUT, ports);
  assert.deepEqual(r, { ok: false, skip: "unknown_invoice" });
  assert.equal(calls.fetchRemote, 0, "로컬에 없는데 페이싱크를 조회했다");
  assert.equal(calls.recordTopup, 0);
  assert.equal(calls.markPaid, 0);
});

test("이미 적립된 주문: 외부 호출 0 · F11 0 (웹훅 재전송·크론 중복의 정상 경로)", async () => {
  const { ports, calls } = makePorts({ local: localRow({ status: "paid" }) });
  const r = await recordPaysyncTopupCore(INPUT, ports);
  assert.deepEqual(r, { ok: false, skip: "already_paid" });
  assert.equal(calls.fetchRemote, 0);
  assert.equal(calls.recordTopup, 0);
});

test("소유자 불일치: 외부 호출 0 · F11 0", async () => {
  const { ports, calls } = makePorts();
  const r = await recordPaysyncTopupCore({ ...INPUT, eventUserId: "other-user" }, ports);
  assert.deepEqual(r, { ok: false, skip: "owner_mismatch" });
  assert.equal(calls.fetchRemote, 0);
  assert.equal(calls.recordTopup, 0);
});

test("재조회가 미결제면 F11 0 — 웹훅이 invoice.paid 를 보냈어도 적립하지 않는다", async () => {
  // 실측: invoice.paid 이벤트의 본문 paid 가 false 로 온다. 반대로 이벤트만 믿고
  // 적립하면 안 되는 경우도 같은 이유로 존재한다 — 근거는 항상 재조회 결과다.
  const { ports, calls } = makePorts({ remote: { ok: true, invoice: { paid: false, amountWon: 200_000 } } });
  const r = await recordPaysyncTopupCore(INPUT, ports);
  assert.deepEqual(r, { ok: false, skip: "remote_not_paid" });
  assert.equal(calls.fetchRemote, 1);
  assert.equal(calls.recordTopup, 0, "재조회가 미결제인데 원장을 기록했다");
  assert.equal(calls.markPaid, 0);
});

test("재조회 금액이 로컬과 다르면 F11 0", async () => {
  const { ports, calls } = makePorts({ remote: { ok: true, invoice: { paid: true, amountWon: 30_000 } } });
  const r = await recordPaysyncTopupCore(INPUT, ports);
  assert.deepEqual(r, { ok: false, skip: "amount_mismatch" });
  assert.equal(calls.recordTopup, 0);
});

test("재조회 실패는 lookup_failed — F11 0, 크론이 나중에 회수한다", async () => {
  const { ports, calls } = makePorts({ remote: { ok: false, code: "transport_failed" } });
  const r = await recordPaysyncTopupCore(INPUT, ports);
  assert.deepEqual(r, { ok: false, skip: "lookup_failed" });
  assert.equal(calls.recordTopup, 0);
  assert.equal(calls.markPaid, 0);
});

test("duplicate: 정상 성공이지만 past_due 복구를 재실행하지 않는다", async () => {
  const { ports, calls } = makePorts({ rpc: { ok: true, duplicate: true } });
  const r = await recordPaysyncTopupCore(INPUT, ports);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.duplicate, true);
  assert.equal(calls.recoverPastDue, 0, "duplicate 인데 past_due 복구를 다시 돌렸다");
  // 로컬 전이는 수행한다 — F11 성공 후 markLocalPaid 가 실패했던 건의 자가 복구 경로.
  assert.equal(calls.markPaid, 1);
});

test("F11 실패 코드는 은폐하지 않고 안정 실패로 전달, 로컬 전이 0", async () => {
  const cases: Array<[string, string]> = [
    ["ORDER_REF_INVALID", "invalid_order"],
    ["ORDER_REF_OWNER_MISMATCH", "order_owner_mismatch"],
    ["LEDGER_FIELD_MISMATCH", "LEDGER_FIELD_MISMATCH"],
    ["SOMETHING_NEW", "ledger_failed"],
  ];
  for (const [rpcCode, expected] of cases) {
    const { ports, calls } = makePorts({ rpc: { ok: false, code: rpcCode } });
    const r = await recordPaysyncTopupCore(INPUT, ports);
    assert.equal("failed" in r && r.failed, expected, rpcCode);
    assert.equal(calls.markPaid, 0, `${rpcCode}: F11 실패인데 로컬을 paid 로 바꿨다`);
    assert.equal(calls.recoverPastDue, 0);
  }
});

test("past_due 복구 실패는 적립 결과를 되돌리지 않는다(best-effort)", async () => {
  const { ports } = makePorts();
  ports.recoverPastDue = async () => {
    throw new Error("boom");
  };
  const r = await recordPaysyncTopupCore(INPUT, ports);
  assert.equal(r.ok, true);
});

test("만료·취소 주문에 입금이 도착해도 적립하고 이상만 기록한다(돈 묶임 방지)", async () => {
  for (const status of ["expired", "canceled"] as const) {
    const { ports, calls } = makePorts({ local: localRow({ status }) });
    const r = await recordPaysyncTopupCore(INPUT, ports);
    assert.equal(r.ok, true, status);
    if (r.ok) assert.equal(r.staleStatus, status);
    assert.equal(calls.recordTopup, 1);
  }
});

test("크론 경로(eventUserId=null)는 소유자 대조를 건너뛰고 로컬을 정본으로 쓴다", async () => {
  const { ports, calls, recorded } = makePorts();
  const r = await recordPaysyncTopupCore({ ...INPUT, eventUserId: null, trigger: "RECONCILE_CRON" }, ports);
  assert.equal(r.ok, true);
  assert.equal(calls.recordTopup, 1);
  assert.equal(recorded[0].userId, USER);
});

test("빈 invoiceId 는 로컬 조회조차 하지 않는다", async () => {
  const { ports, calls } = makePorts();
  const r = await recordPaysyncTopupCore({ ...INPUT, paysyncInvoiceId: "  " }, ports);
  assert.deepEqual(r, { ok: false, skip: "unknown_invoice" });
  assert.equal(calls.findLocal, 0);
});

test("cents 환산은 토스 경로와 동일해야 한다(두 채널이 같은 원장을 쓴다)", () => {
  for (const won of [1, 30_000, 206_000, 315_000, 10_000_000, 0, -1, 10_000_001, Number.NaN]) {
    assert.equal(krwWonToCents(won), tossKrwWonToCents(won), `won=${won}`);
  }
});
