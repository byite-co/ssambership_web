/**
 * D-13(PREFETCH_SIDE_EFFECT) 계약 — 로그아웃은 상태 변경이므로 POST 전용이다.
 *
 * - GET /logout 은 존재하지 않는다(라우트가 GET 을 export 하지 않아 405).
 * - POST 성공: signOut 1회 → 303 See Other → `/` (307/308 금지 — `/` 로 POST 재전송 방지).
 * - POST 실패: 성공으로 위장하지 않고 `/?logout=error` 로 303. 로그에는 오류 메시지만
 *   남기고 token/cookie 원문은 절대 출력하지 않는다.
 */

export type LogoutSignOutError = { message?: string | null } | null;

export type LogoutRouteDeps = {
  signOut: () => Promise<{ error: LogoutSignOutError }>;
};

export const LOGOUT_REDIRECT_STATUS = 303;

export async function handleLogoutPost(request: Request, deps: LogoutRouteDeps): Promise<Response> {
  let failed = false;
  try {
    const { error } = await deps.signOut();
    if (error) {
      failed = true;
      console.error("[POST /logout] signOut failed:", error.message ?? "unknown");
    }
  } catch (e) {
    failed = true;
    console.error("[POST /logout] signOut threw:", e instanceof Error ? e.message : "unknown");
  }
  const dest = new URL(failed ? "/?logout=error" : "/", request.url);
  return Response.redirect(dest, LOGOUT_REDIRECT_STATUS);
}
