import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { CookieOptions } from "@supabase/ssr";
import {
  APP_SESSION_BOOTSTRAP_TARGETS,
  bootstrapProjectRefMatches,
  parseBootstrapBody,
} from "@/lib/appSession/appSessionBootstrapCore";
import {
  assertAppSurfaceAccountActiveStrict,
  strictMentorRoleDecision,
} from "@/lib/appSession/appSurfaceAccountGate";
import { hardenAppSurfaceCookieWrites } from "@/lib/appSession/appSurfaceCookies";
import type { AppBridgeErrorCode } from "@/lib/appSession/appSurfacePaths";
import { appBridgeErrorPath } from "@/lib/appSession/appSurfacePaths";
import { getUserProfileById } from "@/lib/auth/getCurrentProfile";

// POST /api/app-session/bootstrap — 앱 WebView 세션 부트스트랩(단일 target: shortform_create).
//
// 보안 계약:
// - POST 전용(GET/PUT/PATCH/DELETE 405). Content-Type allowlist(form-urlencoded/json).
// - 토큰은 body 로만 받고 URL·로그·응답 어디에도 싣지 않는다. Cache-Control: no-store.
// - 앱 토큰의 발급 프로젝트 ref 와 웹 Supabase ref 가 일치해야 한다(교차 프로젝트 이식 차단).
// - [쿠키 버퍼 불변식] setSession 이 쓰는 쿠키는 격리 버퍼(pendingCookies)에만 기록되고,
//   getUser(실사용자)·계정 활성·mentor role·target 검증이 **전부** 통과한 성공 응답에만
//   부착된다. 어떤 실패 응답에도 Set-Cookie 는 0개다(버퍼 폐기).
// - redirect 대상은 전부 서버 상수(open redirect 0). 실패는 고정 브릿지 오류 페이지로.
// - 쿠키 속성은 appSurfaceCookies 정본(HttpOnly/Secure/SameSite=Lax/Path=/)으로 강제하며,
//   이후 앱 표면의 refresh 재발급·회전·삭제도 전용 클라이언트(appSurfaceServer)가 같은
//   속성으로 쓴다 — 최초만 HttpOnly 였다가 재발급에서 내려가는 구조 없음. 전역
//   lib/supabase/server.ts 기본값(httpOnly=false)은 불변경(전역 변경은 브라우저 로그인 파괴).

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

    // 계정 게이트(strict·fail-closed: 행 없음/조회 오류/미지 status/유효 정지/banned/
    // 삭제 write-block/RPC 실패 전부 거부) → mentor role 게이트. 어느 실패든 쿠키
    // 버퍼는 부착 없이 폐기되고, 고정 오류 code 외 내부 상태는 반사하지 않는다.
    const acctGate = await assertAppSurfaceAccountActiveStrict(supabase, data.user.id);
    if (!acctGate.ok) return errorRedirect(request.url, "account_blocked");
    const { data: profile, error: profileError } = await getUserProfileById(supabase, data.user.id);
    const roleDecision = strictMentorRoleDecision(profile, Boolean(profileError));
    if (roleDecision === "profile_unavailable") return errorRedirect(request.url, "bootstrap_failed");
    if (roleDecision === "not_mentor") return errorRedirect(request.url, "mentor_only");

    const targetPath = APP_SESSION_BOOTSTRAP_TARGETS[parsed.target];
    const res = withNoStore(NextResponse.redirect(new URL(targetPath, request.url), 303));
    for (const { name, value, options } of hardenAppSurfaceCookieWrites(pendingCookies)) {
      res.cookies.set(name, value, options as CookieOptions);
    }
    return res;
  } catch {
    return errorRedirect(request.url, "bootstrap_failed");
  }
}
