// POST /api/app-session/bootstrap 의 순수 코어 — 파싱·검증만 담당(supabase·next 미의존).
//
// 계약(앱↔웹):
// - 입력: access_token · refresh_token · target(단일 enum: shortform_create)
// - Content-Type: application/x-www-form-urlencoded(Android WebView postUrl 기본) 또는
//   application/json 만 허용. JSON 단독 제한 금지 — Android POST 호환이 1순위다.
// - 토큰은 URL·로그·응답 본문에 절대 싣지 않는다(redirect 대상은 서버 상수 경로뿐).

/** 본문 크기 상한(UTF-8 바이트). Supabase JWT 2개 + target 이 넉넉히 들어가는 수준으로 제한. */
export const APP_SESSION_BOOTSTRAP_MAX_BODY_BYTES = 16 * 1024;

/**
 * target enum → 성공 redirect 경로(서버 상수). 결제·구독·충전 target 은 존재하지 않는다.
 * 값은 appSurfacePaths.APP_SHORTFORM_COMPOSE_PATH 와 동일해야 한다 — node --test 의
 * 확장자 해석 제약으로 리터럴 유지, 동일성은 계약 테스트가 회귀 방지한다.
 */
export const APP_SESSION_BOOTSTRAP_TARGETS = Object.freeze({
  shortform_create: "/app/community/shortform/new",
} as const);

export type AppSessionBootstrapTarget = keyof typeof APP_SESSION_BOOTSTRAP_TARGETS;

export function isAppSessionBootstrapTarget(value: string): value is AppSessionBootstrapTarget {
  return Object.prototype.hasOwnProperty.call(APP_SESSION_BOOTSTRAP_TARGETS, value);
}

export type BootstrapBodyKind = "form" | "json";

/** Content-Type allowlist 판정(charset 등 파라미터 허용, 그 외 전부 거부). */
export function bootstrapBodyKindForContentType(rawContentType: string | null): BootstrapBodyKind | null {
  const ct = (rawContentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (ct === "application/x-www-form-urlencoded") return "form";
  if (ct === "application/json") return "json";
  return null;
}

export type BootstrapParseError =
  | "content_type"
  | "body_too_large"
  | "malformed"
  | "missing_fields"
  | "invalid_target";

export type BootstrapParseResult =
  | { ok: true; accessToken: string; refreshToken: string; target: AppSessionBootstrapTarget }
  | { ok: false; error: BootstrapParseError };

function fieldFrom(source: Record<string, unknown>, key: string): string {
  const v = source[key];
  return typeof v === "string" ? v.trim() : "";
}

/**
 * 원문 본문 → 부트스트랩 입력. URLSearchParams/JSON 을 안전하게 파싱하고
 * 크기 상한·필수 필드·target enum 을 검증한다. 토큰 값은 검사만 하고 어디에도 기록하지 않는다.
 */
export function parseBootstrapBody(rawContentType: string | null, rawBody: string): BootstrapParseResult {
  const kind = bootstrapBodyKindForContentType(rawContentType);
  if (!kind) return { ok: false, error: "content_type" };
  if (new TextEncoder().encode(rawBody).length > APP_SESSION_BOOTSTRAP_MAX_BODY_BYTES) {
    return { ok: false, error: "body_too_large" };
  }

  let source: Record<string, unknown>;
  if (kind === "form") {
    const params = new URLSearchParams(rawBody);
    source = {
      access_token: params.get("access_token") ?? "",
      refresh_token: params.get("refresh_token") ?? "",
      target: params.get("target") ?? "",
    };
  } else {
    try {
      const parsed: unknown = JSON.parse(rawBody);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { ok: false, error: "malformed" };
      }
      source = parsed as Record<string, unknown>;
    } catch {
      return { ok: false, error: "malformed" };
    }
  }

  const accessToken = fieldFrom(source, "access_token");
  const refreshToken = fieldFrom(source, "refresh_token");
  const target = fieldFrom(source, "target");
  if (!accessToken || !refreshToken || !target) return { ok: false, error: "missing_fields" };
  if (!isAppSessionBootstrapTarget(target)) return { ok: false, error: "invalid_target" };

  return { ok: true, accessToken, refreshToken, target };
}

/** `https://<ref>.supabase.co` → `<ref>`. 형식이 다르면 null(비교 불가 → 거부 대상). */
export function supabaseProjectRefFromUrl(supabaseUrl: string | null | undefined): string | null {
  const raw = (supabaseUrl ?? "").trim();
  if (!raw) return null;
  try {
    const host = new URL(raw).hostname.toLowerCase();
    const ref = host.split(".")[0] ?? "";
    return ref ? ref : null;
  } catch {
    return null;
  }
}

/**
 * access_token(JWT) payload 의 issuer 에서 프로젝트 ref 를 추출한다(서명 검증은
 * 이후 auth.getUser 가 수행 — 여기서는 '어느 프로젝트 토큰인가'만 판별).
 * `iss: https://<ref>.supabase.co/auth/v1` 우선, 없으면 `ref` claim 폴백.
 */
export function jwtProjectRef(accessToken: string): string | null {
  const parts = accessToken.split(".");
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const payloadJson = Buffer.from(parts[1], "base64url").toString("utf8");
    const payload: unknown = JSON.parse(payloadJson);
    if (!payload || typeof payload !== "object") return null;
    const p = payload as { iss?: unknown; ref?: unknown };
    if (typeof p.iss === "string" && p.iss) {
      const fromIss = supabaseProjectRefFromUrl(p.iss);
      if (fromIss) return fromIss;
    }
    if (typeof p.ref === "string" && p.ref) return p.ref;
    return null;
  } catch {
    return null;
  }
}

/** 앱 토큰 발급 프로젝트와 웹 Supabase 프로젝트의 일치 검증(불일치 세션 이식 차단). */
export function bootstrapProjectRefMatches(accessToken: string, webSupabaseUrl: string | null | undefined): boolean {
  const expected = supabaseProjectRefFromUrl(webSupabaseUrl);
  const actual = jwtProjectRef(accessToken);
  return Boolean(expected && actual && expected === actual);
}
