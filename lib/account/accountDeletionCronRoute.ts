/**
 * 계정 삭제 cron 라우트 핸들러 — 순수 seam(‘next/server’·Supabase SDK 의존 0).
 *
 * 왜 별도 모듈인가: 계약 테스트 러너(`node --test --experimental-strip-types`)는
 * `@/*` alias 도 `next/server` 도 해석하지 못한다. 라우트 본문을 여기로 내리면
 * 인증·게이트·PII 계약을 fake dependency 만으로 실증할 수 있다
 * (`lib/auth/logoutRoute.ts` 와 같은 패턴).
 *
 * ── S3-A 배선 계약 ────────────────────────────────────────────────────────────
 * 스케줄러(Vercel Cron)는 **GET** 으로만 호출한다. 기존 수동 경로인 **POST** 는 그대로 둔다.
 * 두 메서드는 이 파일의 `handleAccountDeletionCron` 하나를 공유하고, `trigger` 로만 갈린다.
 *
 *   trigger="scheduled" (GET)  실삭제 여부를 **쿼리스트링으로 정하지 않는다**.
 *                              `?dryRun=false` 를 붙여도 무시한다 — 스케줄 URL 은
 *                              vercel.json 에 평문으로 남고, 그 문자열 하나가
 *                              전 사용자 실삭제 스위치가 되면 안 된다.
 *                              오직 `ACCOUNT_DELETION_SCHEDULED_REAL_RUN=true|1`
 *                              (별도 env, 기본 미설정)일 때만 real-run 을 요청한다.
 *   trigger="manual"   (POST)  기존 계약 유지 — `?dryRun=false` 명시로 real-run 요청.
 *
 * 어느 경로든 "요청"은 요청일 뿐이다. 실제 파괴 실행은 `resolveDeletionRunMode` 가
 * worker env(①) + 기능 플래그(②) + 명시적 real-run 요청(③)을 모두 통과시킨 뒤,
 * 여기서 미커버 버킷 게이트(④)까지 통과해야 시작된다. 하나라도 어긋나면 dry-run
 * 또는 disabled 로 강등되며 job 을 claim 하지 않는다(fail-closed 기본값).
 *
 * ── dry-run zero-write 계약 ──────────────────────────────────────────────────
 * dry-run 을 "read-only" 라고 부르려면 **DB write 가 실제로 0** 이어야 한다.
 * `reclaimExpiredLeases` 와 `claimJobs` 는 둘 다 `account_deletion_jobs` 를 UPDATE 한다
 * (lease_owner·leased_until·updated_at). 따라서 dry-run 은 이 둘을 부르지 않고,
 * 같은 술어의 SELECT 인 `previewJobs` 로만 대상을 고른 뒤 워커의 read-only planner 를 돌린다.
 *
 *   disabled  runner 호출 0 (preview 포함) · DB/Storage/Auth 변경 0
 *   dry-run   preview 1회 · reclaim 0 · claim 0 · lease/attempts/state 변경 0 ·
 *             Storage/Auth/익명화 0 · 응답은 claimed:0 + previewed:N
 *   real-run  reclaim → claim → runJob (기존 lease·중복 실행 계약 그대로)
 *
 * ── 응답 카운터 ──────────────────────────────────────────────────────────────
 *   claimed   real-run 이 **lease 를 획득한** job 수(dry-run 은 0). 작업 성공 수가 아니다.
 *   previewed dry-run 이 SELECT 로 **조회만** 한 대상 수(real-run 은 0).
 *   succeeded runJob 이 결과를 돌려준 수. 부분 실패 시 claimed 보다 작다.
 *   failed    runJob 이 예외로 끝난 수. `ok` 는 failed === 0 일 때만 true.
 * claimed = succeeded + failed 가 성립한다(real-run). 셋을 분리해 두면 운영자가
 * "몇 건이 lease 를 물고 있는가"와 "몇 건이 실제로 진행됐는가"를 구분할 수 있다.
 */

import { timingSafeEqual } from "node:crypto";
import {
  ACCOUNT_DELETION_WORKER_ENABLED_ENV,
  effectiveJobDryRun,
  parseRequestedDryRun,
  resolveClaimParams,
  resolveDeletionRunMode,
  type DeletionRunMode,
} from "./accountDeletionRunnerConfig.ts";

export { ACCOUNT_DELETION_WORKER_ENABLED_ENV };

