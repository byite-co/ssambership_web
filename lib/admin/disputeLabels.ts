/**
 * 분쟁 status 운영자 표기 — PR-10 부터 상태 사전(`adminStatusDictionary`)을 참조한다(구 `접수·진행/에스컬레이션/종결` 표기 폐기).
 * 사전에 없는 값은 `(확인 필요)` 를 붙여 그대로(구 동작 유지) · 빈 값은 `—`.
 */
import { resolveAdminStatus } from "./adminStatusDictionary.ts";

export function adminDisputeStatusLabel(raw: string | null | undefined): string {
  const s = String(raw ?? "").trim();
  if (!s) return "—";
  const resolved = resolveAdminStatus("disputes", "status", s);
  return resolved.known ? resolved.label : `${s} (확인 필요)`;
}
