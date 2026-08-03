import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { isAccountDeletionFeatureEnabled } from "@/lib/shell/featureFlags";
import { runAccountDeletionJob } from "@/lib/account/accountDeletionWorker";
import {
  ACCOUNT_DELETION_UNCOVERED_BUCKETS,
  buildDeletionDeps,
  claimDeletionJobs,
  reclaimExpiredDeletionLeases,
} from "@/lib/account/accountDeletionAdapters";
import {
  ACCOUNT_DELETION_CRON_REAL_RUN_ENV,
  ACCOUNT_DELETION_WORKER_ENABLED_ENV,
  effectiveJobDryRun,
  parseCronRealRunEnv,
  parseRequestedDryRun,
  resolveClaimParams,
  resolveDeletionRunMode,
} from "@/lib/account/accountDeletionRunnerConfig";

/**
 * 계정 삭제 saga 러너(내부 전용).
 *
 * 파괴 실행은 **세 조건이 모두** 참일 때만 한다:
 *   ① ACCOUNT_DELETION_WORKER_ENABLED=true|1  ② 기능 플래그 ON
 *   ③ 명시적 real-run 신호 — env ACCOUNT_DELETION_CRON_REAL_RUN=true|1 (주 경로,
 *      Vercel cron 은 쿼리를 못 싣는다) 또는 ?dryRun=false (수동 호출·점검용, 쿼리 우선)
 * 하나라도 어긋나면 dry-run 으로 강등되어 계획만 만들고 아무것도 지우지 않는다.
 *
 * 인증은 기존 cron 라우트 2종과 동일한 timing-safe CRON_SECRET 비교다.
 * lease 는 154 account_deletion_claim(owner·leased_until)만 쓴다 —
 * 151 account_deletion_worker_claim 은 lease 를 다루지 않아 중복 처리가 가능하므로 쓰지 않는다.
 */
export const dynamic = "force-dynamic";

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

async function handleRun(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const mode = resolveDeletionRunMode({
    workerEnabledRaw: process.env[ACCOUNT_DELETION_WORKER_ENABLED_ENV],
    featureEnabled: isAccountDeletionFeatureEnabled(),
    // real-run 신호의 주 경로는 env — Vercel cron path 쿼리스트링에 의존하지 않는다.
    // 쿼리 ?dryRun= 이 명시되면 쿼리가 우선한다(수동 dry-run 점검용).
    requestedDryRun:
      parseRequestedDryRun(url.searchParams.get("dryRun")) ??
      parseCronRealRunEnv(process.env[ACCOUNT_DELETION_CRON_REAL_RUN_ENV]),
  });

  if (!mode.enabled) {
    // kill switch — job 을 집지도 않는다.
    return NextResponse.json({ ok: true, disabled: true, reason: mode.reason, claimed: 0 });
  }

  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch {
    return NextResponse.json({ ok: false, error: "server_config" }, { status: 500 });
  }

  const { limit, leaseSeconds } = resolveClaimParams({
    limitRaw: url.searchParams.get("limit"),
    leaseSecondsRaw: url.searchParams.get("leaseSeconds"),
  });

  const owner = `cron-${process.env.VERCEL_DEPLOYMENT_ID ?? "local"}-${Date.now()}`;
  const results: Array<Record<string, unknown>> = [];
  const errors: string[] = [];

  try {
    await reclaimExpiredDeletionLeases(admin);
    const jobs = await claimDeletionJobs(admin, owner, limit, leaseSeconds);
    const deps = buildDeletionDeps(admin);

    for (const job of jobs) {
      const dryRun = effectiveJobDryRun(job.dryRun, mode);
      try {
        const result = await runAccountDeletionJob(
          { userId: job.userId, state: job.state, dryRun },
          deps
        );
        // userId 는 PII 취급 — 응답에 싣지 않는다.
        results.push({
          finalState: result.finalState,
          ok: result.ok,
          dryRun: result.dryRun,
          stopped: result.stopped,
          planCount: result.plan?.length ?? 0,
        });
      } catch (cause) {
        errors.push(cause instanceof Error ? cause.message : "job_failed");
      }
    }
  } catch (cause) {
    return NextResponse.json(
      { ok: false, error: cause instanceof Error ? cause.message : "claim_failed" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: errors.length === 0,
    mode: mode.reason,
    dryRun: mode.dryRun,
    claimed: results.length,
    results,
    errors,
    // 사용자 prefix 스캔으로 커버되지 않는 버킷을 매 응답에 드러낸다(조용한 미삭제 방지).
    uncoveredBuckets: ACCOUNT_DELETION_UNCOVERED_BUCKETS,
  });
}

export async function POST(req: NextRequest) {
  return handleRun(req);
}

/**
 * GET 도 동일 규약으로 받는다 — Vercel cron 은 GET 으로만 호출하므로
 * (기존 라이브 크론 2종과 동일), GET 부재 시 스케줄러 연결 자체가 불가능했다.
 * 인증·쿼리 규약(dryRun/limit/leaseSeconds)·3중 안전장치는 POST 와 완전히 같다.
 */
export async function GET(req: NextRequest) {
  return handleRun(req);
}