/**
 * 스케줄 실행이 real-run 으로 내려갈 수 있는 유일한 스위치.
 * worker env(`ACCOUNT_DELETION_WORKER_ENABLED`)와 **일부러 분리**했다:
 * 워커를 켜서 스케줄 dry-run 을 관측하는 단계와, 실제로 지우기 시작하는 단계를
 * 서로 다른 env 변경으로 나눠 한 번의 실수로 삭제가 시작되지 않게 한다.
 */
export const ACCOUNT_DELETION_SCHEDULED_REAL_RUN_ENV = "ACCOUNT_DELETION_SCHEDULED_REAL_RUN";

/** 호출 출처. 스케줄러(GET)와 수동(POST)의 real-run 판별 규칙이 다르다. */
export type DeletionCronTrigger = "scheduled" | "manual";

/** 기존 cron 라우트 2종과 동일 파싱(trim·소문자 처리 없음). 기본 off. */
export function isScheduledRealRunEnabled(raw: string | undefined): boolean {
  const value = raw ?? "";
  return value === "true" || value === "1";
}

/**
 * trigger 별 "명시적 real-run 요청" 판별 — 코드 한 곳에서만 결정한다(§3 요구 7).
 * scheduled 는 URL 을 보지 않는다: 인자로 받지도 않는다.
 */
export function resolveRequestedDryRun(input: {
  trigger: DeletionCronTrigger;
  /** manual(POST) 전용. scheduled 에서는 호출부가 넘기지 않는다. */
  dryRunParamRaw?: string | null;
  scheduledRealRunRaw?: string | undefined;
}): boolean | undefined {
  if (input.trigger === "scheduled") {
    return isScheduledRealRunEnabled(input.scheduledRealRunRaw) ? false : undefined;
  }
  return parseRequestedDryRun(input.dryRunParamRaw ?? null);
}

// ── 인증 ─────────────────────────────────────────────────────────────────────

/**
 * timing-safe 문자열 비교 — 기존 cron 라우트 3종의 구현을 **그대로** 옮겨 온 것이다.
 * (길이 불일치 조기 false 포함. 길이는 비밀이 아니고, timingSafeEqual 은 길이가
 * 다르면 던지므로 이 가드가 필요하다.)
 */
function timingSafeStringEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  if (aBuffer.length !== bBuffer.length) return false;
  return timingSafeEqual(aBuffer, bBuffer);
}

/**
 * 인증 — `Authorization: Bearer <CRON_SECRET>`(Vercel Cron 이 보내는 형태) 또는
 * `x-cron-secret: <CRON_SECRET>`(기존 수동 호출 계약). 둘 다 기존 계약이라 유지한다.
 * CRON_SECRET 미설정이면 **항상 401** — 비밀이 없을 때 열리지 않는다.
 */
export function isAuthorizedCronRequest(
  headers: { get(name: string): string | null },
  secretRaw: string | undefined
): boolean {
  const secret = secretRaw?.trim();
  if (!secret) return false;

  const auth = headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  const headerSecret = headers.get("x-cron-secret")?.trim() ?? "";

  return (
    (bearer.length > 0 && timingSafeStringEqual(bearer, secret)) ||
    (headerSecret.length > 0 && timingSafeStringEqual(headerSecret, secret))
  );
}

// ── PII 차단 ─────────────────────────────────────────────────────────────────

/** 안전 코드 형태 — 소문자·숫자·밑줄만. uuid(하이픈)·경로(슬래시)·이메일(@)은 전부 탈락. */
const SAFE_ERROR_CODE = /^[a-z0-9_]{1,64}$/;
/** 하이픈이 제거된 uuid·해시가 코드처럼 위장하는 경우까지 막는다. */
const LONG_HEX = /[0-9a-f]{16,}/;

/**
 * 워커·어댑터 오류 문자열을 응답에 실을 수 있는 **코드**로 축약한다.
 * 원문은 `uncovered_buckets: a,b` · `not empty after purge: bucket/uid/file` 처럼
 * 버킷 경로와 사용자 uuid 를 담을 수 있으므로 그대로 내보내지 않는다(§3 요구 11).
 * 화이트리스트 방식 — 안전 형태로 환원되지 않으면 전부 `job_failed` 로 접는다.
 */
export function sanitizeDeletionCronError(cause: unknown): string {
  const raw =
    cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "";
  const head = raw.split(":")[0]?.trim().toLowerCase().replace(/\s+/g, "_") ?? "";
  if (!SAFE_ERROR_CODE.test(head)) return "job_failed";
  if (LONG_HEX.test(head)) return "job_failed";
  return head;
}

