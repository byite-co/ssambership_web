import test from "node:test";
import assert from "node:assert/strict";
import { handleLogoutPost, LOGOUT_REDIRECT_STATUS } from "../logoutRoute.ts";

// D-13(F1) — POST /logout 동작 계약.
// F1-R2: POST → signOut 정확히 1회 · 303 · Location "/".
// F1-R3: signOut 실패 → 성공으로 위장하지 않음 · token/cookie 원문 노출 0.

const REQ = () => new Request("http://localhost:3000/logout", { method: "POST" });

function withSilencedConsoleError<T>(fn: () => Promise<T>): Promise<{ result: T; logs: string[] }> {
  const original = console.error;
  const logs: string[] = [];
  console.error = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  return fn()
    .then((result) => ({ result, logs }))
    .finally(() => {
      console.error = original;
    });
}

test("F1-R2: POST 성공 — signOut 1회 · 303 · Location /", async () => {
  let calls = 0;
  const res = await handleLogoutPost(REQ(), {
    signOut: async () => {
      calls += 1;
      return { error: null };
    },
  });
  assert.equal(calls, 1, "signOut 은 정확히 1회");
  assert.equal(res.status, 303, "303 See Other (307/308 은 / 로 POST 를 재전송하므로 금지)");
  assert.equal(LOGOUT_REDIRECT_STATUS, 303);
  const loc = res.headers.get("location");
  assert.ok(loc, "Location 헤더 존재");
  const url = new URL(loc);
  assert.equal(url.pathname, "/", "홈으로 redirect");
  assert.equal(url.search, "", "성공 시 오류 마커 없음");
});

test("F1-R3: signOut 이 error 를 반환 — 성공으로 위장하지 않음(오류 마커) · 원문 노출 0", async () => {
  const SECRET = "refresh-token-원문-abc123";
  let calls = 0;
  const { result: res, logs } = await withSilencedConsoleError(() =>
    handleLogoutPost(REQ(), {
      signOut: async () => {
        calls += 1;
        return { error: { message: "signOut failed" } };
      },
    }),
  );
  assert.equal(calls, 1);
  assert.equal(res.status, 303, "실패도 303 redirect (form POST UX)");
  const url = new URL(res.headers.get("location") ?? "");
  assert.equal(url.pathname, "/");
  assert.equal(url.searchParams.get("logout"), "error", "실패를 성공( / 무마커)으로 위장하지 않는다");
  assert.ok(logs.length > 0, "실패는 서버 로그에 남긴다");
  assert.ok(!logs.join(" ").includes(SECRET), "token 원문 미출력");
  for (const l of logs) {
    assert.ok(!/sb-.*-auth-token|access_token=|refresh_token=/i.test(l), "cookie/token 원문 미출력");
  }
});

test("F1-R3: signOut throw — 응답은 여전히 303 오류 마커 (500 스택 노출 없음)", async () => {
  const { result: res } = await withSilencedConsoleError(() =>
    handleLogoutPost(REQ(), {
      signOut: async () => {
        throw new Error("network down");
      },
    }),
  );
  assert.equal(res.status, 303);
  const url = new URL(res.headers.get("location") ?? "");
  assert.equal(url.searchParams.get("logout"), "error");
});
