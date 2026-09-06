// POST /api/app-session/bootstrap 의 순수 코어 — 파싱·검증·target 별 역할 규칙(supabase·next 미의존).
//
// 계약(앱↔웹):
// - 입력: access_token · refresh_token · target(enum: shortform_create · identity_verify · guardian_consent)
// - Content-Type: application/x-www-form-urlencoded(Android WebView postUrl 기본) 또는
//   application/json 만 허용. JSON 단독 제한 금지 — Android POST 호환이 1순위다.
// - 토큰은 URL·로그·응답 본문에 절대 싣지 않는다(redirect 대상은 서버 상수 경로뿐).
// - target 별 역할 규칙(웹 PR-2 §6 · 앱 A-4c 소비):
//     shortform_create = mentor(현행) · identity_verify = student·mentor · guardian_consent = student.
//   완성 전(`profile_completed_at IS NULL` · DB-5 206) 계정은 세 target 모두 거부(strict 게이트 유지).

/** 본문 크기 상한(UTF-8 바이트). Supabase JWT 2개 + target 이 넉넉히 들어가는 수준으로 제한. */
export const APP_SESSION_BOOTSTRAP_MAX_BODY_BYTES = 16 * 1024;

/**
 * target enum → 성공 redirect 경로(서버 상수). 결제·구독·충전 target 은 존재하지 않는다.
 * shortform_create 값은 appSurfacePaths.APP_SHORTFORM_COMPOSE_PATH 와 동일해야 한다 — node --test 의
 * 확장자 해석 제약으로 리터럴 유지, 동일성은 계약 테스트가 회귀 방지한다.
 * identity_verify · guardian_consent 는 기존 본인인증 온보딩 화면(루트 라우트)이다 — WebView 복귀 안내는
 * `bootstrapTargetRedirectPath` 가 붙이는 `?src=app` 으로 켠다.
 */
export const APP_SESSION_BOOTSTRAP_TARGETS = Object.freeze({
  shortform_create: "/app/community/shortform/new",
  identity_verify: "/onboarding/verify",
  guardian_consent: "/onboarding/guardian",
} as const);

export type AppSessionBootstrapTarget = keyof typeof APP_SESSION_BOOTSTRAP_TARGETS;

export function isAppSessionBootstrapTarget(value: string): value is AppSessionBootstrapTarget {
  return Object.prototype.hasOwnProperty.call(APP_SESSION_BOOTSTRAP_TARGETS, value);
}

/** 온보딩 화면이 "앱으로 돌아가기" 안내를 켜는 쿼리(현행 A7 패턴 — 딥링크 스킴은 A-4c 가 보고). */
export const APP_SESSION_BOOTSTRAP_APP_SOURCE_QUERY = "src=app";

/** 성공 redirect 경로 — 온보딩 target 은 `?src=app` 을 붙인다(앱 표면 경로는 그대로). */
export function bootstrapTargetRedirectPath(target: AppSessionBootstrapTarget): string {
  const base = APP_SESSION_BOOTSTRAP_TARGETS[target];
  if (target === "identity_verify" || target === "guardian_consent") {
    return `${base}?${APP_SESSION_BOOTSTRAP_APP_SOURCE_QUERY}`;
  }
  return base;
}

export type BootstrapAllowedRole = "student" | "mentor";

/** target 별 허용 역할(allowlist). admin 은 어느 target 도 없다. */
export const APP_SESSION_BOOTSTRAP_TARGET_ROLES: Readonly<Record<AppSessionBootstrapTarget, readonly BootstrapAllowedRole[]>> =
  Object.freeze({
    shortform_create: ["mentor"],
    identity_verify: ["student", "mentor"],
    guardian_consent: ["student"],
  });

export type BootstrapProfileRow = { role?: unknown; profile_completed_at?: unknown };

export type BootstrapTargetDecision = "ok" | "profile_unavailable" | "profile_incomplete" | "role_not_allowed";

/**
 * target 별 역할 규칙 순수 판정(strict · fail-closed).
 * - 조회 실패·행 없음 → profile_unavailable
 * - `profile_completed_at` 이 문자열이 아니거나 role 이 없음 → profile_incomplete (완성 전 계정은 세 target 모두 거부)
 * - role 이 target allowlist 밖(대소문자 위조 포함) → role_not_allowed
 */
export function bootstrapTargetRoleDecision(
  target: AppSessionBootstrapTarget,
  profile: BootstrapProfileRow | null | undefined,
  hadQueryError: boolean,
): BootstrapTargetDecision {
  if (hadQueryError || !profile) return "profile_unavailable";
  const completedAt = profile.profile_completed_at;
  const role = profile.role;
  if (typeof completedAt !== "string" || completedAt.trim() === "" || typeof role !== "string" || role === "") {
    return "profile_incomplete";
  }
  const allowed = APP_SESSION_BOOTSTRAP_TARGET_ROLES[target] as readonly string[];
  return allowed.includes(role) ? "ok" : "role_not_allowed";
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
