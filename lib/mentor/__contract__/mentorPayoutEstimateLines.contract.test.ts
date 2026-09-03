import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PAYOUT_AMOUNT_ESTIMATED_LABEL,
  customRequestPerformanceAmount,
  individualQuestionLine,
} from "../mentorPayoutLinesCore.ts";

// V-5 — 성과 목록·개별질문 라인: 정산 행(지급 스냅샷)이 있으면 행 요율·금액(적용값) 그대로, 없으면 정책 요율 추정 + '예상'.
//   • 지급 스냅샷(payout_run_items) 있는 개별질문: 금액 3종·요율이 행 값(DB 가 정책과 다른 요율을 기록해도 그대로)
//   • 스냅샷 없는 개별질문: 구 산식 floor(price × 0.85) 과 같은 추정 + 설명 '· 예상' + amountEstimated
//   • 성과 목록 맞춤의뢰: 정산 행 mentor_amount 우선, 없으면 floor(gross × 0.95) 추정 + amountEstimated
//   • 서비스·표 소스 가드
//
// 실행: node --test --experimental-strip-types lib/mentor/__contract__/mentorPayoutEstimateLines.contract.test.ts

const QUESTION = {
  id: "iq-abcdef-1",
  price_cents: 1_000_000, // 10,000 캐시
  status: "released",
  claimed_mentor_id: "mentor-1",
  released_at: "2026-08-15T03:00:00.000Z",
  answered_at: "2026-08-14T03:00:00.000Z",
  created_at: "2026-08-13T03:00:00.000Z",
  release_ledger_id: null,
};

test("지급 스냅샷 없는 개별질문: 정책 요율 추정(구 산식 floor(price×0.85) 과 동일) + '예상' 표시 + feeRate 없음", () => {
  const line = individualQuestionLine(QUESTION, null)!;
  assert.ok(line);
  assert.equal(line.id, "iq-iq-abcdef-1");
  assert.equal(line.type, "individual_question");
  assert.equal(line.date, "2026-08-15T03:00:00.000Z");
  assert.equal(line.description, `개별질문 · iq-abcde · ${PAYOUT_AMOUNT_ESTIMATED_LABEL}`);
  assert.equal(PAYOUT_AMOUNT_ESTIMATED_LABEL, "예상");
  assert.equal(line.paymentAmount, 10_000);
  assert.equal(line.netAmount, 8_500, "구 코드: minorCentsToCash(floor(1,000,000 × 0.85))");
  assert.equal(line.feeAmount, 1_500);
  assert.equal(line.amountEstimated, true);
  assert.equal(line.feeRate, undefined, "정산 행이 없으니 적용 요율도 없다(정책값을 feeRate 로 흘리지 않는다)");
  assert.equal(line.status, "정산예정");
  assert.equal(individualQuestionLine({ ...QUESTION, release_ledger_id: "ledger-1" }, null)!.status, "지급완료");
  // 날짜 폴백·id 없음은 구 동작 그대로
  assert.equal(individualQuestionLine({ ...QUESTION, released_at: null }, null)!.date, "2026-08-14T03:00:00.000Z");
  const noId = individualQuestionLine({ ...QUESTION, id: undefined }, null)!;
  assert.equal(noId.id, "iq-");
  assert.equal(noId.description, `개별질문 · ${PAYOUT_AMOUNT_ESTIMATED_LABEL}`);
  // 가격을 모르면 라인 없음
  assert.equal(individualQuestionLine({ ...QUESTION, price_cents: 0 }, null), null);
  assert.equal(individualQuestionLine({ ...QUESTION, price_cents: "abc" }, null), null);
});

