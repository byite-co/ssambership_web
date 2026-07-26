// 계약 테스트: W5-c §3-3-b — storage.objects.owner_id 실측 기반 소유 분류·차단 관문.
// 실행: node --test --experimental-strip-types lib/account/__contract__/accountDeletionOwnershipClassification.contract.test.ts
//
// 분기 근거(staging lbeqxarxothkmzqvpudy, 2026-07-26 전수 실측): 13버킷 중 7버킷 with_owner > 0
// (community-post-images 64/64 · custom-order-deliverables 2/2 · custom-request-application-attachments 2/2
//  · custom-request-post-attachments 2/2 · profile-avatars 1/1 · question-room-attachments 7/7
//  · student-id-images 1/1), individual-question-attachments 5건 전부 owner NULL(전부 DB 조인 커버),
// 나머지 5버킷 객체 0. → 지시서 §3-3 분기 (b): owner 합집합 수집 + 4분류 + 차단 배선.
//
// 분류표(§3-3-b):
//   DB 조인 O · owner 일치(또는 미기록)  → 정상 삭제 대상
//   DB 조인 O · owner 존재·불일치        → OWNERSHIP_CONFLICT (차단)
//   DB 조인 X · owner = 대상             → owner 귀속 삭제 대상(별도 표기)
//   수집됐으나 셋 다 아님(커버 버킷 내)   → UNATTRIBUTABLE (차단)
// 차단 ≥ 1 → real-run 시작 0 · purging→storage_purged 전이 0 · record_error
// (미커버 버킷 차단과 동일 관문).

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDeletionPlan,
  storageObjectKey,
  type ObjectOwnership,
  type StorageObjectRef,
} from "../accountDeletionPurgePlan.ts";
import { runAccountDeletionJob, type DeletionDeps } from "../accountDeletionWorker.ts";

const UID = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

function ownership(input: {
  ownedByUser?: StorageObjectRef[];
  owners?: Array<[StorageObjectRef, string | null]>;
}): ObjectOwnership {
  return {
    ownedByUser: input.ownedByUser ?? [],
    owners: new Map((input.owners ?? []).map(([r, o]) => [storageObjectKey(r), o])),
  };
}

// ── 순수 분류 ────────────────────────────────────────────────────────────────

test("분류표 스냅샷: 4분류가 지시서 표와 일치한다(§3-3-b)", () => {
  const dbOwnerMatch = { bucket: "question-room-attachments", path: "r1/a.png" };
  const dbOwnerNull = { bucket: "individual-question-attachments", path: "q1/b.pdf" };
  const dbOwnerOther = { bucket: "custom-order-deliverables", path: "o1/c.zip" };
  const ownerOnly = { bucket: "community-post-images", path: `${UID}/d.png` };
  const inventoryOrphan = { bucket: "profile-avatars", path: `${UID}/e.png` };

  const plan = buildDeletionPlan({
    userId: UID,
    dbRefs: [dbOwnerMatch, dbOwnerNull, dbOwnerOther],
    inventory: [inventoryOrphan],
    uncoveredBuckets: [],
    ownership: ownership({
      ownedByUser: [ownerOnly],
      owners: [
        [dbOwnerMatch, UID], // DB O · owner 일치 → 정상
        [dbOwnerNull, null], // DB O · owner 미기록(실측: individual-question-attachments) → 정상
        [dbOwnerOther, OTHER], // DB O · owner 불일치 → OWNERSHIP_CONFLICT
        [inventoryOrphan, null], // 인벤토리만 · owner 없음 → UNATTRIBUTABLE
      ],
    }),
  });

  assert.deepEqual(plan.refs.map(storageObjectKey), [
    `community-post-images/${UID}/d.png`,
    "individual-question-attachments/q1/b.pdf",
    "question-room-attachments/r1/a.png",
  ]);
  assert.deepEqual(plan.ownerAttributed.map(storageObjectKey), [
    `community-post-images/${UID}/d.png`,
  ]);
  assert.deepEqual(
    plan.ownershipConflicts.map((c) => ({ key: storageObjectKey(c), ownerId: c.ownerId })),
    [{ key: "custom-order-deliverables/o1/c.zip", ownerId: OTHER }]
  );
  assert.deepEqual(plan.unattributable.map(storageObjectKey), [
    `profile-avatars/${UID}/e.png`,
  ]);
});

