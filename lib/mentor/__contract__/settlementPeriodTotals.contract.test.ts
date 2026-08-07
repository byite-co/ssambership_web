// 계약 테스트: '이번 달 수익' KPI 당월 경계 집계 — D-MT-3 회귀 방지.
//
// 공유 로더(mentorPayoutsQueries)의 settlementPayouts.totals 는 월 경계 없는 전 기간
// (최근 200행) 합계라, 대시보드 KPI 가 이를 그대로 쓰면 '이번 달 수익' 라벨과 집계
// 기간이 어긋난다(D-MT-3 회귀). 대시보드는 bundle 의 monthBounds(periodStart/periodEnd)로
// 당월 정산 행만 걸러 재집계한다. 여기서 그 경계 포함/제외·상태 분류·금액 파싱을 고정한다.

import test from "node:test";
import assert from "node:assert/strict";
import { aggregateSettlementTotalsInPeriod } from "../settlementPeriodTotals.ts";

// mentorPayoutsQueries.monthBounds 형식과 동일한 ISO 경계(월초 00:00 ~ 말일 23:59:59.999).
const START = "2026-08-01T00:00:00.000Z";
const END = "2026-08-31T23:59:59.999Z";

test("당월 밖 정산 행은 합산에서 빠진다(D-MT-3 핵심)", () => {
  const rows = [
    { created_at: "2026-08-10T09:00:00.000Z", status: "pending", mentor_amount: 10000 },
    { created_at: "2026-08-20T09:00:00.000Z", status: "paid", mentor_amount: 5000 },
    // 전월·익월 행 — 전 기간 합계였다면 섞였을 행들.
    { created_at: "2026-07-31T23:59:59.999Z", status: "pending", mentor_amount: 70000 },
    { created_at: "2026-09-01T00:00:00.000Z", status: "paid", mentor_amount: 90000 },
  ];
  const out = aggregateSettlementTotalsInPeriod(rows, START, END);
  assert.deepEqual(out, { expectedMentorAmount: 10000, paidMentorAmount: 5000, count: 2 });
});

test("경계 양끝(월초 00:00 · 말일 23:59:59.999)은 포함이다", () => {
  const rows = [
    { created_at: START, status: "payable", mentor_amount: 1 },
    { created_at: END, status: "paid", mentor_amount: 2 },
  ];
  const out = aggregateSettlementTotalsInPeriod(rows, START, END);
  assert.deepEqual(out, { expectedMentorAmount: 1, paidMentorAmount: 2, count: 2 });
});

test("상태 분류는 로더와 동일 — 예정(pending/on_hold/payable) vs 지급(paid), 그 외 미합산", () => {
  const rows = [
    { created_at: "2026-08-05T00:00:00Z", status: "pending", mentor_amount: 100 },
    { created_at: "2026-08-05T00:00:00Z", status: "on_hold", mentor_amount: 200 },
    { created_at: "2026-08-05T00:00:00Z", status: "payable", mentor_amount: 400 },
    { created_at: "2026-08-05T00:00:00Z", status: " PAID ", mentor_amount: 800 }, // 공백·대문자 흡수
    { created_at: "2026-08-05T00:00:00Z", status: "canceled", mentor_amount: 1600 }, // 미합산(count 만)
  ];
  const out = aggregateSettlementTotalsInPeriod(rows, START, END);
  assert.equal(out.expectedMentorAmount, 700);
  assert.equal(out.paidMentorAmount, 800);
  assert.equal(out.count, 5);
});

test("금액 파싱은 로더 intAmount 와 동일 — 숫자문자열 허용·그 외 0", () => {
  const rows = [
    { created_at: "2026-08-05T00:00:00Z", status: "pending", mentor_amount: "12345" },
    { created_at: "2026-08-05T00:00:00Z", status: "pending", mentor_amount: "abc" },
    { created_at: "2026-08-05T00:00:00Z", status: "paid", mentor_amount: null },
  ];
  const out = aggregateSettlementTotalsInPeriod(rows, START, END);
  assert.equal(out.expectedMentorAmount, 12345);
  assert.equal(out.paidMentorAmount, 0);
});

test("created_at 없음·파싱 불가 행은 당월 귀속 불가로 제외한다", () => {
  const rows = [
    { status: "pending", mentor_amount: 100 },
    { created_at: "not-a-date", status: "paid", mentor_amount: 200 },
  ];
  const out = aggregateSettlementTotalsInPeriod(rows, START, END);
  assert.deepEqual(out, { expectedMentorAmount: 0, paidMentorAmount: 0, count: 0 });
});

test("경계 자체가 파싱 불가면 빈 합계를 돌려준다(전 기간 합산으로 퇴행 금지)", () => {
  const rows = [{ created_at: "2026-08-05T00:00:00Z", status: "paid", mentor_amount: 100 }];
  const out = aggregateSettlementTotalsInPeriod(rows, "", END);
  assert.deepEqual(out, { expectedMentorAmount: 0, paidMentorAmount: 0, count: 0 });
});
