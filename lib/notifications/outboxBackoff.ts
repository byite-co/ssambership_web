// 알림 outbox worker 순수 로직 — backoff·오류 분류(node:test 검증). Supabase/`@/` 의존 없음.

export type BackoffOpts = { baseSeconds?: number; capSeconds?: number; factor?: number };

/** 지수 backoff(attempt 1부터). base*factor^(attempt-1), [base, cap] clamp. */
export function exponentialBackoffSeconds(attempt: number, opts?: BackoffOpts): number {
  const base = opts?.baseSeconds ?? 30;
  const cap = opts?.capSeconds ?? 3600;
  const factor = opts?.factor ?? 2;
  const a = Math.max(1, Math.floor(attempt));
  const raw = base * Math.pow(factor, a - 1);
  return Math.min(cap, Math.max(base, Math.round(raw)));
}

/** FCM 계열 오류 문자열이 "무효 토큰"(재시도 무의미 → revoke)인지 분류. */
export function isInvalidTokenError(err: string | null | undefined): boolean {
  const s = (err ?? "").toLowerCase();
  if (!s) return false;
  return (
    s.includes("unregistered") ||
    s.includes("not registered") ||
    s.includes("notregistered") ||
    s.includes("invalid registration") ||
    s.includes("invalid-registration-token") ||
    s.includes("invalid_argument") ||
    s.includes("mismatch") ||
    // FCM v1 UNREGISTERED(HTTP 404)의 표준 메시지 — 무효 토큰.
    s.includes("requested entity was not found") ||
    s.includes("entity was not found")
  );
}
