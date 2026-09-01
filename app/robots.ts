import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/seo/siteUrl";

/**
 * robots.txt (App Router 파일 규약: /robots.txt 로 서빙된다).
 *
 * 정본 호스트는 apex(www 금지)이며 siteUrl() 이 단일 소스다.
 * 크롤러별 규칙을 나누지 않고 userAgent "*" 하나만 둔다 — 네이버 Yeti 전용 블록을 따로 만들면
 * 동일한 disallow 목록을 두 곳에서 관리하게 되어 어긋날 위험만 커진다(Yeti 도 "*" 규칙을 따른다).
 */
export default function robots(): MetadataRoute.Robots {
  const origin = siteUrl();

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // robots.txt 의 Disallow 는 정규식이 아니라 "접두사 매칭"이다.
      // 즉 "/mentor" 라고 쓰면 공개 페이지인 "/mentors"(멘토 찾기)·"/mentors/[mentorId]" 까지 함께 차단된다.
      // 그래서 멘토 전용 콘솔 영역은 반드시 뒤에 슬래시를 붙여 "/mentor/" 로 적는다.
      // 같은 이유로 아래 각 항목의 슬래시 유무는 의도된 것이므로 임의로 붙이거나 떼지 말 것.
      disallow: [
        "/api/",
        "/admin",
        "/mentor/",
        "/mypage",
        "/home",
        "/wallet",
        "/cash",
        "/cash-history",
        "/questions",
        "/question-room",
        "/individual-questions",
        "/notes",
        "/subscribe",
        "/subscriptions",
        "/custom-request",
        "/account/",
        "/notifications",
        "/settings/",
        "/payments",
        "/support/disputes",
        "/support/refunds",
        "/support/reports",
        "/community/new",
        "/community/write",
        "/community/me",
        "/login",
        "/signup",
        "/logout",
        "/forgot-password",
        "/auth/",
        "/onboarding/",
        "/app/",
        "/dev/",
      ],
    },
    sitemap: `${origin}/sitemap.xml`,
  };
}