test("충돌 객체는 삭제 대상(refs)에 들어가지 않는다 — 과삭제는 미삭제보다 나쁘다", () => {
  const conflicted = { bucket: "custom-order-deliverables", path: "o1/c.zip" };
  const plan = buildDeletionPlan({
    userId: UID,
    dbRefs: [conflicted],
    inventory: [],
    uncoveredBuckets: [],
    ownership: ownership({ owners: [[conflicted, OTHER]] }),
  });
  assert.equal(plan.refs.length, 0);
  assert.equal(plan.ownershipConflicts.length, 1);
});

test("DB 조인 O 인데 storage 행이 없으면(owner 미확인) 정상 대상 — remove 는 no-op 으로 수렴", () => {
  const ghost = { bucket: "question-room-attachments", path: "r1/gone.png" };
  const plan = buildDeletionPlan({
    userId: UID,
    dbRefs: [ghost],
    inventory: [],
    uncoveredBuckets: [],
    ownership: ownership({}),
  });
  assert.deepEqual(plan.refs.map(storageObjectKey), ["question-room-attachments/r1/gone.png"]);
  assert.equal(plan.unattributable.length, 0);
});

test("ownedByUser 목록은 owners 맵에 없어도 owner 귀속으로 수집된다(전 버킷 owner 축)", () => {
  const owned = { bucket: "scan-annotations", path: "s1/ink.png" };
  const plan = buildDeletionPlan({
    userId: UID,
    dbRefs: [],
    inventory: [],
    uncoveredBuckets: [],
    ownership: ownership({ ownedByUser: [owned] }),
  });
  assert.deepEqual(plan.refs.map(storageObjectKey), ["scan-annotations/s1/ink.png"]);
  assert.deepEqual(plan.ownerAttributed.map(storageObjectKey), ["scan-annotations/s1/ink.png"]);
});

test("ownership 없이 부르면 구 합집합 계획(하위호환) — 차단 분류는 전부 빈 배열", () => {
  const plan = buildDeletionPlan({
    dbRefs: [{ bucket: "shortform-videos", path: "u/v.mp4" }],
    inventory: [{ bucket: "profile-avatars", path: "u/a.png" }],
    uncoveredBuckets: [],
  });
  assert.equal(plan.refs.length, 2);
  assert.deepEqual(plan.ownershipConflicts, []);
  assert.deepEqual(plan.unattributable, []);
});

test("ownership 을 주면서 userId 를 빠뜨리면 조용히 진행하지 않고 던진다", () => {
  assert.throws(() =>
    buildDeletionPlan({
      dbRefs: [],
      inventory: [],
      uncoveredBuckets: [],
      ownership: ownership({}),
    })
  );
});

