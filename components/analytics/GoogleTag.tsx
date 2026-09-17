import Script from "next/script";

import {
  GOOGLE_ADS_TAG_ID,
  GTAG_SCRIPT_SRC,
  googleTagInitScript,
  shouldLoadGoogleTag,
} from "@/lib/analytics/googleTag";

/**
 * Google 태그(gtag.js) — 루트 레이아웃 전용. 서버 컴포넌트.
 *
 * 운영 배포에서만 렌더된다(게이트는 lib/analytics/googleTag.ts).
 * `afterInteractive` 는 next/script 가 하이드레이션 직후 <head> 에 주입하는 전략으로,
 * Google 이 배포하는 @next/third-parties 의 GoogleAnalytics 컴포넌트와 같은 방식이다.
 * 렌더 차단 없이 로드되며 Ads 콘솔 '연결 테스트' 가 감지한다.
 */
export default function GoogleTag() {
  if (!shouldLoadGoogleTag()) return null;

  return (
    <>
      <Script src={GTAG_SCRIPT_SRC} strategy="afterInteractive" />
      <Script id={`gtag-init-${GOOGLE_ADS_TAG_ID}`} strategy="afterInteractive">
        {googleTagInitScript()}
      </Script>
    </>
  );
}
