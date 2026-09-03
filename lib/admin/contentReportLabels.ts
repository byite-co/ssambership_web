/**
 * `content_reports.status` 표시용 — PR-10 부터 상태 사전(`adminStatusDictionary`)을 참조한다(구 `접수/거절/종결` 표기 폐기).
 * 사전에 없는 값은 코드값을 노출하지 않고 `기타`(빈 값은 `—`).
 */
import { resolveAdminStatus } from "./adminStatusDictionary.ts";

export function contentReportStatusLabel(raw: string): string {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return "—";
  const resolved = resolveAdminStatus("content_reports", "status", s);
  return resolved.known ? resolved.label : "기타";
}

export function contentReportRowIsActionable(statusRaw: string): boolean {
  const s = statusRaw.trim().toLowerCase();
  return s === "pending" || s === "reviewing";
}
