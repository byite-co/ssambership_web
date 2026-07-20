// 계약 테스트: 멘토 지급 계산(수익률 85/95·원천징수 3.3%·23일).
// 실행: node --test --experimental-strip-types lib/payout/__contract__/payoutComputation.contract.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import {
  PAYOUT_DAY_OF_MONTH,
  computeMentorPayout,
  mentorAmountCents,
  mentorShareRate,
  netPaidCents,
  withholdingCents,
} from "../payoutComputation.ts";

test("지급일 23일 고정", () => {
  assert.equal(PAYOUT_DAY_OF_MONTH, 23);
});

test("수익률: 구독·개별질문 85%, 맞춤의뢰 95%", () => {
  assert.equal(mentorShareRate("subscription"), 0.85);
  assert.equal(mentorShareRate("individual_question"), 0.85);
  assert.equal(mentorShareRate("custom_request"), 0.95);
});

test("멘토 몫: floor(gross*rate)", () => {
  assert.equal(mentorAmountCents(10000, "subscription"), 8500);
  assert.equal(mentorAmountCents(10000, "custom_request"), 9500);
  // 홀수/절사
  assert.equal(mentorAmountCents(9999, "subscription"), Math.floor(9999 * 0.85)); // 8499
});

test("원천징수 3.3% = floor(mentor*0.033), net = mentor - wh", () => {
  assert.equal(withholdingCents(9500), 313); // floor(313.5)
  assert.equal(netPaidCents(9500), 9187);
  // 0원
  assert.equal(withholdingCents(0), 0);
  assert.equal(netPaidCents(0), 0);
  // 홀수 mentor
  assert.equal(withholdingCents(9999), 329); // floor(329.967)
  // 소액(공제 0)
  assert.equal(withholdingCents(1), 0);
  assert.equal(netPaidCents(1), 1);
});

test("SQL 153 과 동일: gross 10000 custom_request → mentor 9500, wh 313, net 9187", () => {
  const b = computeMentorPayout(10000, "custom_request");
  assert.equal(b.mentorAmountCents, 9500);
  assert.equal(b.withholdingCents, 313);
  assert.equal(b.netPaidCents, 9187);
  assert.equal(b.shareRate, 0.95);
});

test("전체 합계 정합: net + withholding = mentorAmount", () => {
  for (const gross of [29900, 84900, 174900, 5000, 1, 0]) {
    for (const s of ["subscription", "individual_question", "custom_request"] as const) {
      const b = computeMentorPayout(gross, s);
      assert.equal(b.netPaidCents + b.withholdingCents, b.mentorAmountCents, `${gross}/${s}`);
    }
  }
});
