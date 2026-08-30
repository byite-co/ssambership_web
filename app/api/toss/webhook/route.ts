import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { isTossAllowedUser } from "@/lib/payments/tossGate";
import {
  logWebhookCashTopupRecovery,
  parseUserIdFromCashOrderId,
  recordCashTopupFromTossOrder,
} from "@/lib/toss/cashTopupFromPayment";
import {
  readTossWebhookSignatureHeader,
  verifyTossWebhookSignature,
} from "@/lib/toss/verifyTossWebhookSignature";

type TossPaymentWebhookData = {
  orderId?: string;
  paymentKey?: string;
  status?: string;
  totalAmount?: number;
  method?: string;
  card?: { amount?: number };
};

type TossPaymentWebhookEvent = {
  eventType?: string;
  createdAt?: string;
  data?: TossPaymentWebhookData;
};

type TossPaymentLookupData = {
  orderId?: string;
  paymentKey?: string;
  status?: string;
  totalAmount?: number;
  method?: string;
};

type TossPaymentLookupResult =
  | { ok: true; data: TossPaymentLookupData; amount: number }
  | { ok: false; code: string; message: string };

function okResponse(extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: true, ...extra });
}

function pickPayAmountWon(data: TossPaymentWebhookData): number {
  const total = Number(data.totalAmount);
  if (Number.isFinite(total) && total > 0) return total;
  const cardAmount = Number(data.card?.amount);
  if (Number.isFinite(cardAmount) && cardAmount > 0) return cardAmount;
  return Number.NaN;
}

function maskPaymentKey(value: string | null | undefined): string | null {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;
  return `${trimmed.slice(0, 4)}...`;
}

function webhookLogData(data: TossPaymentWebhookData): Record<string, unknown> {
  return {
    orderId: data.orderId ?? null,
    status: data.status ?? null,
    totalAmount: data.totalAmount ?? null,
    method: data.method ?? null,
    paymentKey: maskPaymentKey(data.paymentKey),
  };
}

