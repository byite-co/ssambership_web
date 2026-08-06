// 계약 테스트: 지급일 표기 — QA-C12(카드 2026.08.23 vs 안내 "매월 10일") 회귀 방지.
//
// 계산 정본은 PAYOUT_DAY_OF_MONTH(=23, SQL 153 pay_due_payouts 와 동일 규칙)이고,
// 멘토 화면 안내 문구는 그 값에서 파생돼야 한다. 문구에 날짜를 직접 적으면 계산이
// 바뀌어도 화면이 따라오지 않아 멘토에게 모순된 두 날짜가 동시에 보인다.

import test from "node:test";
import assert from "node:assert/strict";
import { PAYOUT_DAY_LABEL, PAYOUT_DAY_OF_MONTH } from "../../payout/payoutComputation.ts";

test("안내 문구의 지급일은 계산 정본에서 파생된다", () => {
  assert.equal(PAYOUT_DAY_LABEL, `매월 ${PAYOUT_DAY_OF_MONTH}일`);
});

test("오너 확정값 — 지급일은 23일이다(2026-08-06)", () => {
  assert.equal(PAYOUT_DAY_OF_MONTH, 23);
  assert.equal(PAYOUT_DAY_LABEL, "매월 23일");
});
