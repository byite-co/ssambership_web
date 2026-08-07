/**
 * 레거시 외부 미디어 URL 허용 판정 (D-CM-11) — 순수 leaf(부수효과·환경 접근 없음, 계약 테스트 대상).
 *
 * shortform_posts.video_url / thumbnail_url 에 버킷 마커 없는 임의 외부 URL 이 들어 있는 레거시
 * 행이 도메인 검증 없이 그대로 재생/로드되면 추적·악성 콘텐츠 삽입 벡터가 된다. 자사 Storage
 * 호스트 allowlist 로만 렌더를 허용하고, 그 외 오리진과 http(s) 아닌 스킴은 거부한다.
 */

/** URL 문자열들에서 host(소문자) 집합을 만든다. 형식 오류·빈 값은 건너뛴다. */
export function parseAllowedMediaHosts(urls: ReadonlyArray<string | null | undefined>): Set<string> {
  const hosts = new Set<string>();
  for (const raw of urls) {
    const v = typeof raw === "string" ? raw.trim() : "";
    if (!v) continue;
    try {
      hosts.add(new URL(v).host.toLowerCase());
    } catch {
      /* ignore malformed */
    }
  }
  return hosts;
}

/** url 이 http(s) 이고 host 가 allowlist 에 있으면 true. 그 외(다른 스킴·형식 오류·미허용 host)는 false. */
export function isAllowedExternalMediaUrl(url: string, allowedHosts: ReadonlySet<string>): boolean {
  let host: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    host = parsed.host.toLowerCase();
  } catch {
    return false;
  }
  return allowedHosts.has(host);
}
