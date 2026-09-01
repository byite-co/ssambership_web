/**
 * 사이트 canonical origin 단일 정본.
 *
 * 네이버 서치어드바이저는 등록한 사이트 도메인과 sitemap·canonical·robots 에 적힌
 * 도메인이 정확히 일치해야 수집을 진행한다. apex(ssambership.com) 로 등록했으므로
 * www 서브도메인이나 프리뷰 도메인이 한 곳이라도 새면 도메인 불일치로 반려된다.
 * 그래서 origin 계산을 이 모듈 한 곳으로 모으고, www 는 apex 로 강제 정규화한다.
 *
 * VERCEL_URL 은 의도적으로 참조하지 않는다 — 배포마다 바뀌는 프리뷰 도메인이
 * 사이트맵·canonical 에 그대로 실려 검색엔진에 노출되는 사고의 원인이기 때문이다.
 */

/** 운영 canonical origin. env 가 비었거나 잘못됐을 때의 하드코딩 폴백이자 정본. */
export const CANONICAL_SITE_ORIGIN = "https://ssambership.com";

/** "scheme://" 형태의 스킴이 이미 붙어 있는지 판별한다. */
const SCHEME_PREFIX_PATTERN = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//;

/**
 * 임의의 origin 문자열을 canonical 형태(`<scheme>://<host>[:port]`)로 정규화한다.
 * 순수 함수이며 부작용이 없다.
 *
 * - 빈 값·공백뿐인 값·파싱 실패 → {@link CANONICAL_SITE_ORIGIN}
 * - 스킴이 없으면 https:// 를 붙여 파싱한다 (예: "ssambership.com")
 * - http/https 가 아닌 스킴은 신뢰하지 않고 폴백한다
 * - 호스트가 "www." 로 시작하면 apex 로 낮춘다 (운영 env 오설정 대비 안전장치)
 * - 경로·쿼리·해시는 버리고, 말미 슬래시는 남기지 않는다
 * - 스킴과 포트는 보존한다 (예: "http://localhost:3000" 은 그대로)
 */
export function normalizeSiteOrigin(raw: string | null | undefined): string {
  if (typeof raw !== "string") return CANONICAL_SITE_ORIGIN;

  const trimmed = raw.trim();
  if (trimmed.length === 0) return CANONICAL_SITE_ORIGIN;

  const candidate = SCHEME_PREFIX_PATTERN.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return CANONICAL_SITE_ORIGIN;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return CANONICAL_SITE_ORIGIN;
  }

  const hostname = parsed.hostname.startsWith("www.")
    ? parsed.hostname.slice("www.".length)
    : parsed.hostname;

  if (hostname.length === 0) return CANONICAL_SITE_ORIGIN;

  const port = parsed.port ? `:${parsed.port}` : "";
  return `${parsed.protocol}//${hostname}${port}`;
}

/**
 * 현재 요청 시점의 canonical origin 을 돌려준다.
 *
 * env 를 모듈 초기화 시점에 캐싱하지 않고 호출할 때마다 읽는다 — 빌드 시점과
 * 런타임의 env 가 다를 수 있고, 계약 테스트가 env 를 바꿔가며 호출하기 때문이다.
 */
export function siteUrl(): string {
  return normalizeSiteOrigin(process.env.NEXT_PUBLIC_SITE_URL);
}
