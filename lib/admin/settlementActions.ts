"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/routeGuard";
import { logAdminAction } from "@/lib/admin/adminActionLog";
import { resolveAdminWriteClient } from "@/lib/admin/adminWriteClient";
import {
  PAYOUT_RUN_EXECUTE_ACTION_TYPE,
  PAYOUT_RUN_TARGET_TYPE,
  SETTLEMENT_BASE_PATH,
  SETTLEMENT_EXECUTE_FIELDS,
  SETTLEMENT_EXECUTE_MESSAGES,
  SETTLEMENT_EXECUTE_REASON_FIELD,
  SETTLEMENT_EXECUTE_REASON_REQUIRED_MESSAGE,
  buildPayoutExecuteOkMessage,
  buildSettlementUrl,
  currentPayoutRunDate,
  expectedMatchesDryRun,
  isSettlementReasonValid,
  parsePayoutExecuteExpected,
  parsePayoutRunResult,
  payoutRunIdempotencyKey,
} from "@/lib/admin/settlementConsole";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * 정산 실행 서버 액션(PR-9 §1-2) — `pay_due_payouts_for_run(p_run_date, null, p_dry_run=false)` 호출 경로. DB·RPC 동작 불변.
 *
 * RPC **앞에** 붙인 것:
 * - 사유 필수(critical 다이얼로그와 같은 최소 길이) — 모달을 우회한 제출도 서버에서 막는다. 사유는 감사 로그 `detail.reason` 에 남는다.
 * - 지급일은 서버가 다시 계산한 **이번 달 23일**과 같아야 한다(과거·미래 달 실행 금지).
 * - 이번 달 멱등키(`payout:YYYY-MM`)로 이미 `completed` 인 실행이 있으면 거부(RPC 도 no-op 이지만 "실행됨" 으로 오인하지 않게).
 * - **드라이런 재대조**: 미리보기가 보여준 값(hidden)과 실행 직전 드라이런(`run_scheduled_payout(p_force_dry_run=true)`)이 다르면
 *   거부한다 — 화면을 열어 둔 사이 정산 대상이 바뀌면 관리자가 확인한 금액과 다른 금액이 확정되면 안 된다.
 * `payout_settings.scheduler_enabled` 는 읽지도 쓰지도 않는다(오너 결정: 수동 실행만).
 */

