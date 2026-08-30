/**
 * 홈 이미지 팝업 설정 — 단일 정본 (간단버전: 코드 배포로 교체)
 *
 * 팝업 교체 절차:
 *   1. `public/popups/` 에 새 이미지 추가
 *   2. 이 파일의 값 수정 (특히 `id` 를 반드시 새 값으로 — "오늘 하루 보지 않기" 초기화됨)
 *   3. 배포
 *
 * 긴급 오프: `enabled: false` 한 줄이면 즉시 미노출.
 * 이 파일과 `components/popup/HomeImagePopup.tsx` 외에는 어떤 코드도 팝업에 관여하지 않는다.
 */

export type HomePopupConfig = {
  /** false 면 어떤 조건이든 렌더하지 않는다 (긴급 오프 스위치) */
  enabled: boolean;
  /**
   * 팝업 버전 식별자. localStorage 숨김 키에 포함되므로
   * 팝업을 교체할 때마다 반드시 새 값으로 바꿀 것 (예: "2026-09-fall-event").
   */
  id: string;
  /** public/ 기준 경로 (예: "/popups/2026-09-event.png") */
  imageSrc: string;
  /** 스크린리더용 대체 텍스트 — 이미지에 담긴 내용을 요약 */
  imageAlt: string;
  /** 원본 이미지 픽셀 크기 (next/image 필수값, 비율 계산용) */
  imageWidth: number;
  imageHeight: number;
  /** 이미지 클릭 시 이동할 내부 경로. 없으면 null (클릭 무동작) */
  linkHref: string | null;
  /**
   * 노출 기간 (ISO 8601, KST 오프셋 명시 권장). null 이면 해당 경계 없음.
   * 간단버전 한계: 클라이언트 기기 시각 기준으로 판정한다.
   */
  startsAt: string | null;
  endsAt: string | null;
};

export const HOME_POPUP_CONFIG: HomePopupConfig = {
  enabled: true,
  id: "2026-09-sample-event",
  imageSrc: "/popups/2026-09-sample-event.png",
  imageAlt: "9월 이벤트 안내",
  imageWidth: 800,
  imageHeight: 1000,
  linkHref: "/notices",
  startsAt: "2026-09-01T00:00:00+09:00",
  endsAt: "2026-09-30T23:59:59+09:00",
};
