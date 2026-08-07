import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { IndividualQuestionEscrowResult } from "@/lib/individualQuestion/individualQuestionTypes";
import {
  individualQuestionExpiryBatchLimit,
  individualQuestionExpiryHours,
  type IndividualQuestionExpirableStatus,
} from "@/lib/individualQuestion/individualQuestionExpiryConfig";
import {
  EXPIRABLE_STATUSES,
  getExpiryScanQuestionId,
  selectDueNullExpiryRows,
  mergeExpiryScanRows,
  type ExpiryScanRow,
} from "@/lib/individualQuestion/individualQuestionExpiryScan";

type Row = ExpiryScanRow;

// [D-IQ-1] status별 기본 만료시간 주입기 — NULL-expires 폴백 판정에 사용.
const hoursForStatus = (status: string): number =>
  individualQuestionExpiryHours(status as IndividualQuestionExpirableStatus);

// [D-IQ-2] hold_missing 처리 병렬도. 행 단위 070 RPC는 각자 `for update` 로 독립 잠금 →
// 제한 병렬은 안전하며 대량 만료 시 실행 시간을 선형에서 완화한다.
const REFUND_CONCURRENCY = 5;

export type IndividualQuestionExpiryBatchSummary = {
  at: string;
  scanned: number;
  refunded: number;
  alreadyRefunded: number;
  skipped: number;
  // [D-IQ-2] 환불 불가·확정(hold_missing) 행을 terminal(canceled)로 마킹해 스캔에서 제외한 수.
  terminated: number;
  errors: Array<{ questionId: string | null; code: string; message: string }>;
};

function firstRpcResult(
  data: IndividualQuestionEscrowResult | IndividualQuestionEscrowResult[] | null
): IndividualQuestionEscrowResult | null {
  if (Array.isArray(data)) return data[0] ?? null;
  return data;
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: workerCount }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) break;
      results[index] = await fn(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

type RefundOutcome = {
  code: "refunded" | "already" | "skipped" | "error";
  rpcCode?: string | null;
  message?: string;
};

async function refundExpiredQuestion(supabase: SupabaseClient, row: Row): Promise<RefundOutcome> {
  const questionId = getExpiryScanQuestionId(row);
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
  return { code: "skipped", rpcCode: result.code ?? null, message: `${result.code}: ${result.message ?? ""}`.trim() };
}

/**
 * [D-IQ-2] hold_missing 은 홀드 원장이 없어 환불이 불가능한 확정적 skip 이다. 이런 행은 status 가
 * 그대로 남아 매 실행마다 expires_at 오름차순 창의 앞을 재점유하고 배치 한도를 잠식(head-of-line
 * blocking)한다. 홀드가 정말 없는 행만 골라 canceled(terminal)로 마킹해 스캔에서 영구 제외한다.
 * 자금 이동은 없다(홀드 자체가 없음) — 지갑·원장 미접근이라 자금 정본 규약과 무관하다.
 */
async function terminateBrokenEscrowRow(supabase: SupabaseClient, questionId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("individual_questions")
    .update({ status: "canceled" })
    .eq("id", questionId)
    .is("hold_ledger_id", null) // 홀드가 실제로 없는 행만 — 홀드가 있으면 절대 건드리지 않는다.
    .in("status", EXPIRABLE_STATUSES)
    .select("id");
  if (error) {
    console.error("[individualQuestionExpiry] terminate hold_missing failed", { questionId, error: error.message });
    return false;
  }
  return Array.isArray(data) && data.length > 0;
}

export async function runIndividualQuestionExpiryBatch(
  supabase: SupabaseClient,
  at: Date
): Promise<IndividualQuestionExpiryBatchSummary> {
  const atIso = at.toISOString();
  const limit = individualQuestionExpiryBatchLimit();
  const summary: IndividualQuestionExpiryBatchSummary = {
    at: atIso,
    scanned: 0,
    refunded: 0,
    alreadyRefunded: 0,
    skipped: 0,
    terminated: 0,
    errors: [],
  };

  // primary: expires_at 가 설정돼 있고 만료 도달한 행.
  const primaryResp = await supabase
    .from("individual_questions")
    .select("id, student_id, title, status, expires_at, created_at")
    .in("status", EXPIRABLE_STATUSES)
    .lte("expires_at", atIso)
    .order("expires_at", { ascending: true })
    .limit(limit);

  if (primaryResp.error) {
    summary.errors.push({ questionId: null, code: "query_failed", message: primaryResp.error.message });
    return summary;
  }

  // [D-IQ-1] fallback: expires_at 가 NULL 인 행 — best-effort 기록 실패로 스캔에 영원히 안 걸리던 행.
  const nullResp = await supabase
    .from("individual_questions")
    .select("id, student_id, title, status, expires_at, created_at")
    .in("status", EXPIRABLE_STATUSES)
    .is("expires_at", null)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (nullResp.error) {
    // 폴백 조회 실패는 primary 처리를 막지 않는다(관측용 오류만 기록).
    summary.errors.push({ questionId: null, code: "null_scan_failed", message: nullResp.error.message });
  }

  const primaryRows = ((primaryResp.data as unknown as Row[] | null) ?? []) as Row[];
  const nullDueRows = selectDueNullExpiryRows(
    ((nullResp.data as unknown as Row[] | null) ?? []) as Row[],
    at,
    hoursForStatus
  );
  const rows = mergeExpiryScanRows(primaryRows, nullDueRows, limit);
  summary.scanned = rows.length;

  const outcomes = await mapWithConcurrency(rows, REFUND_CONCURRENCY, async (row) => {
    const questionId = getExpiryScanQuestionId(row);
    const outcome = await refundExpiredQuestion(supabase, row);
    // 확정적 skip(hold_missing)은 terminal 마킹으로 스캔에서 제외한다(head-of-line 해소).
    let terminated = false;
    let terminateFailed = false;
    if (outcome.code === "skipped" && outcome.rpcCode === "hold_missing" && questionId) {
      const ok = await terminateBrokenEscrowRow(supabase, questionId);
      terminated = ok;
      terminateFailed = !ok;
    }
    return { questionId, outcome, terminated, terminateFailed };
  });

  // summary 집계는 순차로(병렬 누산 경합 방지).
  for (const { questionId, outcome, terminated, terminateFailed } of outcomes) {
    if (outcome.code === "refunded") {
      summary.refunded += 1;
    } else if (outcome.code === "already") {
      summary.alreadyRefunded += 1;
    } else if (outcome.code === "error") {
      summary.skipped += 1;
      summary.errors.push({
        questionId,
        code: "refund_rpc_failed",
        message: outcome.message ?? "refund failed",
      });
    } else {
      summary.skipped += 1;
      if (terminated) {
        summary.terminated += 1;
        summary.errors.push({
          questionId,
          code: "terminated_hold_missing",
          message: "escrow hold missing → marked canceled to unblock scan",
        });
      } else if (terminateFailed) {
        summary.errors.push({ questionId, code: "terminate_failed", message: "hold_missing terminal mark failed" });
      } else if (outcome.message) {
        summary.errors.push({ questionId, code: "skipped", message: outcome.message });
      }
    }
  }

  return summary;
}
