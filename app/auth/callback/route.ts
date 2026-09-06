import { NextResponse } from "next/server";
import { getUserProfileById } from "@/lib/auth/getCurrentProfile";
import { resolveOAuthCallbackDestination } from "@/lib/auth/oauthCallbackCore";
import { createClient } from "@/lib/supabase/server";

// GET /auth/callback?code=…&next=<safe>&role_hint=<student|mentor> — 소셜 로그인(PKCE) 콜백.
//
// - `exchangeCodeForSession(code)` 로 세션 쿠키를 심는다(@supabase/ssr 서버 클라이언트가 Set-Cookie).
// - 실패 → `/login/<role_hint|student>?error=oauth` (사유 원문은 URL 에 싣지 않는다).
// - 성공 → users 본인 행 `role · profile_completed_at`:
//     profile_completed_at IS NULL(소셜 첫 가입) → `/complete-profile?role_hint=…&next=…`
//     완성 → `resolvePostLoginPath(next, role)`.
// - 콜백은 아무것도 저장하지 않는다 — 206 트리거가 auth.users.email·provider 이름을 users 에 넣는다.
//   이메일 NULL(카카오 미동의) 계정도 그대로 진행한다(이메일은 선택).
// - `next` 는 `safeInternalNextPath` 로만(open redirect 0). Cache-Control: no-store.

export const dynamic = "force-dynamic";

function redirectTo(requestUrl: string, path: string): NextResponse {
  const res = NextResponse.redirect(new URL(path, requestUrl), 303);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code")?.trim() ?? "";
  const next = url.searchParams.get("next");
  const roleHint = url.searchParams.get("role_hint");

  if (!code) {
    return redirectTo(request.url, resolveOAuthCallbackDestination({ hasCode: false, exchangeOk: false, profile: null, next, roleHint }));
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error || !data?.user) {
      return redirectTo(request.url, resolveOAuthCallbackDestination({ hasCode: true, exchangeOk: false, profile: null, next, roleHint }));
    }

    const { data: profile, error: profileError } = await getUserProfileById(supabase, data.user.id);
    return redirectTo(
      request.url,
      resolveOAuthCallbackDestination({
        hasCode: true,
        exchangeOk: true,
        profile: profile ? { role: profile.role, profile_completed_at: profile.profile_completed_at ?? null } : null,
        profileLookupFailed: Boolean(profileError),
        next,
        roleHint,
      }),
    );
  } catch (e) {
    console.error("[auth/callback] exchange failed", e instanceof Error ? e.message : String(e));
    return redirectTo(request.url, resolveOAuthCallbackDestination({ hasCode: true, exchangeOk: false, profile: null, next, roleHint }));
  }
}
