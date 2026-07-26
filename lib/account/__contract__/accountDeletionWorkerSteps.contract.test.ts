// 계약 테스트: 계정 삭제 saga worker 단계 순서·게이트.
// 실행: node --test --experimental-strip-types lib/account/__contract__/accountDeletionWorkerSteps.contract.test.ts
//
// preflight 실측: 이 파일 이전에는 단계 순서·dry-run 정지선·revoke 선행·잔여/빈상태
// 게이트·catch→recordError 경로를 고정하는 테스트가 **하나도 없었다**.
// DB 계약(전이표·forfeit 상태 게이트·동의 3층)은 SQL 쪽이 강제하므로 여기서는 워커 로직만 고정한다.
//
// W5 보정 반영:
//   §3-1 dry-run = read-only planner (claim·advance·revoke·remove 0회)
//   §3-2 pending→locked 는 beginLocked(동의·잔액 원자 검증)로만
//   §3-4 미커버 버킷이 있으면 real-run 시작 0 · storage_purged 전이 0

import test from "node:test";
import assert from "node:assert/strict";
import { runAccountDeletionJob, planAccountDeletion, type DeletionDeps } from "../accountDeletionWorker.ts";
import type { StorageObjectRef } from "../accountDeletionPurgePlan.ts";

type Calls = string[];

function makeDeps(calls: Calls, over: Partial<DeletionDeps> = {}): DeletionDeps {
  return {
    beginLocked: async () => {
      calls.push("beginLocked");
      return { ok: true };
    },
    advance: async (_u, from, to) => {
      calls.push(`advance:${from}->${to}`);
      return true;
    },
    recordError: async (_u, err) => {
      calls.push(`recordError:${err}`);
    },
    revokeSessions: async () => {
      calls.push("revokeSessions");
      return { ok: true };
    },
    gatherDbRefs: async () => {
      calls.push("gatherDbRefs");
      return [] as StorageObjectRef[];
    },
    listInventory: async () => {
      calls.push("listInventory");
      return [] as StorageObjectRef[];
    },
    uncoveredBuckets: async () => {
      calls.push("uncoveredBuckets");
      return [];
    },
    removeObjects: async (refs) => {
      calls.push(`removeObjects:${refs.length}`);
      return refs.map((r) => `${r.bucket}/${r.path}`);
    },
    forfeitWalletAndAnonymize: async () => {
      calls.push("forfeit");
    },
    authSoftDelete: async () => {
      calls.push("authSoftDelete");
    },
    ...over,
  };
}

// ── §3-2 / 취소 창 ───────────────────────────────────────────────────────────

test("pending: 취소 窓 미경과(beginLocked=CANCEL_WINDOW_OPEN) → 아무 파괴 동작 없이 정지", async () => {
  const calls: Calls = [];
  const deps = makeDeps(calls, {
    beginLocked: async () => {
      calls.push("beginLocked");
      return { ok: false, code: "CANCEL_WINDOW_OPEN" };
    },
  });
  const result = await runAccountDeletionJob({ userId: "u1", state: "pending", dryRun: false }, deps);

  assert.equal(result.stopped, "CANCEL_WINDOW_OPEN");
  assert.equal(result.ok, true, "취소창 대기는 오류가 아니다");
  assert.ok(!calls.includes("revokeSessions"));
  assert.ok(!calls.some((c) => c.startsWith("removeObjects")));
  assert.ok(!calls.includes("forfeit"));
  assert.ok(!calls.includes("authSoftDelete"));
  assert.ok(!calls.some((c) => c.startsWith("recordError")), "정상 대기는 오류로 기록하지 않는다");
});

