// 계약 테스트: W5-c §3-3 (b) — storage.objects.owner_id 실측 기반 분류·차단.
// 실행: node --test --experimental-strip-types lib/account/__contract__/accountDeletionPlanClassification.contract.test.ts
//
// 실측 근거(staging, 2026-07-26): with_owner > 0 버킷 다수 → (b) 분기.
// 고정하는 계약:
//   · 분류표 — DB 조인/owner/prefix 조합 4분류(스냅샷)
//   · OWNERSHIP_CONFLICT ≥ 1 → real-run 시작 0 · purging→storage_purged 전이 0
//   · UNATTRIBUTABLE ≥ 1   → 동일
//   · owner 부재(null)는 충돌이 아니다(individual-question-attachments 실측 형태)
//   · 충돌·판별불능 객체는 삭제 대상(refs)에 들어가지 않는다(과삭제 방지)

import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyDeletionPlan,
  storageObjectKey,
  type StorageObjectRef,
  type StorageOwnerEvidence,
} from "../accountDeletionPurgePlan.ts";
import { runAccountDeletionJob, type DeletionDeps } from "../accountDeletionWorker.ts";

const PREFIX_BUCKETS = [
  "student-id-images",
  "profile-avatars",
  "community-post-images",
  "shortform-videos",
  "shortform-thumbnails",
] as const;

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
    gatherDbRefs: async () => [] as StorageObjectRef[],
    listInventory: async () => [] as StorageObjectRef[],
    gatherOwnerEvidence: async () => [] as StorageOwnerEvidence[],
    uncoveredBuckets: async () => [],
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

// ── 분류표 스냅샷 ────────────────────────────────────────────────────────────

test("분류표 스냅샷: DB 조인/owner/prefix 4분류 + 합집합 수집", () => {
  const plan = classifyDeletionPlan({
    userId: "u1",
    dbRefs: [
      { bucket: "question-room-attachments", path: "room1/a.png" }, // DB O · owner 일치
      { bucket: "question-room-attachments", path: "room1/b.png" }, // DB O · owner 타인 → 충돌
      { bucket: "individual-question-attachments", path: "q2/c.png" }, // DB O · owner null → 정상
      { bucket: "question-room-attachments", path: "room1/d.png" }, // DB O · owner 미실측 → 정상
    ],
    inventory: [
      { bucket: "student-id-images", path: "u1/f.png" }, // prefix 귀속
    ],
    ownerEvidence: [
      { bucket: "question-room-attachments", path: "room1/a.png", ownerId: "u1" },
      { bucket: "question-room-attachments", path: "room1/b.png", ownerId: "u2" },
      { bucket: "individual-question-attachments", path: "q2/c.png", ownerId: null },
      { bucket: "custom-order-deliverables", path: "order9/e.zip", ownerId: "u1" }, // DB X · owner=대상 → owner 귀속
      { bucket: "question-room-attachments", path: "u1/g.png", ownerId: "u2" }, // 셋 다 아님 → 판별불능
    ],
    uncoveredBuckets: [],
    prefixBuckets: PREFIX_BUCKETS,
  });

  assert.deepEqual(plan, {
    refs: [
      { bucket: "custom-order-deliverables", path: "order9/e.zip" },
      { bucket: "individual-question-attachments", path: "q2/c.png" },
      { bucket: "question-room-attachments", path: "room1/a.png" },
      { bucket: "question-room-attachments", path: "room1/d.png" },
      { bucket: "student-id-images", path: "u1/f.png" },
    ],
    ownerAttributed: [{ bucket: "custom-order-deliverables", path: "order9/e.zip" }],
    ownershipConflicts: [
      { bucket: "question-room-attachments", path: "room1/b.png", ownerId: "u2" },
    ],
    unattributable: [{ bucket: "question-room-attachments", path: "u1/g.png" }],
    uncoveredBuckets: [],
  });
});

test("owner 부재(null)는 충돌이 아니다 — 등록 RPC 실측 형태(DB 조인 O · owner null)", () => {
  const plan = classifyDeletionPlan({
    userId: "u1",
    dbRefs: [{ bucket: "individual-question-attachments", path: "q1/a.png" }],
    inventory: [],
    ownerEvidence: [{ bucket: "individual-question-attachments", path: "q1/a.png", ownerId: null }],
    uncoveredBuckets: [],
    prefixBuckets: PREFIX_BUCKETS,
  });
  assert.deepEqual(plan.refs.map(storageObjectKey), ["individual-question-attachments/q1/a.png"]);
  assert.equal(plan.ownershipConflicts.length, 0);
  assert.equal(plan.unattributable.length, 0);
});

test("선언된 prefix 버킷 밖의 {uid}/ 경로는 prefix 로 귀속되지 않는다(과삭제 방지)", () => {
  const plan = classifyDeletionPlan({
    userId: "u1",
    dbRefs: [],
    inventory: [],
    ownerEvidence: [
      // 유저-스코프 전 버킷 인벤토리에서 나온, uid 폴더처럼 보이지만 근거 없는 객체.
      { bucket: "question-room-attachments", path: "u1/x.png", ownerId: null },
    ],
    uncoveredBuckets: [],
    prefixBuckets: PREFIX_BUCKETS,
  });
  assert.deepEqual(plan.refs, []);
  assert.deepEqual(plan.unattributable.map(storageObjectKey), ["question-room-attachments/u1/x.png"]);
});