test("지급 스냅샷(payout_run_items) 있는 개별질문: 결제액·수수료·멘토 몫·요율은 행 그대로 — DB 가 정책(15%)과 다른 20% 를 기록해도 그대로(구 코드는 8,500 을 표시했다)", () => {
  const runItem = { source_id: "iq-abcdef-1", gross_cents: 1_000_000, platform_fee_cents: 200_000, mentor_amount_cents: 800_000, fee_rate: 0.2 };
  const line = individualQuestionLine(QUESTION, runItem)!;
  assert.equal(line.paymentAmount, 10_000);
  assert.equal(line.feeAmount, 2_000);
  assert.equal(line.netAmount, 8_000, "구 코드는 정산 행이 있어도 floor(price×0.85)=8,500 으로 계산했다(V-5 결함 유형)");
  assert.equal(line.feeRate, 0.2);
  assert.equal(line.description, "개별질문 · iq-abcde", "'예상' 없음");
  assert.equal(line.amountEstimated, undefined);
  assert.equal(line.status, "정산예정");
  // 문자열 요율·요율 없는 행(행은 있지만 fee_rate 비어 있음)
  assert.equal(individualQuestionLine(QUESTION, { ...runItem, fee_rate: "0.15" })!.feeRate, 0.15);
  const unset = individualQuestionLine(QUESTION, { ...runItem, fee_rate: null })!;
  assert.equal(unset.feeRate, null);
  assert.equal(unset.netAmount, 8_000, "요율이 비어도 행 금액은 그대로 — 재계산하지 않는다");
  // 정책과 같은 요율의 정상 행: 숫자는 구 화면과 동일
  const normal = individualQuestionLine(QUESTION, { ...runItem, platform_fee_cents: 150_000, mentor_amount_cents: 850_000, fee_rate: 0.15 })!;
  assert.equal(normal.netAmount, 8_500);
  assert.equal(normal.feeAmount, 1_500);
});

test("성과 목록 맞춤의뢰 금액: 정산 행 mentor_amount 우선(적용 요율), 없으면 floor(gross×0.95) 추정 + amountEstimated", () => {
  const order = { id: "order-1", agreed_price: 120_000, created_at: "2026-08-20T00:00:00.000Z" };
  assert.deepEqual(customRequestPerformanceAmount(order, null), { amount: 114_000, amountEstimated: true }, "구 코드: floor(120,000 × 0.95)");
  assert.deepEqual(customRequestPerformanceAmount({ id: "order-2" }, null), { amount: 0, amountEstimated: true }, "gross 를 모르면 0(구 동작)");
  assert.deepEqual(
    customRequestPerformanceAmount(order, { custom_request_order_id: "order-1", gross_amount: 120_000, platform_fee_amount: 27_000, mentor_amount: 93_000, fee_rate: 0.225 }),
    { amount: 93_000, amountEstimated: false },
    "구 코드는 정산 행이 있어도 114,000 을 표시했다(V-5 결함 유형)"
  );
  assert.deepEqual(customRequestPerformanceAmount(order, { mentor_amount: "95,000" }), { amount: 95_000, amountEstimated: false });
  assert.deepEqual(customRequestPerformanceAmount(order, { mentor_amount: 114_000, fee_rate: 0.05 }), { amount: 114_000, amountEstimated: false }, "정상 5% 행은 숫자가 구 화면과 같다");
});

// ── 소스 스캔: 서비스·표가 매퍼를 쓰고 TS 상수·정책 직접 호출로 되돌아가지 않는지 ──
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));
}

test("가드: mentorPayoutsService 는 매퍼(individualQuestionLine · customRequestPerformanceAmount)와 지급 스냅샷·정산 행 조회를 쓰고 정책 모듈을 직접 부르지 않는다 · 성과 표는 '예상' 을 표기한다", () => {
  const src = stripComments(readFileSync(join(process.cwd(), "lib/mentor/mentorPayoutsService.ts"), "utf8"));
  assert.ok(src.includes("individualQuestionLine("), "개별질문 매퍼 미사용");
  assert.ok(src.includes("customRequestPerformanceAmount("), "성과 목록 매퍼 미사용");
  assert.ok(src.includes('.from("payout_run_items")') && src.includes('.eq("source_type", "individual_question")'), "개별질문 지급 스냅샷(payout_run_items) 조회 없음");
  assert.ok(/loadPerformanceLines[\s\S]*loadMentorSettlementItemsForPayouts\(client, mentorId\)/.test(src), "성과 목록이 정산 행을 읽지 않는다");
  assert.ok(!/platformFeePolicy|estimateMentorAmount\(|mentorShareRate\(/.test(src), "서비스 층이 정책 모듈을 직접 호출(행 우선 매퍼를 우회)");
  assert.ok(!/Math\.floor\(\s*(?:gross|priceCents|price)\s*\*/.test(src), "TS 상수 재계산 잔존");
  const table = readFileSync(join(process.cwd(), "components/mentor/payouts/MentorPayoutsPerformanceTable.tsx"), "utf8");
  assert.ok(table.includes("row.amountEstimated") && table.includes("PAYOUT_AMOUNT_ESTIMATED_LABEL"), "성과 표에 '예상' 표기가 없다");
});
