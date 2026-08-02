// 계약 테스트: 계정 삭제 cron 라우트 배선(S3-A) — GET 스케줄 경로 · POST 수동 경로 공용 게이트.
// 실행: node --test --experimental-strip-types lib/account/__contract__/accountDeletionCronRoute.contract.test.ts
//
// 이 파일은 **실제 job 에 절대 닿지 않는다**. Supabase 클라이언트도, 네트워크도 없다.
// runner 는 전부 fake 이고, "실삭제가 일어났는가"는 fake 가 기록한 호출 흔적으로만 판정한다.
//
// 고정하는 계약:
//   R1 인증 fail-closed — 비밀 미설정·무인증·오답 bearer 는 GET/POST 모두 401.
//   R2 스케줄(GET) real-run 은 **쿼리스트링으로 켜지지 않는다** — 전용 env 만이 스위치.
//   R3 worker env OFF / 기능 플래그 OFF → disabled · runner 호출 0(preview 포함).
//   R4 dry-run 은 **zero-write** — preview 1회 · reclaim 0 · claim 0 · 실삭제 0.
//   R5 미커버 버킷이 있으면 real-run 시작 0(claim 0).
//   R6 real-run 만 write seam 을 연다 — 만료 lease 회수는 claim 이전에 1회.
//   R7 lease 를 쥔 job 은 두 번째 러너가 다시 집지 않는다.
//   R8 응답 어디에도 uuid·이메일·Storage 경로·job id 가 없다.
//   R9 POST 수동 경로의 기존 계약(?dryRun=false · x-cron-secret · limit/leaseSeconds)은 그대로다.
//   R10 응답 카운터 — claimed 는 **lease 획득 수**, succeeded/failed 와 분리된다.
//
// ★ write seam 은 `reclaimExpiredLeases` 와 `claimJobs` 둘뿐이다(둘 다 account_deletion_jobs
//   UPDATE). fake 는 이 둘이 불릴 때마다 trace.writes 에 흔적을 남기고, dry-run 계열
//   테스트는 그 배열이 **비어 있음**을 요구한다 — "삭제는 안 했지만 job 행은 건드렸다"를 막는다.

import test from "node:test";
import assert from "node:assert/strict";
import {
  ACCOUNT_DELETION_SCHEDULED_REAL_RUN_ENV,
  ACCOUNT_DELETION_WORKER_ENABLED_ENV,
  handleAccountDeletionCron,
  isAuthorizedCronRequest,
  isScheduledRealRunEnabled,
  resolveRequestedDryRun,
  sanitizeDeletionCronError,
  uncoveredBucketGateBlocks,
  type AccountDeletionCronDeps,
  type CronClaimedJob,
  type DeletionCronRunner,
  type DeletionCronTrigger,
} from "../accountDeletionCronRoute.ts";
import { resolveDeletionRunMode } from "../accountDeletionRunnerConfig.ts";

const SECRET = "cron-secret-fixture-000";
const URL_BASE = "https://example.test/api/cron/account-deletion";

// 응답에 새어 나오면 안 되는 실제 형태의 값들 — fake job 에 심어 두고 전 응답을 훑는다.
const PII = {
  userId: "3f1c2b7e-9a44-4d51-8b0e-6c2f5a91d7c3",
  email: "student@example.com",
  storagePath: "student-id-images/3f1c2b7e-9a44-4d51-8b0e-6c2f5a91d7c3/front.jpg",
  jobId: "9c8e4d21-77aa-4f60-9b31-0e5d2a6c4f18",
};

type Trace = {
  /** [READ] preview 호출 인자 — dry-run 이 대상을 고르는 유일한 경로. */
  previews: number[];
  reclaim: number;
  claims: Array<{ owner: string; limit: number; leaseSeconds: number }>;
  /** account_deletion_jobs 를 UPDATE 하는 seam 이 불린 흔적. dry-run 에서는 반드시 비어 있다. */
  writes: string[];
  ran: Array<CronClaimedJob>;
  /** dryRun=false 로 실제 파괴 단계에 들어간 job 수 — 0 이어야 하는 테스트가 대부분이다. */
  destructive: number;
};

function newTrace(): Trace {
  return { previews: [], reclaim: 0, claims: [], writes: [], ran: [], destructive: 0 };
}

/** lease 를 흉내내는 fake — 같은 job 을 두 번 집지 않고, 만료 회수 후에만 다시 집는다. */
function makeRunner(
  trace: Trace,
  opts: { jobs?: CronClaimedJob[]; leaseHeld?: boolean } = {}
): DeletionCronRunner {
  const pool = opts.jobs ?? [{ userId: PII.userId, state: "pending", dryRun: false }];
  let leased = opts.leaseHeld ?? false;
  return {
    // read-only: lease 상태를 읽기만 하고 바꾸지 않는다(실어댑터의 SELECT 대응).
    previewJobs: async (limit) => {
      trace.previews.push(limit);
      return leased ? [] : pool.slice(0, limit);
    },
    reclaimExpiredLeases: async () => {
      trace.writes.push("reclaimExpiredLeases");
      trace.reclaim += 1;
      return 0;
    },
    claimJobs: async (owner, limit, leaseSeconds) => {
      trace.writes.push("claimJobs");
      trace.claims.push({ owner, limit, leaseSeconds });
      if (leased) return []; // 다른 러너가 lease 를 쥐고 있다 — SKIP LOCKED.
      leased = true;
      return pool.slice(0, limit);
    },
    runJob: async (job) => {
      trace.ran.push(job);
      if (!job.dryRun) trace.destructive += 1;
      return { ok: true, finalState: job.dryRun ? job.state : "completed", dryRun: job.dryRun };
    },
  };
}

