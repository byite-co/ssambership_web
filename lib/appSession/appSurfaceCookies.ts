// 앱(WebView) 표면 쿠키 속성 정본 — 순수 모듈(next·supabase 미의존, node --test 대상).
//
// 계약:
// - 앱 표면의 **모든** Supabase 쿠키 쓰기(bootstrap 최초 발급·refresh 재발급·회전·
//   maxAge=0 삭제, chunk 쿠키 .0/.1/... 전부)는 아래 고정 속성을 갖는다.
// - 입력 options 가 무엇을 주장하든(httpOnly:false 포함) 고정 속성이 이긴다.
// - maxAge 는 라이브러리(@supabase/ssr)가 결정한 값을 그대로 보존한다
//   (세트: 기본 400일, 삭제: 0) — 만료 의미론은 바꾸지 않는다.
// - 일반 웹 표면(lib/supabase/server.ts)은 이 모듈을 사용하지 않는다(전역 기본 유지).

export const APP_SURFACE_COOKIE_ATTRIBUTES = Object.freeze({
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/",
} as const);

/** @supabase/ssr CookieOptions 와 구조 호환(순수성 유지를 위해 로컬 정의). */
export type AppSurfaceCookieOptions = {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "lax" | "strict" | "none" | boolean;
  path?: string;
  maxAge?: number;
  domain?: string;
  expires?: Date;
  [key: string]: unknown;
};

export type AppSurfaceCookieWrite = {
  name: string;
  value: string;
  options: AppSurfaceCookieOptions;
};

/** 단일 쿠키 옵션 강제 — 고정 속성 외(maxAge/domain/expires 등)는 보존. */
export function hardenAppSurfaceCookieOptions(
  options: AppSurfaceCookieOptions | null | undefined,
): AppSurfaceCookieOptions {
  return { ...(options ?? {}), ...APP_SURFACE_COOKIE_ATTRIBUTES };
}

/** 쓰기 목록 전체 강제 — chunk 쿠키(.0/.1/...)를 포함해 전 항목 동일 속성 보장. */
export function hardenAppSurfaceCookieWrites(
  writes: readonly AppSurfaceCookieWrite[],
): AppSurfaceCookieWrite[] {
  return writes.map((w) => ({
    name: w.name,
    value: w.value,
    options: hardenAppSurfaceCookieOptions(w.options),
  }));
}
