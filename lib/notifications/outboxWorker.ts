// P1-11C outbox delivery worker 오케스트레이터 — 어댑터 주입, dry-run transport 기본.
// ⚠️ 실제 FCM 발송은 실 transport 배선 시에만. 상태 전이는 152 RPC 로만.
// claim(SKIP LOCKED·lease) → create_deliveries(설정 강제 fan-out) → per-token transport →
//   delivery sent/failed(invalid token revoke) → outbox sent/failed(backoff·dead-letter).

import { exponentialBackoffSeconds, isInvalidTokenError } from "@/lib/notifications/outboxBackoff";

export type OutboxRow = {
  id: string;
  recipient_user_id: string;
  event_type: string;
  attempt_count: number;
  payload: Record<string, unknown>;
};
export type DeliveryRow = { id: string; device_token_id: string; token: string };

export type TransportResult = { ok: boolean; invalidToken?: boolean; error?: string };
export type OutboxTransport = (delivery: DeliveryRow, outbox: OutboxRow) => Promise<TransportResult>;

/** 실제 발송 없는 dry-run transport(성공 반환). 실기기 FCM 은 앱 부채. */
export const dryRunTransport: OutboxTransport = async () => ({ ok: true });

export type OutboxWorkerDeps = {
  owner: string;
  limit?: number;
  leaseSeconds?: number;
  reclaimExpired: () => Promise<number>;
  claim: (owner: string, limit: number, leaseSeconds: number) => Promise<OutboxRow[]>;
  createDeliveries: (outboxId: string) => Promise<{ created: number; suppressed: boolean }>;
  listDeliveries: (outboxId: string) => Promise<DeliveryRow[]>;
  transport: OutboxTransport;
  markDeliverySent: (id: string) => Promise<void>;
  markDeliveryFailed: (id: string, err: string, invalidToken: boolean) => Promise<void>;
  markOutboxSent: (id: string) => Promise<void>;
  markOutboxFailed: (id: string, err: string, backoffSeconds: number) => Promise<void>;
  log?: (msg: string, meta?: Record<string, unknown>) => void;
};

export type OutboxWorkerSummary = {
  reclaimed: number;
  claimed: number;
  sent: number;
  failed: number;
  suppressed: number;
};

export async function runOutboxBatch(deps: OutboxWorkerDeps): Promise<OutboxWorkerSummary> {
  const limit = deps.limit ?? 10;
  const leaseSeconds = deps.leaseSeconds ?? 60;
  const summary: OutboxWorkerSummary = { reclaimed: 0, claimed: 0, sent: 0, failed: 0, suppressed: 0 };

  summary.reclaimed = await deps.reclaimExpired();
  const claimed = await deps.claim(deps.owner, limit, leaseSeconds);
  summary.claimed = claimed.length;

  for (const outbox of claimed) {
    try {
      const fan = await deps.createDeliveries(outbox.id);
      if (fan.suppressed) {
        // 설정으로 억제 → 발송 없이 완료(전송 대상 0).
        summary.suppressed += 1;
        await deps.markOutboxSent(outbox.id);
        continue;
      }
      const deliveries = await deps.listDeliveries(outbox.id);
      if (deliveries.length === 0) {
        // 활성 토큰 없음 → 보낼 곳 없음(완료).
        await deps.markOutboxSent(outbox.id);
        continue;
      }
      let allOk = true;
      let lastErr = "";
      for (const d of deliveries) {
        const res = await deps.transport(d, outbox);
        if (res.ok) {
          await deps.markDeliverySent(d.id);
        } else {
          allOk = false;
          lastErr = res.error ?? "delivery_failed";
          const invalid = res.invalidToken ?? isInvalidTokenError(res.error);
          await deps.markDeliveryFailed(d.id, lastErr, invalid);
        }
      }
      if (allOk) {
        summary.sent += 1;
        await deps.markOutboxSent(outbox.id);
      } else {
        summary.failed += 1;
        await deps.markOutboxFailed(outbox.id, lastErr, exponentialBackoffSeconds(outbox.attempt_count + 1));
      }
    } catch (e) {
      summary.failed += 1;
      const msg = e instanceof Error ? e.message : String(e);
      await deps.markOutboxFailed(outbox.id, msg, exponentialBackoffSeconds(outbox.attempt_count + 1));
    }
  }
  return summary;
}
