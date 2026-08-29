// 계약 테스트: mentor_settlement_summary RPC 응답 스키마 — 키 존재·정수(cents) 고정.
//
// 정산 화면은 이 파서가 통과시킨 값만 그대로 표시한다(프론트 ×0.15/×0.033 재계산 금지).
// 키 누락·비정수 cents 는 파싱 실패 → 화면은 0 대신 오류 상태를 그린다(fail-closed —
// PR #75 zero-row 무음 흡수 패턴 재발 방지). 단 100의 배수 위반(캐시 소수)은 합법 데이터가
// 있어(85% 산식 × 20의 배수 아닌 가격) 파싱 실패가 아니라 표시 계층의 값별 단위 오류
// 표식으로 처리한다 — isCashIntegerCents 가 그 판정을 고정한다.
//
// 픽스처는 2026-08-27 prod 실측(테스트 멘토, mentor_settlement_summary('2026-08-01'),
// migration 20260827100200·20260827100300 적용본)과 같은 형상이다.

import test from "node:test";
import assert from "node:assert/strict";
import {
  centsToCash,
  isCashIntegerCents,
  MentorSettlementParseError,
  parseMentorSettlementSummary,
} from "../mentorSettlementSchema.ts";

function fixture() {
  return {
    month: "2026-08",
    run_date: "2026-09-23",
    cutoff: "2026-08-31T14:59:59+00:00",
    payout_account_registered: false,
    confirmed: {
      count: 0,
      gross_cents: 0,
      platform_fee_cents: 0,
      mentor_amount_cents: 0,
      withholding_cents: 0,
      net_cents: 0,
    },
    accruing: {
      count: 1,
      mentor_amount_cents: 14_866_500,
      withholding_cents: 490_500,
      net_cents: 14_376_000,
      last_period_end: "2026-09-27T02:00:44+00:00",
      expected_run_date: "2026-10-23",
    },
    held: { count: 0, mentor_amount_cents: 0 },
    paid_total: { count: 0, mentor_amount_cents: 0, net_cents: 0 },
    by_source_this_month: {
      subscription: { mentor_amount_cents: 14_866_500, count: 1 },
    },
    withholding_rule: "calc_withholding_cents",
  };
}

test("실측 형상 응답은 키 전부 존재·정수로 파싱된다", () => {
  const s = parseMentorSettlementSummary(fixture());

  assert.equal(s.month, "2026-08");
  assert.equal(s.runDate, "2026-09-23");
  assert.equal(s.payoutAccountRegistered, false);
  assert.equal(s.withholdingRule, "calc_withholding_cents");

  // confirmed 산식 네 값 전부 존재 + 정합 (gross − fee − withholding = net)
  assert.equal(
    s.confirmed.grossCents - s.confirmed.platformFeeCents - s.confirmed.withholdingCents,
    s.confirmed.netCents
  );

  // 적립중 버킷 — 실측값 그대로: 148,665 캐시 / 원천징수 4,905 / 실지급 143,760
  assert.equal(centsToCash(s.accruing.mentorAmountCents), 148_665);
  assert.equal(centsToCash(s.accruing.withholdingCents), 4_905);
  assert.equal(centsToCash(s.accruing.netCents), 143_760);
  assert.equal(s.accruing.expectedRunDate, "2026-10-23");
  assert.equal(s.accruing.lastPeriodEnd, "2026-09-27T02:00:44+00:00");

  // 모든 cents 는 정수 — 실측 픽스처는 전부 캐시 정수(÷100)이기도 하다
  const centsValues = [
    s.confirmed.grossCents,
    s.confirmed.platformFeeCents,
    s.confirmed.mentorAmountCents,
    s.confirmed.withholdingCents,
    s.confirmed.netCents,
    s.accruing.mentorAmountCents,
    s.accruing.withholdingCents,
    s.accruing.netCents,
    s.held.mentorAmountCents,
    s.paidTotal.mentorAmountCents,
    s.paidTotal.netCents,
    s.bySourceThisMonth.subscription?.mentorAmountCents ?? 0,
  ];
  for (const cents of centsValues) {
    assert.ok(Number.isSafeInteger(cents), `cents 정수 아님: ${cents}`);
    assert.ok(isCashIntegerCents(cents), `실측 픽스처 캐시가 소수: ${cents}`);
    assert.ok(Number.isInteger(centsToCash(cents)), `캐시가 소수: ${cents}`);
  }
});

test("키 누락은 파싱 실패다 — 무음 0 렌더 금지", () => {
  const noConfirmed = fixture() as Record<string, unknown>;
  delete noConfirmed.confirmed;
  assert.throws(() => parseMentorSettlementSummary(noConfirmed), MentorSettlementParseError);

  const noRegistered = fixture() as Record<string, unknown>;
  delete noRegistered.payout_account_registered;
  assert.throws(() => parseMentorSettlementSummary(noRegistered), MentorSettlementParseError);

  const noNet = fixture();
  delete (noNet.confirmed as Record<string, unknown>).net_cents;
  assert.throws(() => parseMentorSettlementSummary(noNet), MentorSettlementParseError);
});

test("비정수 cents 는 파싱 실패다 (단위 혼동 신호)", () => {
  const fractional = fixture();
  fractional.accruing.withholding_cents = 490_500.94; // cents 소수 — 구 표시 버그(4,905.94)의 신호
  assert.throws(() => parseMentorSettlementSummary(fractional), MentorSettlementParseError);

  const stringCents = fixture() as ReturnType<typeof fixture> & {
    confirmed: { gross_cents: unknown };
  };
  stringCents.confirmed.gross_cents = "0";
  assert.throws(() => parseMentorSettlementSummary(stringCents), MentorSettlementParseError);
});

test("캐시 소수(100의 배수 아닌 정수 cents)는 파싱은 통과하고 표시 계층 판정으로 넘어간다", () => {
  // 85% 산식 × 20의 배수 아닌 가격이면 합법적으로 발생 (예: 84,910캐시 구독 → 멘토분 7,217,350 cents).
  // 파싱 실패로 페이지 전체를 잠그면 정상 멘토가 복구 불가가 된다 — 값별 단위 오류 표시가 정책이다.
  const subCash = fixture();
  subCash.accruing.mentor_amount_cents = 7_217_350;
  const parsed = parseMentorSettlementSummary(subCash);
  assert.equal(parsed.accruing.mentorAmountCents, 7_217_350);
  assert.equal(isCashIntegerCents(parsed.accruing.mentorAmountCents), false); // → CashText 단위 오류 표식
  assert.equal(centsToCash(parsed.accruing.mentorAmountCents), 72_173.5); // 정확값 그대로(반올림·절사 금지)
  assert.ok(isCashIntegerCents(490_500) && !isCashIntegerCents(490_505));
});