test("pending: 동의 없음(FORFEIT_CONSENT_REQUIRED) → 전이·세션폐기·삭제 전부 0", async () => {
  const calls: Calls = [];
  const deps = makeDeps(calls, {
    beginLocked: async () => {
      calls.push("beginLocked");
      return { ok: false, code: "FORFEIT_CONSENT_REQUIRED" };
    },
  });
  const result = await runAccountDeletionJob({ userId: "u1", state: "pending", dryRun: false }, deps);

  assert.equal(result.ok, false);
  assert.equal(result.stopped, "FORFEIT_CONSENT_REQUIRED");
  assert.equal(result.finalState, "pending", "job 은 pending 그대로");
  assert.ok(!calls.some((c) => c.startsWith("advance")), "advance 0회");
  assert.ok(!calls.includes("revokeSessions"), "session revoke 0회");
  assert.ok(!calls.some((c) => c.startsWith("removeObjects")), "Storage remove 0회");
  assert.ok(!calls.includes("forfeit"), "몰수·익명화 0회");
  assert.ok(calls.some((c) => c.startsWith("recordError")));
});

test("pending: 동의 stale(FORFEIT_CONSENT_STALE) → 파괴 단계 0회", async () => {
  const calls: Calls = [];
  const deps = makeDeps(calls, {
    beginLocked: async () => {
      calls.push("beginLocked");
      return { ok: false, code: "FORFEIT_CONSENT_STALE" };
    },
  });
  const result = await runAccountDeletionJob({ userId: "u1", state: "pending", dryRun: false }, deps);

  assert.equal(result.stopped, "FORFEIT_CONSENT_STALE");
  assert.equal(result.finalState, "pending");
  assert.ok(!calls.some((c) => c.startsWith("advance")));
  assert.ok(!calls.includes("revokeSessions"));
  assert.ok(!calls.some((c) => c.startsWith("removeObjects")));
});

test("pending→locked 은 raw advance 가 아니라 beginLocked 로만 간다", async () => {
  const calls: Calls = [];
  const deps = makeDeps(calls);
  await runAccountDeletionJob({ userId: "u1", state: "pending", dryRun: false }, deps);

  assert.ok(calls.includes("beginLocked"));
  assert.ok(!calls.includes("advance:pending->locked"), "raw advance 우회 0");
  assert.ok(calls.indexOf("beginLocked") < calls.indexOf("revokeSessions"), "검증이 세션 폐기보다 먼저");
});

test("locked: 세션 revoke 실패 → purging 으로 진행하지 않는다(INV-5)", async () => {
  const calls: Calls = [];
  const deps = makeDeps(calls, {
    revokeSessions: async () => {
      calls.push("revokeSessions");
      return { ok: false, error: "session_revoke_unsupported" };
    },
  });
  const result = await runAccountDeletionJob({ userId: "u1", state: "locked", dryRun: false }, deps);

  assert.equal(result.ok, false, "폐기 실패가 성공으로 보고되지 않는다");
  assert.equal(result.stopped, "session_revoke");
  assert.ok(!calls.includes("advance:locked->purging"), "revoke 실패 시 전이 금지");
  assert.ok(calls.some((c) => c.startsWith("recordError")));
  assert.ok(!calls.some((c) => c.startsWith("removeObjects")), "폐기 실패 시 purging 진입 0");
});

// ── §3-1 dry-run = read-only planner ────────────────────────────────────────

test("dry-run: claim·advance·revoke·remove 0회, 계획만 반환", async () => {
  const calls: Calls = [];
  const plan: StorageObjectRef[] = [{ bucket: "student-id-images", path: "u1/a.png" }];
  const deps = makeDeps(calls, { listInventory: async () => plan });
  const result = await runAccountDeletionJob({ userId: "u1", state: "purging", dryRun: true }, deps);

  assert.equal(result.stopped, "dry_run");
  assert.equal(result.ok, true);
  assert.equal(result.plan?.length, 1, "계획은 만든다");
  assert.ok(!calls.some((c) => c.startsWith("advance")), "advance 어댑터 호출 0회");
  assert.ok(!calls.includes("beginLocked"), "job claim/전이 0회");
  assert.ok(!calls.includes("revokeSessions"), "revokeSessions 어댑터 호출 0회");
  assert.ok(!calls.some((c) => c.startsWith("removeObjects")), "removeObjects 0회");
  assert.ok(!calls.includes("forfeit"), "몰수·익명화 0");
  assert.ok(!calls.includes("authSoftDelete"), "auth 삭제 0");
});

