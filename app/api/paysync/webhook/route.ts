import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { cashKrwForPayKrw, isAllowedChargePayKrw } from "@/lib/cash/chargePackages";
import { logPaysyncTopupAudit, recordPaysyncTopup } from "@/lib/paysync/paysyncTopupServer";
import {
  decidePaysyncTopup,
  isKnownPaysyncTrigger,
  parsePaysyncWebhookEvent,
} from "@/lib/paysync/paysyncWebhookEvent";
import {
  verifyPaysyncWebhookSignature,
  type PaysyncSignatureVerdict,
} from "@/lib/paysync/verifyPaysyncWebhookSignature";

// 페이싱크 무통장입금 웹훅 수신 + 적립 (Phase 1~2).
//
// 정본: https://docs.paysync.kr/api-reference/webhooks/overview.md
//
// 응답 계약(문서 §6):
//   * 성공은 **정확히 200** 만 성공으로 기록된다 — 201·204 도 실패 취급이다.
//   * 그 외(3xx/4xx/5xx/타임아웃)는 실패로 기록되고 실패 알림 메일이 발송된다.
//   * 응답 타임아웃 10초. 페이싱크는 **자동 재시도를 하지 않는다** — 무거운 후처리로
//     핸들러를 늘리지 않는다. 유실 복구는 보정 크론(paysync-reconcile)이 담당한다.
//
// 그래서 서명이 유효한 요청은 처리 결과와 무관하게 200 으로 닫고, 처리하지 못한 사유는
// 로그·감사 기록으로 남긴다(재전송을 유도해봐야 페이싱크가 재시도하지 않는다).
// 서명 검증 실패만 401 이다 — 위조 요청은 "수신 성공"으로 기록되면 안 된다.
//
// 수신 로그: 모든 요청에 `[paysync/webhook] received` 한 줄(서명 판정 결과 포함).
// 서명이 유효한 요청만 `admin_action_logs` 에 감사 행을 남긴다 — 미검증 요청이 DB 쓰기를
// 유발하면 공개 URL 이 그대로 무제한 쓰기 표면이 된다.

/** 페이싱크는 200 만 성공으로 본다 — 이 라우트의 성공 응답은 전부 이 함수를 통한다. */
function okResponse(extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: true, ...extra }, { status: 200 });
}

function verdictLog(verdict: PaysyncSignatureVerdict): Record<string, unknown> {
  return verdict.ok
    ? { signature: "valid", webhookId: verdict.webhookId, timestampSeconds: verdict.timestampSeconds }
    : { signature: "invalid", reason: verdict.reason };
}

/** 서명 검증을 통과한 수신 건만 감사 기록 (service_role). 실패는 삼킨다(200 응답 보장). */
async function logPaysyncWebhookAudit(detail: Record<string, unknown>): Promise<void> {
  try {
    const admin = createServiceRoleClient();
    const { error } = await admin.from("admin_action_logs").insert({
      admin_id: null,
      action_type: "paysync_webhook",
      target_type: "cash_topup",
      target_id: null,
      detail,
    });
    if (error) console.error("[paysync/webhook] audit log failed", error.message, detail);
  } catch (e) {
    console.error("[paysync/webhook] audit log error", e);
  }
}

