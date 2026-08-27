// App-F1(푸시 재도입, 2026-08) — notification outbox 발송 워커 cron 라우트 (PUSH 지시문 B-3).
// 인증(isAuthorized)·dynamic 패턴은 subscription-renewal/route.ts 를 복제한다(공용 헬퍼 리팩터링 금지).
// 플래그 2단: NOTIFICATION_OUTBOX_WORKER_ENABLED(기본 false) → FCM_TRANSPORT_MODE(기본 dry-run).
// ★ 로그 규칙: outbox id·event_type·delivery 수·결과만. 토큰 전문·제목·본문 로그 금지.
// ★ notification_transport_config(push_transport_enabled)는 읽지도 쓰지도 않는다(B-8 — postgres 전용, F14).

import { randomUUID, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import {
  dryRunTransport,
  runOutboxBatch,
  type DeliveryRow,
  type OutboxWorkerDeps,
} from "@/lib/notifications/outboxWorker";
import {
  createFcmTransport,
  resolveFcmTransportMode,
  splitGatedOutboxRows,
  type NotificationRowForPush,
  type OutboxRowForPush,
} from "@/lib/notifications/fcmTransport";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function timingSafeStringEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  if (aBuffer.length !== bBuffer.length) return false;
  return timingSafeEqual(aBuffer, bBuffer);
}

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;

  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  const headerSecret = req.headers.get("x-cron-secret")?.trim() ?? "";

  return (
    (bearer.length > 0 && timingSafeStringEqual(bearer, secret)) ||
    (headerSecret.length > 0 && timingSafeStringEqual(headerSecret, secret))
  );
}

function workerEnabled(): boolean {
  const raw = process.env.NOTIFICATION_OUTBOX_WORKER_ENABLED ?? "";
  return raw === "true" || raw === "1";
}

