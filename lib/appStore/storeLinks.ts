/**
 * 앱스토어 링크 정본 — 화면에 URL 을 노출하지 않고 이 상수만 참조한다.
 * - apple: 한글 경로(쌤버십)는 퍼센트 인코딩으로 고정 (인코딩 이슈 예방)
 * - google: 공유용 추적 파라미터(pcampaignid=web_share)는 제거
 */
export const STORE_LINKS = {
  google: "https://play.google.com/store/apps/details?id=com.ssambership.edu",
  apple: "https://apps.apple.com/kr/app/%EC%8C%A4%EB%B2%84%EC%8B%AD/id6797208031",
} as const;
