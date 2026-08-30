import "server-only";

// 페이싱크 적립 서버 래퍼 — 순수 코어(paysyncTopupCore)에 실제 포트를 배선한다.
// 판정·순서는 전부 코어가 정본이고, 이 파일은 어댑터만 담당한다
// (lib/toss/cashTopupFromPayment.ts 와 같은 역할).

import type { SupabaseClient } from "@supabase/supabase-js";
import { callApiWebV1Rpc } from "@/lib/apiWebV1/rpc";
import { fetchPaysyncInvoice } from "@/lib/paysync/client";
import {
  recordPaysyncTopupCore,
  type LocalPaysyncInvoice,
  type PaysyncTopupResult,
} from "@/lib/paysync/paysyncTopupCore";
import { recoverPastDueAfterTopup } from "@/lib/toss/cashTopupFromPayment";

/** 코어가 쓰는 필드만 조회한다(과다 노출 금지). */
const LOCAL_INVOICE_COLUMNS =
  "id, user_id, paysync_invoice_id, ledger_order_ref, pay_krw, cash_krw, status";

type LocalInvoiceRow = {
  id: string;
  user_id: string;
  paysync_invoice_id: string;
  ledger_order_ref: string;
  pay_krw: number;
  cash_krw: number;
  status: string;
};

function toLocalInvoice(row: LocalInvoiceRow): LocalPaysyncInvoice {
  return {
    id: row.id,
    userId: row.user_id,
    paysyncInvoiceId: row.paysync_invoice_id,
    ledgerOrderRef: row.ledger_order_ref,
    payKrw: Number(row.pay_krw),
    cashKrw: Number(row.cash_krw),
    status: row.status as LocalPaysyncInvoice["status"],
  };
}

/**
 * 페이싱크 주문 1건 적립. 웹훅·보정 크론이 **같은 함수**를 쓴다 —
 * 크론은 웹훅 유실 복구가 목적이므로 경로가 갈라지면 안 된다.
 *
 * `eventUserId` 는 웹훅 metadata 에서 온 값이다. 크론에는 없으므로 null 을 넘긴다
 * (로컬 행이 이미 소유자 정본이라 대조가 불필요하다).
 */
export async function recordPaysyncTopup(params: {
  admin: SupabaseClient;
  paysyncInvoiceId: string;
  eventUserId: string | null;
  trigger: string | null;
  /** 재조회 타임아웃(ms). 웹훅은 10초 응답 제한이 있어 짧게, 크론은 여유 있게. */
  lookupTimeoutMs?: number;
}): Promise<PaysyncTopupResult> {
  const { admin, paysyncInvoiceId, eventUserId, trigger, lookupTimeoutMs } = params;

  return recordPaysyncTopupCore(
    { paysyncInvoiceId, eventUserId, trigger },
    {
      findLocalInvoice: async (id) => {
        const { data, error } = await admin
          .from("paysync_invoices")
          .select(LOCAL_INVOICE_COLUMNS)
          .eq("paysync_invoice_id", id)
          .maybeSingle();
        if (error) {
          console.error("[paysync/topup] findLocalInvoice", { code: error.code, invoiceId: id });
          return null;
        }
        return data ? toLocalInvoice(data as LocalInvoiceRow) : null;
      },

      fetchRemoteInvoice: async (id) => {
        const res = await fetchPaysyncInvoice(id, lookupTimeoutMs);
        if (!res.ok) return { ok: false, code: res.code };
        const d = res.data;
        const amount = Number(d?.amount);
        return {
          ok: true,
          invoice: {
            paid: d?.paid === true,
            amountWon: Number.isFinite(amount) ? amount : Number.NaN,
          },
        };
      },

      recordTopupV2: async (userId, amountCents, orderRef) => {
        const res = await callApiWebV1Rpc(admin, "record_cash_topup_v2", {
          p_user_id: userId,
          p_amount_cents: amountCents,
          p_order_ref: orderRef,
        });
        if (!res.ok) {
          // 코드만 로깅 — 원문은 사용자에게 나가지 않는다.
          console.error("[paysync/topup] record_cash_topup_v2", {
            code: res.code,
            transport: res.message !== null,
            userId,
          });
          return { ok: false, code: res.code };
        }
        return { ok: true, duplicate: res.row.duplicate === true };
      },

      markLocalPaid: async (localId, paidTrigger) => {
        const { error } = await admin
          .from("paysync_invoices")
          .update({
            status: "paid",
            paid_at: new Date().toISOString(),
            paid_trigger: paidTrigger,
          })
          .eq("id", localId);
        if (error) {
          // 여기서 실패해도 원장은 이미 기록됐다. 로컬은 pending 으로 남고 다음 재시도가
          // F11 duplicate 를 거쳐 다시 이 단계로 와서 스스로 복구한다.
          console.error("[paysync/topup] markLocalPaid", { code: error.code, localId });
        }
      },

      recoverPastDue: (userId) => recoverPastDueAfterTopup(admin, userId),
    },
  );
}

/** 페이싱크 수신·적립 감사 기록 (service_role). 실패는 삼킨다. */
export async function logPaysyncTopupAudit(
  admin: SupabaseClient,
  detail: Record<string, unknown>,
): Promise<void> {
  const { error } = await admin.from("admin_action_logs").insert({
    admin_id: null,
    action_type: "paysync_webhook",
    target_type: "cash_topup",
    target_id: null,
    detail,
  });
  if (error) console.error("[paysync/topup] audit log failed", error.message, detail);
}
