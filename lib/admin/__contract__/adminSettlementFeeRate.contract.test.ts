import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ADMIN_SETTLEMENT_FEE_RATE_UNSET_LABEL,
  adminSettlementFeeRateLabel,
  parseCosItem,
  parseSettlementFeeRate,
  parseSubscriptionSettlementItem,
  summarizeSettlementRows,
  withFeeRateUnsetMarker,
} from "../adminSettlementItems.ts";

// PR-1b(관리자 콘솔 값 연동) — 구독 정산 feeRate 폴백 0.3(구 30% 잔재) 제거.
//   • 요율 없는 행은 feeRate null → '요율 미설정' 표시, 어떤 금액도 요율로 계산되지 않는다
//   • 요율 있는 행은 수정 전후 금액이 동일하다(DB 행 그대로)
//   • 폴백 리터럴(0.3 / 0.15 / 0)이 파서에 다시 들어오지 않는지 소스 스캔
//
// 실행: node --test --experimental-strip-types lib/admin/__contract__/adminSettlementFeeRate.contract.test.ts

const SUB_ROW = {
  id: "ssi-1",
  billing_event_id: "be-1",
  subscription_id: "sub-1",
  mentor_id: "mentor-1",
  student_id: "student-1",
  event_type: "renewal",
  billing_at: "2026-08-15T03:00:00.000Z",
  period_start: "2026-08-01T00:00:00.000Z",
  period_end: "2026-08-31T23:59:59.000Z",
  gross_cents: 8_490_000, // 84,900 캐시
  platform_fee_cents: 1_273_500, // DB 가 계산한 15%
  mentor_amount_cents: 7_216_500,
  fee_rate: 0.15,
  status: "pending",
  hold_reason: null,
  paid_at: null,
  created_at: "2026-08-15T03:00:00.000Z",
  updated_at: "2026-08-15T03:00:00.000Z",
};

test("요율 있는 행: 금액은 DB 행 그대로(cents/100), feeRate 는 DB 값", () => {
  const it = parseSubscriptionSettlementItem(SUB_ROW)!;
  assert.equal(it.feeRate, 0.15);
  assert.equal(it.grossAmount, 84_900);
  assert.equal(it.platformFeeAmount, 12_735);
  assert.equal(it.mentorAmount, 72_165);
  assert.equal(it.status, "pending");
  assert.ok(it.orderMetaLine?.startsWith("구독 정산 · renewal · "), it.orderMetaLine ?? "");
  assert.ok(!it.orderMetaLine?.includes(ADMIN_SETTLEMENT_FEE_RATE_UNSET_LABEL), "요율 있는 행에 마커가 붙으면 안 됨");
});

test("요율 없는 행: feeRate 는 null(0.3/0.15 추측 금지) → '요율 미설정' 표시, 금액은 요율로 계산되지 않는다", () => {
  for (const missing of [null, undefined, "", "abc"]) {
    const it = parseSubscriptionSettlementItem({ ...SUB_ROW, fee_rate: missing })!;
    assert.equal(it.feeRate, null, `fee_rate=${String(missing)} 은 null 이어야 함`);
    assert.equal(adminSettlementFeeRateLabel(it.feeRate), "요율 미설정");
    assert.ok(it.orderMetaLine?.endsWith(" · 요율 미설정"), `마커 누락: ${it.orderMetaLine}`);
    // 금액은 여전히 DB cents 값 — 어떤 요율로도 재계산되지 않았다.
    assert.equal(it.grossAmount, 84_900);
    assert.equal(it.platformFeeAmount, 12_735);
    assert.equal(it.mentorAmount, 72_165);
  }
  // 수수료 cents 까지 비어 있어도 gross×0.3(=25,470)·gross×0.15(=12,735) 를 만들어 내지 않는다.
  const bare = parseSubscriptionSettlementItem({ ...SUB_ROW, fee_rate: null, platform_fee_cents: null, mentor_amount_cents: null })!;
  assert.equal(bare.platformFeeAmount, 0);
  assert.equal(bare.mentorAmount, 0);
  assert.equal(bare.feeRate, null);
});