/** dry-run 계열 공통 단언 — job 행을 건드리는 seam 이 하나도 불리지 않았는가. */
function assertZeroWrite(trace: Trace, label: string) {
  assert.deepEqual(trace.writes, [], `${label}: DB write seam 0`);
  assert.equal(trace.reclaim, 0, `${label}: reclaim 0`);
  assert.equal(trace.claims.length, 0, `${label}: claim 0`);
  assert.equal(trace.destructive, 0, `${label}: 파괴 실행 0`);
}

function makeDeps(over: Partial<AccountDeletionCronDeps> = {}): AccountDeletionCronDeps {
  const trace = newTrace();
  return {
    trigger: "scheduled",
    cronSecret: SECRET,
    workerEnabledRaw: "true",
    scheduledRealRunRaw: undefined,
    featureEnabled: true,
    uncoveredBuckets: [],
    makeOwner: () => "cron-test-owner",
    createRunner: () => makeRunner(trace),
    ...over,
  };
}

function req(
  init: { method?: string; secret?: string | null; header?: "bearer" | "x-cron-secret"; query?: string } = {}
): Request {
  const headers: Record<string, string> = {};
  if (init.secret !== null && init.secret !== undefined) {
    if (init.header === "x-cron-secret") headers["x-cron-secret"] = init.secret;
    else headers.authorization = `Bearer ${init.secret}`;
  }
  return new Request(`${URL_BASE}${init.query ?? ""}`, { method: init.method ?? "GET", headers });
}