// ── 실행 ─────────────────────────────────────────────────────────────────────

export type CronClaimedJob = { userId: string; state: string; dryRun: boolean };

export type CronJobRunResult = {
  ok: boolean;
  finalState: string;
  dryRun: boolean;
  stopped?: string;
  plan?: readonly unknown[];
};

/**
 * DB 에 닿는 부분 전부. 라우트는 Supabase service-role 클라이언트로 이걸 만들고,
 * 테스트는 fake 로 만든다 — 계약 테스트가 실제 job 에 절대 닿지 않는 경계다.
 *
 * ★ write seam 은 `reclaimExpiredLeases` 와 `claimJobs` **둘뿐**이다.
 *   dry-run 은 이 둘을 호출하지 않는다(§ dry-run zero-write).
 */
export type DeletionCronRunner = {
  /**
   * dry-run 전용 **read-only** 조회. claim 과 같은 술어로 "real-run 이라면 집었을 job" 을
   * SELECT 만으로 보여 준다. lease·attempts·state·updated_at 어느 것도 바꾸지 않는다.
   */
  previewJobs: (limit: number) => Promise<CronClaimedJob[]>;
  /** [WRITE] 만료 lease 회수 — 죽은 러너가 잡고 있던 job 을 다시 집을 수 있게 한다. */
  reclaimExpiredLeases: () => Promise<number>;
  /** [WRITE] 154 account_deletion_claim — lease(owner·leased_until) + SKIP LOCKED 중복 claim 방지. */
  claimJobs: (owner: string, limit: number, leaseSeconds: number) => Promise<CronClaimedJob[]>;
  runJob: (job: CronClaimedJob) => Promise<CronJobRunResult>;
};

export type AccountDeletionCronDeps = {
  trigger: DeletionCronTrigger;
  cronSecret: string | undefined;
  workerEnabledRaw: string | undefined;
  scheduledRealRunRaw: string | undefined;
  featureEnabled: boolean;
  /** 수집 경로가 없는 버킷(계산값). 비어 있지 않으면 real-run 을 시작하지 않는다. */
  uncoveredBuckets: readonly string[];
  /** lease owner 문자열 생성. 응답에는 싣지 않는다. */
  makeOwner: () => string;
  /** 던지면 500 server_config — 서비스 롤 키 미설정 등. */
  createRunner: () => DeletionCronRunner;
  /** 비-PII 운영 로그. 미지정이면 로깅하지 않는다. */
  log?: (message: string, meta: Record<string, unknown>) => void;
};

/** real-run 을 시작해도 되는지 최종 판정 — 미커버 버킷이 마지막 관문이다(§3 요구 10). */
export function uncoveredBucketGateBlocks(
  mode: DeletionRunMode,
  uncoveredBuckets: readonly string[]
): boolean {
  return mode.enabled && !mode.dryRun && uncoveredBuckets.length > 0;
}

/**
 * GET(scheduled)·POST(manual) 공용 실행 함수.
 * 응답에는 사용자 uuid·이메일·Storage 경로·job id 를 **일절 싣지 않는다** — 개수와 상태명뿐이다.
 */
