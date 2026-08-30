import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { cashKrwForPayKrw, isAllowedChargePayKrw } from "@/lib/cash/chargePackages";
import {
  decidePaysyncTopup,
  isKnownPaysyncTrigger,
  parsePaysyncWebhookEvent,
} from "@/lib/paysync/paysyncWebhookEvent";
import {
  verifyPaysyncWebhookSignature,
  type PaysyncSignatureVerdict,
} from "@/lib/paysync/verifyPaysyncWebhookSignature";

// 페이싱크 무통장입금 웹훅 수신 (Phase 1).
//
// 정본: https://docs.paysync.kr/api-reference/webhooks/overview.md
//
// 응답 계약(문서 §6):
//   * 성공은 **정확히 200** 만 성공으로 기록된다 — 201·204 도 실패 취급이다.
//   * 그 외(3xx/4xx/5xx/타임아웃)는 실패로 기록되고 실패 알림 메일이 발송된다.
//   * 응답 타임아웃 10초. 페이싱크는 **자동 재시도를 하지 않는다** — 무거운 후처리로
//     핸들러를 늘리지 않는다. 유실 복구는 Phase 2 보정 크론이 담당한다.
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
    console.error("[paysync/webhook] invalid json", e, { webhookId: verdict.webhookId });
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

  // ── Phase 2 경계 ────────────────────────────────────────────────────────────
  // 여기부터가 실제 적립이다: 로컬 `paysync_invoices` 대조 → `record_cash_topup_v2`
  // (`p_order_ref` = `ivc_...` 가 멱등키) → status/paid_at 기록 → past_due 복구.
  // 그 테이블과 주문 선발급(POST /v1/invoices)은 킥오프 문서 §4·§5(Phase 2·3) 항목이라
  // 아직 없다. 대조할 정본이 없는 상태에서 metadata 만 믿고 적립하면, 대시보드에서
  // 수기 발행된 주문의 metadata 로 임의 계정에 캐시를 넣을 수 있다.
  // 그래서 Phase 1 은 **적립하지 않고 기본 차단**으로 닫고, 판정 결과만 남긴다.
  console.log(
    "[paysync/webhook] topup_deferred",
    JSON.stringify({
      ...base,
      userId: decision.userId,
      payAmountWon: decision.payAmountWon,
      cashKrw: decision.cashKrw,
    }),
  );
  await logPaysyncWebhookAudit({
    outcome: "topup_deferred_phase2",
    ...base,
    userId: decision.userId,
    payAmountWon: decision.payAmountWon,
    cashKrw: decision.cashKrw,
  });

  return okResponse({ received: true, deferred: "phase2_topup" });
}

/** 엔드포인트 도달 확인용(공개 URL 포워딩·경로 점검). 설정 상태는 노출하지 않는다. */
export async function GET() {
  return NextResponse.json({ ok: true, service: "paysync-webhook" }, { status: 200 });
}
