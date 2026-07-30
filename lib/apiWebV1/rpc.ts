import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * S2-2 웹 전환 W1 — `api_web_v1` 계약 표면 호출 공통부.
 * 정본: docs/contracts/api_web_v1_contract_v1_1.md §8 (envelope).
 *
 * - 모든 명령 함수는 jsonb 단일 객체를 반환한다:
 *   성공 `{ ok: true, contract_version: 1, ... }` / 도메인 거부 `{ ok: false, contract_version: 1, code }`.
 * - `ok` 필드가 없는 응답을 성공으로 간주하지 않는다(§8.2 — T-CON-04).
 * - 사전에 없는 SQL 예외는 함수가 전파하므로(§8.2) PostgREST 오류로 도착한다 —
 *   여기서 raise 코드(대문자_스네이크)만 추출해 넘기고, 임의로 성공으로 바꾸지 않는다.
 * - 실패 시 구 `public` 경로로 되돌아가는 fallback·dual-read 는 만들지 않는다(W1 지시 §4).
 */

export const API_WEB_V1_SCHEMA = "api_web_v1";

export type ApiWebV1Envelope =
  | ({ ok: true; contract_version: number } & Record<string, unknown>)
  | { ok: false; contract_version: number; code: string };

export type ApiWebV1RpcResult =
  | { ok: true; row: Record<string, unknown> }
  | {
      ok: false;
      code: string;
      /** 전송·전파 오류 원문(envelope 실패면 null — 확정 거부). */
      message: string | null;
      /** envelope 실패의 보조 필드(§8.1 — 예: F8 밴드 tier/min/max). 전송 오류면 null. */
      detail: Record<string, unknown> | null;
    };

/** Postgres 오류 메시지에서 raise 코드(대문자_스네이크)만 추출 — 전파 예외용. */
export function extractRaiseCode(message: string): string {
  const m = /\b([A-Z][A-Z0-9_]{3,})\b/.exec(String(message ?? ""));
  return m ? m[1] : "";
}

/** `api_web_v1` envelope RPC 호출 + §8 envelope 정규화. */
export async function callApiWebV1Rpc(
  supabase: SupabaseClient,
  fn: string,
  args: Record<string, unknown>
): Promise<ApiWebV1RpcResult> {
  const { data, error } = await supabase.schema(API_WEB_V1_SCHEMA).rpc(fn, args);
  if (error) {
    // 사전 밖 예외 전파(§8.2) 또는 전송 오류 — 성공으로 승격하지 않는다.
    return { ok: false, code: extractRaiseCode(error.message), message: error.message, detail: null };
  }
  const row =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : null;
  if (!row || row.ok !== true) {
    // ok 부재·비성공 — §8.2: ok 없는 응답은 성공이 아니다.
    const code = row && typeof row.code === "string" ? row.code : "";
    return { ok: false, code, message: null, detail: row };
  }
  return { ok: true, row };
}