async function body(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

// ── R1 인증 fail-closed ──────────────────────────────────────────────────────

test("R1 인증 없는 GET·POST 는 401 이고 runner 를 만들지도 않는다", async () => {
  for (const method of ["GET", "POST"] as const) {
    let created = 0;
    const res = await handleAccountDeletionCron(
      req({ method, secret: null }),
      makeDeps({
        trigger: method === "GET" ? "scheduled" : "manual",
        createRunner: () => {
          created += 1;
          return makeRunner(newTrace());
        },
      })
    );
    assert.equal(res.status, 401, method);
    assert.deepEqual(await body(res), { ok: false, error: "unauthorized" });
    assert.equal(created, 0, `${method}: 인증 실패 시 DB 클라이언트 생성 0`);
  }
});

test("R1 틀린 bearer 는 401 — 길이가 같아도 다른 값이면 통과하지 않는다", async () => {
  const sameLengthWrong = "cron-secret-fixture-001";
  assert.equal(sameLengthWrong.length, SECRET.length);
  for (const wrong of ["wrong", sameLengthWrong, "", " "]) {
    const res = await handleAccountDeletionCron(req({ secret: wrong }), makeDeps());
    assert.equal(res.status, 401, JSON.stringify(wrong));
  }
});

test("R1 CRON_SECRET 미설정이면 어떤 요청도 통과하지 못한다(빈 비밀로 열리지 않음)", async () => {
  for (const secret of [undefined, "", "   "]) {
    const res = await handleAccountDeletionCron(
      req({ secret: "anything" }),
      makeDeps({ cronSecret: secret })
    );
    assert.equal(res.status, 401, JSON.stringify(secret));
  }
});

test("R1 올바른 bearer 는 핸들러 본문에 진입한다(401 아님)", async () => {
  const res = await handleAccountDeletionCron(req({ secret: SECRET }), makeDeps());
  assert.equal(res.status, 200);
  assert.notEqual((await body(res)).error, "unauthorized");
});

test("R9 x-cron-secret 헤더 지원은 기존 계약이므로 유지된다(GET·POST 모두)", async () => {
  for (const method of ["GET", "POST"] as const) {
    const res = await handleAccountDeletionCron(
      req({ method, secret: SECRET, header: "x-cron-secret" }),
      makeDeps({ trigger: method === "GET" ? "scheduled" : "manual" })
    );
    assert.equal(res.status, 200, method);
  }
});

test("R1 인증 판별 단위 — 두 헤더 형태만 인정하고 나머지는 거부", () => {
  const H = (map: Record<string, string>) => ({ get: (n: string) => map[n.toLowerCase()] ?? null });
  assert.equal(isAuthorizedCronRequest(H({ authorization: `Bearer ${SECRET}` }), SECRET), true);
  assert.equal(isAuthorizedCronRequest(H({ "x-cron-secret": SECRET }), SECRET), true);
  assert.equal(isAuthorizedCronRequest(H({ authorization: SECRET }), SECRET), false, "Bearer 접두사 필요");
  assert.equal(isAuthorizedCronRequest(H({ authorization: `bearer ${SECRET}` }), SECRET), false);
  assert.equal(isAuthorizedCronRequest(H({}), SECRET), false);
  assert.equal(isAuthorizedCronRequest(H({ authorization: `Bearer ${SECRET}` }), undefined), false);
});

// ── R2 스케줄 경로는 쿼리스트링으로 실삭제되지 않는다 ────────────────────────

test("R2 scheduled GET 은 ?dryRun=false 를 무시한다 — 실삭제 0 · write 0", async () => {
  const trace = newTrace();
  const res = await handleAccountDeletionCron(
    req({ secret: SECRET, query: "?dryRun=false" }),
    makeDeps({ trigger: "scheduled", createRunner: () => makeRunner(trace) })
  );
  const json = await body(res);
  assert.equal(json.dryRun, true);
  assert.equal(json.mode, "dry_run_default");
  assertZeroWrite(trace, "쿼리스트링만으로 파괴 실행·claim 이 시작되면 안 된다");
});

test("R2 scheduled GET 의 real-run 스위치는 전용 env 뿐이다", () => {
  // 쿼리 인자를 아예 받지 않는 경로 — trigger 로만 갈린다.
  assert.equal(
    resolveRequestedDryRun({ trigger: "scheduled", dryRunParamRaw: "false", scheduledRealRunRaw: undefined }),
    undefined,
    "env 없이 쿼리만으로는 real-run 요청이 되지 않는다"
  );
  assert.equal(
    resolveRequestedDryRun({ trigger: "scheduled", scheduledRealRunRaw: "true" }),
    false,
    "env=true 면 real-run 요청"
  );
  assert.equal(resolveRequestedDryRun({ trigger: "scheduled", scheduledRealRunRaw: "1" }), false);
  for (const raw of [undefined, "", " ", "TRUE", "True", "yes", "on", "false", "0", "2"]) {
    if (raw === "true" || raw === "1") continue;
    assert.equal(
      isScheduledRealRunEnabled(raw),
      false,
      `스케줄 real-run 스위치 기본 off: ${JSON.stringify(raw)}`
    );
  }
});

test("R2 scheduled real-run env 가 켜지고 나머지 조건이 모두 참일 때만 파괴 실행이 시작된다", async () => {
  const trace = newTrace();
  const res = await handleAccountDeletionCron(
    req({ secret: SECRET }),
    makeDeps({
      trigger: "scheduled",
      scheduledRealRunRaw: "true",
      workerEnabledRaw: "true",
      featureEnabled: true,
      uncoveredBuckets: [],
      createRunner: () => makeRunner(trace),
    })
  );
  const json = await body(res);
  assert.equal(json.mode, "real_run");
  assert.equal(json.dryRun, false);
  assert.equal(json.claimed, 1);
  assert.equal(json.previewed, 0, "real-run 은 preview 를 쓰지 않는다");
  assert.equal(trace.previews.length, 0);
  assert.equal(trace.destructive, 1, "네 관문을 모두 통과했을 때만 claim·실행이 일어난다");
  assert.deepEqual(trace.writes, ["reclaimExpiredLeases", "claimJobs"], "real-run 만 write seam 을 연다");
});

test("R2 env 는 켜져 있어도 worker env 나 기능 플래그가 꺼져 있으면 claim 0", async () => {
  for (const over of [{ workerEnabledRaw: undefined }, { featureEnabled: false }]) {
    const trace = newTrace();
    const res = await handleAccountDeletionCron(
      req({ secret: SECRET }),
      makeDeps({ scheduledRealRunRaw: "true", createRunner: () => makeRunner(trace), ...over })
    );
    const json = await body(res);
    assert.equal(json.disabled, true, JSON.stringify(over));
    assert.equal(json.claimed, 0);
    assertZeroWrite(trace, JSON.stringify(over));
    assert.equal(trace.previews.length, 0, "disabled 는 preview 조차 하지 않는다");
  }
});

// ── R3 kill switch ──────────────────────────────────────────────────────────

test("R3 worker env OFF → disabled · preview 포함 모든 runner 호출 0", async () => {
  const trace = newTrace();
  const res = await handleAccountDeletionCron(
    req({ secret: SECRET }),
    makeDeps({ workerEnabledRaw: undefined, createRunner: () => makeRunner(trace) })
  );
  const json = await body(res);
  assert.equal(res.status, 200);
  assert.equal(json.disabled, true);
  assert.equal(json.reason, "worker_disabled");
  assert.equal(json.claimed, 0);
  assert.equal(json.previewed, 0);
  assertZeroWrite(trace, "worker OFF");
  assert.equal(trace.previews.length, 0, "preview 도 하지 않는다");
  assert.equal(trace.ran.length, 0);
});

test("R3 기능 플래그 OFF → disabled · preview 포함 모든 runner 호출 0", async () => {
  const trace = newTrace();
  const res = await handleAccountDeletionCron(
    req({ secret: SECRET }),
    makeDeps({ featureEnabled: false, createRunner: () => makeRunner(trace) })
  );
  const json = await body(res);
  assert.equal(json.disabled, true);
  assert.equal(json.reason, "feature_disabled");
  assert.equal(json.claimed, 0);
  assert.equal(json.previewed, 0);
  assertZeroWrite(trace, "feature OFF");
  assert.equal(trace.previews.length, 0, "preview 도 하지 않는다");
  assert.equal(trace.ran.length, 0);
});

test("R3 env 이름은 문서·라우트가 같은 상수를 본다", () => {
  assert.equal(ACCOUNT_DELETION_WORKER_ENABLED_ENV, "ACCOUNT_DELETION_WORKER_ENABLED");
  assert.equal(ACCOUNT_DELETION_SCHEDULED_REAL_RUN_ENV, "ACCOUNT_DELETION_SCHEDULED_REAL_RUN");
});

// ── R4 dry-run zero-write ───────────────────────────────────────────────────

test("R4 scheduled 기본 dry-run — preview 1회 · reclaim 0 · claim 0 · write seam 0", async () => {
  const trace = newTrace();
  const res = await handleAccountDeletionCron(
    req({ secret: SECRET }),
    makeDeps({ trigger: "scheduled", createRunner: () => makeRunner(trace) })
  );
  const json = await body(res);
  assert.equal(json.mode, "dry_run_default");
  assert.equal(json.dryRun, true);
  assert.equal(json.claimed, 0, "dry-run 은 아무것도 claim 하지 않는다");
  assert.equal(json.previewed, 1, "조회한 대상 수는 previewed 로 센다");
  assert.deepEqual(trace.previews, [5], "preview 정확히 1회(기본 limit)");
  assertZeroWrite(trace, "scheduled 기본 dry-run");
});

test("R4 manual 명시적 dry-run — preview 1회 · reclaim 0 · claim 0 · write seam 0", async () => {
  const trace = newTrace();
  const res = await handleAccountDeletionCron(
    req({ method: "POST", secret: SECRET, query: "?dryRun=true" }),
    makeDeps({ trigger: "manual", createRunner: () => makeRunner(trace) })
  );
  const json = await body(res);
  assert.equal(json.dryRun, true);
  assert.equal(json.mode, "dry_run_explicit", "명시 요청은 기본값과 구분된다");
  assert.equal(json.claimed, 0);
  assert.equal(json.previewed, 1);
  assert.equal(trace.previews.length, 1);
  assertZeroWrite(trace, "manual 명시적 dry-run");
});

test("R4 manual 기본 요청(파라미터 없음)도 dry-run zero-write", async () => {
  const trace = newTrace();
  const res = await handleAccountDeletionCron(
    req({ method: "POST", secret: SECRET }),
    makeDeps({ trigger: "manual", createRunner: () => makeRunner(trace) })
  );
  const json = await body(res);
  assert.equal(json.mode, "dry_run_default");
  assert.equal(json.claimed, 0);
  assert.equal(json.previewed, 1);
  assertZeroWrite(trace, "manual 기본 dry-run");
});

test("R4 dry-run 은 preview 한 대상에 대해 read-only planner 를 돌린다(전부 dryRun=true)", async () => {
  const trace = newTrace();
  // job 행이 dry_run=false 여도 러너가 dry 면 dry 로 내려간다.
  await handleAccountDeletionCron(
    req({ secret: SECRET }),
    makeDeps({
      createRunner: () =>
        makeRunner(trace, { jobs: [{ userId: PII.userId, state: "pending", dryRun: false }] }),
    })
  );
  assert.equal(trace.ran.length, 1, "미리보기 계획은 산출한다");
  assert.equal(trace.ran[0]!.dryRun, true, "러너가 dry 면 job 도 dry — 파괴 단계 진입 0");
  assertZeroWrite(trace, "dry-run planner");
});

test("R4 job 행이 dry_run 이면 러너가 real-run 이어도 그 job 은 dry 로 남는다", async () => {
  const trace = newTrace();
  const res = await handleAccountDeletionCron(
    req({ method: "POST", secret: SECRET, query: "?dryRun=false" }),
    makeDeps({
      trigger: "manual",
      createRunner: () =>
        makeRunner(trace, { jobs: [{ userId: PII.userId, state: "pending", dryRun: true }] }),
    })
  );
  assert.equal((await body(res)).mode, "real_run");
  assert.equal(trace.ran[0]!.dryRun, true, "어느 한쪽이라도 dry 면 dry");
  assert.equal(trace.destructive, 0);
});

// ── R5 미커버 버킷 게이트 ────────────────────────────────────────────────────

test("R5 미커버 버킷이 있으면 real-run 은 claim 조차 하지 않는다", async () => {
  for (const trigger of ["scheduled", "manual"] as const) {
    const trace = newTrace();
    const res = await handleAccountDeletionCron(
      req({
        method: trigger === "scheduled" ? "GET" : "POST",
        secret: SECRET,
        query: trigger === "manual" ? "?dryRun=false" : "",
      }),
      makeDeps({
        trigger,
        scheduledRealRunRaw: "true",
        uncoveredBuckets: ["orphan-bucket"],
        createRunner: () => makeRunner(trace),
      })
    );
    const json = await body(res);
    assert.equal(json.ok, false, trigger);
    assert.equal(json.blocked, "uncovered_buckets", trigger);
    assert.equal(json.claimed, 0, trigger);
    assertZeroWrite(trace, `${trigger}: 게이트가 claim 이전이다`);
    assert.equal(trace.previews.length, 0, `${trigger}: 조회조차 하지 않는다`);
  }
});

test("R5 dry-run 은 미커버 버킷이 있어도 계획 산출을 계속한다(read-only 진단 경로)", async () => {
  const trace = newTrace();
  const res = await handleAccountDeletionCron(
    req({ secret: SECRET }),
    makeDeps({ uncoveredBuckets: ["orphan-bucket"], createRunner: () => makeRunner(trace) })
  );
  const json = await body(res);
  assert.equal(json.blocked, undefined);
  assert.deepEqual(json.uncoveredBuckets, ["orphan-bucket"], "매 응답에 드러낸다");
  assert.equal(trace.previews.length, 1, "진단은 preview 로만 한다");
  assertZeroWrite(trace, "미커버 + dry-run");
});

test("R5 게이트 판정 단위 — real-run 이면서 미커버가 있을 때만 막는다", () => {
  const real = resolveDeletionRunMode({ workerEnabledRaw: "true", featureEnabled: true, requestedDryRun: false });
  const dry = resolveDeletionRunMode({ workerEnabledRaw: "true", featureEnabled: true, requestedDryRun: undefined });
  const off = resolveDeletionRunMode({ workerEnabledRaw: undefined, featureEnabled: true, requestedDryRun: false });
  assert.equal(uncoveredBucketGateBlocks(real, ["x"]), true);
  assert.equal(uncoveredBucketGateBlocks(real, []), false);
  assert.equal(uncoveredBucketGateBlocks(dry, ["x"]), false);
  assert.equal(uncoveredBucketGateBlocks(off, ["x"]), false);
});

// ── R6·R7 lease ─────────────────────────────────────────────────────────────

test("R6 real-run 에서 만료 lease 회수는 claim 이전에 정확히 1회 일어난다", async () => {
  const trace = newTrace();
  await handleAccountDeletionCron(
    req({ method: "POST", secret: SECRET, query: "?dryRun=false" }),
    makeDeps({ trigger: "manual", createRunner: () => makeRunner(trace) })
  );
  assert.equal(trace.reclaim, 1);
  assert.equal(trace.claims.length, 1);
  assert.deepEqual(trace.writes, ["reclaimExpiredLeases", "claimJobs"], "순서도 고정한다");
  assert.equal(trace.previews.length, 0);
});

test("R7 lease 를 쥔 job 은 두 번째 러너가 다시 집지 않는다(중복 claim 방지)", async () => {
  const trace = newTrace();
  const runner = makeRunner(trace); // 두 호출이 같은 fake lease 상태를 공유한다.
  const deps = makeDeps({ trigger: "manual", createRunner: () => runner });
  const realRun = () =>
    handleAccountDeletionCron(req({ method: "POST", secret: SECRET, query: "?dryRun=false" }), deps);

  const first = await body(await realRun());
  const second = await body(await realRun());

  assert.equal(first.claimed, 1);
  assert.equal(second.claimed, 0, "lease 가 살아 있는 동안 같은 job 을 다시 집지 않는다");
  assert.equal(trace.ran.length, 1);
});

test("R7 만료 lease 는 회수 후 다시 집힌다", async () => {
  const trace = newTrace();
  // 죽은 러너가 쥔 lease 를 회수(reclaim)가 푸는 것을 모사한다 —
  // 회수 이전에는 claim 이 비고, 회수 이후에만 job 이 나온다.
  let reclaimed = false;
  const runner: DeletionCronRunner = {
    previewJobs: async (limit) => {
      trace.previews.push(limit);
      return [];
    },
    reclaimExpiredLeases: async () => {
      trace.writes.push("reclaimExpiredLeases");
      trace.reclaim += 1;
      reclaimed = true;
      return 1;
    },
    claimJobs: async (owner, limit, leaseSeconds) => {
      trace.writes.push("claimJobs");
      trace.claims.push({ owner, limit, leaseSeconds });
      return reclaimed ? [{ userId: PII.userId, state: "pending", dryRun: false }] : [];
    },
    runJob: async (job) => {
      trace.ran.push(job);
      if (!job.dryRun) trace.destructive += 1;
      return { ok: true, finalState: job.state, dryRun: job.dryRun };
    },
  };

  const res = await body(
    await handleAccountDeletionCron(
      req({ method: "POST", secret: SECRET, query: "?dryRun=false" }),
      makeDeps({ trigger: "manual", createRunner: () => runner })
    )
  );
  assert.equal(trace.reclaim, 1);
  assert.equal(res.claimed, 1, "만료 회수 뒤에는 다시 집을 수 있어야 한다");
});

test("R9 limit·leaseSeconds 쿼리 정규화는 기존 계약대로 claim 에 전달된다", async () => {
  const trace = newTrace();
  await handleAccountDeletionCron(
    req({ method: "POST", secret: SECRET, query: "?dryRun=false&limit=99&leaseSeconds=10" }),
    makeDeps({ trigger: "manual", createRunner: () => makeRunner(trace) })
  );
  assert.deepEqual(trace.claims[0], { owner: "cron-test-owner", limit: 20, leaseSeconds: 60 });
});

test("R9 dry-run 의 limit 정규화도 동일하게 preview 로 전달된다", async () => {
  const trace = newTrace();
  await handleAccountDeletionCron(
    req({ method: "POST", secret: SECRET, query: "?limit=99" }),
    makeDeps({ trigger: "manual", createRunner: () => makeRunner(trace) })
  );
  assert.deepEqual(trace.previews, [20], "상한 20 — claim 과 같은 정규화");
  assertZeroWrite(trace, "dry-run limit 정규화");
});

// ── R8 PII 무유출 ───────────────────────────────────────────────────────────

/** 응답 전문에서 PII 형태를 훑는다 — 필드 이름이 아니라 값 자체를 본다. */
function assertNoPii(raw: string, label: string) {
  for (const [name, value] of Object.entries(PII)) {
    assert.ok(!raw.includes(value), `${label}: ${name} 유출`);
  }
  assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(raw), `${label}: uuid 형태 유출`);
  assert.ok(!/@[a-z0-9.-]+\.[a-z]{2,}/i.test(raw), `${label}: 이메일 형태 유출`);
  assert.ok(
    !/(student-id-images|profile-avatars|community-post-images|shortform-videos)\//.test(raw),
    `${label}: Storage 경로 유출`
  );
}

