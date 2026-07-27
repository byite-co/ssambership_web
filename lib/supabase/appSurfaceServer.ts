import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { hardenAppSurfaceCookieOptions } from "@/lib/appSession/appSurfaceCookies";

/**
 * 앱(WebView) 표면 **전용** Supabase 서버 클라이언트.
 *
 * 일반 `lib/supabase/server.ts` 와의 유일한 차이는 쿠키 쓰기 경로다:
 * 이 클라이언트를 통한 모든 쿠키 쓰기(최초 발급 이후의 refresh 재발급·회전·
 * maxAge=0 삭제, chunk 쿠키 전부)는 HttpOnly/Secure/SameSite=Lax/Path=/ 로
 * 강제된다 — 앱 표면 쿠키가 이후 재발급에서 일반(httpOnly=false) 속성으로
 * 내려가는 구조를 제거한다(appSurfaceCookies 정본).
 *
 * 사용 범위(계약테스트가 import 지점을 회귀 감시한다):
 * - POST /api/app-session/bootstrap
 * - /app/community/shortform/new (세션 검증·draft 조회)
 * - 앱 표면 wrapper 액션(서명 티켓·finalize)
 * 일반 웹 표면은 절대 이 클라이언트를 쓰지 않는다(웹 로그인은 브라우저가
 * document.cookie 로 세션을 기록하므로 HttpOnly 화하면 로그인이 깨진다).
 */
export async function createAppSurfaceClient() {
  const cookieStore = await cookies();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.SUPABASE_ANON_KEY;

  return createServerClient(url ?? "", anonKey ?? "", {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, hardenAppSurfaceCookieOptions(options));
          });
        } catch {
          // Server Component 렌더 중 쿠키 쓰기 불가(Next 제약) — 전역 클라이언트와 동일하게 무시.
        }
      },
    },
  });
}
