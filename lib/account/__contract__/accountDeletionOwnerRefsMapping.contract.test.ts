// 계약 테스트: W5-e E2 · W5-f F1 — 181/183 RPC 행 → ObjectOwnership 매핑.
// 실행: node --test --experimental-strip-types lib/account/__contract__/accountDeletionOwnerRefsMapping.contract.test.ts
//
// 배경: owner 증거 어댑터(`makeResolveObjectOwners`)의 PostgREST storage 스키마 직조회가
// staging 에서 PGRST106("Invalid schema: storage") 으로 fail-closed 정지했다(2026-07-26
// read-only 재현). SQL 181 이 service_role 전용 SECURITY DEFINER RPC 를 신설했고,
// 어댑터는 그 RPC 반환 행(TABLE(bucket_id text, name text))을 이 매핑으로 흡수한다.
//
// W5-f F1: 181 은 대상 uid 소유분만 반환해 타인-owner 이상치가 OWNERSHIP_CONFLICT
// 차단 대신 삭제로 수렴하는 의미 후퇴가 있었다(W5-e 지시서 스펙 결함으로 판정).
// SQL 183 `account_deletion_verify_object_owners` 가 수집 ref 전건의 소유 상태를
// 'target'/'other'/'none' 3값 verdict 로 알리고 `applyOwnerVerdicts` 가 owners 맵에
// 반영해 감지를 복원했다. 여기서는 두 매핑의 순수 계약을 고정한다 — 어댑터는
// 페이지네이션·배치·예외(fail-closed)만 더한다.

