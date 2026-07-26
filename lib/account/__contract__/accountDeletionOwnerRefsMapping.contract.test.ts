// 계약 테스트: W5-e E2 — 181 RPC `account_deletion_storage_owner_refs` 행 → ObjectOwnership 매핑.
// 실행: node --test --experimental-strip-types lib/account/__contract__/accountDeletionOwnerRefsMapping.contract.test.ts
//
// 배경: owner 증거 어댑터(`makeResolveObjectOwners`)의 PostgREST storage 스키마 직조회가
// staging 에서 PGRST106("Invalid schema: storage") 으로 fail-closed 정지했다(2026-07-26
// read-only 재현). SQL 181 이 service_role 전용 SECURITY DEFINER RPC 를 신설했고,
// 어댑터는 그 RPC 반환 행(TABLE(bucket_id text, name text))을 이 매핑으로 흡수한다.
// 여기서는 매핑의 순수 계약을 고정한다 — 어댑터는 페이지네이션·예외(fail-closed)만 더한다.

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDeletionPlan,
  buildObjectOwnershipFromOwnerRefRows,
  storageObjectKey,
  type StorageOwnerRefRow,
} from "../accountDeletionPurgePlan.ts";

const UID = "11111111-1111-4111-8111-111111111111";
const AUDITED = ["community-post-images", "question-room-attachments"] as const;

test("RPC 행은 감사 대상 버킷만 ownedByUser·owners(owner=대상 uid) 로 실린다", () => {
  const rows: StorageOwnerRefRow[] = [
    { bucket_id: "community-post-images", name: `${UID}/a.png` },
    { bucket_id: "question-room-attachments", name: "room1/b.pdf" },
    // 감사 대상 밖 버킷 — 계획 축에 싣지 않는다(미커버 버킷 관문이 별도로 잡는다).
    { bucket_id: "some-unknown-bucket", name: "x/y.bin" },
  ];
  const ownership = buildObjectOwnershipFromOwnerRefRows(UID, rows, [...AUDITED]);
  assert.deepEqual(
    ownership.ownedByUser.map(storageObjectKey),
    [`community-post-images/${UID}/a.png`, "question-room-attachments/room1/b.pdf"]
  );
  assert.equal(ownership.owners.size, 2);
  for (const [, owner] of ownership.owners) assert.equal(owner, UID);
});

test("bucket_id·name 이 문자열이 아니거나 빈 문자열인 행은 버린다(방어적)", () => {
  const rows: StorageOwnerRefRow[] = [
    { bucket_id: "community-post-images", name: "" },
    { bucket_id: "community-post-images", name: null },
    { bucket_id: "", name: "a.png" },
    { bucket_id: null, name: "a.png" },
    {},
    { bucket_id: "community-post-images", name: "ok.png" },
  ];
  const ownership = buildObjectOwnershipFromOwnerRefRows(UID, rows, [...AUDITED]);
  assert.deepEqual(ownership.ownedByUser.map(storageObjectKey), ["community-post-images/ok.png"]);
});

test("(bucket, name) 중복 행은 1회만 싣는다", () => {
  const rows: StorageOwnerRefRow[] = [
    { bucket_id: "community-post-images", name: "dup.png" },
    { bucket_id: "community-post-images", name: "dup.png" },
  ];
  const ownership = buildObjectOwnershipFromOwnerRefRows(UID, rows, [...AUDITED]);
  assert.equal(ownership.ownedByUser.length, 1);
  assert.equal(ownership.owners.size, 1);
});

test("buildDeletionPlan 통합: owner 귀속(DB 조인 X)·owner 미확인 DB ref·귀속 불능이 기존 관문대로 분류된다", () => {
  const dbRef = { bucket: "community-post-images", path: `${UID}/db.png` };
  const ownerOnly = { bucket: "question-room-attachments", path: "room9/owner-only.pdf" };
  const orphan = { bucket: "community-post-images", path: "someone-else/orphan.png" };
  const ownership = buildObjectOwnershipFromOwnerRefRows(
    UID,
    [
      { bucket_id: dbRef.bucket, name: dbRef.path },
      { bucket_id: ownerOnly.bucket, name: ownerOnly.path },
    ],
    [...AUDITED]
  );
  const plan = buildDeletionPlan({
    userId: UID,
    dbRefs: [dbRef],
    inventory: [orphan],
    uncoveredBuckets: [],
    ownership,
  });
  // DB 조인 O · owner 일치 → 정상 삭제 대상 / DB 조인 X · owner=대상 → owner 귀속 삭제 대상.
  assert.deepEqual(plan.refs.map(storageObjectKey).sort(), [
    storageObjectKey(dbRef),
    storageObjectKey(ownerOnly),
  ]);
  assert.deepEqual(plan.ownerAttributed.map(storageObjectKey), [storageObjectKey(ownerOnly)]);
  // 인벤토리만 있고 owner 증거가 없는 객체는 여전히 귀속 불능 차단 — RPC 전환으로 완화되지 않는다.
  assert.deepEqual(plan.unattributable.map(storageObjectKey), [storageObjectKey(orphan)]);
  assert.deepEqual(plan.ownershipConflicts, []);
});

test("181 의미 변화 박제: owners 맵에는 대상 uid 값만 실린다(타인 owner·null owner 관측 불가)", () => {
  // RPC 는 owner_id = 대상 uid 행만 반환하므로 매핑이 다른 owner 값을 만들 방법이 없다.
  // OWNERSHIP_CONFLICT 분류 자체는 buildDeletionPlan 에 그대로 남아 있고
  // (accountDeletionOwnershipClassification.contract.test.ts), owner 값을 공급하는
  // 어댑터가 다시 생기면 즉시 동작한다 — 이 테스트는 "실어댑터 경로에서는 conflict 가
  // 발화하지 않는다"는 런타임 사실을 명시적으로 남긴다.
  const dbRef = { bucket: "community-post-images", path: "u2/foreign-owned.png" };
  const ownership = buildObjectOwnershipFromOwnerRefRows(UID, [], [...AUDITED]);
  const plan = buildDeletionPlan({
    userId: UID,
    dbRefs: [dbRef],
    inventory: [],
    uncoveredBuckets: [],
    ownership,
  });
  // owner 증거 부재의 DB ref 는 "owner 미기록 레거시"와 구분되지 않아 정상 삭제 대상이 된다.
  assert.deepEqual(plan.refs.map(storageObjectKey), [storageObjectKey(dbRef)]);
  assert.deepEqual(plan.ownershipConflicts, []);
});
