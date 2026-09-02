import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  customRequestCompletedOrderLine,
  customRequestSettlementLine,
  intWon,
  orderGrossWon,
} from "../mentorPayoutLinesCore.ts";

// PR-1b V-2 — 맞춤의뢰 정산 라인은 DB 행 그대로: TS 상수(0.05/0.95) 재계산·휴리스틱 보정 금지.
//   • 요율 있는 행: 결제액·수수료·멘토 몫이 DB 값과 동일(DB 가 TS 상수와 다른 요율을 기록해도 그대로)
//   • 요율 없는 행: feeRate null → '요율 미설정', 수수료·멘토 몫을 요율로 만들어 내지 않는다
//   • 정산 행 없는 완료 주문: gross 만 표시, 수수료·멘토 몫 0 + '요율 미설정'(구 TS 0.95 몫 생성 제거)
//
// 실행: node --test --experimental-strip-types lib/mentor/__contract__/mentorPayoutLinesCore.contract.test.ts

const SETTLEMENT = {
  id: "cosi-1",
  custom_request_order_id: "order-abcdef-1",
  mentor_id: "mentor-1",
  gross_amount: 100_000,
  platform_fee_amount: 5_000,
  mentor_amount: 95_000,
  fee_rate: 0.05,
  status: "pending",
  created_at: "2026-08-15T03:00:00.000Z",
};

test("요율 있는 정산 행: 금액 3종은 DB 값 그대로, feeRate 는 DB 값, 마커 없음", () => {
  const line = customRequestSettlementLine(SETTLEMENT);
  assert.equal(line.id, "cr-cosi-1");
  assert.equal(line.type, "custom_request");
  assert.equal(line.paymentAmount, 100_000);
  assert.equal(line.feeAmount, 5_000);
  assert.equal(line.netAmount, 95_000);
  assert.equal(line.feeRate, 0.05);
  assert.equal(line.description, "맞춤의뢰 주문 · order-ab");
  assert.equal(line.status, "정산예정");
  assert.equal(customRequestSettlementLine({ ...SETTLEMENT, status: "paid" }).status, "지급완료");
  assert.equal(customRequestSettlementLine({ ...SETTLEMENT, status: "on_hold" }).status, "보류");
  assert.equal(customRequestSettlementLine({ ...SETTLEMENT, status: "payable" }).status, "지급가능");
});

test("DB 가 TS 상수(5%)와 다른 요율·수수료를 기록해도 그대로 반영한다 — 구 휴리스틱(15% 미만이면 5% 로 덮어쓰기) 제거", () => {
  const line = customRequestSettlementLine({ ...SETTLEMENT, fee_rate: 0.07, platform_fee_amount: 7_000, mentor_amount: 93_000 });
  assert.equal(line.feeRate, 0.07);
  assert.equal(line.feeAmount, 7_000, "구 코드는 7,000/100,000 < 0.15 라 floor(100,000×0.05)=5,000 으로 덮었다");
  assert.equal(line.netAmount, 93_000);
});

test("요율 없는 정산 행: feeRate null → '요율 미설정', 수수료·멘토 몫은 요율로 계산하지 않는다", () => {
  for (const missing of [null, undefined, "", "n/a"]) {
    const line = customRequestSettlementLine({ ...SETTLEMENT, fee_rate: missing });
    assert.equal(line.feeRate, null, `fee_rate=${String(missing)}`);
    assert.equal(line.description, "맞춤의뢰 주문 · order-ab · 요율 미설정");
    // DB 에 기록된 금액은 그대로 — 재계산되지 않았다.
    assert.equal(line.feeAmount, 5_000);
    assert.equal(line.netAmount, 95_000);
  }
  // 수수료·멘토 몫까지 0 이면 0 으로 남긴다 — gross×0.05 / gross×0.95 를 만들어 내지 않는다.
  const bare = customRequestSettlementLine({ ...SETTLEMENT, fee_rate: null, platform_fee_amount: 0, mentor_amount: 0 });
  assert.equal(bare.feeAmount, 0);
  assert.equal(bare.netAmount, 0);
  assert.equal(bare.paymentAmount, 100_000);
});

test("정산 행 없는 완료 주문: gross 만 표시하고 수수료·멘토 몫은 계산하지 않는다(구 TS 0.95 몫 생성 제거)", () => {
  const line = customRequestCompletedOrderLine({ id: "order-xyz-9", agreed_price: 120_000, created_at: "2026-08-20T00:00:00.000Z" });
  assert.ok(line);
  assert.equal(line.id, "cro-order-xyz-9");
  assert.equal(line.paymentAmount, 120_000);
  assert.equal(line.feeAmount, 0, "구 코드는 120,000 − floor(120,000×0.95) = 6,000 을 지어냈다");
  assert.equal(line.netAmount, 0, "구 코드는 floor(120,000×0.95) = 114,000 을 지어냈다");
  assert.equal(line.feeRate, null);
  assert.equal(line.description, "맞춤의뢰 완료 · order-xy · 요율 미설정");
  assert.equal(line.status, "정산예정");
  assert.equal(customRequestCompletedOrderLine({ id: "o", agreed_price: 0 }), null, "gross 를 모르면 라인 없음");
  assert.equal(customRequestCompletedOrderLine({ agreed_price: 1000 }), null, "id 없으면 라인 없음");
});

test("원 단위 파싱 헬퍼", () => {
  assert.equal(intWon(1234.9), 1234);
  assert.equal(intWon("1,234"), 1234);
  assert.equal(intWon("abc"), 0);
  assert.equal(intWon(null), 0);
  assert.equal(orderGrossWon({ agreed_price: "0", final_price: 50_000 }), 50_000);
  assert.equal(orderGrossWon(null), 0);
});

// ── 소스 스캔: 서비스 층이 휴리스틱·TS 상수 재계산으로 되돌아가지 않는지 ─────────────
test("가드: mentorPayoutsService 의 맞춤의뢰 라인은 순수 매퍼만 쓰고 TS 수수료 상수·휴리스틱을 쓰지 않는다", () => {
  const src = readFileSync(join(process.cwd(), "lib/mentor/mentorPayoutsService.ts"), "utf8");
  assert.ok(src.includes("customRequestSettlementLine("), "정산 행 매퍼 미사용");
  assert.ok(src.includes("customRequestCompletedOrderLine("), "완료 주문 매퍼 미사용");
  assert.ok(!src.includes("MENTOR_CUSTOM_REQUEST_PLATFORM_SHARE"), "TS 플랫폼 수수료 상수 잔존(V-2 회귀)");
  assert.ok(!/\/\s*payment\s*<\s*0\.15/.test(src), "15% 미만 휴리스틱 잔존(V-2 회귀)");
  assert.ok(!/expectedFee/.test(src), "expectedFee 재계산 잔존(V-2 회귀)");
  assert.ok(!/payment\s*\*\s*MENTOR_CUSTOM_REQUEST_SHARE/.test(src), "완료 주문 멘토 몫 TS 0.95 생성 잔존(V-2 회귀)");
});
