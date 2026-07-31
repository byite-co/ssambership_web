import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { callApiWebV1Rpc } from "@/lib/apiWebV1/rpc";
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

/**
 * Toss 결제 완료 후 캐시 충전 원장 기록.
 * S2-2 전환 W3(C7): 운영 Toss confirm·webhook 경로는 F11
 * `api_web_v1.record_cash_topup_v2(p_user_id, p_amount_cents, p_order_ref)` 를
 * service_role 로 호출한다(계약 §7 F11 · §17 #13). `p_order_ref` 는 Toss orderId
 * 원문이고 같은 값이 F11 멱등키다 — 별도 키를 만들지 않으며, `ref_id` 는 전달하지
 * 않는다(주문 정본 참조 = `idempotency_key`, rev 8 A-6). 신규/duplicate 판정은
 * F11 반환의 `duplicate` 가 정본이다 — 구 cash_ledger 사전 SELECT 추정 helper 는
 * 제거했다(W3 §4.1). 판정·순서는 tossTopupCore.recordCashTopupCore(순수·
 * 계약테스트 대상)가 정본이고, 이 함수는 실제 admin 클라이언트로 포트만 배선한다.
 * 기존 계약 유지: F11 신규 기록 성공 시에만 past_due 복구 1회(best-effort),
 * duplicate 재생은 복구 재실행 없이 duplicate 로 통과(이중 적립 0).
 * (테스트 충전 `walletTopupActions.ts` 는 의도적으로 레거시 `record_cash_topup`
 * 유지 — 전환 대상 아님, rev 8 A-6 정정 2.)
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
    recordTopupV2: async (userId, amountCents, orderRef) => {
      const res = await callApiWebV1Rpc(admin, "record_cash_topup_v2", {
        p_user_id: userId,
        p_amount_cents: amountCents,
        p_order_ref: orderRef,
      });
      if (!res.ok) {
        // 코드만 로깅 — LEDGER_FIELD_MISMATCH 등 안정 코드는 코어가 그대로 실패로 전달한다.
        console.error("[recordCashTopupFromTossOrder] record_cash_topup_v2", {
          code: res.code,
          transport: res.message !== null,
          orderId,
          userId,
        });
        return { ok: false, code: res.code };
      }
      return { ok: true, duplicate: res.row.duplicate === true };
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