test("맞춤의뢰 정산 행도 같은 규칙(구 폴백 0 제거)", () => {
  const base = {
    id: "cosi-1",
    custom_request_order_id: "order-1",
    mentor_id: "mentor-1",
    student_id: "student-1",
    gross_amount: 100_000,
    platform_fee_amount: 5_000,
    mentor_amount: 95_000,
    fee_rate: 0.05,
    status: "pending",
    reason: null,
    paid_at: null,
    created_at: "2026-08-15T03:00:00.000Z",
    updated_at: "2026-08-15T03:00:00.000Z",
  };
  const ok = parseCosItem(base)!;
  assert.equal(ok.feeRate, 0.05);
  assert.equal(ok.orderMetaLine, null, "주문 보조 조회 전에는 메타 없음");
  assert.equal(ok.grossAmount, 100_000);
  assert.equal(ok.platformFeeAmount, 5_000);
  assert.equal(ok.mentorAmount, 95_000);

  const missing = parseCosItem({ ...base, fee_rate: null })!;
  assert.equal(missing.feeRate, null, "구 폴백 0(=0%) 도 사본이다");
  assert.equal(missing.orderMetaLine, "요율 미설정");
  assert.equal(missing.mentorAmount, 95_000, "금액은 DB 행 그대로");
});

test("요율 파싱·라벨·마커 헬퍼", () => {
  assert.equal(parseSettlementFeeRate(0.15), 0.15);
  assert.equal(parseSettlementFeeRate("0.05"), 0.05);
  assert.equal(parseSettlementFeeRate(0), 0, "DB 가 0 을 저장했으면 0 은 값이다(폴백이 아님)");
  assert.equal(parseSettlementFeeRate(null), null);
  assert.equal(parseSettlementFeeRate(undefined), null);
  assert.equal(parseSettlementFeeRate(""), null);
  assert.equal(parseSettlementFeeRate("n/a"), null);
  assert.equal(parseSettlementFeeRate(Number.NaN), null);

  assert.equal(adminSettlementFeeRateLabel(null), ADMIN_SETTLEMENT_FEE_RATE_UNSET_LABEL);
  assert.equal(adminSettlementFeeRateLabel(0.15), "15%");
  assert.equal(adminSettlementFeeRateLabel(0.05), "5%");
  assert.equal(adminSettlementFeeRateLabel(0.3), "30%");
  assert.equal(adminSettlementFeeRateLabel(0.055), "5.5%");

  assert.equal(withFeeRateUnsetMarker("주문 완료", 0.15), "주문 완료");
  assert.equal(withFeeRateUnsetMarker(null, 0.15), null);
  assert.equal(withFeeRateUnsetMarker(null, null), "요율 미설정");
  assert.equal(withFeeRateUnsetMarker("a · b", null), "a · b · 요율 미설정");
});

test("요약 합계는 행의 DB 금액을 그대로 합산한다(요율 재계산 없음) — 요율 없는 행도 크래시 없이 집계", () => {
  const withRate = parseSubscriptionSettlementItem(SUB_ROW)!;
  const noRate = parseSubscriptionSettlementItem({ ...SUB_ROW, id: "ssi-2", fee_rate: null, status: "paid" })!;
  const s = summarizeSettlementRows([withRate, noRate]);
  assert.equal(s.totalRows, 2);
  assert.equal(s.pendingMentorAmountSum, 72_165);
  assert.equal(s.paidMentorAmountSum, 72_165);
  assert.equal(s.pendingCount, 1);
  assert.equal(s.paidCount, 1);
});

// ── 소스 스캔: 요율 폴백 리터럴 회귀 방지 ─────────────────────────────────────
const ROOT = process.cwd();
const FEE_FALLBACK_RE = /feeRate\s*:\s*[^,\n]*\?[^:\n]*:\s*0(?:\.\d+)?\s*,/;

test("가드: 정산 파서·관리자 조회에 feeRate 폴백 리터럴(0.3 / 0.15 / 0)이 없다", () => {
  for (const rel of ["lib/admin/adminSettlementItems.ts", "lib/admin/adminQueries.ts"]) {
    const src = readFileSync(join(ROOT, rel), "utf8");
    assert.ok(!FEE_FALLBACK_RE.test(src), `${rel}: feeRate 삼항 폴백 리터럴 발견 — null + '요율 미설정' 으로 두라`);
    assert.ok(!/:\s*0\.3\b/.test(src), `${rel}: 0.3 리터럴(구 30%) 발견`);
  }
  const items = readFileSync(join(ROOT, "lib/admin/adminSettlementItems.ts"), "utf8");
  assert.ok(items.includes("parseSettlementFeeRate(r.fee_rate)"), "파서가 공용 요율 파서를 쓰지 않음");
});
