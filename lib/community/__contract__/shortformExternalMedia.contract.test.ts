// 계약 테스트: 레거시 외부 미디어 URL allowlist (D-CM-11).
// 실행: node --test --experimental-strip-types lib/community/__contract__/shortformExternalMedia.contract.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { isAllowedExternalMediaUrl, parseAllowedMediaHosts } from "../shortformExternalMedia.ts";

const allowed = parseAllowedMediaHosts([
  "https://abcd1234.supabase.co",
  "https://cdn.ssambership.example/storage",
  undefined,
  "not a url",
]);

test("parseAllowedMediaHosts 는 유효 URL 의 host 만 소문자로 모은다", () => {
  assert.equal(allowed.has("abcd1234.supabase.co"), true);
  assert.equal(allowed.has("cdn.ssambership.example"), true);
  assert.equal(allowed.size, 2); // 빈 값·형식 오류는 건너뜀
});

test("허용 host 의 http(s) URL 은 통과한다", () => {
  assert.equal(isAllowedExternalMediaUrl("https://abcd1234.supabase.co/storage/v1/x.mp4", allowed), true);
  assert.equal(isAllowedExternalMediaUrl("http://cdn.ssambership.example/a.jpg", allowed), true);
});

test("미허용 오리진은 거부한다(추적·악성 콘텐츠 삽입 벡터 차단)", () => {
  assert.equal(isAllowedExternalMediaUrl("https://evil.example/track.mp4", allowed), false);
  assert.equal(isAllowedExternalMediaUrl("https://abcd1234.supabase.co.evil.example/x", allowed), false);
});

test("http(s) 아닌 스킴과 형식 오류는 거부한다", () => {
  assert.equal(isAllowedExternalMediaUrl("javascript:alert(1)", allowed), false);
  assert.equal(isAllowedExternalMediaUrl("data:video/mp4;base64,AAAA", allowed), false);
  assert.equal(isAllowedExternalMediaUrl("file:///etc/passwd", allowed), false);
  assert.equal(isAllowedExternalMediaUrl("보통 문자열", allowed), false);
});

test("allowlist 가 비면 어떤 외부 URL 도 통과하지 않는다", () => {
  const empty = parseAllowedMediaHosts([]);
  assert.equal(isAllowedExternalMediaUrl("https://abcd1234.supabase.co/x.mp4", empty), false);
});
