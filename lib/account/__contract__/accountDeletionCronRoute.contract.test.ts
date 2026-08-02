// 계약 테스트: 계정 삭제 cron 라우트 배선(S3-A) — GET 스케줄 경로 · POST 수동 경로 공용 게이트.
// 실행: node --test --experimental-strip-types lib/account/__contract__/accountDeletionCronRoute.contract.test.ts
//
// 이 파일은 **실제 job 에 절대 닿지 않는다**. Supabase 클라이언트도, 네트워크도 없다.
// runner 는 전부 fake 이고, "실삭제가 일어났는가"는 fake 가 기록한 호출 흔적으로만 판정한다.
//
// 고정하는 계약:
//   R1 인증 fail-closed — 비밀 미설정·무인증·오답 bearer 는 GET/POST 모두 401.
//   R2 스케줄(GET) real-run 은 **쿼리스트링으로 켜지지 않는다** — 전용 env 만이 스위치.
//   R3 worker env OFF / 기능 플래그 OFF → disabled · claim 0 (job 을 집지도 않는다).
//   R4 기본값은 dry-run — 실삭제 0.
//   R5 미커버 버킷이 있으면 real-run 시작 0(claim 0).
//   R6 만료 lease 회수는 claim 이전에 항상 1회.
//   R7 lease 를 쥔 job 은 두 번째 러너가 다시 집지 않는다.
//   R8 응답 어디에도 uuid·이메일·Storage 경로·job id 가 없다.
//   R9 POST 수동 경로의 기존 계약(?dryRun=false · x-cron-secret · limit/leaseSeconds)은 그대로다.

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
  reclaim: number;
  claims: Array<{ owner: string; limit: number; leaseSeconds: number }>;
  ran: Array<CronClaimedJob>;
  /** dryRun=false 로 실제 파괴 단계에 들어간 job 수 — 0 이어야 하는 테스트가 대부분이다. */
  destructive: number;
};

function newTrace(): Trace {
  return { reclaim: 0, claims: [], ran: [], destructive: 0 };
}