test("충돌·판별불능 객체는 삭제 대상(refs)에 들어가지 않는다", () => {
  const plan = classifyDeletionPlan({
    userId: "u1",
    dbRefs: [{ bucket: "question-room-attachments", path: "room1/b.png" }],
    inventory: [],
    ownerEvidence: [
      { bucket: "question-room-attachments", path: "room1/b.png", ownerId: "u2" },
      { bucket: "question-room-attachments", path: "u1/g.png", ownerId: null },
    ],
    uncoveredBuckets: [],
    prefixBuckets: PREFIX_BUCKETS,
  });
  assert.deepEqual(plan.refs, []);
  assert.equal(plan.ownershipConflicts.length, 1);
  assert.equal(plan.unattributable.length, 1);
});

// ── 워커 차단 관문 (미커버 버킷과 동일 관문) ─────────────────────────────────

const CONFLICT_DEPS: Partial<DeletionDeps> = {
  gatherDbRefs: async () => [{ bucket: "question-room-attachments", path: "room1/b.png" }],
  gatherOwnerEvidence: async () => [
    { bucket: "question-room-attachments", path: "room1/b.png", ownerId: "u2" },
  ],
};

test("OWNERSHIP_CONFLICT 1건 → real-run 시작 0 (locked 진입 전 정지)", async () => {
  const calls: Calls = [];
  const deps = makeDeps(calls, CONFLICT_DEPS);
  const result = await runAccountDeletionJob({ userId: "u1", state: "pending", dryRun: false }, deps);

  assert.equal(result.ok, false);
  assert.equal(result.stopped, "ownership_conflict");
  assert.equal(result.finalState, "pending", "job 은 pending 그대로");
  assert.equal(result.ownershipConflicts, 1);
  assert.ok(!calls.includes("beginLocked"), "계정을 잠그지도 않는다");
  assert.ok(!calls.includes("revokeSessions"));
  assert.ok(!calls.some((c) => c.startsWith("advance")));
  assert.ok(!calls.some((c) => c.startsWith("removeObjects")));
  assert.ok(
    calls.some((c) => c.startsWith("recordError:ownership_conflict")),
    "차단 사유를 record_error 로 남긴다"
  );
});

test("OWNERSHIP_CONFLICT 1건 → purging→storage_purged 전이 0 · 삭제 0", async () => {
  const calls: Calls = [];
  const deps = makeDeps(calls, CONFLICT_DEPS);
  const result = await runAccountDeletionJob({ userId: "u1", state: "purging", dryRun: false }, deps);

  assert.equal(result.stopped, "ownership_conflict");
  assert.ok(!calls.includes("advance:purging->storage_purged"));
  assert.ok(!calls.some((c) => c.startsWith("removeObjects")), "차단은 removeObjects 보다 먼저");
  assert.ok(calls.some((c) => c.startsWith("recordError:ownership_conflict")));
});

const UNATTRIBUTABLE_DEPS: Partial<DeletionDeps> = {
  gatherOwnerEvidence: async () => [
    { bucket: "question-room-attachments", path: "u1/g.png", ownerId: null },
  ],
};

test("UNATTRIBUTABLE 1건 → real-run 시작 0", async () => {
  const calls: Calls = [];
  const deps = makeDeps(calls, UNATTRIBUTABLE_DEPS);
  const result = await runAccountDeletionJob({ userId: "u1", state: "pending", dryRun: false }, deps);

  assert.equal(result.ok, false);
  assert.equal(result.stopped, "unattributable");
  assert.equal(result.unattributable, 1);
  assert.ok(!calls.includes("beginLocked"));
  assert.ok(!calls.some((c) => c.startsWith("removeObjects")));
  assert.ok(calls.some((c) => c.startsWith("recordError:unattributable")));
});

test("UNATTRIBUTABLE 1건 → purging→storage_purged 전이 0", async () => {
  const calls: Calls = [];
  const deps = makeDeps(calls, UNATTRIBUTABLE_DEPS);
  const result = await runAccountDeletionJob({ userId: "u1", state: "purging", dryRun: false }, deps);

  assert.equal(result.stopped, "unattributable");
  assert.ok(!calls.includes("advance:purging->storage_purged"));
  assert.ok(!calls.some((c) => c.startsWith("removeObjects")));
});

test("재검증 시점에 충돌이 나타나도 storage_purged 로 넘어가지 않는다", async () => {
  const calls: Calls = [];
  let evidenceCall = 0;
  const deps = makeDeps(calls, {
    gatherOwnerEvidence: async () => {
      evidenceCall += 1;
      // 계획 시점(1회차)은 깨끗, purge 후 재검증(2회차)에서 충돌 등장(레이스 재현).
      if (evidenceCall >= 2) {
        return [{ bucket: "question-room-attachments", path: "room1/b.png", ownerId: "u2" }];
      }
      return [];
    },
    gatherDbRefs: async () => [{ bucket: "question-room-attachments", path: "room1/b.png" }],
  });
  const result = await runAccountDeletionJob({ userId: "u1", state: "purging", dryRun: false }, deps);

  assert.equal(result.stopped, "ownership_conflict");
  assert.ok(!calls.includes("advance:purging->storage_purged"));
});

test("dry-run 도 같은 분류를 보고한다 — 충돌 객체는 계획에서 빠지고 개수로 드러난다", async () => {
  const calls: Calls = [];
  const deps = makeDeps(calls, CONFLICT_DEPS);
  const result = await runAccountDeletionJob({ userId: "u1", state: "pending", dryRun: true }, deps);

  assert.equal(result.stopped, "dry_run");
  assert.equal(result.ok, true, "dry-run 은 계획 보고일 뿐 실패가 아니다");
  assert.equal(result.ownershipConflicts, 1);
  assert.deepEqual(result.plan, [], "충돌 객체는 삭제 계획에 없다");
  assert.ok(!calls.some((c) => c.startsWith("recordError")), "dry-run 은 record_error 0");
  assert.ok(!calls.includes("beginLocked"));
});