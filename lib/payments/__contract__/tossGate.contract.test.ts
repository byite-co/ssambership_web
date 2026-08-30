// 토스 심사 게이트 계약(Phase 0):
//   * env 미설정·빈 값·쉼표만 있는 값 = 전원 차단(기본 닫힘).
//   * 쉼표 구분·trim·대소문자 무시로 allowlist 를 판정한다.
// 실행: node --test --experimental-strip-types lib/payments/__contract__/tossGate.contract.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import {
  isTossAllowedUser,
  isTossUserIdAllowed,
  parseTossReviewAllowedUserIds,
} from "../tossGate.ts";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

test("파싱: 쉼표 구분·trim·빈 항목 제거·소문자 정규화", () => {
  assert.deepEqual([...parseTossReviewAllowedUserIds(`${A},${B}`)], [A, B]);
  assert.deepEqual([...parseTossReviewAllowedUserIds(`  ${A} , ,, ${B.toUpperCase()} `)], [A, B]);
  assert.deepEqual([...parseTossReviewAllowedUserIds("")], []);
  assert.deepEqual([...parseTossReviewAllowedUserIds(" , ,")], []);
  assert.deepEqual([...parseTossReviewAllowedUserIds(null)], []);
  assert.deepEqual([...parseTossReviewAllowedUserIds(undefined)], []);
});

test("판정: 등재된 유저만 true — 대소문자·공백에 견고, 빈 userId 는 항상 false", () => {
  const allow = parseTossReviewAllowedUserIds(`${A}`);
  assert.equal(isTossUserIdAllowed(A, allow), true);
  assert.equal(isTossUserIdAllowed(A.toUpperCase(), allow), true);
  assert.equal(isTossUserIdAllowed(` ${A} `, allow), true);
  assert.equal(isTossUserIdAllowed(B, allow), false);
  assert.equal(isTossUserIdAllowed("", allow), false);
  assert.equal(isTossUserIdAllowed(null, allow), false);
  assert.equal(isTossUserIdAllowed(undefined, allow), false);
  // 빈 allowlist 는 누구도 통과하지 못한다.
  assert.equal(isTossUserIdAllowed(A, new Set()), false);
});

test("기본 닫힘: env 미설정·빈 값이면 전원 차단, 등재 시에만 그 계정만 허용", () => {
  const prev = process.env.TOSS_REVIEW_ALLOWED_USER_IDS;
  try {
    delete process.env.TOSS_REVIEW_ALLOWED_USER_IDS;
    assert.equal(isTossAllowedUser(A), false, "env 미설정인데 허용됨");

    process.env.TOSS_REVIEW_ALLOWED_USER_IDS = "";
    assert.equal(isTossAllowedUser(A), false, "빈 env 인데 허용됨");

    process.env.TOSS_REVIEW_ALLOWED_USER_IDS = " , ";
    assert.equal(isTossAllowedUser(A), false, "쉼표만 있는 env 인데 허용됨");

    process.env.TOSS_REVIEW_ALLOWED_USER_IDS = `${A}, ${B.toUpperCase()}`;
    assert.equal(isTossAllowedUser(A), true);
    assert.equal(isTossAllowedUser(B), true);
    assert.equal(isTossAllowedUser("33333333-3333-4333-8333-333333333333"), false);
  } finally {
    if (prev === undefined) delete process.env.TOSS_REVIEW_ALLOWED_USER_IDS;
    else process.env.TOSS_REVIEW_ALLOWED_USER_IDS = prev;
  }
});
