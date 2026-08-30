import "server-only";

// 페이싱크 주문 발급·취소·수동 재확인 (Phase 3 §5).
//
// 순서 계약(§1): 인증(호출부) → 입력 검증(패키지 allowlist · 입금자명) → 본인 pending
// 재사용 판정 → 그 후에만 외부 호출. 검증 실패에서 페이싱크 호출은 0회다.
//
// 발급 순서는 **페이싱크 먼저, 로컬 나중**이다. 반대로 하면 로컬에만 있고 페이싱크에는
// 없는 유령 주문이 생겨 사용자에게 입금 안내를 띄워놓고 매칭이 영영 안 된다.
// 페이싱크 발급 후 로컬 insert 가 실패하면 발급된 주문을 되돌린다(고아 주문 방지).

import type { SupabaseClient } from "@supabase/supabase-js";
import { cashKrwForPayKrw, isAllowedChargePayKrw } from "@/lib/cash/chargePackages";
import {
  createPaysyncInvoice,
  deletePaysyncInvoice,
  fetchPaysyncInvoice,
} from "@/lib/paysync/client";
import { depositorNameError, normalizeDepositorName } from "@/lib/paysync/depositorName";
import { buildPaysyncLedgerOrderRef } from "@/lib/paysync/paysyncLedgerRef";
import { userMessageForPaysyncCode } from "@/lib/paysync/paysyncErrorMessages";
import { recordPaysyncTopup } from "@/lib/paysync/paysyncTopupServer";

export const PAYSYNC_INVOICE_COLUMNS =
  "id, user_id, paysync_invoice_id, ledger_order_ref, pay_krw, cash_krw, bonus_krw, depositor_name, status, issued_at, expires_at, paid_at";

export type PaysyncInvoiceRow = {
  id: string;
  user_id: string;
  paysync_invoice_id: string;
  ledger_order_ref: string;
  pay_krw: number;
  cash_krw: number;
  bonus_krw: number;
  depositor_name: string;
  status: "pending" | "paid" | "expired" | "canceled";
  issued_at: string;
  expires_at: string | null;
  paid_at: string | null;
};

export type IssueResult =
  | { ok: true; invoice: PaysyncInvoiceRow; reused: boolean }
  | { ok: false; message: string };

/** 본인의 진행 중(pending) 무통장 주문. 화면·재사용 판정 공용. */
export async function findOwnPendingInvoice(
  db: SupabaseClient,
  userId: string,
): Promise<PaysyncInvoiceRow | null> {
  const { data, error } = await db
    .from("paysync_invoices")
    .select(PAYSYNC_INVOICE_COLUMNS)
    .eq("user_id", userId)
    .eq("status", "pending")
    .order("issued_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[paysync/invoice] findOwnPendingInvoice", error.code);
    return null;
  }
  return (data as PaysyncInvoiceRow) ?? null;
}

/**
 * 주문 발급. 이미 본인 pending 주문이 있으면 **새로 만들지 않고 그것을 돌려준다**
 * (§5) — 같은 사람 앞으로 미결제 주문이 여러 개면 어느 것에 매칭될지 모호해진다.
 */
export async function issuePaysyncInvoice(params: {
  admin: SupabaseClient;
  userId: string;
  payKrw: number;
  depositorName: string;
}): Promise<IssueResult> {
  const { admin, userId, payKrw } = params;
  const depositorName = normalizeDepositorName(params.depositorName);

  // 1) 입력 검증 — 외부 호출 전
  if (!isAllowedChargePayKrw(payKrw)) {
    return { ok: false, message: "허용되지 않은 충전 금액입니다." };
  }
  const cashKrw = cashKrwForPayKrw(payKrw);
  if (cashKrw == null) return { ok: false, message: "허용되지 않은 충전 금액입니다." };
  const nameError = depositorNameError(depositorName);
  if (nameError) return { ok: false, message: nameError };

  // 2) 본인 pending 재사용 — 외부 호출 없이 기존 주문으로 안내한다.
  const existing = await findOwnPendingInvoice(admin, userId);
  if (existing) return { ok: true, invoice: existing, reused: true };

  // 3) 페이싱크 발급
  const created = await createPaysyncInvoice({
    depositorName,
    amountWon: payKrw,
    metadata: { userId, ref: "wallet-charge" },
    expireAfter: "1d",
  });

  if (!created.ok) {
    if (created.code === "INVOICE_ALREADY_EXISTS") {
      // 우리 로컬엔 pending 이 없는데 페이싱크엔 같은 (입금자명, 금액) 미결제 주문이 있다
      // = 동명이인 충돌이다(본인 건이면 위 2)에서 이미 재사용됐다). v1 에서 금액
      // 유니크화는 하지 않기로 했으므로(§5) 재시도·금액 변경을 안내한다.
      return { ok: false, message: userMessageForPaysyncCode("INVOICE_ALREADY_EXISTS") };
    }
    return { ok: false, message: created.message };
  }

  const paysyncInvoiceId = String((created.data as { id?: unknown })?.id ?? "").trim();
  const expiresAtRaw = (created.data as { expiresAt?: unknown })?.expiresAt;
  if (!paysyncInvoiceId.startsWith("ivc_")) {
    console.error("[paysync/invoice] 발급 응답에 주문 ID 가 없다");
    return { ok: false, message: userMessageForPaysyncCode("malformed_response") };
  }

  // 4) 로컬 정본 — 실패하면 발급된 주문을 되돌린다(로컬에 없는 주문은 적립 불가라
  //    그대로 두면 사용자가 입금해도 영영 매칭되지 않는다).
  const { data, error } = await admin
    .from("paysync_invoices")
    .insert({
      user_id: userId,
      paysync_invoice_id: paysyncInvoiceId,
      ledger_order_ref: buildPaysyncLedgerOrderRef(userId, Date.now()),
      pay_krw: payKrw,
      cash_krw: cashKrw,
      bonus_krw: cashKrw - payKrw,
      depositor_name: depositorName,
      status: "pending",
      expires_at: typeof expiresAtRaw === "string" ? expiresAtRaw : null,
    })
    .select(PAYSYNC_INVOICE_COLUMNS)
    .single();

  if (error || !data) {
    console.error("[paysync/invoice] 로컬 insert 실패 — 발급 주문 회수 시도", error?.code);
    const rollback = await deletePaysyncInvoice(paysyncInvoiceId);
    if (!rollback.ok) {
      // 회수까지 실패했다 — 페이싱크에만 존재하는 고아 주문이다. 입금이 오면 웹훅이
      // unknown_invoice 로 막고 감사 로그에 남으므로, 수동 대사 근거는 확보된다.
      console.error("[paysync/invoice] 고아 주문 발생", { paysyncInvoiceId, code: rollback.code });
    }
    return { ok: false, message: "입금 주문을 만들지 못했어요. 잠시 후 다시 시도해 주세요." };
  }

  return { ok: true, invoice: data as PaysyncInvoiceRow, reused: false };
}