/** lease 를 흉내내는 fake — 같은 job 을 두 번 집지 않고, 만료 회수 후에만 다시 집는다. */
function makeRunner(
  trace: Trace,
  opts: { jobs?: CronClaimedJob[]; leaseHeld?: boolean } = {}
): DeletionCronRunner {
  const pool = opts.jobs ?? [{ userId: PII.userId, state: "pending", dryRun: false }];
  let leased = opts.leaseHeld ?? false;
  return {
    reclaimExpiredLeases: async () => {
      trace.reclaim += 1;
      return 0;
    },
    claimJobs: async (owner, limit, leaseSeconds) => {
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

test("R2 scheduled GET 은 ?dryRun=false 를 무시한다 — 실삭제 0", async () => {
  const trace = newTrace();
  const res = await handleAccountDeletionCron(
    req({ secret: SECRET, query: "?dryRun=false" }),
    makeDeps({ trigger: "scheduled", createRunner: () => makeRunner(trace) })
  );
  const json = await body(res);
  assert.equal(json.dryRun, true);
  assert.equal(json.mode, "dry_run_default");
  assert.equal(trace.destructive, 0, "쿼리스트링만으로 파괴 실행이 시작되면 안 된다");
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
  assert.equal(trace.destructive, 1, "네 관문을 모두 통과했을 때만 claim·실행이 일어난다");
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
    assert.equal(trace.claims.length, 0);
    assert.equal(trace.destructive, 0);
  }
});

// ── R3 kill switch ──────────────────────────────────────────────────────────

test("R3 worker env OFF → disabled · claimed 0 · reclaim 도 하지 않는다", async () => {
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
  assert.equal(trace.reclaim, 0);
  assert.equal(trace.claims.length, 0);
  assert.equal(trace.ran.length, 0);
});

test("R3 기능 플래그 OFF → disabled · claimed 0", async () => {
  const trace = newTrace();
  const res = await handleAccountDeletionCron(
    req({ secret: SECRET }),
    makeDeps({ featureEnabled: false, createRunner: () => makeRunner(trace) })
  );
  const json = await body(res);
  assert.equal(json.disabled, true);
  assert.equal(json.reason, "feature_disabled");
  assert.equal(json.claimed, 0);
  assert.equal(trace.claims.length, 0);
});

test("R3 env 이름은 문서·라우트가 같은 상수를 본다", () => {
  assert.equal(ACCOUNT_DELETION_WORKER_ENABLED_ENV, "ACCOUNT_DELETION_WORKER_ENABLED");
  assert.equal(ACCOUNT_DELETION_SCHEDULED_REAL_RUN_ENV, "ACCOUNT_DELETION_SCHEDULED_REAL_RUN");
});

// ── R4 기본 dry-run ─────────────────────────────────────────────────────────

test("R4 파라미터 없는 기본 요청은 GET·POST 모두 dry-run — 실삭제 0", async () => {
  for (const trigger of ["scheduled", "manual"] as const) {
    const trace = newTrace();
    const res = await handleAccountDeletionCron(
      req({ method: trigger === "scheduled" ? "GET" : "POST", secret: SECRET }),
      makeDeps({ trigger, createRunner: () => makeRunner(trace) })
    );
    const json = await body(res);
    assert.equal(json.mode, "dry_run_default", trigger);
    assert.equal(json.dryRun, true, trigger);
    assert.equal(trace.destructive, 0, trigger);
    assert.equal(trace.ran.length, 1, `${trigger}: 계획 산출은 수행한다`);
    assert.equal(trace.ran[0]!.dryRun, true, trigger);
  }
});

test("R4 명시적 dry-run 요청도 실삭제 0", async () => {
  const trace = newTrace();
  const res = await handleAccountDeletionCron(
    req({ method: "POST", secret: SECRET, query: "?dryRun=true" }),
    makeDeps({ trigger: "manual", createRunner: () => makeRunner(trace) })
  );
  assert.equal((await body(res)).dryRun, true);
  assert.equal(trace.destructive, 0);
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
    assert.equal(trace.claims.length, 0, `${trigger}: claim 0`);
    assert.equal(trace.reclaim, 0, `${trigger}: 게이트가 claim 이전이다`);
    assert.equal(trace.destructive, 0, trigger);
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
  assert.equal(trace.destructive, 0);
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

test("R6 만료 lease 회수는 claim 이전에 정확히 1회 일어난다", async () => {
  const trace = newTrace();
  await handleAccountDeletionCron(
    req({ secret: SECRET }),
    makeDeps({ createRunner: () => makeRunner(trace) })
  );
  assert.equal(trace.reclaim, 1);
  assert.equal(trace.claims.length, 1);
});

test("R7 lease 를 쥔 job 은 두 번째 러너가 다시 집지 않는다(중복 claim 방지)", async () => {
  const trace = newTrace();
  const runner = makeRunner(trace); // 두 호출이 같은 fake lease 상태를 공유한다.
  const deps = makeDeps({ createRunner: () => runner });

  const first = await body(await handleAccountDeletionCron(req({ secret: SECRET }), deps));
  const second = await body(await handleAccountDeletionCron(req({ secret: SECRET }), deps));

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
    reclaimExpiredLeases: async () => {
      trace.reclaim += 1;
      reclaimed = true;
      return 1;
    },
    claimJobs: async (owner, limit, leaseSeconds) => {
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
    await handleAccountDeletionCron(req({ secret: SECRET }), makeDeps({ createRunner: () => runner }))
  );
  assert.equal(trace.reclaim, 1);
  assert.equal(res.claimed, 1, "만료 회수 뒤에는 다시 집을 수 있어야 한다");
});

test("R9 limit·leaseSeconds 쿼리 정규화는 기존 계약대로 claim 에 전달된다", async () => {
  const trace = newTrace();
  await handleAccountDeletionCron(
    req({ method: "POST", secret: SECRET, query: "?limit=99&leaseSeconds=10" }),
    makeDeps({ trigger: "manual", createRunner: () => makeRunner(trace) })
  );
  assert.deepEqual(trace.claims[0], { owner: "cron-test-owner", limit: 20, leaseSeconds: 60 });
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
    req({ secret: SECRET }),
    makeDeps({
      createRunner: () => ({
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

// ── 기타 ────────────────────────────────────────────────────────────────────

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

test("응답은 호출 출처를 밝혀 스케줄·수동 실행을 로그에서 구분할 수 있게 한다", async () => {
  for (const trigger of ["scheduled", "manual"] as DeletionCronTrigger[]) {
    const res = await handleAccountDeletionCron(req({ secret: SECRET }), makeDeps({ trigger }));
    assert.equal((await body(res)).trigger, trigger);
  }
});
