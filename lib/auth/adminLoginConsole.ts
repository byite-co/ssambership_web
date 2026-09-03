/**
 * 관리자 로그인(PR-12 §3)의 순수 규칙 — 복귀 경로 허용 목록 · 실패 코드 → 문구 · 2단계(코드) 단계 판정.
 *
 * - 복귀 경로: `requireRole` 이 붙이는 `next` 키를 그대로 받되 **허용 목록 방식**(PR-6·7 과 같은 방식)으로 해석한다 —
 *   같은 오리진 상대 경로 중 `/admin`·`/admin/...`(로그인 자신은 제외)·`/notifications` 만. 그 밖은 기본 화면(대시보드).
 * - 실패 문구는 코드로만 URL 에 싣는다(원문 반영 금지). 서비스 계정(학생·멘토)은 별도 코드로 명확히 거부한다.
 * - 2단계 인증: Supabase `getAuthenticatorAssuranceLevel()` 결과가 `nextLevel === 'aal2'`(등록된 인증 수단이 있고 아직 aal2 가 아님)일 때만
 *   코드 단계를 보인다. 등록된 수단이 없으면 `nextLevel` 이 `aal1` 이라 건너뛴다(현재 관리자 3명 전원 미등록 → 항상 건너뜀).
 *   **코드 입력·검증·등록·강제는 PR-12b** — 여기는 판정 로직만.
 *
 * node --test 계약 테스트가 직접 import 하므로 React·`@/` import 를 두지 않는다.
 */

export const ADMIN_LOGIN_PATH = "/admin/login";
export const ADMIN_LOGIN_DEFAULT_PATH = "/admin/dashboard";
/** 서비스(학생·멘토) 로그인 — 거부 문구에서 안내 */
export const ADMIN_LOGIN_SERVICE_LOGIN_HREF = "/login";

/** `requireRole` → 로그인 복귀 키(routeGuard 가 붙인다) — 이름은 그대로, 해석은 아래 허용 목록 */
export const ADMIN_LOGIN_NEXT_PARAM = "next";
export const ADMIN_LOGIN_ERROR_PARAM = "error";
export const ADMIN_LOGIN_STEP_PARAM = "step";

export const ADMIN_LOGIN_STEP_VALUES = ["password", "code"] as const;
export type AdminLoginStep = (typeof ADMIN_LOGIN_STEP_VALUES)[number];

export const ADMIN_LOGIN_STEP_LABELS: Readonly<Record<AdminLoginStep, string>> = {
  password: "비밀번호",
  code: "인증 코드",
};

export function resolveAdminLoginStep(raw: string | string[] | null | undefined): AdminLoginStep {
  const v = String((Array.isArray(raw) ? raw[0] : raw) ?? "").trim().toLowerCase();
  return v === "code" ? "code" : "password";
}

// ── 실패 코드 ────────────────────────────────────────────────────────────────

export const ADMIN_LOGIN_ERROR_CODES = ["invalid", "unconfirmed", "not_admin", "session"] as const;
export type AdminLoginErrorCode = (typeof ADMIN_LOGIN_ERROR_CODES)[number];

export const ADMIN_LOGIN_ERROR_MESSAGES: Readonly<Record<AdminLoginErrorCode, string>> = {
  invalid: "이메일 또는 비밀번호를 확인해 주세요.",
  unconfirmed: "이메일 인증이 완료된 관리자 계정만 로그인할 수 있습니다.",
  not_admin: "학생·멘토 계정으로는 관리자 콘솔에 로그인할 수 없습니다. 서비스 로그인 페이지를 이용해 주세요.",
  session: "세션이 만료되었습니다. 다시 로그인해 주세요.",
};

export const ADMIN_LOGIN_GENERIC_ERROR = "로그인에 실패했습니다. 잠시 후 다시 시도해 주세요.";

export function isAdminLoginErrorCode(value: string | null | undefined): value is AdminLoginErrorCode {
  return (ADMIN_LOGIN_ERROR_CODES as readonly string[]).includes(String(value ?? ""));
}

/** 코드 → 문구. 모르는 값은 원문을 비추지 않고 일반 문구. 비어 있으면 null(문구 없음). */
export function adminLoginErrorMessage(raw: string | string[] | null | undefined): string | null {
  const v = String((Array.isArray(raw) ? raw[0] : raw) ?? "").trim();
  if (!v) return null;
  return isAdminLoginErrorCode(v) ? ADMIN_LOGIN_ERROR_MESSAGES[v] : ADMIN_LOGIN_GENERIC_ERROR;
}

