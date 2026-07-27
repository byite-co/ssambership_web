// 계약 테스트: 숏폼 영상 ref 소유권 — finalize 가 클라 제출 ref 위조/타인 객체를 거부하는지.
// 실행: node --test --experimental-strip-types lib/community/__contract__/shortformVideoRef.contract.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildShortformVideoPathWithId,
  formatShortformVideoStoredRef,
  parseShortformVideoRef,
  shortformVideoExtForMime,
  shortformVideoRefBelongsToUser,
} from "../shortformVideoRef.ts";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

test("본인 네임스페이스 ref 통과 · 타인/위조 거부", () => {
  const ref = formatShortformVideoStoredRef(buildShortformVideoPathWithId(USER_A, "video/mp4", "uuid-1"));
  assert.equal(shortformVideoRefBelongsToUser(ref, USER_A), true);
  assert.equal(shortformVideoRefBelongsToUser(ref, USER_B), false);
  const forged = formatShortformVideoStoredRef(`${USER_B}/uuid-x.mp4`);
  assert.equal(shortformVideoRefBelongsToUser(forged, USER_A), false);
});

test("빈 값·형식 오류 거부", () => {
  assert.equal(shortformVideoRefBelongsToUser("", USER_A), false);
  assert.equal(shortformVideoRefBelongsToUser(null, USER_A), false);
  assert.equal(shortformVideoRefBelongsToUser(`shortform-videos/${USER_A}/x.mp4`, ""), false);
});

test("mime→ext 매핑", () => {
  assert.equal(shortformVideoExtForMime("video/quicktime"), "mov");
  assert.equal(shortformVideoExtForMime("video/webm"), "webm");
  assert.equal(shortformVideoExtForMime("video/mp4"), "mp4");
  assert.equal(shortformVideoExtForMime("VIDEO/MP4"), "mp4");
});

test("parse/format 왕복", () => {
  const path = buildShortformVideoPathWithId(USER_A, "video/quicktime", "uuid-2");
  assert.equal(path, `${USER_A}/uuid-2.mov`);
  const parsed = parseShortformVideoRef(formatShortformVideoStoredRef(path));
  assert.deepEqual(parsed, { bucket: "shortform-videos", path });
});

test("레거시 http 서명 URL 도 본인 path 면 통과", () => {
  const legacy = `https://x.supabase.co/storage/v1/object/sign/shortform-videos/${USER_A}/uuid-y.mp4?token=abc`;
  assert.equal(shortformVideoRefBelongsToUser(legacy, USER_A), true);
  assert.equal(shortformVideoRefBelongsToUser(legacy, USER_B), false);
});