export async function handleAccountDeletionCron(
  request: Request,
  deps: AccountDeletionCronDeps
): Promise<Response> {
  if (!isAuthorizedCronRequest(request.headers, deps.cronSecret)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const mode = resolveDeletionRunMode({
    workerEnabledRaw: deps.workerEnabledRaw,
    featureEnabled: deps.featureEnabled,
    requestedDryRun: resolveRequestedDryRun({
      trigger: deps.trigger,
      // scheduled 는 쿼리스트링을 읽지 않는다.
      dryRunParamRaw: deps.trigger === "manual" ? url.searchParams.get("dryRun") : null,
      scheduledRealRunRaw: deps.scheduledRealRunRaw,
    }),
  });

  if (!mode.enabled) {
    // kill switch — job 을 집지도 않는다.
    deps.log?.("account_deletion_cron_disabled", { trigger: deps.trigger, reason: mode.reason });
    return Response.json({
      ok: true,
      trigger: deps.trigger,
      disabled: true,
      reason: mode.reason,
      claimed: 0,
      previewed: 0,
      succeeded: 0,
      failed: 0,
    });
  }

  // §3-4 와 같은 관문을 claim **이전**에 한 번 더 건다. 워커도 job 단위로 막지만,
  // 미커버 버킷이 있는 상태에서 real-run 을 시작하면 lease·attempts 만 태운다.
  if (uncoveredBucketGateBlocks(mode, deps.uncoveredBuckets)) {
    deps.log?.("account_deletion_cron_blocked", {
      trigger: deps.trigger,
      reason: "uncovered_buckets",
      uncoveredCount: deps.uncoveredBuckets.length,
    });
    return Response.json({
      ok: false,
      trigger: deps.trigger,
      blocked: "uncovered_buckets",
      mode: mode.reason,
      dryRun: mode.dryRun,
      claimed: 0,
      previewed: 0,
      succeeded: 0,
      failed: 0,
      uncoveredBuckets: deps.uncoveredBuckets,
    });
  }

  let runner: DeletionCronRunner;
  try {
    runner = deps.createRunner();
  } catch {
    return Response.json({ ok: false, error: "server_config" }, { status: 500 });
  }

  const { limit, leaseSeconds } = resolveClaimParams({
    limitRaw: url.searchParams.get("limit"),
    leaseSecondsRaw: url.searchParams.get("leaseSeconds"),
  });

  const results: Array<Record<string, unknown>> = [];
  const errors: string[] = [];
  let jobs: CronClaimedJob[];

  try {
    // ── dry-run zero-write 경계 ────────────────────────────────────────────────
    // reclaim 과 claim 은 account_deletion_jobs 를 UPDATE 한다(lease_owner·leased_until·
    // updated_at, 그리고 claim 은 재시도 회계에 영향을 준다). dry-run 이 이들을 부르면
    // "삭제는 안 했지만 job 행은 건드렸다"가 되어, 운영 관측(스케줄 dry-run 여러 사이클)이
    // 관측 대상 자체를 오염시킨다. 그래서 write seam 은 real-run 에서만 열린다.
    if (mode.dryRun) {
      jobs = await runner.previewJobs(limit);
    } else {
      await runner.reclaimExpiredLeases();
      jobs = await runner.claimJobs(deps.makeOwner(), limit, leaseSeconds);
    }

    for (const job of jobs) {
      const dryRun = effectiveJobDryRun(job.dryRun, mode);
      try {
        const result = await runner.runJob({ userId: job.userId, state: job.state, dryRun });
        // userId 는 PII 취급 — 응답에 싣지 않는다.
        results.push({
          finalState: result.finalState,
          ok: result.ok,
          dryRun: result.dryRun,
          stopped: result.stopped,
          planCount: result.plan?.length ?? 0,
        });
      } catch (cause) {
        errors.push(sanitizeDeletionCronError(cause));
      }
    }
  } catch (cause) {
    // preview/claim/reclaim 실패도 원문을 흘리지 않는다(어댑터 오류에 RPC 인자가 섞일 수 있다).
    return Response.json({ ok: false, error: sanitizeDeletionCronError(cause) }, { status: 500 });
  }

  // claimed 는 **lease 를 실제로 획득한 수** 다 — 작업 성공 수가 아니다.
  // runJob 이 던진 job 도 lease 는 이미 잡았으므로 claimed 에 남아야 한다.
  // (results.length 로 세면 부분 실패 시 운영자가 "몇 건이 lease 를 물고 있는가"를
  //  알 수 없다. lease 회수·재시도 판단에 필요한 수치다.)
  const claimed = mode.dryRun ? 0 : jobs.length;
  const previewed = mode.dryRun ? jobs.length : 0;
  const succeeded = results.length;
  const failed = errors.length;

  deps.log?.("account_deletion_cron_done", {
    trigger: deps.trigger,
    mode: mode.reason,
    dryRun: mode.dryRun,
    claimed,
    previewed,
    succeeded,
    failed,
  });

  return Response.json({
    ok: failed === 0,
    trigger: deps.trigger,
    mode: mode.reason,
    dryRun: mode.dryRun,
    /** real-run 이 lease 를 획득한 job 수(dry-run 은 언제나 0). */
    claimed,
    /** dry-run 이 SELECT 로 조회만 한 대상 수(real-run 은 언제나 0). */
    previewed,
    /** runJob 이 결과를 돌려준 수 — claimed 와 다를 수 있다(부분 실패). */
    succeeded,
    /** runJob 이 예외로 끝난 수. */
    failed,
    results,
    errors,
    // 사용자 prefix 스캔으로 커버되지 않는 버킷을 매 응답에 드러낸다(조용한 미삭제 방지).
    uncoveredBuckets: deps.uncoveredBuckets,
  });
}
