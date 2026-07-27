import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { IndividualQuestionEscrowResult } from "@/lib/individualQuestion/individualQuestionTypes";
import { individualQuestionExpiryBatchLimit } from "@/lib/individualQuestion/individualQuestionExpiryConfig";

type Row = Record<string, unknown>;

// status별 만료 환불 대상. answered/released/refunded/canceled/escrowed는 제외.
const EXPIRABLE_STATUSES = ["open", "assigned", "claimed"] as const;

export type IndividualQuestionExpiryBatchSummary = {
  at: string;
  scanned: number;
  refunded: number;
  alreadyRefunded: number;
  skipped: number;
  errors: Array<{ questionId: string | null; code: string; message: string }>;
};

function getQuestionId(row: Row): string | null {
  return typeof row.id === "string" && row.id.trim() ? row.id : null;
}

function firstRpcResult(
  data: IndividualQuestionEscrowResult | IndividualQuestionEscrowResult[] | null
): IndividualQuestionEscrowResult | null {
  if (Array.isArray(data)) return data[0] ?? null;
  return data;
}

async function refundExpiredQuestion(
  supabase: SupabaseClient,
  row: Row
): Promise<{ code: "refunded" | "already" | "skipped" | "error"; message?: string }> {
  const questionId = getQuestionId(row);
  if (!questionId) return { code: "skipped", message: "missing_question_id" };

  // 환불은 반드시 070 RPC만 경유(멱등: iq_refund:{id}). 지갑 직접 조작 금지.
  // RPC 내부에서 `for update` 행 잠금 + status/refunded_at/refund_ledger_id 갱신.
  const { data, error } = await supabase.rpc("refund_individual_question_hold", {
    p_question_id: questionId,
  });

  if (error) {
    console.error("[individualQuestionExpiry] refund rpc failed", { questionId, error: error.message });
    return { code: "error", message: error.message };
  }

  const result = firstRpcResult(data as IndividualQuestionEscrowResult | IndividualQuestionEscrowResult[] | null);
  if (!result) return { code: "error", message: "empty_rpc_result" };

  if (result.ok && result.code === "refunded") {
    // expired_refunded 알림은 155 AFTER UPDATE(status→refunded) 트리거가 학생에게 원자 발행(best-effort 제거).
    return { code: "refunded" };
  }
  if (result.ok && result.code === "already_refunded") {
    return { code: "already" };
  }
  // already_released / hold_missing / not_found 등은 환불 대상이 아니므로 skip.
  return { code: "skipped", message: `${result.code}: ${result.message ?? ""}`.trim() };
}

export async function runIndividualQuestionExpiryBatch(
  supabase: SupabaseClient,
  at: Date
): Promise<IndividualQuestionExpiryBatchSummary> {
  const atIso = at.toISOString();
  const summary: IndividualQuestionExpiryBatchSummary = {
    at: atIso,
    scanned: 0,
    refunded: 0,
    alreadyRefunded: 0,
    skipped: 0,
    errors: [],
  };

  const { data, error } = await supabase
    .from("individual_questions")
    .select("id, student_id, title, status, expires_at")
    .in("status", EXPIRABLE_STATUSES)
    .lte("expires_at", atIso)
    .order("expires_at", { ascending: true })
    .limit(individualQuestionExpiryBatchLimit());

  if (error) {
    summary.errors.push({ questionId: null, code: "query_failed", message: error.message });
    return summary;
  }

  const rows = ((data as unknown as Row[] | null) ?? []) as Row[];
  summary.scanned = rows.length;

  for (const row of rows) {
    const questionId = getQuestionId(row);
    const result = await refundExpiredQuestion(supabase, row);
    if (result.code === "refunded") summary.refunded += 1;
    else if (result.code === "already") summary.alreadyRefunded += 1;
    else if (result.code === "error") {
      summary.skipped += 1;
      summary.errors.push({
        questionId,
        code: "refund_rpc_failed",
        message: result.message ?? "refund failed",
      });
    } else {
      summary.skipped += 1;
      if (result.message) {
        summary.errors.push({ questionId, code: "skipped", message: result.message });
      }
    }
  }

  return summary;
}
