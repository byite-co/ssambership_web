// 계약 테스트: 커뮤니티 이미지 ref 소유권 판정 — 클라 제출 ref 위조/타인 객체 참조 차단.
// 실행: node --test --experimental-strip-types lib/community/__contract__/communityImageRef.contract.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCommunityImageObjectPathWithId,
  communityImageRefBelongsToUser,
  formatCommunityImageStoredRef,
  parseCommunityImageRef,
} from "../communityImageRef.ts";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

test("본인 네임스페이스 ref 는 통과, 타인/위조 ref 는 거부", () => {
  const path = buildCommunityImageObjectPathWithId(USER_A, "image/png", "photo.png", "uuid-1");
  const ref = formatCommunityImageStoredRef(path);
  assert.equal(communityImageRefBelongsToUser(ref, USER_A), true);
  // 타인 소유로 판정되면 안 됨
  assert.equal(communityImageRefBelongsToUser(ref, USER_B), false);
});

test("경로 위조(다른 userId 접두어)는 거부", () => {
  const forged = formatCommunityImageStoredRef(`${USER_B}/uuid-x-evil.png`);
  assert.equal(communityImageRefBelongsToUser(forged, USER_A), false);
});

test("빈 값·형식 오류·다른 버킷은 거부", () => {
  assert.equal(communityImageRefBelongsToUser("", USER_A), false);
  assert.equal(communityImageRefBelongsToUser(null, USER_A), false);
  assert.equal(communityImageRefBelongsToUser("other-bucket/aaaa/x.png", USER_A), false);
  assert.equal(communityImageRefBelongsToUser(`community-post-images/${USER_A}/x.png`, ""), false);
});

test("레거시 http 서명 URL 도 path 첫 세그먼트가 본인이면 통과", () => {
  const legacy = `https://x.supabase.co/storage/v1/object/sign/community-post-images/${USER_A}/uuid-y.png?token=abc`;
  assert.equal(communityImageRefBelongsToUser(legacy, USER_A), true);
  assert.equal(communityImageRefBelongsToUser(legacy, USER_B), false);
});

test("parse/format 왕복 일관성", () => {
  const path = buildCommunityImageObjectPathWithId(USER_A, "image/webp", "a b.png", "uuid-2");
  assert.equal(path, `${USER_A}/uuid-2-a_b.png.webp`);
  const ref = formatCommunityImageStoredRef(path);
  const parsed = parseCommunityImageRef(ref);
  assert.deepEqual(parsed, { bucket: "community-post-images", path });
});
