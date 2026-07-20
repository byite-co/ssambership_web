// 계약 테스트: 알림 커서 왕복(back-forward)·읽음판정.
// 실행: node --test --experimental-strip-types lib/notifications/__contract__/notificationCursor.contract.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import {
  decodeNotificationCursor,
  encodeNotificationCursor,
  isNotificationReadRow,
} from "../notificationCursor.ts";

test("커서 왕복: timestamp(+00:00)·uuid 손상 없이 복원", () => {
  const orderValue = "2026-07-20T12:34:56.789+00:00";
  const id = "11111111-2222-4333-8444-555555555555";
  const cur = encodeNotificationCursor(orderValue, id);
  // URL-safe(+// = 없음)
  assert.ok(!/[+/=]/.test(cur));
  assert.deepEqual(decodeNotificationCursor(cur), { orderValue, id });
});

test("잘못된/빈 커서는 null", () => {
  assert.equal(decodeNotificationCursor(null), null);
  assert.equal(decodeNotificationCursor(""), null);
  assert.equal(decodeNotificationCursor("!!!not-base64!!!"), null);
  // 구분자 없는 값 → null
  assert.equal(decodeNotificationCursor(encodeNotificationCursorRaw("no-separator")), null);
});

function encodeNotificationCursorRaw(raw: string): string {
  return Buffer.from(raw, "binary").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

test("읽음판정: boolean 컬럼", () => {
  assert.equal(isNotificationReadRow({ is_read: true }, "is_read"), true);
  assert.equal(isNotificationReadRow({ is_read: false }, "is_read"), false);
  assert.equal(isNotificationReadRow({ is_read: 1 }, "is_read"), true);
  assert.equal(isNotificationReadRow({ is_read: "true" }, "is_read"), true);
  assert.equal(isNotificationReadRow({ read: null }, "read"), false);
});

test("읽음판정: timestamp 컬럼(sentinel 1970 은 미읽음)", () => {
  assert.equal(isNotificationReadRow({ read_at: "2026-07-20T00:00:00Z" }, "read_at"), true);
  assert.equal(isNotificationReadRow({ read_at: null }, "read_at"), false);
  assert.equal(isNotificationReadRow({ read_at: "" }, "read_at"), false);
  assert.equal(isNotificationReadRow({ read_at: "1970-01-01T00:00:00Z" }, "read_at"), false);
});

test("읽음 컬럼이 없으면(readCol null) 항상 미읽음", () => {
  assert.equal(isNotificationReadRow({ anything: true }, null), false);
});
