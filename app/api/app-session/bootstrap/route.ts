import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { CookieOptions } from "@supabase/ssr";
import {
  APP_SESSION_BOOTSTRAP_TARGETS,
  bootstrapProjectRefMatches,
  parseBootstrapBody,
} from "@/lib/appSession/appSessionBootstrapCore";
import type { AppBridgeErrorCode } from "@/lib/appSession/appSurfacePaths";
import { appBridgeErrorPath } from "@/lib/appSession/appSurfacePaths";

// POST /api/app-session/bootstrap — 앱 WebView 세션 부트스트랩(단일 target: shortform_create).
//
// 보안 계약:
// - POST 전용(GET/PUT/PATCH/DELETE 405). Content-Type allowlist(form-urlencoded/json).
// - 토큰은 body 로만 받고 URL·로그·응답 어디에도 싣지 않는다. Cache-Control: no-store.
// - 앱 토큰의 발급 프로젝트 ref 와 웹 Supabase ref 가 일치해야 한다(교차 프로젝트 이식 차단).
// - auth.setSession 후 auth.getUser 로 실사용자 재검증(서명·만료는 auth 서버가 판정).
// - redirect 대상은 전부 서버 상수(open redirect 0). 실패는 고정 브릿지 오류 페이지로.
// - 쿠키는 이 라우트 한정으로 HttpOnly/Secure/SameSite=Lax 를 강제한다(3-3):
//   전역 lib/supabase/server.ts 기본값(@supabase/ssr 0.10.2: httpOnly=false)은 건드리지
//   않는다 — 전역 HttpOnly 화(化)는 브라우저 로그인(document.cookie 기록)을 깨뜨린다.
//   한계: 이후 다른 서버 경로에서 토큰 refresh 로 쿠키가 재발급되면 전역 기본 속성으로
//   내려간다(기능 저하 없음 — 속성 강화가 부트스트랩 발급분에 한정될 뿐). 문서화됨.

export const dynamic = "force-dynamic";

const NO_STORE = "no-store";

function withNoStore<T extends NextResponse | Response>(res: T): T {
  res.headers.set("Cache-Control", NO_STORE);
  return res;
}

function errorRedirect(requestUrl: string, code: AppBridgeErrorCode): NextResponse {
  return withNoStore(NextResponse.redirect(new URL(appBridgeErrorPath(code), requestUrl), 303));
}

function methodNotAllowed(): Response {
  return withNoStore(
    new Response(null, { status: 405, headers: { Allow: "POST" } }),
  );
}

export async function GET() {
  return methodNotAllowed();
}
export async function PUT() {
  return methodNotAllowed();
}
export async function PATCH() {
  return methodNotAllowed();
}
export async function DELETE() {
  return methodNotAllowed();
}

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    const parsed = parseBootstrapBody(request.headers.get("content-type"), rawBody);
    if (!parsed.ok) {
      // 세부 사유는 로그·응답에 싣지 않는다(토큰 포함 가능 입력을 되비추지 않음).
      return errorRedirect(request.url, "invalid_request");
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
    const anonKey =
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
      process.env.SUPABASE_ANON_KEY ??
      "";
    if (!supabaseUrl || !anonKey) return errorRedirect(request.url, "bootstrap_failed");

    // 프로젝트 ref 일치 선검증 — 다른 Supabase 프로젝트에서 발급된 토큰의 이식을 차단.
    if (!bootstrapProjectRefMatches(parsed.accessToken, supabaseUrl)) {
      return errorRedirect(request.url, "bootstrap_failed");
    }

    const cookieStore = await cookies();
    const pendingCookies: { name: string; value: string; options: CookieOptions }[] = [];
    const supabase = createServerClient(supabaseUrl, anonKey, {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          pendingCookies.push(...cookiesToSet);
        },
      },
    });

    const { error: setError } = await supabase.auth.setSession({
      access_token: parsed.accessToken,
      refresh_token: parsed.refreshToken,
    });
    if (setError) return errorRedirect(request.url, "bootstrap_failed");

    // 실사용자 재검증(auth 서버 왕복) — 위조·만료 토큰은 여기서 걸러진다.
    const { data, error: userError } = await supabase.auth.getUser();
    if (userError || !data?.user) return errorRedirect(request.url, "bootstrap_failed");

    const targetPath = APP_SESSION_BOOTSTRAP_TARGETS[parsed.target];
    const res = withNoStore(NextResponse.redirect(new URL(targetPath, request.url), 303));
    for (const { name, value, options } of pendingCookies) {
      res.cookies.set(name, value, {
        ...options,
        httpOnly: true,
        secure: true,
        sameSite: "lax",
      });
    }
    return res;
  } catch {
    return errorRedirect(request.url, "bootstrap_failed");
  }
}
