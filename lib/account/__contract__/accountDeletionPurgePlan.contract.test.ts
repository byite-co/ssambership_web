// 계약 테스트: 회원탈퇴 Storage purge 계획(합집합·dedup·빈상태·잔여).
// 실행: node --test --experimental-strip-types lib/account/__contract__/accountDeletionPurgePlan.contract.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildStoragePurgePlan,
  emptyStateSatisfied,
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
