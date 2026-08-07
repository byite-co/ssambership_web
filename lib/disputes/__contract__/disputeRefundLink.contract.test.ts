// D-CR-9 회귀: disputes↔refunds 공유키 후보 우선순위. 고정 null 대신 실제 역참조 키를 만든다.
// 실행: node --test --experimental-strip-types lib/disputes/__contract__/disputeRefundLink.contract.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import {
  refundLinkCandidatesForDispute,
  REFUND_LINK_KEY_PRECEDENCE,
} from "../disputeRefundLink.ts";

test("우선순위: 주문 → 결제 → 구독", () => {
  assert.deepEqual(REFUND_LINK_KEY_PRECEDENCE, [
    "custom_request_order_id",
    "payment_id",
    "subscription_id",
  ]);
});

test("세 키 모두 있으면 우선순위 순서 그대로 후보 3개", () => {
  const cands = refundLinkCandidatesForDispute({
    custom_request_order_id: "ord-1",
    payment_id: "pay-1",
    subscription_id: "sub-1",
  });
  assert.deepEqual(cands, [
    ["custom_request_order_id", "ord-1"],
    ["payment_id", "pay-1"],
    ["subscription_id", "sub-1"],
  ]);
});

test("null·빈문자 키는 제외한다", () => {
  const cands = refundLinkCandidatesForDispute({
    custom_request_order_id: null,
    payment_id: "pay-9",
    subscription_id: "   ",
  });
  assert.deepEqual(cands, [["payment_id", "pay-9"]]);
});

test("연계 키가 하나도 없으면 빈 후보(→ 환불 조회 자체를 하지 않음)", () => {
  assert.deepEqual(refundLinkCandidatesForDispute({ id: "d1", status: "open" }), []);
  assert.deepEqual(refundLinkCandidatesForDispute(null), []);
});

test("맞춤의뢰 분쟁은 주문 키가 최우선(가장 특정적)", () => {
  const cands = refundLinkCandidatesForDispute({
    custom_request_order_id: "ord-x",
    subscription_id: "sub-x",
  });
  assert.equal(cands[0][0], "custom_request_order_id");
});