test("R8 정상 응답에 userId·email·Storage 경로·job id 가 없다", async () => {
  const res = await handleAccountDeletionCron(
    req({ secret: SECRET }),
    makeDeps({
      createRunner: () =>
        makeRunner(newTrace(), {
          jobs: [{ userId: PII.userId, state: "pending", dryRun: true }],
        }),
    })
  );
  assertNoPii(await res.text(), "정상 응답");
});

test("R8 job 오류 메시지가 PII 를 담고 있어도 응답에는 코드만 남는다", async () => {
  const leaky = new Error(
    `not empty after purge: ${PII.storagePath} (user ${PII.userId}, ${PII.email}, job ${PII.jobId})`
  );
  const res = await handleAccountDeletionCron(
    req({ secret: SECRET }),
    makeDeps({
      createRunner: () => ({
        previewJobs: async () => [{ userId: PII.userId, state: "purging", dryRun: true }],
        reclaimExpiredLeases: async () => 0,
        claimJobs: async () => [{ userId: PII.userId, state: "purging", dryRun: true }],
        runJob: async () => {
          throw leaky;
        },
      }),
    })
  );
  const text = await res.text();
  assertNoPii(text, "job 오류 응답");
  assert.deepEqual((JSON.parse(text) as { errors: string[] }).errors, ["not_empty_after_purge"]);
});

