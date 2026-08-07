import test from "node:test";
import assert from "node:assert/strict";
import {
  anonViewerKeyFromHeaders,
  anonViewerKeyFromRequestHeaders,
  deriveViewEventKey,
  hourBucket,
  viewEventKeyFor,
} from "../viewEventKey.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ANON_KEY_RE = /^anonh:[0-9a-f]{16}$/;

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

test("viewerId 미전달은 최후 폴백 'anon'으로 접힌다(무한 랜덤 방지)", () => {
  const now = new Date("2026-08-07T10:00:00Z");
  assert.equal(viewEventKeyFor("p", null, now), viewEventKeyFor("p", undefined, now));
});

test("hourBucket 은 UTC 시(YYYY-MM-DDTHH) 단위", () => {
  assert.equal(hourBucket(new Date("2026-08-07T10:59:59Z")), "2026-08-07T10");
});

test("anonViewerKeyFromHeaders — 같은 IP·UA 는 항상 같은 키(anonh:<hex16> 형태)", () => {
  const a = anonViewerKeyFromHeaders("203.0.113.7", "Mozilla/5.0");
  const b = anonViewerKeyFromHeaders("203.0.113.7", "Mozilla/5.0");
  assert.equal(a, b);
  assert.match(a, ANON_KEY_RE);
});

test("anonViewerKeyFromHeaders — IP 또는 UA 가 다르면 다른 키(D-CM-3: 전역 접힘 방지)", () => {
  const base = anonViewerKeyFromHeaders("203.0.113.7", "Mozilla/5.0");
  assert.notEqual(base, anonViewerKeyFromHeaders("203.0.113.8", "Mozilla/5.0"));
  assert.notEqual(base, anonViewerKeyFromHeaders("203.0.113.7", "curl/8.0"));
});

test("anonViewerKeyFromHeaders — 한쪽만 있어도 해시 키, 둘 다 부재 시에만 'anon' 폴백", () => {
  assert.match(anonViewerKeyFromHeaders("203.0.113.7", null), ANON_KEY_RE);
  assert.match(anonViewerKeyFromHeaders(null, "Mozilla/5.0"), ANON_KEY_RE);
  assert.equal(anonViewerKeyFromHeaders(null, null), "anon");
  assert.equal(anonViewerKeyFromHeaders(undefined, undefined), "anon");
  assert.equal(anonViewerKeyFromHeaders("  ", ""), "anon");
});

test("anonViewerKeyFromRequestHeaders — x-forwarded-for 는 첫 홉만 사용", () => {
  const direct = new Headers({ "x-forwarded-for": "203.0.113.7", "user-agent": "Mozilla/5.0" });
  const proxied = new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1, 10.0.0.2", "user-agent": "Mozilla/5.0" });
  assert.equal(anonViewerKeyFromRequestHeaders(proxied), anonViewerKeyFromRequestHeaders(direct));
  assert.equal(anonViewerKeyFromRequestHeaders(direct), anonViewerKeyFromHeaders("203.0.113.7", "Mozilla/5.0"));
});

test("anonViewerKeyFromRequestHeaders — 두 헤더 모두 부재 시 'anon' 폴백", () => {
  assert.equal(anonViewerKeyFromRequestHeaders(new Headers()), "anon");
});
