// 계약 테스트: outbox backoff·무효토큰 분류.
// 실행: node --test --experimental-strip-types lib/notifications/__contract__/outboxBackoff.contract.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { exponentialBackoffSeconds, isInvalidTokenError } from "../outboxBackoff.ts";

test("지수 backoff: attempt 증가 시 base*2^(n-1), cap clamp", () => {
  assert.equal(exponentialBackoffSeconds(1, { baseSeconds: 30, capSeconds: 3600, factor: 2 }), 30);
  assert.equal(exponentialBackoffSeconds(2, { baseSeconds: 30 }), 60);
  assert.equal(exponentialBackoffSeconds(3, { baseSeconds: 30 }), 120);
  assert.equal(exponentialBackoffSeconds(4, { baseSeconds: 30 }), 240);
  // cap
  assert.equal(exponentialBackoffSeconds(100, { baseSeconds: 30, capSeconds: 3600 }), 3600);
  // attempt<1 → base
  assert.equal(exponentialBackoffSeconds(0, { baseSeconds: 30 }), 30);
});

test("무효 토큰 오류 분류(revoke 대상)", () => {
  for (const e of [
    "Requested entity was not found",
    "NotRegistered",
    "messaging/registration-token-not-registered: not registered",
    "Invalid registration token",
    "SenderId mismatch",
  ]) {
    assert.equal(isInvalidTokenError(e), true, e);
  }
});

test("일시 오류는 무효 토큰 아님(재시도 대상)", () => {
  assert.equal(isInvalidTokenError("Internal server error"), false);
  assert.equal(isInvalidTokenError("Unavailable"), false);
  assert.equal(isInvalidTokenError("timeout"), false);
  assert.equal(isInvalidTokenError(""), false);
  assert.equal(isInvalidTokenError(null), false);
});
