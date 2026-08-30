// 페이싱크 보정 크론 (Phase 2 §4).
//
// 왜 필수인가: 페이싱크는 웹훅 **자동 재시도를 하지 않는다**(문서 §7). 전송이 한 번
// 실패하면 그걸로 끝이다. 서버가 잠깐 내려가 있었거나 배포 중이었으면 "돈은 들어왔는데
// 캐시 미적립" 상태가 그대로 남는다. 이 크론이 그 유일한 자동 회수 경로다.
//
// 하는 일: pending 인데 N분 경과한 로컬 주문을 `GET /v1/invoices/{id}` 로 재조회해
//   * paid: true  → 웹훅과 **동일한 코어**로 적립(멱등키가 같아 이중 적립 0)
//   * 미결제 + expires_at 경과 → 로컬만 expired 마킹
// 웹훅 이벤트에 `invoice.expired` 는 없다(created/paid/deleted 뿐) — 만료는 로컬 판정만.
//
// 인증·dynamic 패턴은 기존 cron 라우트(notification-outbox/subscription-renewal)를 복제한다.

import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { logPaysyncTopupAudit, recordPaysyncTopup } from "@/lib/paysync/paysyncTopupServer";
import { selectReconcileTargets, type ReconcileCandidate } from "@/lib/paysync/paysyncReconcileCore";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** 한 번 실행에서 처리할 주문 상한 — 라우트 예산(60s) 안에 들어오도록. */
const MAX_BATCH = 40;
/** 발급 직후 건은 건드리지 않는다. 웹훅이 정상 도착할 시간을 준다. */
const MIN_AGE_MINUTES = 5;

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

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch (e) {
    console.error("[paysync-reconcile] service role client", e);
    return NextResponse.json({ ok: false, error: "server_config" }, { status: 500 });
  }

  const now = new Date();
  const cutoff = new Date(now.getTime() - MIN_AGE_MINUTES * 60_000).toISOString();

  const { data, error } = await admin
    .from("paysync_invoices")
    .select("id, paysync_invoice_id, issued_at, expires_at, status")
    .eq("status", "pending")
    .lte("issued_at", cutoff)
    .order("issued_at", { ascending: true })
    .limit(MAX_BATCH);

  if (error) {
    console.error("[paysync-reconcile] select pending", error.message);
    return NextResponse.json({ ok: false, error: "query_failed" }, { status: 500 });
  }

  const candidates = (data ?? []) as ReconcileCandidate[];
  const { toRecover, toExpire } = selectReconcileTargets(candidates, now.toISOString());

  let recorded = 0;
  let duplicate = 0;
  let stillPending = 0;
  let failed = 0;
  let revalidate = false;

  for (const target of toRecover) {
    try {
      // 웹훅과 **같은 코어**를 쓴다 — 경로가 갈라지면 크론이 웹훅의 안전장치가 되지 못한다.
      // eventUserId 는 null: 로컬 행이 이미 소유자 정본이라 대조가 불필요하다.
      const result = await recordPaysyncTopup({
        admin,
        paysyncInvoiceId: target.paysync_invoice_id,
        eventUserId: null,
        trigger: "RECONCILE_CRON",
        lookupTimeoutMs: 8_000,
      });

      if ("skip" in result) {
        // remote_not_paid = 아직 입금 전(정상) · lookup_failed = 다음 회차에 재시도.
        stillPending += 1;
        if (result.skip !== "remote_not_paid") {
          // JSON.stringify 로 넘긴다 — 객체를 그대로 주면 dev 로그 수집기가 `{}` 로 접는다.
          console.warn(
            "[paysync-reconcile] skip",
            JSON.stringify({ invoiceId: target.paysync_invoice_id, skip: result.skip }),
          );
          await logPaysyncTopupAudit(admin, {
            outcome: "reconcile_skipped",
            skip: result.skip,
            invoiceId: target.paysync_invoice_id,
          });
        }
        continue;
      }

      if (!result.ok) {
        failed += 1;
        console.error(
          "[paysync-reconcile] failed",
          JSON.stringify({ invoiceId: target.paysync_invoice_id, failed: result.failed }),
        );
        await logPaysyncTopupAudit(admin, {
          outcome: "reconcile_failed",
          failed: result.failed,
          invoiceId: target.paysync_invoice_id,
        });
        continue;
      }

      if (result.duplicate) {
        duplicate += 1;
      } else {
        recorded += 1;
        revalidate = true;
        // 웹훅이 유실됐다는 뜻이다 — 회수 자체를 감사 기록으로 남긴다(빈도 추적용).
        console.log(
          "[paysync-reconcile] recovered",
          JSON.stringify({ invoiceId: target.paysync_invoice_id, userId: result.userId, cashKrw: result.cashKrw }),
        );
        await logPaysyncTopupAudit(admin, {
          outcome: "reconcile_recovered",
          invoiceId: target.paysync_invoice_id,
          userId: result.userId,
          cashKrw: result.cashKrw,
          staleStatus: result.staleStatus,
        });
      }
    } catch (e) {
      failed += 1;
      console.error("[paysync-reconcile] unexpected", e, JSON.stringify({ invoiceId: target.paysync_invoice_id }));
    }
  }

  // 만료 마킹 — 웹훅 이벤트가 없으므로 로컬 판정만. 적립 경로와 무관하다.
  let expired = 0;
  if (toExpire.length > 0) {
    const { error: expireError, count } = await admin
      .from("paysync_invoices")
      .update({ status: "expired" }, { count: "exact" })
      .in("id", toExpire.map((t) => t.id))
      // 경합 방어: 그 사이 웹훅이 paid 로 바꿨다면 건드리지 않는다.
      .eq("status", "pending");
    if (expireError) {
      console.error("[paysync-reconcile] expire update", expireError.message);
    } else {
      expired = count ?? toExpire.length;
    }
  }

  if (revalidate) {
    revalidatePath("/wallet");
    revalidatePath("/wallet/ledger");
  }

  const summary = { scanned: candidates.length, recorded, duplicate, stillPending, expired, failed };
  console.log("[paysync-reconcile] done", JSON.stringify(summary));
  return NextResponse.json({ ok: true, ...summary });
}
