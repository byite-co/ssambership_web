import test from "node:test";
import assert from "node:assert/strict";
import {
  APP_SURFACE_COOKIE_ATTRIBUTES,
  hardenAppSurfaceCookieOptions,
  hardenAppSurfaceCookieWrites,
} from "../appSurfaceCookies.ts";

test("bootstrap 발급 쿠키 속성: HttpOnly·Secure·SameSite=Lax·Path=/ 고정", () => {
  const o = hardenAppSurfaceCookieOptions({ maxAge: 400 * 24 * 60 * 60 });
  assert.equal(o.httpOnly, true);
  assert.equal(o.secure, true);
  assert.equal(o.sameSite, "lax");
  assert.equal(o.path, "/");
  assert.equal(o.maxAge, 400 * 24 * 60 * 60); // 라이브러리 결정 Max-Age 보존
});

test("입력이 무엇을 주장해도 고정 속성이 이긴다(httpOnly:false 강등 시도 차단)", () => {
  const o = hardenAppSurfaceCookieOptions({
    httpOnly: false,
    secure: false,
    sameSite: "none",
    path: "/somewhere",
    maxAge: 123,
  });
  assert.equal(o.httpOnly, true);
  assert.equal(o.secure, true);
  assert.equal(o.sameSite, "lax");
  assert.equal(o.path, "/");
  assert.equal(o.maxAge, 123);
});

test("refresh 재발급(두 번째 쓰기)도 같은 속성 — 최초만 HttpOnly 인 구조 없음", () => {
  // @supabase/ssr 는 refresh 때 setAll 을 다시 부른다 — 같은 harden 경로를 타므로 속성 동일.
  const first = hardenAppSurfaceCookieOptions({ maxAge: 34560000 });
  const refreshRewrite = hardenAppSurfaceCookieOptions({ maxAge: 34560000, httpOnly: false });
  assert.deepEqual(
    { httpOnly: first.httpOnly, secure: first.secure, sameSite: first.sameSite, path: first.path },
    {
      httpOnly: refreshRewrite.httpOnly,
      secure: refreshRewrite.secure,
      sameSite: refreshRewrite.sameSite,
      path: refreshRewrite.path,
    },
  );
});

test("삭제(logout/세션 폐기, maxAge=0)도 동일 속성으로 쓴다 — 삭제 의미론 보존", () => {
  const o = hardenAppSurfaceCookieOptions({ maxAge: 0 });
  assert.equal(o.maxAge, 0); // 0 이 라이브러리 삭제 신호 — 덮어쓰지 않음
  assert.equal(o.httpOnly, true);
  assert.equal(o.secure, true);
});

test("chunk 쿠키(.0/.1/...) 전체가 동일 속성 — 일부만 강화되는 일 없음", () => {
  const writes = hardenAppSurfaceCookieWrites([
    { name: "sb-ref-auth-token.0", value: "aaa", options: { maxAge: 100 } },
    { name: "sb-ref-auth-token.1", value: "bbb", options: { maxAge: 100, httpOnly: false } },
    { name: "sb-ref-auth-token.2", value: "", options: { maxAge: 0 } }, // 회전 잔여 chunk 삭제
  ]);
  assert.equal(writes.length, 3);
  for (const w of writes) {
    assert.equal(w.options.httpOnly, true, w.name);
    assert.equal(w.options.secure, true, w.name);
    assert.equal(w.options.sameSite, "lax", w.name);
    assert.equal(w.options.path, "/", w.name);
  }
  // name/value 는 그대로(토큰 값 가공·기록 없음).
  assert.deepEqual(writes.map((w) => [w.name, w.value]), [
    ["sb-ref-auth-token.0", "aaa"],
    ["sb-ref-auth-token.1", "bbb"],
    ["sb-ref-auth-token.2", ""],
  ]);
});

test("속성 정본은 동결(우발 변형 차단)", () => {
  assert.equal(Object.isFrozen(APP_SURFACE_COOKIE_ATTRIBUTES), true);
  assert.deepEqual(APP_SURFACE_COOKIE_ATTRIBUTES, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
  });
});
