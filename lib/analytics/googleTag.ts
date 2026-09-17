/**
 * Google 태그(gtag.js) 단일 정본 — Google Ads 전환 측정용.
 *
 * Google Ads 캠페인 진단이 "웹사이트에 Google 태그 설치" 를 요구한다. 태그 ID 는
 * 공개 식별자(페이지 소스에 그대로 실린다)이므로 env 가 아니라 코드 상수로 둔다.
 * 전환 이벤트 스니펫(gtag('event', 'conversion', ...))은 이 기본 태그가 모든 페이지에
 * 깔린 뒤에야 동작하므로, 삽입 지점은 루트 레이아웃(app/layout.tsx) 하나뿐이다.
 *
 * 로드 게이트:
 *   Vercel Production 배포에서만 로드한다(VERCEL_ENV === "production"). 프리뷰·로컬
 *   트래픽이 Ads 전환·리마케팅 목록에 섞이는 것을 막기 위해서다. VERCEL_ENV 는 Vercel 이
 *   빌드·런타임 양쪽에 자동 주입하므로 별도 env 설정이 필요 없다.
 */

/** Google Ads 계정 태그 ID. Ads 콘솔 > 도구 > 데이터 관리자 > Google 태그와 일치해야 한다. */
export const GOOGLE_ADS_TAG_ID = "AW-18397050128";

/** gtag.js 로더 URL — 태그 ID 를 쿼리로 받는다. */
export const GTAG_SCRIPT_SRC = `https://www.googletagmanager.com/gtag/js?id=${GOOGLE_ADS_TAG_ID}`;

/**
 * 현재 프로세스가 Google 태그를 내보내야 하는 환경인지 판정한다.
 * env 를 캐싱하지 않고 호출 시점에 읽는다 — 계약 테스트가 env 를 바꿔가며 호출한다.
 */
export function shouldLoadGoogleTag(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.VERCEL_ENV === "production";
}

/**
 * gtag 초기화 인라인 스크립트 본문. Google Ads 콘솔이 제시한 스니펫과 동일한 순서
 * (dataLayer 초기화 → gtag 정의 → js 타임스탬프 → config).
 */
export function googleTagInitScript(tagId: string = GOOGLE_ADS_TAG_ID): string {
  return [
    "window.dataLayer = window.dataLayer || [];",
    "function gtag(){dataLayer.push(arguments);}",
    "gtag('js', new Date());",
    `gtag('config', '${tagId}');`,
  ].join("\n");
}