test("dry-run: pending 상태에서 불러도 상태 전이·세션 폐기 0회", async () => {
  const calls: Calls = [];
  const deps = makeDeps(calls);
  const result = await runAccountDeletionJob({ userId: "u1", state: "pending", dryRun: true }, deps);

  assert.equal(result.finalState, "pending", "dry-run 후 job state 불변");
  assert.equal(result.stopped, "dry_run");
  assert.ok(!calls.includes("beginLocked"));
  assert.ok(!calls.some((c) => c.startsWith("advance")));
  assert.ok(!calls.includes("revokeSessions"));
});

test("dry-run: locked 상태에서 불러도 부수효과 0", async () => {
  const calls: Calls = [];
  const deps = makeDeps(calls);
  const result = await runAccountDeletionJob({ userId: "u1", state: "locked", dryRun: true }, deps);

  assert.equal(result.finalState, "locked");
  assert.ok(!calls.some((c) => c.startsWith("advance")));
  assert.ok(!calls.includes("revokeSessions"));
  assert.ok(!calls.some((c) => c.startsWith("removeObjects")));
});

test("dry-run 계획과 real-run 삭제 대상이 동일하다(§3-1 계약 6 — 같은 산출 함수)", async () => {
  const inventory: StorageObjectRef[] = [
    { bucket: "student-id-images", path: "u1/a.png" },
    { bucket: "profile-avatars", path: "u1/b.png" },
  ];
  const dbRefs: StorageObjectRef[] = [{ bucket: "question-room-attachments", path: "r1/t1/c.png" }];

  const dryCalls: Calls = [];
  const dryDeps = makeDeps(dryCalls, {
    listInventory: async () => inventory,
    gatherDbRefs: async () => dbRefs,
  });
  const dry = await runAccountDeletionJob({ userId: "u1", state: "purging", dryRun: true }, dryDeps);

  const realCalls: Calls = [];
  let removedTargets: StorageObjectRef[] = [];
  let listCount = 0;
  const realDeps = makeDeps(realCalls, {
    listInventory: async () => {
      listCount += 1;
      return listCount === 1 ? inventory : [];
    },
    gatherDbRefs: async () => (listCount <= 1 ? dbRefs : []),
    removeObjects: async (refs) => {
      removedTargets = [...refs];
      return refs.map((r) => `${r.bucket}/${r.path}`);
    },
  });
  await runAccountDeletionJob({ userId: "u1", state: "purging", dryRun: false }, realDeps);

  assert.deepEqual(
    removedTargets.map((r) => `${r.bucket}/${r.path}`),
    (dry.plan ?? []).map((r) => `${r.bucket}/${r.path}`)
  );
});

test("planAccountDeletion 은 계획과 미커버 목록을 함께 돌려준다(§3-1 계약 5)", async () => {
  const calls: Calls = [];
  const deps = makeDeps(calls, {
    listInventory: async () => [{ bucket: "profile-avatars", path: "u1/a.png" }],
    uncoveredBuckets: async () => ["mystery-bucket"],
  });
  const plan = await planAccountDeletion("u1", deps);

  assert.equal(plan.refs.length, 1);
  assert.deepEqual(plan.uncoveredBuckets, ["mystery-bucket"]);
});

// ── §3-4 미커버 버킷 게이트 ──────────────────────────────────────────────────

