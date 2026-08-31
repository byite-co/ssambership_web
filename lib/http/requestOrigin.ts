// 요청의 실제 외부 오리진 도출 — 순수 모듈(env·DB·네트워크 미접근, node:test 대상).
//
// 용도: NICE 본인인증 return_url/close_url 과 return 팝업의 postMessage targetOrigin 을
// 고정 APP_URL 대신 "요청이 들어온 호스트" 기준으로 조립한다. 시작 호스트 == 복귀 호스트가
// 성립해야 세션 쿠키(host-only)가 복귀 요청에 실리고, 부모창 origin 검증과도 맞물린다.
//
// 보안: Host/X-Forwarded-Host 는 클라이언트 입력이므로 허용목록 밖이면 null 을 돌려
// 호출측이 APP_URL 로 폴백하게 한다(임의 호스트로 return_url 을 보내는 경로 차단).

export const ALLOWED_APP_HOSTS = Object.freeze(["ssambership.com", "www.ssambership.com"] as const);

export type ResolveRequestOriginOptions = {
  /** 허용 호스트명(포트 제외, 소문자). 기본 ALLOWED_APP_HOSTS. */
  allowedHosts?: readonly string[];
  /** localhost/127.0.0.1 허용(개발 전용 — production 에서는 false 로 둘 것). */
  allowLocalhost?: boolean;
};

function firstHeaderValue(headers: Headers, name: string): string | null {
  const raw = headers.get(name);
  if (!raw) return null;
  const first = raw.split(",")[0]?.trim() ?? "";
  return first.length > 0 ? first : null;
}

/**
 * `${proto}://${host}` 또는 null(허용목록 밖·헤더 부재).
 * Vercel 은 x-forwarded-host / x-forwarded-proto 를 실제 요청 값으로 세팅한다.
 */
export function resolveRequestOrigin(headers: Headers, opts?: ResolveRequestOriginOptions): string | null {
  const allowed = opts?.allowedHosts ?? ALLOWED_APP_HOSTS;
  const rawHost = (firstHeaderValue(headers, "x-forwarded-host") ?? firstHeaderValue(headers, "host") ?? "")
    .toLowerCase();
  if (!rawHost) return null;

  const hostname = rawHost.replace(/:\d+$/, "");
  const isLocal = hostname === "localhost" || hostname === "127.0.0.1";
  if (!allowed.includes(hostname) && !(opts?.allowLocalhost === true && isLocal)) {
    return null;
  }

  const forwardedProto = firstHeaderValue(headers, "x-forwarded-proto");
  const proto = forwardedProto === "http" || forwardedProto === "https" ? forwardedProto : isLocal ? "http" : "https";
  return `${proto}://${rawHost}`;
}