test("R8 claim 실패 500 응답도 원문을 흘리지 않는다", async () => {
  const res = await handleAccountDeletionCron(
    req({ method: "POST", secret: SECRET, query: "?dryRun=false" }),
    makeDeps({
      trigger: "manual",
      createRunner: () => ({
        previewJobs: async () => [],
        reclaimExpiredLeases: async () => 0,
        claimJobs: async () => {
          throw new Error(`claim failed: row ${PII.jobId} for ${PII.email}`);
        },
        runJob: async () => ({ ok: true, finalState: "pending", dryRun: true }),
      }),
    })
  );
  assert.equal(res.status, 500);
  const text = await res.text();
  assertNoPii(text, "claim 실패 응답");
  assert.equal((JSON.parse(text) as { error: string }).error, "claim_failed");
});

test("R8 preview 실패 500 응답도 원문을 흘리지 않는다", async () => {
  const res = await handleAccountDeletionCron(
    req({ secret: SECRET }),
    makeDeps({
      createRunner: () => ({
        previewJobs: async () => {
          throw new Error(`preview failed: ${PII.storagePath} / ${PII.userId}`);
        },
        reclaimExpiredLeases: async () => 0,
        claimJobs: async () => [],
        runJob: async () => ({ ok: true, finalState: "pending", dryRun: true }),
      }),
    })
  );
  assert.equal(res.status, 500);
  const text = await res.text();
  assertNoPii(text, "preview 실패 응답");
  assert.equal((JSON.parse(text) as { error: string }).error, "preview_failed");
});

