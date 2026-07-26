// 계약 테스트: 버킷별 소유자 수집 전략 커버리지(W5 §3-3 / §3-4).
// 실행: node --test --experimental-strip-types lib/account/__contract__/accountDeletionBucketCoverage.contract.test.ts
//
// 구 구현은 `{userId}/` prefix 스캔만 있어 13개 버킷 중 2개에서만 결과가 나왔고,
// 나머지는 **공허하게 빈 인벤토리**를 정상으로 오해해 "다 지웠다"고 오판할 수 있었다.
// 이 파일은 (a) 전 버킷이 수집 전략을 갖는지, (b) 전략 없는 버킷이 생기면 게이트가 닫히는지,
// (c) 소유자 조인이 **본인 것만** 고르는 술어인지를 고정한다.

import test from "node:test";
import assert from "node:assert/strict";
import {
  ACCOUNT_DELETION_ALL_BUCKETS,
  ACCOUNT_DELETION_DB_REF_SOURCES,
  ACCOUNT_DELETION_JOINED_BUCKETS,
  ACCOUNT_DELETION_PREFIX_BUCKETS,
  ACCOUNT_DELETION_UNCOVERED_BUCKETS,
  ACCOUNT_DELETION_UNDETERMINABLE_BUCKETS,
  computeUncoveredBuckets,
} from "../accountDeletionBucketCoverage.ts";

test("전 버킷이 수집 전략(prefix ∪ DB조인 ∪ 전용수집기)을 갖는다 — 미커버 0", () => {
  assert.deepEqual([...ACCOUNT_DELETION_UNCOVERED_BUCKETS], []);
});

test("staging 실측 13개 버킷이 전수 등재되어 있다", () => {
  // storage.buckets 실조회(2026-07-26 lbeqxarxothkmzqvpudy)와 동일해야 한다.
  assert.deepEqual([...ACCOUNT_DELETION_ALL_BUCKETS].sort(), [
    "community-post-images",
    "connection-note-ink",
    "custom-order-deliverables",
    "custom-order-message-attachments",
    "custom-request-application-attachments",
    "custom-request-post-attachments",
    "individual-question-attachments",
    "profile-avatars",
    "question-room-attachments",
    "scan-annotations",
    "shortform-thumbnails",
    "shortform-videos",
    "student-id-images",
  ]);
});

test("전략 없는 버킷이 추가되면 자동으로 미커버로 잡힌다(게이트가 살아 있다)", () => {
  const uncovered = computeUncoveredBuckets({
    all: [...ACCOUNT_DELETION_ALL_BUCKETS, "brand-new-bucket"],
    prefixBuckets: ACCOUNT_DELETION_PREFIX_BUCKETS,
    sources: ACCOUNT_DELETION_DB_REF_SOURCES,
    undeterminable: ACCOUNT_DELETION_UNDETERMINABLE_BUCKETS,
  });
  assert.deepEqual(uncovered, ["brand-new-bucket"]);
});

test("판별 불가로 선언한 버킷은 커버 전략이 있어도 미커버로 남는다", () => {
  const uncovered = computeUncoveredBuckets({
    all: ACCOUNT_DELETION_ALL_BUCKETS,
    prefixBuckets: ACCOUNT_DELETION_PREFIX_BUCKETS,
    sources: ACCOUNT_DELETION_DB_REF_SOURCES,
    undeterminable: ["profile-avatars"],
  });
  assert.deepEqual(uncovered, ["profile-avatars"]);
});

test("prefix 커버 버킷은 첫 세그먼트가 사용자 uuid 인 5종뿐이다(실측 근거)", () => {
  assert.deepEqual([...ACCOUNT_DELETION_PREFIX_BUCKETS].sort(), [
    "community-post-images",
    "profile-avatars",
    "shortform-thumbnails",
    "shortform-videos",
    "student-id-images",
  ]);
});

test("DB 조인 소스는 전부 '본인 소유' 술어를 쓴다(타인 객체 유입 차단)", () => {
  const ownerColumns = new Set(ACCOUNT_DELETION_DB_REF_SOURCES.map((s) => s.ownerColumn));
  // 소유자 후보가 여럿인 컬럼(예: 주문의 상대방)은 쓰지 않는다.
  for (const column of ownerColumns) {
    assert.ok(
      ["author_id", "uploaded_by", "uploader_id", "mentor_id"].includes(column),
      `소유자 컬럼으로 부적합: ${column}`
    );
  }
  // 질문 상대방 컬럼을 소유자로 쓰면 과삭제가 된다 — 등재 금지.
  for (const source of ACCOUNT_DELETION_DB_REF_SOURCES) {
    assert.ok(
      !["claimed_mentor_id", "designated_mentor_id", "student_id"].includes(source.ownerColumn),
      `상대방 컬럼을 소유자로 쓰면 안 된다: ${source.table}.${source.ownerColumn}`
    );
  }
});

test("각 DB 조인 소스는 버킷·테이블·경로 컬럼을 모두 명시한다", () => {
  for (const source of ACCOUNT_DELETION_DB_REF_SOURCES) {
    assert.ok(source.bucket.length > 0, "bucket 필수");
    assert.ok(source.table.length > 0, "table 필수");
    assert.ok(source.ownerColumn.length > 0, "ownerColumn 필수");
    assert.ok(source.pathColumns.length > 0, `${source.table}: 경로 컬럼 최소 1개`);
    assert.ok(
      ACCOUNT_DELETION_ALL_BUCKETS.includes(source.bucket),
      `등재되지 않은 버킷: ${source.bucket}`
    );
  }
});

test("전용 수집기 담당 버킷은 표에 중복 등재되지 않는다", () => {
  const tableBuckets = new Set(ACCOUNT_DELETION_DB_REF_SOURCES.map((s) => s.bucket));
  for (const bucket of ACCOUNT_DELETION_JOINED_BUCKETS) {
    assert.ok(!tableBuckets.has(bucket), `${bucket} 은 전용 수집기 담당이라 표에 없어야 한다`);
  }
});

test("현재 판별 불가 버킷은 0종이다(추측 규칙으로 채우지 않았다)", () => {
  assert.deepEqual([...ACCOUNT_DELETION_UNDETERMINABLE_BUCKETS], []);
});
