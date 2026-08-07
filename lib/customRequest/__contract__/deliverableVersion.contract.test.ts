// D-CR-1 회귀: 납품 버전 채번 순수부. 재시도 루프의 매 시도 재채번(max+1, 최소 1) 계약을 고정한다.
// 실행: node --test --experimental-strip-types lib/customRequest/__contract__/deliverableVersion.contract.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { nextDeliverableVersionFromRows } from "../deliverableVersion.ts";

test("빈 목록·null·undefined 는 첫 버전 1", () => {
  assert.equal(nextDeliverableVersionFromRows([]), 1);
  assert.equal(nextDeliverableVersionFromRows(null), 1);
  assert.equal(nextDeliverableVersionFromRows(undefined), 1);
});

test("max(version)+1 로 채번한다(순서 무관)", () => {
  assert.equal(nextDeliverableVersionFromRows([{ version: 1 }, { version: 2 }, { version: 3 }]), 4);
  assert.equal(nextDeliverableVersionFromRows([{ version: 3 }, { version: 1 }, { version: 2 }]), 4);
});

test("문자열 version 도 숫자로 해석한다", () => {
  assert.equal(nextDeliverableVersionFromRows([{ version: "5" }]), 6);
});

test("비정상 version(누락·NaN)은 0으로 취급되지만 결과는 최소 2(=max(1,0)+1)", () => {
  // 기존 행이 하나라도 있으면 최소 2 를 반환해 1 과의 충돌을 피한다.
  assert.equal(nextDeliverableVersionFromRows([{ version: null }]), 2);
  assert.equal(nextDeliverableVersionFromRows([{}]), 2);
  assert.equal(nextDeliverableVersionFromRows([{ version: "abc" }]), 2);
});

test("동시 납품 시나리오: 같은 스냅샷을 읽으면 같은 버전을 계산한다(그래서 unique 재시도가 필요)", () => {
  const snapshot = [{ version: 1 }, { version: 2 }];
  assert.equal(nextDeliverableVersionFromRows(snapshot), 3);
  assert.equal(nextDeliverableVersionFromRows(snapshot), 3);
});
