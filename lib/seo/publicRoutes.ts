/**
 * 사이트맵에 노출할 공개 경로 단일 정본.
 *
 * 사이트맵 생성기와 계약 테스트가 이 배열 하나만 참조한다. 로그인이 필요하거나
 * 개인화된 화면(질문방·마이페이지·캐시·콘솔)과, 색인 제외로 확정된
 * 멘토 상세·커뮤니티 개별 글은 여기에 넣지 않는다.
 *
 * 리다이렉트 전용 스텁도 넣지 않는다: /pricing(→ /mentors, 307)과
 * /community/shorts(→ /community/shortform, 308)는 본문이 없고 목적지가 이미 이 목록에
 * 있어, 제출하면 서치어드바이저가 "리다이렉트된 페이지"로 수집 제외 처리한다.
 */

/**
 * 공개 색인 대상 경로 18개. 선행 슬래시를 포함한 상대 경로이며 순서가 곧 사이트맵 순서다.
 *
 * changefreq·priority 는 넣지 않는다 — 네이버·구글 모두 선택 항목으로 취급하고
 * 실제 수집 우선순위에 미치는 영향이 미미해, 관리 비용만 늘기 때문이다.
 */
export const PUBLIC_SITEMAP_ROUTES: readonly string[] = [
  "/",
  "/about",
  "/support",
  "/notices",
  "/mentors",
  "/legal/terms",
  "/legal/privacy",
  "/legal/refund",
  "/legal/copyright",
  "/legal/mentor-guide",
  "/legal/payout-guide",
  "/legal/minor-consent",
  "/legal/community-guidelines",
  "/legal/no-ghostwriting",
  "/legal/no-offplatform-contact",
  "/community",
  "/community/board",
  "/community/shortform",
] as const;

/**
 * 공개 경로를 절대 URL 배열로 만든다.
 *
 * origin 말미 슬래시는 제거해 "//" 중복을 막는다. 루트만 `${origin}/` 로 만들어
 * 말미 슬래시 1개를 유지하고(경로 없는 오리진만 남는 것을 방지), 나머지는 경로를
 * 그대로 이어 붙인다.
 */
export function buildPublicSitemapUrls(origin: string): string[] {
  const base = origin.replace(/\/+$/, "");
  return PUBLIC_SITEMAP_ROUTES.map((route) =>
    route === "/" ? `${base}/` : `${base}${route}`,
  );
}