// ── 워커 차단 관문 배선 ──────────────────────────────────────────────────────

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
    gatherDbRefs: async () => [],
    listInventory: async () => [],
    resolveObjectOwners: async (userId, refs) => ({
      ownedByUser: [],
      owners: new Map(refs.map((r) => [storageObjectKey(r), userId])),
    }),
    uncoveredBuckets: async () => [],
    removeObjects: async (refs) => {
      calls.push(`removeObjects:${refs.length}`);
      return refs.map(storageObjectKey);
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

test("OWNERSHIP_CONFLICT 1건 → real-run 시작 0 (pending 에서 beginLocked 도 부르지 않는다)", async () => {
  const calls: Calls = [];
  const conflicted = { bucket: "custom-order-deliverables", path: "o1/c.zip" };
  const deps = makeDeps(calls, {
    gatherDbRefs: async () => [conflicted],
    resolveObjectOwners: async () => ownership({ owners: [[conflicted, OTHER]] }),
  });
  const result = await runAccountDeletionJob({ userId: UID, state: "pending", dryRun: false }, deps);

  assert.equal(result.ok, false);
  assert.equal(result.stopped, "ownership_conflict");
  assert.equal(result.ownershipConflicts?.length, 1);
  assert.ok(!calls.includes("beginLocked"), "real-run 시작 0");
  assert.ok(!calls.includes("revokeSessions"));
  assert.ok(!calls.some((c) => c.startsWith("advance")));
  assert.ok(!calls.some((c) => c.startsWith("removeObjects")));
  assert.ok(
    calls.some((c) => c.startsWith("recordError:ownership_conflict")),
    "차단 사유를 record_error 로 남긴다"
  );
});

test("UNATTRIBUTABLE 1건 → real-run 시작 0 · 전이 0", async () => {
  const calls: Calls = [];
  const orphan = { bucket: "profile-avatars", path: `${UID}/e.png` };
  const deps = makeDeps(calls, {
    listInventory: async () => [orphan],
    resolveObjectOwners: async () => ownership({ owners: [[orphan, null]] }),
  });
  const result = await runAccountDeletionJob({ userId: UID, state: "pending", dryRun: false }, deps);

  assert.equal(result.stopped, "unattributable");
  assert.equal(result.unattributable?.length, 1);
  assert.ok(!calls.includes("beginLocked"));
  assert.ok(!calls.some((c) => c.startsWith("advance")));
  assert.ok(calls.some((c) => c.startsWith("recordError:unattributable")));
});

test("purging 진행 중 충돌 → removeObjects 0회 · storage_purged 전이 0", async () => {
  const calls: Calls = [];
  const conflicted = { bucket: "custom-order-deliverables", path: "o1/c.zip" };
  let planCount = 0;
  const deps = makeDeps(calls, {
    gatherDbRefs: async () => [conflicted],
    // 시작 게이트는 통과시키고(1회차 owner 일치) 계획 산출(2회차)에서 충돌이 드러나는 경우.
    resolveObjectOwners: async () => {
      planCount += 1;
      return ownership({ owners: [[conflicted, planCount >= 2 ? OTHER : UID]] });
    },
  });
  const result = await runAccountDeletionJob({ userId: UID, state: "purging", dryRun: false }, deps);

  assert.equal(result.stopped, "ownership_conflict");
  assert.ok(!calls.some((c) => c.startsWith("removeObjects")), "충돌이 있으면 삭제 자체를 하지 않는다");
  assert.ok(!calls.includes("advance:purging->storage_purged"), "storage_purged 전이 0");
});

test("재검증 시점에 UNATTRIBUTABLE 이 생기면 storage_purged 전이 0", async () => {
  const calls: Calls = [];
  const late = { bucket: "profile-avatars", path: `${UID}/late.png` };
  let planCount = 0;
  const deps = makeDeps(calls, {
    // 시작 게이트(1)·계획(2)까지는 깨끗하다가 재검증(3)에서 귀속 불능 객체가 드러난다.
    listInventory: async () => {
      planCount += 1;
      return planCount >= 3 ? [late] : [];
    },
    resolveObjectOwners: async (_userId, refs) =>
      ownership({ owners: refs.map((r) => [r, null] as [StorageObjectRef, null]) }),
  });
  const result = await runAccountDeletionJob({ userId: UID, state: "purging", dryRun: false }, deps);

  assert.equal(result.stopped, "unattributable");
  assert.ok(!calls.includes("advance:purging->storage_purged"));
});

test("owner 귀속 대상(DB 조인 X · owner = 대상)은 실제 삭제 대상에 포함된다", async () => {
  const calls: Calls = [];
  const owned = { bucket: "scan-annotations", path: "s1/ink.png" };
  let purged = false;
  const deps = makeDeps(calls, {
    resolveObjectOwners: async () =>
      purged ? ownership({}) : ownership({ ownedByUser: [owned] }),
    removeObjects: async (refs) => {
      calls.push(`removeObjects:${refs.map(storageObjectKey).join(",")}`);
      purged = true;
      return refs.map(storageObjectKey);
    },
  });
  const result = await runAccountDeletionJob({ userId: UID, state: "purging", dryRun: false }, deps);

  assert.equal(result.ok, true);
  assert.ok(calls.includes("removeObjects:scan-annotations/s1/ink.png"));
  assert.ok(calls.includes("advance:purging->storage_purged"));
});

test("dry-run 계획에도 충돌·귀속 불능이 그대로 실린다(read-only, record_error 0)", async () => {
  const calls: Calls = [];
  const conflicted = { bucket: "custom-order-deliverables", path: "o1/c.zip" };
  const deps = makeDeps(calls, {
    gatherDbRefs: async () => [conflicted],
    resolveObjectOwners: async () => ownership({ owners: [[conflicted, OTHER]] }),
  });
  const result = await runAccountDeletionJob({ userId: UID, state: "pending", dryRun: true }, deps);

  assert.equal(result.stopped, "dry_run");
  assert.equal(result.ownershipConflicts?.length, 1);
  assert.ok(!calls.some((c) => c.startsWith("recordError")), "dry-run 은 부수효과 0");
});