test("R8 오류 축약 단위 — 안전 코드만 통과시키고 나머지는 job_failed 로 접는다", () => {
  assert.equal(sanitizeDeletionCronError(new Error("uncovered_buckets: a,b")), "uncovered_buckets");
  assert.equal(sanitizeDeletionCronError(new Error("claim failed: x")), "claim_failed");
  assert.equal(sanitizeDeletionCronError(new Error("storage residue 3")), "storage_residue_3");
  assert.equal(sanitizeDeletionCronError(new Error(PII.userId)), "job_failed", "uuid 는 코드가 아니다");
  assert.equal(sanitizeDeletionCronError(new Error(PII.email)), "job_failed");
  assert.equal(sanitizeDeletionCronError(new Error(PII.storagePath)), "job_failed");
  assert.equal(sanitizeDeletionCronError(new Error("deadbeefdeadbeefdeadbeef")), "job_failed", "긴 hex 차단");
  assert.equal(sanitizeDeletionCronError("plain string"), "plain_string");
  assert.equal(sanitizeDeletionCronError(undefined), "job_failed");
  assert.equal(sanitizeDeletionCronError({ message: "x" }), "job_failed");
});

test("R8 운영 로그 meta 에도 PII 를 싣지 않는다", async () => {
  const logged: Array<{ message: string; meta: Record<string, unknown> }> = [];
  await handleAccountDeletionCron(
    req({ secret: SECRET }),
    makeDeps({ log: (message, meta) => logged.push({ message, meta }) })
  );
  assert.ok(logged.length > 0, "완료 로그는 남긴다");
  assertNoPii(JSON.stringify(logged), "운영 로그");
});

// ── 러너 생성 실패 ──────────────────────────────────────────────────────────

test("createRunner 가 던지면 500 server_config — 부분 실행으로 넘어가지 않는다", async () => {
  const res = await handleAccountDeletionCron(
    req({ secret: SECRET }),
    makeDeps({
      createRunner: () => {
        throw new Error("SUPABASE_SERVICE_ROLE_KEY missing");
      },
    })
  );
  assert.equal(res.status, 500);
  assert.deepEqual(await body(res), { ok: false, error: "server_config" });
});

// ── R10 응답 카운터 — claimed vs succeeded/failed ────────────────────────────

