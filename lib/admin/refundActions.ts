"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/routeGuard";
import { logAdminAction } from "@/lib/admin/adminActionLog";
import { resolveAdminWriteClient } from "@/lib/admin/adminWriteClient";
import {
  REFUND_APPROVE_REASON_REQUIRED_MESSAGE,
  REFUND_BULK_DECISION_FIELD,
  REFUND_BULK_IDS_FIELD,
  REFUND_BULK_MAX_IDS,
  REFUND_REASON_FIELD,
  REFUND_REJECT_REASON_REQUIRED_MESSAGE,
  REFUND_RETURN_TO_FIELD,
  isRefundBulkDecision,
  isRefundReasonValid,
  refundBulkErrorState,
  resolveRefundReturnPath,
  summarizeRefundBulkResults,
  type RefundBulkItemResult,
  type RefundBulkResultState,
} from "@/lib/admin/refundConsole";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * 환불 승인·반려 서버 액션 — RPC `approve_refund_request_admin` / `reject_refund_request_admin` 호출 경로(DB 동작 불변).
 *
 * PR-3 에서 RPC **앞에** 붙인 것:
 * - 사유 필수(`adminNote`, 다이얼로그와 같은 최소 길이) — 확인 모달을 우회한 제출도 서버에서 막는다.
 *   사유는 RPC `p_admin_note` 로 들어가 `refunds.admin_note` 에 남고, `admin_action_logs.detail.note` 에도 남는다.
 * - 돌아갈 경로(`returnTo`) — 목록 또는 상세만 허용(`resolveRefundReturnPath`). 실패 시 같은 화면에서 재시도할 수 있다.
 * - 일괄 처리 `bulkRefundDecisionAction` — 별도 RPC 가 없어(§0) 건별로 순차 호출하고 **건별 결과를 돌려준다**(redirect 없음,
 *   `useActionState`). 성공 건은 이미 자금이 이동했으므로 되돌리지 않는다.
 */

const PATH = "/admin/refunds";

/** 매핑되지 않은 RPC/Postgres/PostgREST 오류 시 URL·UI에 노출할 고정 문구 */
const REFUND_FLOW_GENERIC = "환불 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.";

function withQuery(path: string, key: "ok" | "error", msg: string) {
  const p = new URLSearchParams();
  p.set(key, msg);
  return `${path}?${p.toString()}`;
}

function textFromForm(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

type RpcPayload = {
  ok?: boolean;
  noop?: boolean;
  message?: string;
  status?: string;
};

function asRpcPayload(data: unknown): RpcPayload {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return data as RpcPayload;
  }
  return {};
}

/** RPC `approve_refund_request_admin` / `reject_refund_request_admin`이 반환하는 `message` (한국어 고정 문구만). */
const REFUND_RPC_PAYLOAD_MESSAGES_OK_FALSE = new Set([
  "환불 ID가 필요합니다.",
  "관리자 ID가 필요합니다.",
  "환불 요청을 찾을 수 없습니다.",
  "이미 정산 지급이 완료된 건은 자동 환불할 수 없습니다. 수동 조정이 필요합니다.",
  "이미 멘토 정산 지급이 완료된 구독 건은 자동 환불할 수 없습니다. 수동 조정이 필요합니다.",
  "환불 금액이 허용 한도를 초과합니다.",
]);

/**
 * PostgREST `error.message` 및 RPC JSON `payload.message`를 사용자/URL용으로만 변환.
 * 원문은 URL에 넣지 않으며, 매핑되지 않은 값은 REFUND_FLOW_GENERIC으로 떨어진다.
 */
