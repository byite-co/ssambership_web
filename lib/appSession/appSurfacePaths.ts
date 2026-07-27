// 앱(모바일) 전용 표면 경로·enum 정본 — 순수 모듈(node/브라우저/테스트 공용, next·`@/` 의존 없음).
//
// 계약:
// - 앱 WebView 는 이 경로들만 탐색 allowlist 로 허용한다(결제·구독·충전 경로 없음).
// - 완료 브릿지의 kind/result, 오류 페이지의 code 는 아래 enum 으로 서버가 제한한다.
// - 임의 returnUrl 을 받지 않는다 — redirect 대상은 전부 이 모듈의 서버 상수다.

export const APP_SHORTFORM_COMPOSE_PATH = "/app/community/shortform/new";
export const APP_BRIDGE_COMPLETE_PATH = "/app/bridge/complete";
export const APP_BRIDGE_ERROR_PATH = "/app/bridge/error";

export const APP_BRIDGE_KINDS = ["shortform"] as const;
export type AppBridgeKind = (typeof APP_BRIDGE_KINDS)[number];

export const APP_BRIDGE_RESULTS = ["draft", "published"] as const;
export type AppBridgeResult = (typeof APP_BRIDGE_RESULTS)[number];

export const APP_BRIDGE_ERROR_CODES = [
  "session_expired",
  "mentor_only",
  "account_blocked",
  "bootstrap_failed",
  "invalid_request",
] as const;
export type AppBridgeErrorCode = (typeof APP_BRIDGE_ERROR_CODES)[number];

export function isAppBridgeKind(value: string): value is AppBridgeKind {
  return (APP_BRIDGE_KINDS as readonly string[]).includes(value);
}

export function isAppBridgeResult(value: string): value is AppBridgeResult {
  return (APP_BRIDGE_RESULTS as readonly string[]).includes(value);
}

export function isAppBridgeErrorCode(value: string): value is AppBridgeErrorCode {
  return (APP_BRIDGE_ERROR_CODES as readonly string[]).includes(value);
}

/** 완료 브릿지 경로(서버 enum 값만 조합 가능 — 임의 문자열 불가). */
export function appBridgeCompletePath(kind: AppBridgeKind, result: AppBridgeResult): string {
  return `${APP_BRIDGE_COMPLETE_PATH}?kind=${kind}&result=${result}`;
}

/** 고정 오류 페이지 경로(코드 enum 한정). */
export function appBridgeErrorPath(code: AppBridgeErrorCode): string {
  return `${APP_BRIDGE_ERROR_PATH}?code=${code}`;
}