/**
 * job 별 결말을 대본으로 지정하는 fake.
 *   "ok"      → { ok:true }
 *   "stopped" → **예외 없이** { ok:false, stopped:… }  ← 워커의 실제 실패 경로 대부분
 *   "throw"   → runJob 이 throw
 * 워커는 uncovered_buckets · ownership_conflict · unattributable · session_revoke ·
 * residue · not_empty 를 전부 던지지 않고 ok:false 로 돌려준다. 그 사실을 대본으로 고정한다.
 */
type Outcome = "ok" | "stopped" | "throw";

function makeScriptedRunner(trace: Trace, script: readonly Outcome[]): DeletionCronRunner {
  const pool: CronClaimedJob[] = script.map(() => ({
    userId: PII.userId,
    state: "pending",
    dryRun: false,
  }));
  let seen = 0;
  return {
    previewJobs: async (limit) => {
      trace.previews.push(limit);
      return pool.slice(0, limit);
    },
    reclaimExpiredLeases: async () => {
      trace.writes.push("reclaimExpiredLeases");
      trace.reclaim += 1;
      return 0;
    },
    claimJobs: async (owner, limit, leaseSeconds) => {
      trace.writes.push("claimJobs");
      trace.claims.push({ owner, limit, leaseSeconds });
      return pool.slice(0, limit);
    },
    runJob: async (job) => {
      trace.ran.push(job);
      const outcome = script[seen++] ?? "ok";
      // lease 는 이미 잡힌 뒤다 — 어떤 결말이든 claimed 에서 빠지면 안 된다.
      if (outcome === "throw") throw new Error(`storage residue: ${PII.storagePath}`);
      if (outcome === "stopped") {
        // 워커의 non-throwing 실패: 상태 전이 없이 멈춘다.
        return { ok: false, finalState: "purging", dryRun: job.dryRun, stopped: "residue" };
      }
      if (!job.dryRun) trace.destructive += 1;
      return { ok: true, finalState: "completed", dryRun: job.dryRun };
    },
  };
}

function realRunReq() {
  return req({ method: "POST", secret: SECRET, query: "?dryRun=false" });
}

/** 응답 카운터 전체를 한 번에 단언한다. */
function assertCounters(
  json: Record<string, unknown>,
  want: {
    claimed: number;
    previewed: number;
    succeeded: number;
    stopped: number;
    errored: number;
    failed: number;
    ok: boolean;
  },
  label: string
) {
  assert.deepEqual(
    {
      claimed: json.claimed,
      previewed: json.previewed,
      succeeded: json.succeeded,
      stopped: json.stopped,
      errored: json.errored,
      failed: json.failed,
      ok: json.ok,
    },
    want,
    label
  );
}

test("R10 real-run 3건 claim · 전부 성공", async () => {
  const trace = newTrace();
  const json = await body(
    await handleAccountDeletionCron(
      realRunReq(),
      makeDeps({ trigger: "manual", createRunner: () => makeScriptedRunner(trace, ["ok", "ok", "ok"]) })
    )
  );
  assertCounters(
    json,
    { claimed: 3, previewed: 0, succeeded: 3, stopped: 0, errored: 0, failed: 0, ok: true },
    "전부 성공"
  );
});

test("R10 non-throwing 실패 — 1건 claim · result.ok=false · throw 없음 → failed 1 · ok false", async () => {
  const trace = newTrace();
  const json = await body(
    await handleAccountDeletionCron(
      realRunReq(),
      makeDeps({ trigger: "manual", createRunner: () => makeScriptedRunner(trace, ["stopped"]) })
    )
  );
  // 워커의 residue·session_revoke·uncovered 계열은 던지지 않고 ok:false 로 돌아온다.
  // results.length 를 succeeded 로 세면 이게 성공 1건 · ok:true 로 집계됐었다.
  assertCounters(
    json,
    { claimed: 1, previewed: 0, succeeded: 0, stopped: 1, errored: 0, failed: 1, ok: false },
    "non-throwing 실패"
  );
  assert.deepEqual(json.errors, [], "throw 가 아니므로 errors 는 비어 있다");
  const results = json.results as Array<Record<string, unknown>>;
  assert.equal(results[0]!.ok, false, "사유는 results[].ok / stopped 로 확인한다");
  assert.equal(results[0]!.stopped, "residue");
});

test("R10 혼합 — 3건 claim · ok 1 · stopped 1 · throw 1", async () => {
  const trace = newTrace();
  const json = await body(
    await handleAccountDeletionCron(
      realRunReq(),
      makeDeps({
        trigger: "manual",
        createRunner: () => makeScriptedRunner(trace, ["ok", "stopped", "throw"]),
      })
    )
  );
  assertCounters(
    json,
    { claimed: 3, previewed: 0, succeeded: 1, stopped: 1, errored: 1, failed: 2, ok: false },
    "혼합 결말"
  );
  assert.equal(trace.ran.length, 3, "claim 한 3건 모두 실행을 시도한다");
  assert.deepEqual(json.errors, ["storage_residue"], "errors 는 throw 한 것만 담는다");
});

test("R10 real-run 1건 claim · 1건 throw → claimed 1 · errored 1", async () => {
  const trace = newTrace();
  const json = await body(
    await handleAccountDeletionCron(
      realRunReq(),
      makeDeps({ trigger: "manual", createRunner: () => makeScriptedRunner(trace, ["throw"]) })
    )
  );
  assertCounters(
    json,
    { claimed: 1, previewed: 0, succeeded: 0, stopped: 0, errored: 1, failed: 1, ok: false },
    "단건 throw"
  );
  assert.deepEqual(json.results, [], "결과 없음 — 사유는 errors[] 에 있다");
});

