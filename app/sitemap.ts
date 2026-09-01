import type { MetadataRoute } from "next";

import { buildPublicSitemapUrls } from "@/lib/seo/publicRoutes";
import { siteUrl } from "@/lib/seo/siteUrl";

/**
 * 멘토 상세(/mentors/[mentorId]) 색인 여부.
 * 현재 false — 멘토 실명·소속 학교가 상세 페이지에 노출되는 구조라 공개 색인 정책이 확정되지 않았다.
 */
const INDEX_MENTOR_DETAIL = false;

/**
 * 커뮤니티 글(게시판·숏폼 상세) 색인 여부.
 * 현재 false — 회원이 작성한 글에 개인정보가 섞였는지 판단하는 기준이 아직 서 있지 않다.
 */
const INDEX_COMMUNITY_POST = false;

/**
 * sitemap.xml (App Router 파일 규약: /sitemap.xml 로 서빙된다).
 *
 * 공개 정적 경로 목록의 정본은 lib/seo/publicRoutes 이며, 이 파일은 경로 문자열을 다시 적지 않고
 * buildPublicSitemapUrls() 를 경유해서만 절대 URL 을 만든다(목록이 두 곳으로 갈라지는 것을 막는다).
 */
export default function sitemap(): MetadataRoute.Sitemap {
  // 페이지별 실제 수정 시각을 알 수 없는 상태라 빌드 시각 하나를 모든 엔트리가 공유한다.
  // 경로마다 그럴듯한 가짜 날짜를 적어 넣는 것보다, 빌드 시각이라는 사실대로의 값이 낫다.
  const lastModified = new Date();

  const entries: MetadataRoute.Sitemap = buildPublicSitemapUrls(siteUrl()).map(
    (url) => ({ url, lastModified }),
  );

  if (INDEX_MENTOR_DETAIL) {
    // 여기서 DB 조회해 멘토 상세 URL 을 entries 에 추가한다.
    // 지금은 비워 둔다 — 멘토 실명·소속 학교 노출에 대한 공개 색인 정책이 미확정이다.
    // 또한 사이트맵 응답이 느려지면 네이버 서치어드바이저가 제출을 제한하므로,
    // 정책이 확정되기 전까지 쓰이지 않을 DB 조회 코드를 미리 넣어 두지 않는다.
  }

  if (INDEX_COMMUNITY_POST) {
    // 여기서 DB 조회해 커뮤니티 글(게시판·숏폼) URL 을 entries 에 추가한다.
    // 지금은 비워 둔다 — 회원이 작성한 글의 개인정보 포함 여부 판단 기준이 미완이다.
  }

  return entries;
}
