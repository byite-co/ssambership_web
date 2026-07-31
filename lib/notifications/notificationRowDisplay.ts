type Row = Record<string, unknown>;

// W4(C10): 후보 키 순회 제거 — notifications 정본 컬럼(body, created_at, type)과
// 정본 writer(132)가 data jsonb 에 넣는 title 만 읽는다(187 baseline 실측).

function dataTitle(row: Row): string | null {
  const d = row.data;
  if (d == null || typeof d !== "object") return null;
  const t = (d as Row).title;
  return typeof t === "string" && t.trim() ? t : null;
}

export function notificationTitleLine(row: Row): string {
  const fromData = dataTitle(row);
  if (fromData) return fromData;
  const body = row.body;
  if (typeof body === "string" && body.trim()) return body;
  return "알림(제목 없음)";
}

export function notificationTimeIso(row: Row): string {
  const v = row.created_at;
  if (typeof v === "string" && v.length > 8) return v;
  return "—";
}

export function formatNotificationTime(iso: string): string {
  if (iso === "—") return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 19);
  return d.toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
}

export function typeRaw(row: Row, typeColumn: string | null): string | null {
  // W4(C10): 정본 컬럼은 type — typeColumn 은 허브 호환 인자(고정 "type" 전달)로 유지.
  const col = typeColumn ?? "type";
  const v = row[col];
  if (typeof v === "string" && v.trim()) return v;
  return null;
}