test("R10 불변식 claimed = succeeded + stopped + errored = succeeded + failed", async () => {
  const scripts: Outcome[][] = [
    ["ok"],
    ["stopped"],
    ["throw"],
    ["ok", "stopped", "throw"],
    ["stopped", "stopped", "throw", "ok", "ok"],
    ["throw", "throw", "throw"],
  ];
  for (const script of scripts) {
    const trace = newTrace();
    const json = await body(
      await handleAccountDeletionCron(
        realRunReq(),
        makeDeps({ trigger: "manual", createRunner: () => makeScriptedRunner(trace, script) })
      )
    );
    const n = (k: string) => json[k] as number;
    const label = script.join("+");
    assert.equal(n("claimed"), script.length, label);
    assert.equal(n("claimed"), n("succeeded") + n("stopped") + n("errored"), label);
    assert.equal(n("claimed"), n("succeeded") + n("failed"), label);
    assert.equal(n("failed"), n("stopped") + n("errored"), label);
    assert.equal(json.ok, n("failed") === 0, `${label}: ok 는 failed 0 일 때만 true`);
  }
});

test("R10 dry-run preview 3건 → claimed 0 · previewed 3 · DB write 0", async () => {
  const trace = newTrace();
  const json = await body(
    await handleAccountDeletionCron(
      req({ secret: SECRET }),
      makeDeps({ createRunner: () => makeScriptedRunner(trace, ["ok", "ok", "ok"]) })
    )
  );
  assertCounters(
    json,
    { claimed: 0, previewed: 3, succeeded: 3, stopped: 0, errored: 0, failed: 0, ok: true },
    "dry-run preview 3건"
  );
  assertZeroWrite(trace, "dry-run preview 3건");
});

test("R10 dry-run 도 non-throwing 실패를 성공으로 세지 않는다", async () => {
  const trace = newTrace();
  const json = await body(
    await handleAccountDeletionCron(
      req({ secret: SECRET }),
      makeDeps({ createRunner: () => makeScriptedRunner(trace, ["ok", "stopped"]) })
    )
  );
  assertCounters(
    json,
    { claimed: 0, previewed: 2, succeeded: 1, stopped: 1, errored: 0, failed: 1, ok: false },
    "dry-run 혼합"
  );
  assertZeroWrite(trace, "dry-run 혼합");
});

test("R10 disabled → 실행 카운터 전부 0", async () => {
  for (const over of [{ workerEnabledRaw: undefined }, { featureEnabled: false }]) {
    const trace = newTrace();
    const json = await body(
      await handleAccountDeletionCron(
        req({ secret: SECRET }),
        makeDeps({ createRunner: () => makeScriptedRunner(trace, ["ok", "ok", "ok"]), ...over })
      )
    );
    assert.equal(json.disabled, true, JSON.stringify(over));
    for (const key of ["claimed", "previewed", "succeeded", "stopped", "errored", "failed"]) {
      assert.equal(json[key], 0, `${JSON.stringify(over)}: ${key}`);
    }
    assert.equal(trace.previews.length, 0);
    assertZeroWrite(trace, JSON.stringify(over));
  }
});

test("R10 uncovered bucket route-level 차단도 실행 카운터 전부 0", async () => {
  const trace = newTrace();
  const json = await body(
    await handleAccountDeletionCron(
      realRunReq(),
      makeDeps({
        trigger: "manual",
        uncoveredBuckets: ["orphan-bucket"],
        createRunner: () => makeScriptedRunner(trace, ["ok", "ok", "ok"]),
      })
    )
  );
  assert.equal(json.blocked, "uncovered_buckets");
  for (const key of ["claimed", "previewed", "succeeded", "stopped", "errored", "failed"]) {
    assert.equal(json[key], 0, key);
  }
  assert.equal(trace.previews.length, 0);
  assertZeroWrite(trace, "uncovered 차단");
});

test("R10 운영 로그에도 다섯 카운터가 모두 실린다(PII 없이)", async () => {
  const logged: Array<{ message: string; meta: Record<string, unknown> }> = [];
  const trace = newTrace();
  await handleAccountDeletionCron(
    realRunReq(),
    makeDeps({
      trigger: "manual",
      createRunner: () => makeScriptedRunner(trace, ["ok", "stopped", "throw"]),
      log: (message, meta) => logged.push({ message, meta }),
    })
  );
  const done = logged.find((l) => l.message === "account_deletion_cron_done");
  assert.ok(done, "완료 로그가 있다");
  assert.equal(done!.meta.claimed, 3);
  assert.equal(done!.meta.succeeded, 1);
  assert.equal(done!.meta.stopped, 1);
  assert.equal(done!.meta.errored, 1);
  assert.equal(done!.meta.failed, 2);
  assertNoPii(JSON.stringify(logged), "카운터 로그");
});

// ── 기타 ────────────────────────────────────────────────────────────────────

test("응답은 호출 출처를 밝혀 스케줄·수동 실행을 로그에서 구분할 수 있게 한다", async () => {
  for (const trigger of ["scheduled", "manual"] as DeletionCronTrigger[]) {
    const res = await handleAccountDeletionCron(req({ secret: SECRET }), makeDeps({ trigger }));
    assert.equal((await body(res)).trigger, trigger);
  }
});