import test from "node:test";
import assert from "node:assert/strict";
import {
  applyOwnerVerdicts,
  buildDeletionPlan,
  buildObjectOwnershipFromOwnerRefRows,
  FOREIGN_OWNER_MARKER,
  storageObjectKey,
  type OwnerVerdictRow,
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

// ── W5-f F1: 183 verdict 매핑 — E2 가 박제했던 "타인-owner 삭제 수렴"의 복원 형상 ──
// (구 박제 테스트: "owner 증거 부재의 DB ref 는 정상 삭제 대상이 된다" — 183 도입으로
//  타인-owner 는 이제 verdict 'other' 로 관측되므로 박제를 복원 계약으로 대체한다.)

test("F1 복원: 183 verdict 'other' 인 DB 조인 ref 는 OWNERSHIP_CONFLICT 로 차단된다", () => {
  const dbRef = { bucket: "community-post-images", path: "u2/foreign-owned.png" };
  const base = buildObjectOwnershipFromOwnerRefRows(UID, [], [...AUDITED]);
  const verdicts: OwnerVerdictRow[] = [
    { bucket_id: dbRef.bucket, name: dbRef.path, owner_state: "other" },
  ];
  const plan = buildDeletionPlan({
    userId: UID,
    dbRefs: [dbRef],
    inventory: [],
    uncoveredBuckets: [],
    ownership: applyOwnerVerdicts(UID, base, verdicts),
  });
  assert.deepEqual(plan.refs, [], "타인 소유 객체는 삭제 대상에 들어가지 않는다");
  assert.equal(plan.ownershipConflicts.length, 1);
  assert.equal(storageObjectKey(plan.ownershipConflicts[0]), storageObjectKey(dbRef));
  // 타인 owner 의 실제 uid 는 183 이 반환하지 않는다 — 표지만 실린다.
  assert.equal(plan.ownershipConflicts[0].ownerId, FOREIGN_OWNER_MARKER);
});

test("F1 오탐 방지: verdict 'none'(owner 미기록·행 부재) DB 조인 ref 는 현행 정상 삭제 대상", () => {
  // individual-question-attachments 의 null-owner 5객체(staging 실측)가 이 경로다.
  const nullOwner = { bucket: "individual-question-attachments", path: "q1/b.pdf" };
  const ghost = { bucket: "community-post-images", path: `${UID}/gone.png` };
  const base = buildObjectOwnershipFromOwnerRefRows(UID, [], [...AUDITED]);
  const verdicts: OwnerVerdictRow[] = [
    { bucket_id: nullOwner.bucket, name: nullOwner.path, owner_state: "none" },
    { bucket_id: ghost.bucket, name: ghost.path, owner_state: "none" },
  ];
  const plan = buildDeletionPlan({
    userId: UID,
    dbRefs: [nullOwner, ghost],
    inventory: [],
    uncoveredBuckets: [],
    ownership: applyOwnerVerdicts(UID, base, verdicts),
  });
  assert.deepEqual(plan.refs.map(storageObjectKey).sort(), [
    storageObjectKey(ghost),
    storageObjectKey(nullOwner),
  ]);
  assert.deepEqual(plan.ownershipConflicts, []);
  assert.deepEqual(plan.unattributable, []);
});

test("F1: verdict 'target' 은 대상 uid 로 실리고 181 축과 합쳐진다", () => {
  const dbRef = { bucket: "community-post-images", path: `${UID}/mine.png` };
  const ownedOnly = { bucket: "question-room-attachments", path: "room1/owned.pdf" };
  const base = buildObjectOwnershipFromOwnerRefRows(
    UID,
    [{ bucket_id: ownedOnly.bucket, name: ownedOnly.path }],
    [...AUDITED]
  );
  const verdicts: OwnerVerdictRow[] = [
    { bucket_id: dbRef.bucket, name: dbRef.path, owner_state: "target" },
    { bucket_id: ownedOnly.bucket, name: ownedOnly.path, owner_state: "target" },
  ];
  const plan = buildDeletionPlan({
    userId: UID,
    dbRefs: [dbRef],
    inventory: [],
    uncoveredBuckets: [],
    ownership: applyOwnerVerdicts(UID, base, verdicts),
  });
  assert.deepEqual(plan.refs.map(storageObjectKey).sort(), [
    storageObjectKey(dbRef),
    storageObjectKey(ownedOnly),
  ]);
  assert.deepEqual(plan.ownerAttributed.map(storageObjectKey), [storageObjectKey(ownedOnly)]);
  assert.deepEqual(plan.ownershipConflicts, []);
});

test("F1 방어: 미지의 owner_state 는 조용히 지나가지 않고 던진다(fail-closed)", () => {
  const base = buildObjectOwnershipFromOwnerRefRows(UID, [], [...AUDITED]);
  assert.throws(() =>
    applyOwnerVerdicts(UID, base, [
      { bucket_id: "community-post-images", name: "x.png", owner_state: "unknown-state" },
    ])
  );
});

test("F1 방어: 형식 이탈 verdict 행(비문자열·빈 문자열)은 버린다 · FOREIGN_OWNER_MARKER 는 uuid 가 아니다", () => {
  const base = buildObjectOwnershipFromOwnerRefRows(UID, [], [...AUDITED]);
  const ownership = applyOwnerVerdicts(UID, base, [
    { bucket_id: "", name: "a.png", owner_state: "other" },
    { bucket_id: "community-post-images", name: null, owner_state: "other" },
    {},
  ]);
  assert.equal(ownership.owners.size, 0);
  // 표지가 uuid 형식이면 실사용자 id 와 충돌할 수 있다 — 구조적으로 배제한다.
  assert.ok(
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(FOREIGN_OWNER_MARKER)
  );
});

// ── S1-5 / QA-C11: owner_id 미기록 객체가 탈퇴 삭제 대상에서 빠지던 문제 ─────────
//
// 서버 사이드(service role) 업로드가 storage.objects.owner_id 를 남기지 않아
// 실측상 student-id-images 2/6 · shortform-videos 1/1 등이 owner 미기록이다.
// 181 이 `<uid>/` 경로 규약으로 이 객체들을 대상 귀속으로 판정해 돌려주더라도,
// 183 verdict 가 'none'(= storage 소유자 기록 부재)으로 오면서 그 귀속 근거를
// null 로 덮으면 buildDeletionPlan 이 unattributable 로 떨어뜨려 **탈퇴 계획
// 자체가 차단**된다. 'none' 은 부재의 사실일 뿐 귀속의 부정이 아니다.
test("S1-5: 181 이 대상 귀속으로 판정한 객체는 verdict 'none' 에도 귀속이 유지된다", () => {
  const prefixOwned = { bucket: "community-post-images", path: `${UID}/server-uploaded.png` };
  // 181 이 경로 규약/도메인 조인으로 대상 귀속을 판정해 돌려준 객체.
  const base = buildObjectOwnershipFromOwnerRefRows(
    UID,
    [{ bucket_id: prefixOwned.bucket, name: prefixOwned.path }],
    [...AUDITED]
  );
  // 183 은 storage 에 owner_id 가 없으므로 'none' 을 돌려준다.
  const ownership = applyOwnerVerdicts(UID, base, [
    { bucket_id: prefixOwned.bucket, name: prefixOwned.path, owner_state: "none" },
  ]);
  assert.equal(ownership.owners.get(storageObjectKey(prefixOwned)), UID);

  const plan = buildDeletionPlan({
    userId: UID,
    dbRefs: [],                       // 도메인 테이블 조인으로는 안 잡히는 객체
    inventory: [prefixOwned],         // prefix 스캔으로만 수집된다
    uncoveredBuckets: [],
    ownership,
  });
  assert.deepEqual(plan.refs.map(storageObjectKey), [storageObjectKey(prefixOwned)]);
  assert.deepEqual(plan.ownerAttributed.map(storageObjectKey), [storageObjectKey(prefixOwned)]);
  // 계획이 오염되면 워커가 real-run 을 시작하지 않는다 — 여기서 비어 있어야 탈퇴가 진행된다.
  assert.deepEqual(plan.unattributable, []);
  assert.deepEqual(plan.ownershipConflicts, []);
});

test("S1-5: 귀속 근거가 없는 객체는 종전대로 verdict 'none' 에서 null 이다(F1 오탐 방지 유지)", () => {
  const orphan = { bucket: "community-post-images", path: "someone-else/x.png" };
  const base = buildObjectOwnershipFromOwnerRefRows(UID, [], [...AUDITED]);
  const ownership = applyOwnerVerdicts(UID, base, [
    { bucket_id: orphan.bucket, name: orphan.path, owner_state: "none" },
  ]);
  assert.equal(ownership.owners.get(storageObjectKey(orphan)), null);

  const plan = buildDeletionPlan({
    userId: UID,
    dbRefs: [],
    inventory: [orphan],
    uncoveredBuckets: [],
    ownership,
  });
  // DB 조인도 owner 귀속도 아니다 → 삭제하지 않고 차단한다(과삭제 금지).
  assert.deepEqual(plan.refs, []);
  assert.deepEqual(plan.unattributable.map(storageObjectKey), [storageObjectKey(orphan)]);
});

test("S1-5: 'other' verdict 는 여전히 base 의 대상 귀속을 이긴다(과삭제 차단 불변)", () => {
  const contested = { bucket: "question-room-attachments", path: "room1/shared.pdf" };
  const base = buildObjectOwnershipFromOwnerRefRows(
    UID,
    [{ bucket_id: contested.bucket, name: contested.path }],
    [...AUDITED]
  );
  const ownership = applyOwnerVerdicts(UID, base, [
    { bucket_id: contested.bucket, name: contested.path, owner_state: "other" },
  ]);
  assert.equal(ownership.owners.get(storageObjectKey(contested)), FOREIGN_OWNER_MARKER);

  const plan = buildDeletionPlan({
    userId: UID,
    dbRefs: [contested],
    inventory: [],
    uncoveredBuckets: [],
    ownership,
  });
  assert.deepEqual(plan.refs, []);
  assert.equal(plan.ownershipConflicts.length, 1);
});