export type CancelResult = { ok: true } | { ok: false; message: string };

/**
 * 주문 취소 — 페이싱크 삭제 후 로컬 canceled.
 * 이미 결제된 주문은 페이싱크가 403 `INVOICE_ALREADY_PAID` 로 거부한다. 그 경우
 * 로컬을 canceled 로 내리지 않는다 — 입금된 돈이 있고, 적립은 웹훅·크론이 처리한다.
 */
export async function cancelPaysyncInvoice(params: {
  admin: SupabaseClient;
  userId: string;
  localId: string;
}): Promise<CancelResult> {
  const { admin, userId, localId } = params;

  const { data: row, error } = await admin
    .from("paysync_invoices")
    .select(PAYSYNC_INVOICE_COLUMNS)
    .eq("id", localId)
    .eq("user_id", userId) // 본인 주문만
    .maybeSingle();
  if (error || !row) return { ok: false, message: "입금 주문을 찾을 수 없습니다." };

  const invoice = row as PaysyncInvoiceRow;
  if (invoice.status !== "pending") {
    return { ok: false, message: "이미 처리된 주문입니다." };
  }

  const deleted = await deletePaysyncInvoice(invoice.paysync_invoice_id);
  if (!deleted.ok) {
    if (deleted.code === "INVOICE_ALREADY_PAID") {
      return { ok: false, message: userMessageForPaysyncCode("INVOICE_ALREADY_PAID") };
    }
    // INVOICE_NOT_FOUND(이미 삭제됨)는 로컬만 정리하면 된다.
    if (deleted.code !== "INVOICE_NOT_FOUND") {
      return { ok: false, message: deleted.message };
    }
  }

  const { error: updateError } = await admin
    .from("paysync_invoices")
    .update({ status: "canceled" })
    .eq("id", localId)
    .eq("status", "pending"); // 경합 방어: 그 사이 웹훅이 paid 로 바꿨으면 건드리지 않는다
  if (updateError) {
    console.error("[paysync/invoice] cancel local update", updateError.code);
    return { ok: false, message: "주문을 취소하지 못했어요. 잠시 후 다시 시도해 주세요." };
  }

  return { ok: true };
}

export type RefreshResult =
  | { ok: true; credited: boolean; message: string }
  | { ok: false; message: string };

/**
 * "입금했는데 확인이 안 돼요" — 사용자가 직접 누르는 재확인.
 * 크론과 **같은 경로**(recordPaysyncTopup)를 쓴다. 별도 구현을 두면 사용자 버튼과
 * 자동 회수의 판정이 갈라진다.
 */
export async function refreshPaysyncInvoice(params: {
  admin: SupabaseClient;
  userId: string;
  localId: string;
}): Promise<RefreshResult> {
  const { admin, userId, localId } = params;

  const { data: row } = await admin
    .from("paysync_invoices")
    .select(PAYSYNC_INVOICE_COLUMNS)
    .eq("id", localId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!row) return { ok: false, message: "입금 주문을 찾을 수 없습니다." };

  const invoice = row as PaysyncInvoiceRow;
  if (invoice.status === "paid") {
    return { ok: true, credited: false, message: "이미 입금이 확인되어 캐시가 지급됐어요." };
  }

  const result = await recordPaysyncTopup({
    admin,
    paysyncInvoiceId: invoice.paysync_invoice_id,
    eventUserId: null, // 로컬 행이 소유자 정본
    trigger: "MANUAL_REFRESH",
    lookupTimeoutMs: 8_000,
  });

  if ("skip" in result) {
    if (result.skip === "remote_not_paid") {
      return {
        ok: true,
        credited: false,
        message: "아직 입금이 확인되지 않았어요. 입금자명과 금액이 안내와 정확히 같은지 확인해 주세요.",
      };
    }
    if (result.skip === "already_paid") {
      return { ok: true, credited: false, message: "이미 입금이 확인되어 캐시가 지급됐어요." };
    }
    return { ok: false, message: "입금 확인에 실패했어요. 잠시 후 다시 시도해 주세요." };
  }
  if (!result.ok) return { ok: false, message: result.message };

  return {
    ok: true,
    credited: !result.duplicate,
    message: result.duplicate
      ? "이미 입금이 확인되어 캐시가 지급됐어요."
      : `입금이 확인되어 ${result.cashKrw.toLocaleString("ko-KR")}캐시가 충전됐어요.`,
  };
}

export { fetchPaysyncInvoice };
