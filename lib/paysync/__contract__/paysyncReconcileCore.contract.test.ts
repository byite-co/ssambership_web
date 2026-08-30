// 보정 크론 대상 선별 계약 (Phase 2 §4):
//   * 만료 경계에서 입금 건을 잃지 않는다(경계값은 아직 만료 아님).
//   * 만료 건은 재조회 대상에서 빠진다(배치 상한을 잠식하지 않게).
//   * expires_at 이 null 이면 만료 없음 — 계속 재조회 대상.
// 실행: node --test --experimental-strip-types lib/paysync/__contract__/paysyncReconcileCore.contract.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { selectReconcileTargets, type ReconcileCandidate } from "../paysyncReconcileCore.ts";

const NOW = "2026-08-30T12:00:00.000Z";

function row(over: Partial<ReconcileCandidate> = {}): ReconcileCandidate {
  return {
    id: "row-1",
    paysync_invoice_id: "ivc_1",
    issued_at: "2026-08-30T11:00:00.000Z",
    expires_at: null,
    status: "pending",
    ...over,
  };
}

test("만료 전 주문은 재조회 대상", () => {
  const r = selectReconcileTargets([row({ expires_at: "2026-08-30T13:00:00.000Z" })], NOW);
  assert.equal(r.toRecover.length, 1);
  assert.equal(r.toExpire.length, 0);
});

test("만료 지난 주문은 재조회하지 않고 만료 마킹 대상", () => {
  const r = selectReconcileTargets([row({ expires_at: "2026-08-30T11:59:59.999Z" })], NOW);
  assert.equal(r.toRecover.length, 0);
  assert.equal(r.toExpire.length, 1);
});

test("경계값: 정확히 만료 시각이면 아직 만료가 아니다(그 순간 입금을 살린다)", () => {
  const r = selectReconcileTargets([row({ expires_at: NOW })], NOW);
  assert.equal(r.toRecover.length, 1, "만료 시각 정각을 만료로 처리하면 경계 입금이 유실된다");
  assert.equal(r.toExpire.length, 0);
});

test("expires_at 이 null 이면 만료 없음 — 계속 재조회 대상", () => {
  const r = selectReconcileTargets([row({ expires_at: null })], NOW);
  assert.equal(r.toRecover.length, 1);
  assert.equal(r.toExpire.length, 0);
});

test("파싱 불가한 시각은 만료로 처리하지 않는다(잘못된 만료 마킹 금지)", () => {
  for (const bad of ["", "not-a-date", "2026-13-45T99:99:99Z"]) {
    const r = selectReconcileTargets([row({ expires_at: bad })], NOW);
    assert.equal(r.toExpire.length, 0, `expires_at=${bad}`);
  }
});

test("pending 이 아닌 행은 양쪽 어디에도 넣지 않는다(이중 방어)", () => {
  const rows = [
    row({ id: "a", status: "paid" }),
    row({ id: "b", status: "expired", expires_at: "2026-08-30T10:00:00.000Z" }),
    row({ id: "c", status: "canceled" }),
  ];
  const r = selectReconcileTargets(rows, NOW);
  assert.equal(r.toRecover.length, 0);
  assert.equal(r.toExpire.length, 0);
});

test("혼합 배치를 정확히 가른다", () => {
  const rows = [
    row({ id: "recover-1", paysync_invoice_id: "ivc_a", expires_at: "2026-08-30T18:00:00.000Z" }),
    row({ id: "expire-1", paysync_invoice_id: "ivc_b", expires_at: "2026-08-29T18:00:00.000Z" }),
    row({ id: "recover-2", paysync_invoice_id: "ivc_c", expires_at: null }),
    row({ id: "skip-1", paysync_invoice_id: "ivc_d", status: "paid" }),
  ];
  const r = selectReconcileTargets(rows, NOW);
  assert.deepEqual(r.toRecover.map((x) => x.id), ["recover-1", "recover-2"]);
  assert.deepEqual(r.toExpire.map((x) => x.id), ["expire-1"]);
});

test("빈 입력·null 안전", () => {
  assert.deepEqual(selectReconcileTargets([], NOW), { toRecover: [], toExpire: [] });
  assert.deepEqual(
    selectReconcileTargets(undefined as unknown as ReconcileCandidate[], NOW),
    { toRecover: [], toExpire: [] },
  );
});
