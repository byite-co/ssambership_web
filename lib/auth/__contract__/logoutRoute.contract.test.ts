import test from "node:test";
import assert from "node:assert/strict";
import { inspect } from "node:util";
import { handleLogoutPost, LOGOUT_REDIRECT_STATUS } from "../logoutRoute.ts";

// D-13(F1) — POST /logout 동작 계약.
// F1-R2: POST → signOut 정확히 1회 · 303 · Location "/".
// F1-R3: signOut 실패 → 성공으로 위장하지 않음 · token/cookie 원문 노출 0.
//
// F1-R3 강화(F1-D): 종전 테스트는 SECRET 을 mock 오류에 주입하지 않아
// `!logs.includes(SECRET)` 이 자명하게 통과했다. 아래 테스트는 SECRET 을
// 오류 "구조"(message 이외 필드 · cause · stack · toString/toJSON 트랩)에
// 실제로 주입해, 라우트가 error.message 만 읽고 오류 객체를 직렬화하지
// 않음을 실증한다.
//
// 경계(의도된 범위): 라우트는 upstream `error.message` 문자열을 그대로 로깅한다.
// 따라서 "라우트가 접근 가능한 자격증명(세션·쿠키·오류 객체 필드)의 유출 0" 은
// 아래 테스트가 보증하지만, GoTrue 가 message 안에 토큰 값을 직접 끼워 넣는
// 경우까지 방어하지는 않는다. 실제 GoTrue 오류 message
// ("Auth session missing!", "Invalid Refresh Token: Refresh Token Not Found" 등)
// 는 토큰 값을 담지 않으므로 D-13 범위 밖으로 둔다. message 자체의 redaction 을
// 도입하려면 제품 코드 변경이 필요하며 별도 세션에서 다룬다.

const REQ = () => new Request("http://localhost:3000/logout", { method: "POST" });

// console.error 는 문자열이 아닌 인자를 util.inspect 로 전개한다.
// 캡처를 String() 으로만 하면 `console.error("msg", errObj)` 가
// "[object Object]" 로 접혀 유출을 놓치므로, 실제 동작을 그대로 모사한다.
function formatArg(arg: unknown): string {
  return typeof arg === "string" ? arg : inspect(arg, { depth: null, showHidden: true, getters: true });
}

function withSilencedConsoleError<T>(fn: () => Promise<T>): Promise<{ result: T; logs: string[] }> {
  const original = console.error;
  const logs: string[] = [];
  console.error = (...args: unknown[]) => {
    logs.push(args.map(formatArg).join(" "));
  };
  return fn()
    .then((result) => ({ result, logs }))
    .finally(() => {
      console.error = original;
    });
}

