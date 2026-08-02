import { type NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { isAccountDeletionFeatureEnabled } from "@/lib/shell/featureFlags";
import { runAccountDeletionJob } from "@/lib/account/accountDeletionWorker";
import {
  ACCOUNT_DELETION_UNCOVERED_BUCKETS,
  buildDeletionDeps,
  claimDeletionJobs,
  previewDeletionJobs,
  reclaimExpiredDeletionLeases,
} from "@/lib/account/accountDeletionAdapters";
import {
  ACCOUNT_DELETION_SCHEDULED_REAL_RUN_ENV,
  ACCOUNT_DELETION_WORKER_ENABLED_ENV,
  handleAccountDeletionCron,
  type AccountDeletionCronDeps,
  type DeletionCronTrigger,
} from "@/lib/account/accountDeletionCronRoute";

/**
 * 계정 삭제 saga 러너(내부 전용).
 *
 * ── 호출 경로 ────────────────────────────────────────────────────────────────
 *   GET   스케줄러(Vercel Cron, vercel.json `0 * * * *`). 쿼리스트링으로 실삭제를
 *         켤 수 없다 — `ACCOUNT_DELETION_SCHEDULED_REAL_RUN=true|1` 만이 스위치다.
 *   POST  기존 수동 운영 경로. `?dryRun=false` 명시로 real-run 을 요청한다(계약 유지).
 * 둘 다 `handleAccountDeletionCron` 하나를 호출한다 — 게이트가 갈라지지 않게.
 *
 * ── 파괴 실행 조건(전부 참일 때만) ───────────────────────────────────────────
 *   ① ACCOUNT_DELETION_WORKER_ENABLED=true|1
 *   ② 계정 삭제 기능 플래그 ON
 *   ③ 명시적 real-run 요청(GET=전용 env / POST=?dryRun=false)
 *   ④ CRON_SECRET 인증 성공
 *   ⑤ 미커버 버킷 0종
 *   ⑥ claim lease 획득 성공
 * 하나라도 어긋나면 claim 0건 · Storage/Auth/DB 무변경 · dry-run 또는 disabled 응답.
 *
 * ── dry-run zero-write ───────────────────────────────────────────────────────
 * dry-run 은 `previewDeletionJobs`(SELECT)로만 대상을 고른다. reclaim·claim 은
 * `account_deletion_jobs` 를 UPDATE 하므로 real-run 에서만 호출한다.
 * 응답은 `claimed: 0` + `previewed: N` 으로 둘을 구분한다.
 *
 * 인증은 기존 cron 라우트 2종과 동일한 timing-safe CRON_SECRET 비교다.
 * lease 는 154 account_deletion_claim(owner·leased_until)만 쓴다 —
 * 151 account_deletion_worker_claim 은 lease 를 다루지 않아 중복 처리가 가능하므로 쓰지 않는다.
 *
 * 응답·로그에는 사용자 uuid·이메일·Storage 경로·job id 를 싣지 않는다(개수·상태명만).
 */
export const dynamic = "force-dynamic";

function buildDeps(trigger: DeletionCronTrigger): AccountDeletionCronDeps {
  return {
    trigger,
    cronSecret: process.env.CRON_SECRET,
    workerEnabledRaw: process.env[ACCOUNT_DELETION_WORKER_ENABLED_ENV],
    scheduledRealRunRaw: process.env[ACCOUNT_DELETION_SCHEDULED_REAL_RUN_ENV],
    featureEnabled: isAccountDeletionFeatureEnabled(),
    uncoveredBuckets: ACCOUNT_DELETION_UNCOVERED_BUCKETS,
    makeOwner: () => `cron-${process.env.VERCEL_DEPLOYMENT_ID ?? "local"}-${Date.now()}`,
    createRunner: () => {
      // 서비스 롤 키 미설정이면 여기서 던지고, 핸들러가 500 server_config 로 접는다.
      const admin = createServiceRoleClient();
      // log 를 주입하지 않는다 — 워커 로그 meta 에 Storage 경로가 실릴 수 있다.
      const workerDeps = buildDeletionDeps(admin);
      return {
        // dry-run 전용 read-only SELECT — job 행을 UPDATE 하지 않는다.
        previewJobs: (limit) => previewDeletionJobs(admin, limit),
        reclaimExpiredLeases: () => reclaimExpiredDeletionLeases(admin),
        claimJobs: (owner, limit, leaseSeconds) =>
          claimDeletionJobs(admin, owner, limit, leaseSeconds),
        runJob: (job) => runAccountDeletionJob(job, workerDeps),
      };
    },
    log: (message, meta) => {
      console.info(`[account-deletion-cron] ${message}`, meta);
    },
  };
}

/** 스케줄러(Vercel Cron)가 호출하는 경로. */
export async function GET(req: NextRequest) {
  return handleAccountDeletionCron(req, buildDeps("scheduled"));
}

/** 기존 수동 운영 경로 — 회귀 없이 유지한다. */
export async function POST(req: NextRequest) {
  return handleAccountDeletionCron(req, buildDeps("manual"));
}