test("미커버 버킷이 있으면 real-run 을 시작조차 하지 않는다", async () => {
  const calls: Calls = [];
  const deps = makeDeps(calls, { uncoveredBuckets: async () => ["shortform-videos"] });
  const result = await runAccountDeletionJob({ userId: "u1", state: "pending", dryRun: false }, deps);

  assert.equal(result.ok, false);
  assert.equal(result.stopped, "uncovered_buckets");
  assert.deepEqual(result.uncoveredBuckets, ["shortform-videos"]);
  assert.ok(!calls.includes("beginLocked"), "real-run 시작 0");
  assert.ok(!calls.some((c) => c.startsWith("advance")));
  assert.ok(!calls.includes("revokeSessions"));
  assert.ok(!calls.some((c) => c.startsWith("removeObjects")));
  assert.ok(calls.some((c) => c.startsWith("recordError")), "차단 사유를 record_error 로 남긴다");
});

test("미커버 버킷이 있으면 storage_purged 전이 0 (purging 진행 중에도)", async () => {
  const calls: Calls = [];
  const deps = makeDeps(calls, { uncoveredBuckets: async () => ["connection-note-ink"] });
  const result = await runAccountDeletionJob({ userId: "u1", state: "purging", dryRun: false }, deps);

  assert.ok(!calls.includes("advance:purging->storage_purged"));
  assert.equal(result.stopped, "uncovered_buckets");
});

test("재조회 시점에 미커버가 생기면 storage_purged 로 넘어가지 않는다", async () => {
  const calls: Calls = [];
  let uncoveredCall = 0;
  const deps = makeDeps(calls, {
    listInventory: async () => [],
    uncoveredBuckets: async () => {
      uncoveredCall += 1;
      // 시작 게이트·계획 산출까지는 비어 있다가 재검증에서 드러나는 경우.
      return uncoveredCall >= 3 ? ["late-bucket"] : [];
    },
  });
  const result = await runAccountDeletionJob({ userId: "u1", state: "purging", dryRun: false }, deps);

  assert.equal(result.stopped, "uncovered_buckets");
  assert.ok(!calls.includes("advance:purging->storage_purged"));
});

test("잔존 객체가 있으면 completed 에 도달하지 않는다", async () => {
  const calls: Calls = [];
  const plan: StorageObjectRef[] = [{ bucket: "student-id-images", path: "u1/a.png" }];
  const deps = makeDeps(calls, { listInventory: async () => plan });
  const result = await runAccountDeletionJob({ userId: "u1", state: "purging", dryRun: false }, deps);

  assert.equal(result.stopped, "not_empty");
  assert.notEqual(result.finalState, "completed");
  assert.ok(!calls.includes("advance:purging->storage_purged"));
});

// ── 기존 purge 게이트 회귀 방지 ──────────────────────────────────────────────

test("purge 잔여가 있으면 storage_purged 로 넘어가지 않는다", async () => {
  const calls: Calls = [];
  const plan: StorageObjectRef[] = [{ bucket: "student-id-images", path: "u1/a.png" }];
  const deps = makeDeps(calls, {
    listInventory: async () => plan,
    removeObjects: async () => {
      calls.push("removeObjects:partial");
      return []; // 아무것도 못 지움 → 전건 잔여
    },
  });
  const result = await runAccountDeletionJob({ userId: "u1", state: "purging", dryRun: false }, deps);

  assert.equal(result.ok, false);
  assert.equal(result.stopped, "residue");
  assert.ok(!calls.includes("advance:purging->storage_purged"));
  assert.ok(calls.some((c) => c.startsWith("recordError")));
});

