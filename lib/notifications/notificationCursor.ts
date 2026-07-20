// 알림 커서·읽음판정 순수 유틸 — Supabase/`@/` 의존 없음(node:test 로 직접 검증 가능).
// notificationsHubQueries.ts 가 이 모듈을 사용·re-export 한다(계약 테스트가 실제 경로를 검증).

export type NotificationCursor = { orderValue: string; id: string };

export type NotificationReadRow = Record<string, unknown>;

// boolean 형 읽음 컬럼(그 외는 timestamp 형으로 간주).
export const BOOL_READ_COLS = new Set(["is_read", "read", "acknowledged"]);

export function isNotificationReadRow(row: NotificationReadRow, readCol: string | null): boolean {
  if (!readCol) return false;
  const v = row[readCol];
  if (BOOL_READ_COLS.has(readCol)) {
    return v === true || v === 1 || v === "true" || v === 1.0;
  }
  // timestamp 형: 값이 있고 1970-01-01(sentinel)이 아니면 읽음.
  return v != null && String(v) !== "" && !String(v).startsWith("1970-01-01");
}

// ── 커서 인코딩(URL-safe base64url) — created_at 의 '+00:00' 등이 URL 왕복에서 손상되지 않도록 ──
// 구분자: 타임스탬프/uuid 에 나타나지 않는 제어문자(0x01).
const CURSOR_SEP = String.fromCharCode(1);

function b64urlEncode(raw: string): string {
  const b64 = typeof btoa === "function" ? btoa(raw) : Buffer.from(raw, "binary").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  return typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
}

export function encodeNotificationCursor(orderValue: string, id: string): string {
  return b64urlEncode(`${orderValue}${CURSOR_SEP}${id}`);
}

export function decodeNotificationCursor(cursor: string | null | undefined): NotificationCursor | null {
  if (!cursor) return null;
  try {
    const raw = b64urlDecode(cursor);
    const idx = raw.indexOf(CURSOR_SEP);
    if (idx < 0) return null;
    const orderValue = raw.slice(0, idx);
    const id = raw.slice(idx + CURSOR_SEP.length);
    if (!id) return null;
    return { orderValue, id };
  } catch {
    return null;
  }
}
