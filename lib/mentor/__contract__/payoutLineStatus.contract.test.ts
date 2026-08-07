// 계약 테스트: 정산 라인 상태 분류 — QA-A2(적립중이 "지급 대기"로 표시·합산) 회귀 방지.
//
// 구독 정산 항목은 사이클이 끝나기 전까지 status='accruing'(지급 불가)이고, 끝나야
// 'pending'(지급 대기)이 된다. 종전 분류기는 모르는 값을 전부 pending 으로 접어서
// 아직 받을 수 없는 돈이 지급 예정 합계에 섞였다. 여기서 그 경계를 고정한다.

import test from "node:test";
import assert from "node:assert/strict";
import { isAccruingPayoutStatus, payoutLineStatusKind } from "../payoutLineStatus.ts";

test("accruing 은 pending 으로 접히지 않는다(QA-A2 핵심)", () => {
  assert.equal(payoutLineStatusKind("accruing"), "accruing");
  assert.equal(payoutLineStatusKind("적립중"), "accruing");
  assert.notEqual(payoutLineStatusKind("accruing"), "pending");
});

test("지급 대기·적립중은 배타적이다 — 합계가 겹치면 안 된다", () => {
  const kinds = ["accruing", "pending", "paid", "hold", "canceled"].map(payoutLineStatusKind);
  assert.deepEqual(kinds, ["accruing", "pending", "paid", "hold", "canceled"]);
  for (const s of ["accruing", "적립중"]) {
    assert.equal(payoutLineStatusKind(s) === "pending", false);
  }
});

test("기존 분류는 그대로다(회귀 없음)", () => {
  assert.equal(payoutLineStatusKind("paid"), "paid");
  assert.equal(payoutLineStatusKind("지급완료"), "paid");
  assert.equal(payoutLineStatusKind("정산완료"), "paid");
  assert.equal(payoutLineStatusKind("hold"), "hold");
  assert.equal(payoutLineStatusKind("on_hold"), "hold");
  assert.equal(payoutLineStatusKind("보류"), "hold");
  assert.equal(payoutLineStatusKind("canceled"), "canceled");
  assert.equal(payoutLineStatusKind("cancelled"), "canceled");
  assert.equal(payoutLineStatusKind("취소"), "canceled");
  assert.equal(payoutLineStatusKind("정산예정"), "pending");
  assert.equal(payoutLineStatusKind(""), "pending");
});

test("이미 끝난 사이클(취소·지급완료)은 적립 판정보다 우선한다", () => {
  assert.equal(payoutLineStatusKind("취소(적립중)"), "canceled");
  assert.equal(payoutLineStatusKind("지급완료 적립중"), "paid");
});

test("대소문자·공백은 흡수한다", () => {
  assert.equal(payoutLineStatusKind("  ACCRUING  "), "accruing");
  assert.equal(isAccruingPayoutStatus(" Accruing "), true);
  assert.equal(isAccruingPayoutStatus("pending"), false);
});
