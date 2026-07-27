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
      // [SERVER_GATE] topup 원장 ref_id 기록(§4-1)은 웹에서 구현할 수 없다 — 서버 SQL 소관.
      //  1) 정본 RPC 시그니처가 record_cash_topup(uuid, bigint, text) 3인자라 ref 를 넘길 자리가 없고,
      //     INSERT 가 ref_id 를 상수 null 로 박아 둔다(supabase/sql/020_p0_cash_topup_charge.sql:35-43).
      //  2) cash_ledger.ref_id 는 uuid 컬럼인데(supabase/sql/004_p0_cash_disputes_admin_draft.sql:58)
      //     orderId 는 `cash-{userId}-{ts}` 텍스트라 타입이 맞지 않는다.
      //  3) 대안인 '내부 주문 ID' 도 없다 — payments 는 cash_topup/topup kind 를 명시적으로 거부하고
      //     (supabase/sql/143_p1_13_state_machine_hardening.sql:31-33), 별도 topup 주문 테이블도 없다.
      // → 주문 참조는 현재 idempotency_key(=orderId)가 유일한 정본 참조다. ref_id 기록에는
      //   RPC 시그니처 변경 또는 ref 컬럼 확장이 선행돼야 하며 이는 트랙 3(supabase/sql) 소관이다.
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