function textFromForm(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

function withQuery(path: string, key: "ok" | "error", msg: string): string {
  const [base, qs = ""] = path.split("?");
  const usp = new URLSearchParams(qs);
  usp.set(key, msg);
  return `${base}?${usp.toString()}`;
}

/** DB·PostgREST 원문은 URL 로 내보내지 않는다 — 고정 문구로만 */
function mapExecuteError(raw: string | null | undefined): string {
  const t = String(raw ?? "").trim();
  if (/ADMIN_REQUIRED|permission denied|42501|row-level security/i.test(t)) return "정산 실행 권한이 확인되지 않았습니다.";
  if (/account_deletion|deletion guard|탈퇴/i.test(t)) return "탈퇴 진행 중인 멘토가 포함되어 실행이 중단되었습니다. 담당자에게 문의해 주세요.";
  if (/violates.*check|duplicate key|unique constraint|23505/i.test(t)) return "데이터베이스 제약 조건과 맞지 않아 실행이 중단되었습니다. 지급 이력을 확인해 주세요.";
  return SETTLEMENT_EXECUTE_MESSAGES.generic;
}

export async function executePayoutRunAction(formData: FormData): Promise<void> {
  const { user } = await requireRole("admin");
  const back = buildSettlementUrl({ tab: "current" });
  const reason = textFromForm(formData.get(SETTLEMENT_EXECUTE_REASON_FIELD));
  const runDate = textFromForm(formData.get(SETTLEMENT_EXECUTE_FIELDS.runDate));
  const expected = parsePayoutExecuteExpected((field) => textFromForm(formData.get(field)));

  // 확인 모달(critical)을 우회한 제출도 서버에서 막는다 — 사유 없는 자금 확정 금지.
  if (!isSettlementReasonValid(reason)) redirect(withQuery(back, "error", SETTLEMENT_EXECUTE_REASON_REQUIRED_MESSAGE));
  if (!expected) redirect(withQuery(back, "error", SETTLEMENT_EXECUTE_MESSAGES.stale));
  if (runDate !== currentPayoutRunDate(new Date())) redirect(withQuery(back, "error", SETTLEMENT_EXECUTE_MESSAGES.runDateMismatch));

  // D-AD-4: service role 없으면 fail-closed.
  const resolved = resolveAdminWriteClient(() => createServiceRoleClient());
  if (!resolved.ok) redirect(withQuery(back, "error", resolved.message));
  const admin = resolved.client;

  const existing = await admin.from("payout_runs").select("id, status").eq("idempotency_key", payoutRunIdempotencyKey(runDate)).maybeSingle();
  if (existing.error) {
    console.error("[settlementActions] payout_runs 조회 실패", existing.error.message);
    redirect(withQuery(back, "error", SETTLEMENT_EXECUTE_MESSAGES.generic));
  }
  if (existing.data && String((existing.data as { status?: unknown }).status) === "completed") {
    redirect(withQuery(back, "error", SETTLEMENT_EXECUTE_MESSAGES.alreadyCompleted));
  }

  // 실행 직전 드라이런 — 미리보기가 보여준 값과 다르면 거부.
  const dry = await admin.rpc("run_scheduled_payout", { p_run_date: runDate, p_force_dry_run: true });
  const dryRun = dry.error ? null : parsePayoutRunResult(dry.data);
  if (!dryRun) {
    console.error("[settlementActions] run_scheduled_payout(dry run) 실패", dry.error?.message ?? "empty");
    redirect(withQuery(back, "error", SETTLEMENT_EXECUTE_MESSAGES.generic));
  }
  if (!expectedMatchesDryRun(expected, dryRun)) redirect(withQuery(back, "error", SETTLEMENT_EXECUTE_MESSAGES.stale));

  // 실제 실행 — 유일한 쓰기 호출. 실제 송금은 하지 않는다(캐시 원장·지갑·payout_runs·payout_run_items 만).
  const { data, error } = await admin.rpc("pay_due_payouts_for_run", { p_run_date: runDate, p_idempotency_key: null, p_dry_run: false });
  if (error) {
    console.error("[settlementActions] pay_due_payouts_for_run 실패", error.message);
    redirect(withQuery(back, "error", mapExecuteError(error.message)));
  }
  const result = parsePayoutRunResult(data);
  if (!result) {
    console.error("[settlementActions] pay_due_payouts_for_run 응답 형상 불일치", JSON.stringify(data).slice(0, 200));
    redirect(withQuery(back, "error", SETTLEMENT_EXECUTE_MESSAGES.generic));
  }

  let mentorCount: number | null = null;
  if (result.runId) {
    const runRow = await admin.from("payout_runs").select("mentor_count").eq("id", result.runId).maybeSingle();
    const mc = (runRow.data as { mentor_count?: unknown } | null)?.mentor_count;
    mentorCount = typeof mc === "number" ? mc : null;
  }

  const session = await createClient();
  await logAdminAction(session, {
    adminId: user.id,
    actionType: PAYOUT_RUN_EXECUTE_ACTION_TYPE,
    targetType: PAYOUT_RUN_TARGET_TYPE,
    targetId: result.runId,
    detail: {
      reason,
      runDate,
      paidCount: result.paidCount,
      skippedNoAccount: result.skippedNoAccount,
      totalMentorCents: result.totalMentorCents,
      totalWithholdingCents: result.totalWithholdingCents,
      totalNetCents: result.totalNetCents,
      expected,
    },
  });

  revalidatePath(SETTLEMENT_BASE_PATH);
  revalidatePath("/admin/dashboard");
  revalidatePath("/mentor/payouts");
  redirect(withQuery(buildSettlementUrl({ tab: "history", run: result.runId }), "ok", buildPayoutExecuteOkMessage(result, mentorCount)));
}