test("삭제는 됐지만 재조회 인벤토리가 비지 않으면 finalized 금지(INV-1)", async () => {
  const calls: Calls = [];
  const plan: StorageObjectRef[] = [{ bucket: "student-id-images", path: "u1/a.png" }];
  let listCount = 0;
  const deps = makeDeps(calls, {
    listInventory: async () => {
      listCount += 1;
      calls.push(`listInventory:${listCount}`);
      // 1회차: 계획용. 2회차(재검증): 여전히 남아 있다.
      return plan;
    },
  });
  const result = await runAccountDeletionJob({ userId: "u1", state: "purging", dryRun: false }, deps);

  assert.equal(result.ok, false);
  assert.equal(result.stopped, "not_empty");
  assert.ok(!calls.includes("advance:purging->storage_purged"));
  assert.equal(listCount, 2, "삭제 후 재조회로 빈 상태를 다시 확인한다");
});

test("removeObjects 가 bucket 접두 없는 key 를 돌려주면 잔여로 잡힌다(어댑터 반환 규약)", async () => {
  const calls: Calls = [];
  const plan: StorageObjectRef[] = [{ bucket: "student-id-images", path: "u1/a.png" }];
  const deps = makeDeps(calls, {
    listInventory: async () => plan,
    removeObjects: async (refs) => refs.map((r) => r.path), // 잘못된 형식(맨 경로)
  });
  const result = await runAccountDeletionJob({ userId: "u1", state: "purging", dryRun: false }, deps);

  assert.equal(result.stopped, "residue", "형식이 어긋나면 삭제됐어도 잔여로 판정된다");
});

test("storage_purged: 몰수·익명화가 finalized 전이보다 먼저, 그리고 한 번에 completed 까지 진행", async () => {
  const calls: Calls = [];
  const deps = makeDeps(calls);
  const result = await runAccountDeletionJob(
    { userId: "u1", state: "storage_purged", dryRun: false },
    deps
  );

  // 워커는 재개 가능한 if-chain 이라 한 번의 실행에서 남은 단계를 이어서 끝낸다.
  assert.deepEqual(calls, [
    "uncoveredBuckets",
    "forfeit",
    "advance:storage_purged->finalized",
    "authSoftDelete",
    "advance:finalized->auth_soft_deleted",
    "advance:auth_soft_deleted->completed",
  ]);
  // 순서 불변식: 몰수·익명화는 finalized 전이보다 앞서야 한다(176 의 storage_purged 게이트와 짝).
  assert.ok(calls.indexOf("forfeit") < calls.indexOf("advance:storage_purged->finalized"));
  // auth 삭제는 finalized 이후에만.
  assert.ok(
    calls.indexOf("advance:storage_purged->finalized") < calls.indexOf("authSoftDelete")
  );
  assert.equal(result.ok, true);
});

test("finalized: auth soft-delete 실패는 예외 → recordError 후 정지(전이 없음)", async () => {
  const calls: Calls = [];
  const deps = makeDeps(calls, {
    authSoftDelete: async () => {
      calls.push("authSoftDelete");
      throw new Error("gotrue down");
    },
  });
  const result = await runAccountDeletionJob({ userId: "u1", state: "finalized", dryRun: false }, deps);

  assert.equal(result.ok, false);
  assert.equal(result.stopped, "error");
  assert.ok(!calls.includes("advance:finalized->auth_soft_deleted"));
  assert.ok(calls.some((c) => c.includes("recordError")));
});

test("auth_soft_deleted → completed 로 마무리", async () => {
  const calls: Calls = [];
  const deps = makeDeps(calls);
  await runAccountDeletionJob({ userId: "u1", state: "auth_soft_deleted", dryRun: false }, deps);
  assert.deepEqual(calls, ["uncoveredBuckets", "advance:auth_soft_deleted->completed"]);
});

test("이미 completed 인 job 재호출은 무해(파괴 동작 0)", async () => {
  const calls: Calls = [];
  const deps = makeDeps(calls);
  const result = await runAccountDeletionJob({ userId: "u1", state: "completed", dryRun: false }, deps);

  assert.equal(result.ok, true);
  assert.ok(!calls.some((c) => c.startsWith("removeObjects")));
  assert.ok(!calls.includes("forfeit"));
  assert.ok(!calls.includes("authSoftDelete"));
});
