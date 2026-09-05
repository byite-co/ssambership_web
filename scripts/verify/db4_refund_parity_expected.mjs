#!/usr/bin/env node
// db4_refund_parity_expected.mjs — DB-4 묶음 B(200) 환불 계산 SQL ↔ 웹 TS 대조용 기대값.
// 웹 정본 lib/subscribe/subscriptionRefundProration.ts computeProratedRefundEstimate(student_voluntary) 를 그대로 실행해
// scripts/verify/fixtures/db4_batch_post_fixture.sql 의 경계값 픽스처(같은 start/end/now/amount)와 동일한 입력으로 기대값을 찍는다.
// 사용: node --experimental-strip-types scripts/verify/db4_refund_parity_expected.mjs
//   → TSV: label  refundable_cents  bracket_reason  remaining_days  period_days
// local_db4_batch_check.sh 가 SQL 결과(core_private.subscription_refund_estimate_impl)와 줄 단위로 대조한다.
import { computeProratedRefundEstimate } from "../../lib/subscribe/subscriptionRefundProration.ts";

// 픽스처와 동일한 상수 — 기간 30일(2026-09-01T00:00Z ~ 2026-10-01T00:00Z) · 결제액 84,900캐시(8,490,000 cents)
export const PARITY_START = "2026-09-01T00:00:00.000Z";
export const PARITY_END = "2026-10-01T00:00:00.000Z";
export const PARITY_AMOUNT_CENTS = 8490000;
export const PARITY_CASES = [
  // [label, now, usageStarted]
  ["before_usage", "2026-09-05T00:00:00.000Z", false],
  ["lt_1_3_just_under", "2026-09-10T23:59:59.000Z", true],
  ["exact_1_3", "2026-09-11T00:00:00.000Z", true],
  ["lt_1_2_just_under", "2026-09-15T23:59:59.000Z", true],
  ["exact_1_2", "2026-09-16T00:00:00.000Z", true],
  ["after_1_2", "2026-09-20T00:00:00.000Z", true],
  ["before_start_usage", "2026-08-31T12:00:00.000Z", true],
  ["after_end", "2026-10-05T00:00:00.000Z", true],
];

for (const [label, nowIso, usageStarted] of PARITY_CASES) {
  const r = computeProratedRefundEstimate({
    amountCents: PARITY_AMOUNT_CENTS,
    periodStartIso: PARITY_START,
    periodEndIso: PARITY_END,
    now: new Date(nowIso),
    usageStarted,
    mode: "student_voluntary",
  });
  process.stdout.write(`${label}\t${r.amountCents}\t${r.bracketReason}\t${r.remainingDays}\t${r.totalDays}\n`);
}
