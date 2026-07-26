// 계약 테스트: 계정 삭제 saga worker 단계 순서·게이트.
// 실행: node --test --experimental-strip-types lib/account/__contract__/accountDeletionWorkerSteps.contract.test.ts
//
// preflight 실측: 이 파일 이전에는 단계 순서·dry-run 정지선·revoke 선행·잔여/빈상태
// 게이트·catch→recordError 경로를 고정하는 테스트가 **하나도 없었다**.
// DB 계약(전이표·forfeit 상태 게이트)은 SQL 쪽이 강제하므로 여기서는 워커 로직만 고정한다.

import test from "node:test";
import assert from "node:assert/strict";
import { runAccountDeletionJob, type DeletionDeps } from "../accountDeletionWorker.ts";
import type { StorageObjectRef } from "../accountDeletionPurgePlan.ts";

type Calls = string[];

function makeDeps(calls: Calls, over: Partial<DeletionDeps> = {}): DeletionDeps {
  return {
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

test("pending: 취소 窓 미경과(advance=false) → 아무 파괴 동작 없이 정지", async () => {
  const calls: Calls = [];
  const deps = makeDeps(calls, { advance: async () => false });
  const result = await runAccountDeletionJob({ userId: "u1", state: "pending", dryRun: false }, deps);

  assert.equal(result.stopped, "cancel_window");
  assert.equal(result.ok, true);
  assert.ok(!calls.includes("revokeSessions"));
  assert.ok(!calls.some((c) => c.startsWith("removeObjects")));
  assert.ok(!calls.includes("forfeit"));
  assert.ok(!calls.includes("authSoftDelete"));
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

  assert.equal(result.ok, false);
  assert.equal(result.stopped, "session_revoke");
  assert.ok(!calls.includes("advance:locked->purging"), "revoke 실패 시 전이 금지");
  assert.ok(calls.some((c) => c.startsWith("recordError")));
  assert.ok(!calls.some((c) => c.startsWith("removeObjects")));
});

test("dry-run 정지선: 삭제·몰수·익명화·auth 삭제 0회", async () => {
  const calls: Calls = [];
  const plan: StorageObjectRef[] = [{ bucket: "student-id-images", path: "u1/a.png" }];
  const deps = makeDeps(calls, { listInventory: async () => plan });
  const result = await runAccountDeletionJob({ userId: "u1", state: "purging", dryRun: true }, deps);

  assert.equal(result.stopped, "dry_run");
  assert.equal(result.ok, true);
  assert.equal(result.plan?.length, 1, "계획은 만든다");
  assert.ok(!calls.some((c) => c.startsWith("removeObjects")), "삭제 0");
  assert.ok(!calls.includes("forfeit"), "몰수·익명화 0");
  assert.ok(!calls.includes("authSoftDelete"), "auth 삭제 0");
  assert.ok(!calls.includes("advance:purging->storage_purged"), "상태 전진 0");
});

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
    "forfeit",
    "advance:storage_purged->finalized",
    "authSoftDelete",
    "advance:finalized->auth_soft_deleted",
    "advance:auth_soft_deleted->completed",
  ]);
  // 순서 불변식: 몰수·익명화는 finalized 전이보다 앞서야 한다(154 의 storage_purged 게이트와 짝).
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
  assert.deepEqual(calls, ["advance:auth_soft_deleted->completed"]);
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
