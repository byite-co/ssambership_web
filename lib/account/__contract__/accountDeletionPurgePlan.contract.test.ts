// 계약 테스트: 회원탈퇴 Storage purge 계획(합집합·dedup·빈상태·잔여).
// 실행: node --test --experimental-strip-types lib/account/__contract__/accountDeletionPurgePlan.contract.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDeletionPlan,
  buildStoragePurgePlan,
  emptyStateSatisfied,
  normalizeStoredObjectPath,
  purgeResidue,
  storageObjectKey,
} from "../accountDeletionPurgePlan.ts";

test("계획 = DB refs ∪ 인벤토리 합집합, dedup", () => {
  const dbRefs = [
    { bucket: "student-id-images", path: "u/id.jpg" },
    { bucket: "community-post-images", path: "u/a.png" },
  ];
  const inventory = [
    { bucket: "community-post-images", path: "u/a.png" }, // 중복
    { bucket: "shortform-videos", path: "u/v.mp4" }, // DB 미기록(고아) — 합집합에 포함
  ];
  const plan = buildStoragePurgePlan(dbRefs, inventory);
  const keys = plan.map(storageObjectKey);
  assert.deepEqual(keys, [
    "community-post-images/u/a.png",
    "shortform-videos/u/v.mp4",
    "student-id-images/u/id.jpg",
  ]);
});

test("선행 슬래시·빈 항목 정규화/무시", () => {
  const plan = buildStoragePurgePlan(
    [{ bucket: "b", path: "/x.png" }],
    [{ bucket: "", path: "y" } as { bucket: string; path: string }, { bucket: "b", path: "x.png" }],
  );
  assert.deepEqual(plan.map(storageObjectKey), ["b/x.png"]); // /x.png == x.png dedup, 빈 bucket 무시
});

test("빈 상태 재검증: 남은 객체 있으면 false(finalized 금지)", () => {
  assert.equal(emptyStateSatisfied([]), true);
  assert.equal(emptyStateSatisfied([{ bucket: "b", path: "x" }]), false);
});

test("삭제 결과 검사: 계획 대비 미삭제 잔여 반환", () => {
  const plan = [
    { bucket: "b", path: "x" },
    { bucket: "b", path: "y" },
  ];
  const removed = ["b/x"];
  const residue = purgeResidue(plan, removed);
  assert.deepEqual(residue.map(storageObjectKey), ["b/y"]);
  assert.deepEqual(purgeResidue(plan, ["b/x", "b/y"]), []);
});

// ── W5 §3-1 / §3-3: 계획 정본 + 저장 참조 정규화 ────────────────────────────

test("buildDeletionPlan: refs 와 미커버 목록을 함께 담는다(정렬·dedup)", () => {
  const plan = buildDeletionPlan({
    dbRefs: [{ bucket: "shortform-videos", path: "u/v.mp4" }],
    inventory: [{ bucket: "profile-avatars", path: "u/a.png" }],
    uncoveredBuckets: ["z-bucket", "a-bucket", "z-bucket", ""],
  });
  assert.deepEqual(plan.refs.map(storageObjectKey), [
    "profile-avatars/u/a.png",
    "shortform-videos/u/v.mp4",
  ]);
  assert.deepEqual(plan.uncoveredBuckets, ["a-bucket", "z-bucket"]);
});

test("정규화: `bucket/path` ref 에서 버킷 접두를 벗긴다", () => {
  assert.equal(
    normalizeStoredObjectPath("community-post-images", "community-post-images/u1/a.png"),
    "u1/a.png"
  );
});

test("정규화: 과거 서명 URL 에서 경로만 뽑고 token 은 버린다", () => {
  const signed =
    "https://x.supabase.co/storage/v1/object/sign/shortform-videos/u1/v.mp4?token=SECRET&x=1";
  assert.equal(normalizeStoredObjectPath("shortform-videos", signed), "u1/v.mp4");
});

test("정규화: 맨 경로(uuid 시작)는 그대로 통과한다", () => {
  assert.equal(
    normalizeStoredObjectPath(
      "individual-question-attachments",
      "a3f6404f-e4bd-47ec-8d37-eb861bb8140d/582fa883-file.jpg"
    ),
    "a3f6404f-e4bd-47ec-8d37-eb861bb8140d/582fa883-file.jpg"
  );
});

test("정규화: 다른 버킷 ref 는 null — 과삭제 방지", () => {
  assert.equal(normalizeStoredObjectPath("shortform-videos", "community-post-images/u1/a.png"), null);
  assert.equal(
    normalizeStoredObjectPath("shortform-videos", "https://x.supabase.co/object/sign/other/u1/a.png"),
    null
  );
});

test("정규화: 빈 값·null·공백은 null", () => {
  assert.equal(normalizeStoredObjectPath("b", null), null);
  assert.equal(normalizeStoredObjectPath("b", undefined), null);
  assert.equal(normalizeStoredObjectPath("b", "   "), null);
  assert.equal(normalizeStoredObjectPath("", "b/x.png"), null);
});