async function fetchTossPayment(paymentKey: string): Promise<TossPaymentLookupResult> {
  const secret = process.env.TOSS_SECRET_KEY;
  if (!secret) {
    console.error("[toss/webhook] TOSS_SECRET_KEY missing");
    return { ok: false, code: "server_config", message: "TOSS_SECRET_KEY missing" };
  }

  const encoded = Buffer.from(`${secret}:`).toString("base64");
  const res = await fetch(`https://api.tosspayments.com/v1/payments/${encodeURIComponent(paymentKey)}`, {
    method: "GET",
    headers: {
      Authorization: `Basic ${encoded}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });

  const body = (await res.json().catch(() => null)) as TossPaymentLookupData | Record<string, unknown> | null;
  if (!res.ok || !body) {
    console.error("[toss/webhook] payment lookup failed", {
      status: res.status,
      paymentKey: maskPaymentKey(paymentKey),
    });
    return { ok: false, code: "payment_lookup_failed", message: `Toss payment lookup failed: ${res.status}` };
  }

  const data = body as TossPaymentLookupData;
  const amount = Number(data.totalAmount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, code: "payment_amount_missing", message: "Toss payment amount missing" };
  }

  return { ok: true, data, amount };
}

async function verifyWebhookPaymentWithToss(params: {
  orderId: string;
  paymentKey: string;
  payAmountWon: number;
}): Promise<TossPaymentLookupResult> {
  const { orderId, paymentKey, payAmountWon } = params;
  const lookup = await fetchTossPayment(paymentKey);
  if (!lookup.ok) return lookup;

  const actual = lookup.data;
  if (actual.status !== "DONE") {
    return { ok: false, code: "payment_not_done", message: `Toss payment status is ${actual.status ?? "missing"}` };
  }
  if (actual.orderId !== orderId) {
    return { ok: false, code: "order_mismatch", message: "Toss payment orderId mismatch" };
  }
  if (actual.paymentKey !== paymentKey) {
    return { ok: false, code: "payment_key_mismatch", message: "Toss paymentKey mismatch" };
  }
  if (lookup.amount !== payAmountWon) {
    return { ok: false, code: "amount_mismatch", message: "Toss payment amount mismatch" };
  }

  return lookup;
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = readTossWebhookSignatureHeader(req.headers);

  if (!verifyTossWebhookSignature(rawBody, signature)) {
    console.error("[toss/webhook] invalid signature");
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  let event: TossPaymentWebhookEvent;
  try {
    event = JSON.parse(rawBody) as TossPaymentWebhookEvent;
  } catch (e) {
    console.error("[toss/webhook] invalid json", e);
    return okResponse({ skipped: "invalid_json" });
  }

  if (event.eventType !== "PAYMENT_STATUS_CHANGED") {
    return okResponse({ skipped: "event_type" });
  }

  const data = event.data;
  if (!data || data.status !== "DONE") {
    return okResponse({ skipped: "status" });
  }

  const orderId = String(data.orderId ?? "").trim();
  if (!orderId.startsWith("cash-")) {
    return okResponse({ skipped: "not_cash_order" });
  }

  const payAmountWon = pickPayAmountWon(data);
  if (!Number.isFinite(payAmountWon) || payAmountWon <= 0) {
    console.error("[toss/webhook] missing pay amount", { orderId, data: webhookLogData(data) });
    return okResponse({ skipped: "amount_missing" });
  }

  const paymentKey = String(data.paymentKey ?? "").trim();
  if (!paymentKey) {
    console.error("[toss/webhook] missing paymentKey", { orderId, data: webhookLogData(data) });
    return okResponse({ recovered: false, skipped: "payment_key_missing" });
  }

  // 토스 심사 게이트 — 비허용 유저의 주문은 Toss 재조회·적립 없이 차단한다(원장
  // 코어의 게이트와 이중 방어). DONE 웹훅이 게이트에 막혔다 = 돈은 결제됐는데
  // 적립이 없는 상태다. 응답은 이 라우트의 기존 계약대로 200(비2xx는 서명 실패
  // 401뿐) — Toss 재시도로 복구하는 경로가 아니라, 감사 로그(admin_action_logs)의
  // blocked_toss_gate 항목을 근거로 환불 또는 수동 적립으로 대사한다.
  const webhookUserId = parseUserIdFromCashOrderId(orderId);
  if (webhookUserId && !isTossAllowedUser(webhookUserId)) {
    console.error("[toss/webhook] blocked by toss review gate", { orderId, payAmountWon });
    try {
      const admin = createServiceRoleClient();
      await logWebhookCashTopupRecovery(admin, {
        outcome: "blocked_toss_gate",
        orderId,
        payAmountWon,
        paymentKey: maskPaymentKey(paymentKey),
        eventCreatedAt: event.createdAt ?? null,
      });
    } catch (e) {
      console.error("[toss/webhook] gate audit log failed", e);
    }
    return okResponse({ recovered: false, skipped: "toss_not_allowed" });
  }

  const verifiedPayment = await verifyWebhookPaymentWithToss({ orderId, paymentKey, payAmountWon });
  if (!verifiedPayment.ok) {
    console.error("[toss/webhook] payment verification failed", verifiedPayment.code, verifiedPayment.message, {
      orderId,
      payAmountWon,
      paymentKey: maskPaymentKey(paymentKey),
      data: webhookLogData(data),
    });
    return okResponse({ recovered: false, skipped: verifiedPayment.code });
  }

  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch (e) {
    console.error("[toss/webhook] service role client", e);
    return okResponse({ error: "server_config" });
  }

  try {
    const result = await recordCashTopupFromTossOrder({
      admin,
      orderId,
      payAmountWon,
    });

    if (!result.ok) {
      console.error("[toss/webhook] topup failed", result.code, result.message, { orderId });
      await logWebhookCashTopupRecovery(admin, {
        outcome: "failed",
        orderId,
        payAmountWon,
        paymentKey: maskPaymentKey(paymentKey),
        code: result.code,
        message: result.message,
        eventCreatedAt: event.createdAt ?? null,
      });
      return okResponse({ recovered: false, code: result.code });
    }

    if (result.duplicate) {
      return okResponse({ recovered: false, duplicate: true });
    }

    revalidatePath("/wallet");
    revalidatePath("/wallet/charge");
    revalidatePath("/wallet/ledger");

    await logWebhookCashTopupRecovery(admin, {
      outcome: "success",
      orderId,
      payAmountWon,
      cashKrw: result.amount,
      userId: result.userId,
      paymentKey: maskPaymentKey(paymentKey),
      method: verifiedPayment.data.method ?? data.method ?? null,
      eventCreatedAt: event.createdAt ?? null,
    });

    return okResponse({ recovered: true, amount: result.amount, payAmount: result.payAmount });
  } catch (e) {
    console.error("[toss/webhook] unexpected", e, { orderId });
    try {
      await logWebhookCashTopupRecovery(admin, {
        outcome: "error",
        orderId,
        payAmountWon,
        paymentKey: maskPaymentKey(paymentKey),
        message: e instanceof Error ? e.message : String(e),
        eventCreatedAt: event.createdAt ?? null,
      });
    } catch (logErr) {
      console.error("[toss/webhook] recovery log failed", logErr);
    }
    return okResponse({ recovered: false, error: "unexpected" });
  }
}
