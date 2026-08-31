import { test } from "node:test";
import assert from "node:assert/strict";
import { ALLOWED_APP_HOSTS, resolveRequestOrigin } from "../requestOrigin.ts";

const h = (init: Record<string, string>) => new Headers(init);

test("허용 호스트(apex/www)는 https 오리진으로 통과", () => {
  assert.equal(resolveRequestOrigin(h({ host: "ssambership.com" })), "https://ssambership.com");
  assert.equal(resolveRequestOrigin(h({ host: "www.ssambership.com" })), "https://www.ssambership.com");
  assert.deepEqual([...ALLOWED_APP_HOSTS], ["ssambership.com", "www.ssambership.com"]);
});

test("x-forwarded-host 가 host 보다 우선하고 콤마 다중값은 첫 항목만", () => {
  assert.equal(
    resolveRequestOrigin(h({ host: "internal.vercel.app", "x-forwarded-host": "www.ssambership.com, proxy" })),
    "https://www.ssambership.com"
  );
});

test("허용목록 밖 호스트는 null (프리뷰·위조 Host 차단 → 호출측 APP_URL 폴백)", () => {
  assert.equal(resolveRequestOrigin(h({ host: "ssambership-web-git-main-byite.vercel.app" })), null);
  assert.equal(resolveRequestOrigin(h({ host: "evil.example" })), null);
  assert.equal(resolveRequestOrigin(h({})), null);
});

test("x-forwarded-proto 는 http/https 만 신뢰", () => {
  assert.equal(resolveRequestOrigin(h({ host: "ssambership.com", "x-forwarded-proto": "http" })), "http://ssambership.com");
  assert.equal(resolveRequestOrigin(h({ host: "ssambership.com", "x-forwarded-proto": "gopher" })), "https://ssambership.com");
});

test("localhost 는 allowLocalhost 일 때만, 포트 보존, http 기본", () => {
  assert.equal(resolveRequestOrigin(h({ host: "localhost:3000" })), null);
  assert.equal(resolveRequestOrigin(h({ host: "localhost:3000" }), { allowLocalhost: true }), "http://localhost:3000");
});

test("대소문자 정규화", () => {
  assert.equal(resolveRequestOrigin(h({ host: "WWW.Ssambership.com" })), "https://www.ssambership.com");
});