/** 워커가 라우트 1회 호출에서 배치를 반복하는 상한(ms). maxDuration(60s)보다 여유 있게 45s. */
const BATCH_LOOP_BUDGET_MS = 45_000;

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  if (!workerEnabled()) {
    console.info("[notification-outbox] disabled by NOTIFICATION_OUTBOX_WORKER_ENABLED");
    return NextResponse.json({
      ok: true,
      disabled: true,
      message: "NOTIFICATION_OUTBOX_WORKER_ENABLED is not true; no-op.",
    });
  }

  const mode = resolveFcmTransportMode(process.env.FCM_TRANSPORT_MODE);
  const projectId = process.env.FCM_PROJECT_ID?.trim() ?? "";
  if (mode === "live" && projectId.length === 0) {
    return NextResponse.json(
      { ok: false, error: "missing_fcm_project_id", message: "FCM_TRANSPORT_MODE=live requires FCM_PROJECT_ID." },
      { status: 500 }
    );
  }

  const supabase = createServiceRoleClient();
  // 분 단위 cron 겹침 대비 — lease + SKIP LOCKED(F13)에 더해 owner 를 실행 단위로 고유화(적대 검증 #17).
  const owner = `vercel:${process.env.VERCEL_DEPLOYMENT_ID ?? "local"}:${randomUUID()}`;

  const totals = {
    batches: 0,
    reclaimed: 0,
    claimed: 0,
    sent: 0,
    failed: 0,
    suppressed: 0,
    gatedSkipped: 0,
    missingNotification: 0,
  };

  const log = (msg: string, meta?: Record<string, unknown>) => {
    console.info(`[notification-outbox] ${msg}`, meta ?? {});
  };

  /** claim 래퍼가 outbox.id → notifications 행을 확보해 transport 에 전달한다(배치마다 재구성). */
  const notificationsByOutboxId = new Map<string, NotificationRowForPush>();

  const deps: OutboxWorkerDeps = {
    owner,
    limit: 50,
    leaseSeconds: 120,

    reclaimExpired: async () => {
      const { data, error } = await supabase.rpc("notification_outbox_reclaim_expired");
      if (error) throw new Error(`notification_outbox_reclaim_expired: ${error.message}`);
      return typeof data === "number" ? data : Number(data ?? 0);
    },

    claim: async (claimOwner, limit, leaseSeconds) => {
      notificationsByOutboxId.clear();
      const { data, error } = await supabase.rpc("notification_outbox_claim", {
        p_owner: claimOwner,
        p_limit: limit,
        p_lease_seconds: leaseSeconds,
      });
      if (error) throw new Error(`notification_outbox_claim: ${error.message}`);
      const rows = (data ?? []) as OutboxRowForPush[];

      // F19 게이트 2종(new_order_message·new_application): 앱 알림함·서버 unread RPC 에서
      // 제외되는 유형은 푸시도 보내지 않는다 — 즉시 sent 처리 후 발송 대상에서 제외.
      // (푸시만 오고 앱 알림함엔 없는 UX 모순 방지 — 적대 검증 #10.)
      const { gated, sendable } = splitGatedOutboxRows(rows);
      for (const row of gated) {
        const { error: markError } = await supabase.rpc("notification_outbox_mark_sent", { p_id: row.id });
        if (markError) throw new Error(`notification_outbox_mark_sent(gated): ${markError.message}`);
        totals.gatedSkipped += 1;
        log("gated_event_marked_sent", { outboxId: row.id, eventType: row.event_type });
      }

      // outbox 1건당 notifications 행 확보(id = outbox.notification_id — 배치 1회 조회로 통합).
      const notificationIds = [
        ...new Set(
          sendable
            .map((row) => row.notification_id)
            .filter((id): id is string => typeof id === "string" && id.length > 0)
        ),
      ];
      const notificationById = new Map<string, NotificationRowForPush>();
      if (notificationIds.length > 0) {
        const { data: notificationRows, error: lookupError } = await supabase
          .from("notifications")
          .select("id, body, data, metadata")
          .in("id", notificationIds);
        if (lookupError) throw new Error(`notifications lookup: ${lookupError.message}`);
        for (const n of (notificationRows ?? []) as Array<
          { id: string } & NotificationRowForPush
        >) {
          notificationById.set(n.id, { body: n.body, data: n.data, metadata: n.metadata });
        }
      }

      const deliverable: OutboxRowForPush[] = [];
      for (const row of sendable) {
        const notification = row.notification_id ? notificationById.get(row.notification_id) : undefined;
        if (!notification) {
          // notifications 행 없음(삭제·익명화) → 보낼 내용이 없다. 실패로 돌리면 무한
          // 재시도가 되므로(적대 검증 #16) sent 처리 후 제외한다.
          const { error: markError } = await supabase.rpc("notification_outbox_mark_sent", { p_id: row.id });
          if (markError) throw new Error(`notification_outbox_mark_sent(missing): ${markError.message}`);
          totals.missingNotification += 1;
          log("notification_row_missing_marked_sent", { outboxId: row.id, eventType: row.event_type });
          continue;
        }
        notificationsByOutboxId.set(row.id, notification);
        deliverable.push(row);
      }
      return deliverable;
    },

    createDeliveries: async (outboxId) => {
      const { data, error } = await supabase.rpc("notification_create_deliveries", { p_outbox_id: outboxId });
      if (error) throw new Error(`notification_create_deliveries: ${error.message}`);
      const body = (data ?? {}) as { created?: number; suppressed?: boolean };
      return { created: body.created ?? 0, suppressed: body.suppressed === true };
    },

    listDeliveries: async (outboxId) => {
      const { data, error } = await supabase
        .from("notification_deliveries")
        .select("id, device_token_id, device_tokens!inner(token, revoked_at)")
        .eq("outbox_id", outboxId)
        .eq("status", "pending")
        .is("device_tokens.revoked_at", null);
      if (error) throw new Error(`notification_deliveries list: ${error.message}`);
      const deliveries: DeliveryRow[] = [];
      for (const row of (data ?? []) as Array<{
        id: string;
        device_token_id: string;
        device_tokens: { token: string } | Array<{ token: string }>;
      }>) {
        const deviceToken = Array.isArray(row.device_tokens) ? row.device_tokens[0] : row.device_tokens;
        if (!deviceToken?.token) continue;
        deliveries.push({ id: row.id, device_token_id: row.device_token_id, token: deviceToken.token });
      }
      return deliveries;
    },

    transport: createFcmTransport({
      mode,
      projectId,
      notificationsByOutboxId,
      dryRun: dryRunTransport,
      log,
    }),

    markDeliverySent: async (id) => {
      const { error } = await supabase.rpc("notification_delivery_mark_sent", { p_id: id });
      if (error) throw new Error(`notification_delivery_mark_sent: ${error.message}`);
    },

    markDeliveryFailed: async (id, err, invalidToken) => {
      const { error } = await supabase.rpc("notification_delivery_mark_failed", {
        p_id: id,
        p_error: err,
        p_invalid_token: invalidToken,
      });
      if (error) throw new Error(`notification_delivery_mark_failed: ${error.message}`);
    },

    markOutboxSent: async (id) => {
      const { error } = await supabase.rpc("notification_outbox_mark_sent", { p_id: id });
      if (error) throw new Error(`notification_outbox_mark_sent: ${error.message}`);
    },

    markOutboxFailed: async (id, err, backoffSeconds) => {
      const { error } = await supabase.rpc("notification_outbox_mark_failed", {
        p_id: id,
        p_error: err,
        p_backoff_seconds: backoffSeconds,
      });
      if (error) throw new Error(`notification_outbox_mark_failed: ${error.message}`);
    },

    log,
  };

  const startedAt = Date.now();
  try {
    for (;;) {
      const summary = await runOutboxBatch(deps);
      totals.batches += 1;
      totals.reclaimed += summary.reclaimed;
      totals.claimed += summary.claimed;
      totals.sent += summary.sent;
      totals.failed += summary.failed;
      totals.suppressed += summary.suppressed;
      if (summary.claimed === 0) break; // 큐 소진 — 이번 호출 종료.
      if (Date.now() - startedAt >= BATCH_LOOP_BUDGET_MS) break; // 45초 예산 소진.
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[notification-outbox] batch_error", { error: msg });
    return NextResponse.json({ ok: false, error: msg, mode, ...totals }, { status: 500 });
  }

  log("run_complete", { mode, ...totals });
  return NextResponse.json({ ok: true, mode, ...totals });
}
