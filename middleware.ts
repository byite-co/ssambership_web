import { type NextRequest, NextResponse } from "next/server";

/**
 * RSC `requireRole`이 로그인으로 보낼 때 `next`에 붙일 복귀 URL.
 * (상대 path + query, open redirect는 `safeInternalNextPath`에서 제거)
 */
export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const returnPath = `${pathname}${search}`;

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", pathname);
  requestHeaders.set("x-return-to", returnPath);

  return NextResponse.next({ request: { headers: requestHeaders } });
}

// matcher 확장자 제외에 txt·xml·html 포함: robots.txt·sitemap.xml·네이버 소유확인 html 은
// 미들웨어를 탈 이유가 없고, 네이버 검색로봇은 robots.txt 가 5xx 면 사이트 전체를 수집
// 차단으로 해석하므로 정적 자산을 미들웨어 예외 경로에 노출하지 않는다.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff2?|ttf|txt|xml|html)).*)"],
};
