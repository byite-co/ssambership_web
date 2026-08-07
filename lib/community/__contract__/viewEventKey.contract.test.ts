import test from "node:test";
import assert from "node:assert/strict";
import { deriveViewEventKey, hourBucket, viewEventKeyFor } from "../viewEventKey.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test("결정적 — 같은 입력은 항상 같은 키", () => {
  const a = deriveViewEventKey(["post-1", "user-1", "2026-08-07T10"]);
  const b = deriveViewEventKey(["post-1", "user-1", "2026-08-07T10"]);
  assert.equal(a, b);
});

test("RFC-4122 v5 형태 UUID 문자열", () => {
  assert.match(deriveViewEventKey(["post-1", "user-1", "2026-08-07T10"]), UUID_RE);
  assert.match(viewEventKeyFor("post-1", null), UUID_RE);
});

test("입력이 다르면 키가 다르다 (게시글·뷰어·시간버킷)", () => {
  const base = deriveViewEventKey(["post-1", "user-1", "2026-08-07T10"]);
  assert.notEqual(base, deriveViewEventKey(["post-2", "user-1", "2026-08-07T10"]));
  assert.notEqual(base, deriveViewEventKey(["post-1", "user-2", "2026-08-07T10"]));
  assert.notEqual(base, deriveViewEventKey(["post-1", "user-1", "2026-08-07T11"]));
});

test("같은 시간버킷 재조회는 같은 키(멱등), 다음 시간대는 새 키", () => {
  const t1 = new Date("2026-08-07T10:05:00Z");
  const t2 = new Date("2026-08-07T10:55:00Z");
  const t3 = new Date("2026-08-07T11:01:00Z");
  assert.equal(viewEventKeyFor("p", "u", t1), viewEventKeyFor("p", "u", t2), "같은 시간대 = 멱등");
  assert.notEqual(viewEventKeyFor("p", "u", t1), viewEventKeyFor("p", "u", t3), "다음 시간대 = 새 계수");
});

test("비로그인 뷰어는 'anon'으로 접힌다(무한 랜덤 방지)", () => {
  const now = new Date("2026-08-07T10:00:00Z");
  assert.equal(viewEventKeyFor("p", null, now), viewEventKeyFor("p", undefined, now));
});

test("hourBucket 은 UTC 시(YYYY-MM-DDTHH) 단위", () => {
  assert.equal(hourBucket(new Date("2026-08-07T10:59:59Z")), "2026-08-07T10");
});