function mapRefundUserFacingError(raw: string | undefined | null, whenTrimmedEmpty?: string): string {
  const t = String(raw ?? "").trim();
  if (!t) {
    return whenTrimmedEmpty ?? REFUND_FLOW_GENERIC;
  }

  if (/ADMIN_REQUIRED/i.test(t)) {
    return "관리자 권한이 확인되지 않았습니다.";
  }
  if (/환불 금액이 설정되지 않아 자동 승인할 수 없습니다/.test(t)) {
    return "환불 금액이 설정되지 않아 자동 승인할 수 없습니다.";
  }
  if (/이미 멘토 정산 지급이 완료된 구독 건/.test(t)) {
    return "이미 멘토 정산 지급이 완료된 구독 건은 자동 환불할 수 없습니다. 수동 조정이 필요합니다.";
  }
  if (/이미 정산 지급이 완료된 건/.test(t)) {
    return "이미 정산 지급이 완료된 건은 자동 환불할 수 없습니다. 수동 조정이 필요합니다.";
  }
  if (/CASH_WALLET_UPDATE_FAILED|REFUND_LEDGER|LEDGER_AMOUNT_MISMATCH|LEDGER_IDEMPOTENT|REFUND_LEDGER_IDEMPOTENT_MISS|REFUND_LEDGER_AMOUNT_MISMATCH/i.test(t)) {
    return "캐시 원장·지갑 처리 중 오류가 발생했습니다. 잠시 후 다시 시도하거나 관리자에게 문의해 주세요.";
  }
  if (/violates.*check|check constraint|duplicate key|unique constraint|23505/i.test(t)) {
    return "데이터베이스 제약 조건과 맞지 않습니다. 스키마·결제 상태를 확인해 주세요.";
  }
  if (/relation|does not exist|schema cache|syntax error|42804|42703|42P01|42883|42501|permission denied|row-level security|not authorized|policy/i.test(t)) {
    return "데이터베이스 제약 조건과 맞지 않습니다. 스키마·결제 상태를 확인해 주세요.";
  }
  if (/REFUND_NOT_FOUND|환불 요청을 찾을 수 없습니다/i.test(t)) {
    return "환불 요청을 찾을 수 없습니다.";
  }
  if (/REFUND_NOT_PENDING|이미 처리되었거나 대기 상태가 아닙니다/i.test(t)) {
    return "이미 처리되었거나 대기 상태가 아닙니다.";
  }
  if (/WALLET_NOT_FOUND/i.test(t)) {
    return "캐시 지갑을 찾을 수 없습니다. 멤버십·결제 설정을 확인해 주세요.";
  }
  if (/INSUFFICIENT|CASH_INSUFFICIENT|잔액이 부족|잔액 부족/i.test(t)) {
    return "캐시 잔액이 부족해 환불을 완료할 수 없습니다. 원장·지갑 상태를 확인해 주세요.";
  }

  if (REFUND_RPC_PAYLOAD_MESSAGES_OK_FALSE.has(t)) {
    return t;
  }

  console.error("[refundActions] unmapped refund RPC/postgrest error (sanitized for user)", t);
  return REFUND_FLOW_GENERIC;
}

type Decision = "approve" | "reject";

const RPC_BY_DECISION: Record<Decision, "approve_refund_request_admin" | "reject_refund_request_admin"> = {
  approve: "approve_refund_request_admin",
  reject: "reject_refund_request_admin",
};

const DECISION_LABEL: Record<Decision, string> = { approve: "승인", reject: "반려" };

type SingleRpcOutcome =
  | { ok: true; noop: boolean; message: string }
  | { ok: false; message: string };

/** RPC 1회 호출 → 사용자용 결과. 원문 오류는 로그로만. */
async function callRefundRpc(
  admin: ReturnType<typeof createServiceRoleClient>,
  decision: Decision,
  refundId: string,
  adminId: string,
  adminNote: string
): Promise<SingleRpcOutcome> {
  const { data, error } = await admin.rpc(RPC_BY_DECISION[decision], {
    p_refund_id: refundId,
    p_admin_id: adminId,
    p_admin_note: adminNote,
  });
  if (error) {
    console.error(`[refundActions] ${RPC_BY_DECISION[decision]} RPC error`, error.message);
    return { ok: false, message: mapRefundUserFacingError(error.message) };
  }
  if (data == null) {
    return { ok: false, message: "서버 응답이 없습니다." };
  }
  const payload = asRpcPayload(data);
  if (payload.ok !== true) {
    const pm = typeof payload.message === "string" ? payload.message : "";
    console.error(`[refundActions] ${RPC_BY_DECISION[decision]} RPC ok:false`, { refundId, message: pm || null });
    return { ok: false, message: mapRefundUserFacingError(pm, `환불 ${DECISION_LABEL[decision]}에 실패했습니다.`) };
  }
  if (payload.noop === true) {
    return { ok: true, noop: true, message: payload.message ?? "이미 처리되었거나 대기 상태가 아닙니다." };
  }
  return { ok: true, noop: false, message: `환불 ${DECISION_LABEL[decision]}이 완료되었습니다.` };
}

function revalidateRefundPaths(returnPath: string) {
  revalidatePath(PATH);
  revalidatePath("/admin/dashboard");
  if (returnPath !== PATH) revalidatePath(returnPath);
}