/** 복귀 경로가 있을 때(가드가 보낸 경우) 폼 위에 보이는 안내 */
export const ADMIN_LOGIN_RETURN_NOTICE = "로그인이 필요합니다. 로그인하면 요청한 화면으로 돌아갑니다.";

// ── 복귀 경로 허용 목록 ───────────────────────────────────────────────────────

function parseRelative(raw: string | null | undefined): { path: string; search: string } | null {
  let s: string;
  try {
    s = decodeURIComponent(String(raw ?? "")).trim();
  } catch {
    return null;
  }
  if (!s || !s.startsWith("/") || s.startsWith("//") || s.includes("\\")) return null;
  if (s.includes("://") || s.includes("..") || /[\0\r\n]/.test(s)) return null;
  try {
    const u = new URL(s, "https://ssambership.local");
    if (u.origin !== "https://ssambership.local") return null;
    return { path: u.pathname, search: u.search };
  } catch {
    return null;
  }
}

/**
 * 허용 목록: `/admin` · `/admin/...`(단, `/admin/login` 자신은 제외) · `/notifications`(·하위). 그 외·비정상 값은 null.
 * 해시는 버리고 경로 + 쿼리만 돌려준다.
 */
export function resolveAdminLoginReturnPath(raw: string | string[] | null | undefined): string | null {
  const parsed = parseRelative(Array.isArray(raw) ? raw[0] : raw);
  if (!parsed) return null;
  const { path, search } = parsed;
  if (path === ADMIN_LOGIN_PATH || path.startsWith(`${ADMIN_LOGIN_PATH}/`)) return null;
  const allowed = path === "/admin" || path.startsWith("/admin/") || path === "/notifications" || path.startsWith("/notifications/");
  if (!allowed) return null;
  return `${path}${search}`;
}

/** 로그인 성공 후 목적지 — 허용된 복귀 경로 또는 대시보드 */
export function adminLoginDestination(raw: string | string[] | null | undefined): string {
  return resolveAdminLoginReturnPath(raw) ?? ADMIN_LOGIN_DEFAULT_PATH;
}

export function buildAdminLoginUrl(opts: { next?: string | null; error?: AdminLoginErrorCode | null; step?: AdminLoginStep | null } = {}): string {
  const usp = new URLSearchParams();
  if (opts.error) usp.set(ADMIN_LOGIN_ERROR_PARAM, opts.error);
  if (opts.step && opts.step !== "password") usp.set(ADMIN_LOGIN_STEP_PARAM, opts.step);
  const next = resolveAdminLoginReturnPath(opts.next ?? null);
  if (next) usp.set(ADMIN_LOGIN_NEXT_PARAM, next);
  const qs = usp.toString();
  return qs ? `${ADMIN_LOGIN_PATH}?${qs}` : ADMIN_LOGIN_PATH;
}

// ── 2단계 인증 판정(PR-12b 전까지 판정만) ────────────────────────────────────

export type AdminAssuranceLevel = "aal1" | "aal2";
/** `supabase.auth.mfa.getAuthenticatorAssuranceLevel()` 의 data 중 이 판정이 읽는 두 필드 */
export type AdminAssuranceLevels = { currentLevel: AdminAssuranceLevel | null; nextLevel: AdminAssuranceLevel | null };

/** 등록된 인증 수단이 있어 다음 단계가 aal2 이고 아직 aal2 가 아닐 때만 true. null(조회 실패)·미등록(aal1)은 false = 건너뜀. */
export function adminLoginRequiresSecondFactor(aal: AdminAssuranceLevels | null | undefined): boolean {
  if (!aal) return false;
  return aal.nextLevel === "aal2" && aal.currentLevel !== "aal2";
}

/** 2단계 자리 안내 — 코드 입력·검증은 PR-12b 에서 활성화 */
export const ADMIN_LOGIN_CODE_STEP_NOTICE = "등록된 인증 수단이 있는 계정입니다. 인증 코드 입력은 아직 열리지 않았으니 다른 계정으로 로그인하거나 운영 담당자에게 문의해 주세요.";