export async function POST(req: NextRequest) {
  // 서명 대상은 파싱 전 원본 바디다 — 여기서 문자열로 받고, 이후 어디서도 재직렬화하지 않는다.
  const rawBody = await req.text();
  const verdict = verifyPaysyncWebhookSignature(rawBody, req.headers);

  console.log(
    "[paysync/webhook] received",
    JSON.stringify({
      ...verdictLog(verdict),
      bodyBytes: Buffer.byteLength(rawBody, "utf8"),
      receivedAt: new Date().toISOString(),
    }),
  );

  if (!verdict.ok) {
    // 사유는 서버 로그에만 남긴다 — 응답 본문으로 설정 상태를 알려주지 않는다.
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch (e) {
    console.error("[paysync/webhook] invalid json", e, JSON.stringify({ webhookId: verdict.webhookId }));
    await logPaysyncWebhookAudit({
      outcome: "invalid_json",
      webhookId: verdict.webhookId,
      bodyBytes: Buffer.byteLength(rawBody, "utf8"),
    });
    return okResponse({ skipped: "invalid_json" });
  }

  const event = parsePaysyncWebhookEvent(parsedBody);
  const decision = decidePaysyncTopup(event, {
    isAllowedPayKrw: isAllowedChargePayKrw,
    cashKrwForPayKrw,
  });

  const base = {
    webhookId: verdict.webhookId,
    eventType: event.type,
    invoiceId: event.invoice?.id ?? null,
    trigger: event.trigger,
    triggerKnown: isKnownPaysyncTrigger(event.trigger),
  };

  // 모르는 type 은 200 으로 무시한다(문서 §2 — 새 이벤트 추가에 안전).
  if (!decision.ok) {
    console.log("[paysync/webhook] skipped", JSON.stringify({ ...base, skip: decision.skip }));
    await logPaysyncWebhookAudit({ outcome: "skipped", skip: decision.skip, ...base });
    return okResponse({ skipped: decision.skip });
  }

  // ── 적립 (Phase 2) ─────────────────────────────────────────────────────────
  // 로컬 paysync_invoices 대조 → 페이싱크 재조회 정본 대조 → F11 원장 → status 전이.
  // 판정·순서는 recordPaysyncTopupCore 가 정본이다(여기서 분기하지 않는다).
  //
  // 실패해도 200 으로 닫는다 — 페이싱크는 재시도하지 않으므로 비200 을 돌려봐야
  // 복구되지 않는다. 유실·일시 실패는 보정 크론(paysync-reconcile)이 회수한다.
  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch (e) {
    console.error("[paysync/webhook] service role client", e);
    return okResponse({ error: "server_config" });
  }

  try {
    const result = await recordPaysyncTopup({
      admin,
      paysyncInvoiceId: decision.invoiceId,
      eventUserId: decision.userId,
      trigger: event.trigger,
      // 10초 응답 제한 안에서 끝나야 한다 — 재조회에 4초 상한.
      lookupTimeoutMs: 4_000,
    });

    if ("skip" in result) {
      console.log("[paysync/webhook] topup_skipped", JSON.stringify({ ...base, skip: result.skip }));
      await logPaysyncTopupAudit(admin, { outcome: "topup_skipped", skip: result.skip, ...base });
      return okResponse({ skipped: result.skip });
    }

    if (!result.ok) {
      console.error("[paysync/webhook] topup_failed", JSON.stringify({ ...base, failed: result.failed }));
      await logPaysyncTopupAudit(admin, { outcome: "topup_failed", failed: result.failed, ...base });
      return okResponse({ failed: result.failed });
    }

    if (!result.duplicate) {
      revalidatePath("/wallet");
      revalidatePath("/wallet/charge");
      revalidatePath("/wallet/ledger");
    }

    console.log(
      "[paysync/webhook] topup_recorded",
      JSON.stringify({ ...base, userId: result.userId, cashKrw: result.cashKrw, duplicate: result.duplicate }),
    );
    await logPaysyncTopupAudit(admin, {
      outcome: result.duplicate ? "topup_duplicate" : "topup_recorded",
      ...base,
      userId: result.userId,
      cashKrw: result.cashKrw,
      // 웹훅 페이로드의 paid 값 — 판정에는 쓰지 않고 기록만 한다(실측상 false 로 온다).
      paidFlag: decision.paidFlag,
      staleStatus: result.staleStatus,
    });

    return okResponse({ recorded: !result.duplicate, duplicate: result.duplicate });
  } catch (e) {
    console.error("[paysync/webhook] unexpected", e, JSON.stringify({ invoiceId: decision.invoiceId }));
    try {
      await logPaysyncTopupAudit(admin, { outcome: "error", ...base, message: e instanceof Error ? e.message : String(e) });
    } catch (logErr) {
      console.error("[paysync/webhook] error audit failed", logErr);
    }
    return okResponse({ error: "unexpected" });
  }
}

/** 엔드포인트 도달 확인용(공개 URL 포워딩·경로 점검). 설정 상태는 노출하지 않는다. */
export async function GET() {
  return NextResponse.json({ ok: true, service: "paysync-webhook" }, { status: 200 });
}
