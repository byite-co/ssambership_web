import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { cashKrwForPayKrw, isAllowedChargePayKrw } from "@/lib/cash/chargePackages";
import { recoverPastDueSubscriptionsForStudent } from "@/lib/subscribe/subscriptionRenewalBatch";
import { krwWonToCents, parseUserIdFromCashOrderId, recordCashTopupCore } from "@/lib/toss/tossTopupCore";

export { krwWonToCents, parseUserIdFromCashOrderId };

/**
 * 충전 직후 그 사용자의 past_due 구독을 즉시 복구한다(best-effort).
 * 충전 자체 흐름을 막지 않도록 예외/오류는 삼킨다. confirm·webhook·테스트충전 공용.
 */
export async function recoverPastDueAfterTopup(admin: SupabaseClient, userId: string): Promise<void> {
  try {
    const r = await recoverPastDueSubscriptionsForStudent(admin, userId, new Date());
    if (r.recovered > 0) {
      console.log("[recoverPastDueAfterTopup] recovered", { userId, ...r });
    }
  } catch (e) {
    console.error("[recoverPastDueAfterTopup]", e);
  }
}

export type RecordCashTopupResult =
  | { ok: true; duplicate: boolean; amount: number; payAmount: number; userId: string }
  | { ok: false; code: string; message: string };

export async function hasCashTopupForOrderId(
  admin: SupabaseClient,
  orderId: string
): Promise<boolean> {
  const { data, error } = await admin
    .from("cash_ledger")
    .select("id")
    .eq("idempotency_key", orderId)
    .maybeSingle();

  if (error) {
    console.error("[hasCashTopupForOrderId]", error.message, { orderId });
    return false;
  }

  return Boolean(data?.id);
}

/**
 * Toss 결제 완료 후 캐시 충전 원장 기록 (service_role + record_cash_topup).
 * confirm·webhook 공통. 판정·순서는 tossTopupCore.recordCashTopupCore(순수·계약테스트
 * 대상)가 정본이고, 이 함수는 실제 admin 클라이언트로 포트만 배선한다.
 * 기존 계약 유지: 신규 원장 기록 성공 시에만 past_due 복구 1회(best-effort),
 * duplicate 재호출은 복구 재실행 없이 duplicate 로 통과(이중 적립 0).
 */
export async function recordCashTopupFromTossOrder(params: {
  admin: SupabaseClient;
  orderId: string;
  payAmountWon: number;
}): Promise<RecordCashTopupResult> {
  const { admin, orderId, payAmountWon } = params;
  return recordCashTopupCore(orderId, payAmountWon, {
    isAllowedPayKrw: isAllowedChargePayKrw,
    cashKrwForPayKrw,
    hasTopupForOrderId: (id) => hasCashTopupForOrderId(admin, id),
    recordTopupRpc: async (userId, amountCents, idempotencyKey) => {
      const { error: rpcError } = await admin.rpc("record_cash_topup", {
        p_user_id: userId,
        p_amount_cents: amountCents,
        p_idempotency_key: idempotencyKey,
      });
      if (rpcError) {
        console.error("[recordCashTopupFromTossOrder] record_cash_topup", rpcError.message, { orderId, userId });
        return { error: true };
      }
      return { error: false };
    },
    // P1 ① — 충전 직후 past_due 구독 즉시 복구(best-effort, 충전 흐름은 중단하지 않음)
    recoverPastDue: (userId) => recoverPastDueAfterTopup(admin, userId),
  });
}

/** webhook 고아결제 복구 성공 시 admin_action_logs 기록 (service_role). */
export async function logWebhookCashTopupRecovery(
  admin: SupabaseClient,
  detail: Record<string, unknown>
): Promise<void> {
  const { error } = await admin.from("admin_action_logs").insert({
    admin_id: null,
    action_type: "webhook_recovery",
    target_type: "cash_topup",
    target_id: null,
    detail,
  });

  if (error) {
    console.error("[logWebhookCashTopupRecovery]", error.message, detail);
  }
}