/** 로그/응답 어디에도 나타나면 안 되는 자격증명 원문 형태. */
const RAW_CREDENTIAL_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "supabase auth cookie", re: /sb-[a-z0-9-]+-auth-token/i },
  { name: "access_token=", re: /access_token["'\s]*[=:]/i },
  { name: "refresh_token=", re: /refresh_token["'\s]*[=:]/i },
  { name: "JWT 형태", re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { name: "Set-Cookie 원문", re: /set-cookie/i },
];

/**
 * 유출 검사용 표현들 — 원문 그대로뿐 아니라 percent-encoding 으로 접힌 형태도 본다.
 * (URL 로 새어 나갈 때 `encodeURIComponent` 를 거치면 단순 substring 검사를 빠져나간다.)
 */
function leakSurfaces(text: string): string[] {
  const out = [text];
  try {
    const decoded = decodeURIComponent(text);
    if (decoded !== text) out.push(decoded);
  } catch {
    // 잘못된 escape sequence 는 원문 검사만 수행한다.
  }
  return out;
}

function assertNoSecret(text: string, secret: string, where: string): void {
  for (const surface of leakSurfaces(text)) {
    assert.ok(!surface.includes(secret), `${where}: 원문 노출 — ${surface}`);
  }
}

function assertNoRawCredentials(text: string, where: string): void {
  for (const surface of leakSurfaces(text)) {
    for (const { name, re } of RAW_CREDENTIAL_PATTERNS) {
      assert.ok(!re.test(surface), `${where}: ${name} 원문 노출 — ${surface}`);
    }
  }
}

async function assertResponseCarriesNoSecret(res: Response, secret: string): Promise<void> {
  const location = res.headers.get("location") ?? "";
  assertNoSecret(location, secret, "Location 헤더");
  assertNoRawCredentials(location, "Location");

  // 실패 redirect 의 query 는 오류 마커 하나뿐 — 진단 데이터를 실어 보내지 않는다.
  const url = new URL(location);
  assert.deepEqual(
    [...url.searchParams.keys()].sort(),
    url.search === "" ? [] : ["logout"],
    `redirect query 에 예상 밖 파라미터 — ${url.search}`,
  );
  for (const [key, value] of url.searchParams) {
    assertNoSecret(value, secret, `redirect query "${key}"`);
    assertNoRawCredentials(value, `redirect query "${key}"`);
  }

  const headerDump = [...res.headers.entries()].map(([k, v]) => `${k}: ${v}`).join("\n");
  assertNoSecret(headerDump, secret, "응답 헤더");
  assertNoRawCredentials(headerDump, "응답 헤더");

  const body = await res.clone().text();
  assertNoSecret(body, secret, "응답 본문");
  assertNoRawCredentials(body, "응답 본문");
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
  // SECRET 을 Supabase AuthError 가 실제로 들고 다닐 수 있는 형태로 주입한다.
  // message 는 무해하지만 객체 전체를 직렬화하면 즉시 유출된다.
  const SECRET = "sb-refresh-token-원문-abc123DEF456";
  const authError = {
    name: "AuthApiError",
    message: "Auth session missing!",
    status: 400,
    __isAuthError: true,
    refresh_token: SECRET,
    access_token: `eyJhbGciOiJIUzI1NiJ9.${SECRET}`,
    session: { access_token: SECRET, refresh_token: SECRET },
    // 직렬화 트랩 — 라우트가 객체를 통째로 넘기면 여기서 새어 나간다.
    toString: () => `AuthApiError: ${SECRET}`,
    toJSON: () => ({ leaked: SECRET }),
  };

  let calls = 0;
  const { result: res, logs } = await withSilencedConsoleError(() =>
    handleLogoutPost(REQ(), {
      signOut: async () => {
        calls += 1;
        return { error: authError };
      },
    }),
  );

  assert.equal(calls, 1);
  assert.equal(res.status, 303, "실패도 303 redirect (form POST UX)");
  const url = new URL(res.headers.get("location") ?? "");
  assert.equal(url.pathname, "/");
  assert.equal(url.searchParams.get("logout"), "error", "실패를 성공( / 무마커)으로 위장하지 않는다");

  // 로그: 남기되, 자격증명 원문은 한 조각도 남기지 않는다.
  assert.ok(logs.length > 0, "실패는 서버 로그에 남긴다");
  const joined = logs.join("\n");
  assertNoSecret(joined, SECRET, "로그");
  assertNoRawCredentials(joined, "로그");

  // 최소 정보 원칙 — 오류 진단 message 한 줄이 전부이며 오류 객체는 직렬화되지 않는다.
  assert.equal(logs.length, 1, "실패당 로그 1줄");
  assert.equal(
    logs[0],
    "[POST /logout] signOut failed: Auth session missing!",
    "message 이외의 오류 필드가 로그에 포함됨(객체 직렬화 의심)",
  );

  // 사용자 반환 경로에도 원문이 실리지 않는다.
  await assertResponseCarriesNoSecret(res, SECRET);
});

test("F1-R3: signOut throw — 응답은 여전히 303 오류 마커 (500 스택 노출 없음)", async () => {
  // 던져진 Error 의 cause · 커스텀 프로퍼티 · stack 에 SECRET 을 심는다.
  // 라우트가 e.message 만 읽지 않고 e 나 e.stack 을 로깅하면 즉시 유출된다.
  const SECRET = "sb-access-token-원문-ZZZ999";
  const thrown = new Error("network down", { cause: { refresh_token: SECRET } }) as Error & {
    access_token?: string;
  };
  thrown.access_token = SECRET;
  thrown.stack = `Error: network down\n    at signOut (/app/node_modules/@supabase/auth-js/index.js:1:1) [${SECRET}]`;

  const { result: res, logs } = await withSilencedConsoleError(() =>
    handleLogoutPost(REQ(), {
      signOut: async () => {
        throw thrown;
      },
    }),
  );

  assert.equal(res.status, 303);
  const url = new URL(res.headers.get("location") ?? "");
  assert.equal(url.pathname, "/");
  assert.equal(url.searchParams.get("logout"), "error");

  const joined = logs.join("\n");
  assertNoSecret(joined, SECRET, "throw 로그");
  assertNoRawCredentials(joined, "throw 로그");
  assert.ok(!joined.includes("at signOut"), "스택 트레이스 미출력");
  assert.equal(logs.length, 1, "실패당 로그 1줄");
  assert.equal(
    logs[0],
    "[POST /logout] signOut threw: network down",
    "message 이외의 오류 정보(stack/cause/프로퍼티)가 로그에 포함됨",
  );

  await assertResponseCarriesNoSecret(res, SECRET);
});

test("F1-R3: 비 Error throw(문자열·객체) — 원문 노출 0 · 오류 마커 유지", async () => {
  // Error 가 아닌 값이 던져져도 "unknown" 으로만 축약되어야 한다.
  const SECRET = "sb-nonerror-token-원문-QQQ111";

  for (const thrown of [SECRET, { refresh_token: SECRET }, [SECRET]] as const) {
    const { result: res, logs } = await withSilencedConsoleError(() =>
      handleLogoutPost(REQ(), {
        signOut: async () => {
          throw thrown;
        },
      }),
    );

    assert.equal(res.status, 303);
    assert.equal(new URL(res.headers.get("location") ?? "").searchParams.get("logout"), "error");

    const joined = logs.join("\n");
    assertNoSecret(joined, SECRET, "비 Error throw 로그");
    assertNoRawCredentials(joined, "비 Error throw 로그");
    assert.equal(logs[0], "[POST /logout] signOut threw: unknown");

    await assertResponseCarriesNoSecret(res, SECRET);
  }
});

test("F1-R3: message 부재/null 오류 — 원문 없이 unknown 으로 축약", async () => {
  const SECRET = "sb-nullmsg-token-원문-WWW222";

  for (const error of [{ message: null }, { message: undefined }, {}] as const) {
    const { result: res, logs } = await withSilencedConsoleError(() =>
      handleLogoutPost(REQ(), {
        signOut: async () => ({ error: { ...error, refresh_token: SECRET } }),
      }),
    );

    assert.equal(res.status, 303);
    assert.equal(new URL(res.headers.get("location") ?? "").searchParams.get("logout"), "error");

    const joined = logs.join("\n");
    assertNoSecret(joined, SECRET, "message 부재 로그");
    assertNoRawCredentials(joined, "message 부재 로그");
    assert.equal(logs[0], "[POST /logout] signOut failed: unknown");
  }
});

test("F1-R3: 성공 경로는 로그를 남기지 않는다(불필요 정보 0)", async () => {
  const { result: res, logs } = await withSilencedConsoleError(() =>
    handleLogoutPost(REQ(), { signOut: async () => ({ error: null }) }),
  );
  assert.equal(res.status, 303);
  assert.deepEqual(logs, [], "성공 시 로그 없음");
});