async function runSingleDecision(decision: Decision, formData: FormData): Promise<never> {
  const { user } = await requireRole("admin");
  const refundId = textFromForm(formData.get("refundId"));
  const adminNote = textFromForm(formData.get(REFUND_REASON_FIELD));
  const returnPath = resolveRefundReturnPath(textFromForm(formData.get(REFUND_RETURN_TO_FIELD)));

  if (!refundId) {
    redirect(withQuery(returnPath, "error", "환불을 선택할 수 없습니다."));
  }
  // 확인 모달(critical/프리셋)을 우회한 제출도 서버에서 막는다 — 사유 없는 자금 이동·반려 금지.
  if (!isRefundReasonValid(adminNote)) {
    redirect(
      withQuery(returnPath, "error", decision === "approve" ? REFUND_APPROVE_REASON_REQUIRED_MESSAGE : REFUND_REJECT_REASON_REQUIRED_MESSAGE)
    );
  }

  // D-AD-4: service role 없으면 fail-closed(한글 안내).
  const resolved = resolveAdminWriteClient(() => createServiceRoleClient());
  if (!resolved.ok) redirect(withQuery(returnPath, "error", resolved.message));

  const outcome = await callRefundRpc(resolved.client, decision, refundId, user.id, adminNote);
  if (!outcome.ok) {
    redirect(withQuery(returnPath, "error", outcome.message));
  }

  const session = await createClient();
  await logAdminAction(session, {
    adminId: user.id,
    actionType: decision === "approve" ? "refund_approve" : "refund_reject",
    targetType: "refund",
    targetId: refundId,
    detail: { note: adminNote, noop: outcome.noop },
  });
  revalidateRefundPaths(returnPath);
  redirect(withQuery(returnPath, "ok", outcome.message));
}

export async function approveAdminRefundAction(formData: FormData) {
  await runSingleDecision("approve", formData);
}

export async function rejectAdminRefundAction(formData: FormData) {
  await runSingleDecision("reject", formData);
}

function idsFromForm(formData: FormData): string[] {
  const seen = new Set<string>();
  for (const v of formData.getAll(REFUND_BULK_IDS_FIELD)) {
    const s = typeof v === "string" ? v.trim() : "";
    if (s) seen.add(s);
  }
  return [...seen].slice(0, REFUND_BULK_MAX_IDS);
}

/**
 * 일괄 승인·반려 — `useActionState` 용. 별도 일괄 RPC 가 없으므로(§0) 검증된 단건 RPC 를 **건별로 순차 호출**한다.
 * - 한 건이 실패해도 다음 건을 계속 처리하고, 결과를 건별로 돌려준다(`2건 성공 · 1건 실패(이유)`).
 * - 성공한 건은 되돌리지 않는다 — 이미 원장에 기록되고 지갑이 움직였다. 실패 건만 화면에서 다시 시도한다.
 * - 사유는 전체에 같은 값으로 적용되며 승인·반려 모두 필수다.
 */
export async function bulkRefundDecisionAction(_prev: RefundBulkResultState, formData: FormData): Promise<RefundBulkResultState> {
  const { user } = await requireRole("admin");
  const decisionRaw = textFromForm(formData.get(REFUND_BULK_DECISION_FIELD)).toLowerCase();
  if (!isRefundBulkDecision(decisionRaw)) {
    return refundBulkErrorState("approve", "허용되지 않은 일괄 처리입니다.");
  }
  const decision = decisionRaw;
  const ids = idsFromForm(formData);
  if (!ids.length) return refundBulkErrorState(decision, "선택된 항목이 없습니다.");
  const adminNote = textFromForm(formData.get(REFUND_REASON_FIELD));
  if (!isRefundReasonValid(adminNote)) {
    return refundBulkErrorState(decision, decision === "approve" ? REFUND_APPROVE_REASON_REQUIRED_MESSAGE : REFUND_REJECT_REASON_REQUIRED_MESSAGE);
  }

  const resolved = resolveAdminWriteClient(() => createServiceRoleClient());
  if (!resolved.ok) return refundBulkErrorState(decision, resolved.message);
  const admin = resolved.client;

  const results: RefundBulkItemResult[] = [];
  for (const refundId of ids) {
    // 순차 — 각 건은 자기 RPC 트랜잭션 안에서만 원자적이다. 앞 건의 성공은 뒤 건의 실패와 무관하게 유지된다.
    const outcome = await callRefundRpc(admin, decision, refundId, user.id, adminNote);
    results.push(
      outcome.ok
        ? { refundId, ok: true, noop: outcome.noop, message: outcome.noop ? outcome.message : null }
        : { refundId, ok: false, noop: false, message: outcome.message }
    );
  }
  const state = summarizeRefundBulkResults(decision, results);

  await logAdminAction(admin, {
    adminId: user.id,
    actionType: `refund_bulk_${decision}`,
    targetType: "refund",
    detail: {
      note: adminNote,
      requested: state.requested,
      success: state.succeeded,
      failed: state.failed,
      failedIds: results.filter((r) => !r.ok).map((r) => r.refundId),
      results: results.map((r) => ({ id: r.refundId, ok: r.ok, noop: r.noop, message: r.message })),
    },
  });
  revalidatePath(PATH);
  revalidatePath("/admin/dashboard");
  return state;
}
