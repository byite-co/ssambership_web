// 계약 테스트: 학생 구독 환불 RPC(DB-4 200 · `api_app_v1.refund_estimate` · `refund_request_create`) — 웹 PR-2 §5-3.
// 실행: node --test --experimental-strip-types lib/subscribe/__contract__/subscriptionRefundRpc.contract.test.ts
//
// 고정하는 것: 응답 해석(예상액·일수·bracket) · 신청 결과·오류 코드 매핑(원문 비반영) · 배선(학생 경로는
// TS 계산 `subscriptionRefundProration` 을 import 하지 않고 service_role 로 refunds 를 직접 쓰지 않는다 · 학원법 안내 카피 유지).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  REFUND_ESTIMATE_RPC,
  REFUND_REQUEST_CREATE_RPC,
  REFUND_REQUEST_GENERIC_ERROR,
  REFUND_RPC_SCHEMA,
  parseRefundEstimateResponse,
  parseRefundRequestCreateResponse,
  unavailableRefundEstimate,
} from "../subscriptionRefundRpc.ts";
import { refundBracketLabelKo } from "../subscriptionRefundDisplay.ts";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

test("RPC 이름·스키마 — DB-4 보고서 §2-B 시그니처", () => {
  assert.equal(REFUND_RPC_SCHEMA, "api_app_v1");
  assert.equal(REFUND_ESTIMATE_RPC, "refund_estimate");
  assert.equal(REFUND_REQUEST_CREATE_RPC, "refund_request_create");
});

test("refund_estimate 성공 응답 → 예상액(cents)·남은/전체 일수·bracket(TS 이름 그대로)·rule", () => {
  const v = parseRefundEstimateResponse({
    ok: true,
    refundable_cents: 5_660_000,
    amount_cents: 8_490_000,
    rule: "1/3 전",
    bracket_reason: "lt_1_3",
    usage_started: true,
    elapsed_days: 9,
    period_days: 30,
    remaining_days: 21,
  });
  assert.deepEqual(v, {
    amountCents: 5_660_000,
    remainingDays: 21,
    totalDays: 30,
    bracketReason: "lt_1_3",
    rule: "1/3 전",
    usageStarted: true,
    unavailable: false,
  });
  assert.equal(refundBracketLabelKo(v.bracketReason), "기간 1/3 미경과 — 결제액의 2/3 환불");
  // 1/2 경과 → 0 · ge_1_2 / 계산 불가 → invalid
  assert.equal(parseRefundEstimateResponse({ ok: true, refundable_cents: 0, bracket_reason: "ge_1_2", period_days: 30, remaining_days: 11 }).bracketReason, "ge_1_2");
  assert.equal(parseRefundEstimateResponse({ ok: true, refundable_cents: 0, bracket_reason: "계산 불가" }).bracketReason, "invalid");
});

test("refund_estimate 실패(ok:false · RPC 오류 · 깨진 응답) → unavailable(금액 0 · 신청 불가)", () => {
  for (const bad of [{ ok: false, code: "NOT_SUBSCRIPTION_OWNER" }, null, "x", ["x"]]) {
    assert.deepEqual(parseRefundEstimateResponse(bad), unavailableRefundEstimate());
  }
  assert.deepEqual(parseRefundEstimateResponse({ ok: true, refundable_cents: 100 }, { message: "permission denied" }), unavailableRefundEstimate());
  assert.equal(unavailableRefundEstimate().unavailable, true);
  assert.equal(unavailableRefundEstimate().amountCents, 0);
});

test("refund_request_create 성공 → refund_id·amount_cents·bracket", () => {
  const r = parseRefundRequestCreateResponse({ ok: true, refund_id: "r-1", subscription_id: "s-1", amount_cents: 4_245_000, rule: "1/2 전", bracket_reason: "lt_1_2", status: "pending" });
  assert.deepEqual(r, { ok: true, refundId: "r-1", amountCents: 4_245_000, bracketReason: "lt_1_2" });
});

test("refund_request_create 오류 코드 → 사용자 문구(원문 비반영) · REFUND_NOT_AVAILABLE(ge_1_2) 는 학원법 문구", () => {
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ ok: false, code: "REASON_TOO_SHORT", min_length: 5 }, "환불 신청 사유를 5자 이상 입력해 주세요."],
    [{ ok: false, code: "ALREADY_REQUESTED", refund_id: "r-9" }, "이미 검토 중인 환불 신청이 있습니다."],
    [{ ok: false, code: "SUBSCRIPTION_NOT_CURRENT", status: "expired" }, "이미 종료되었거나 환불 신청할 수 없는 구독입니다."],
    [{ ok: false, code: "NOT_SUBSCRIPTION_OWNER" }, "본인 구독만 처리할 수 있습니다."],
    [{ ok: false, code: "REFUND_NOT_AVAILABLE", rule: "1/2 후", bracket_reason: "ge_1_2" }, "학원법 기준으로 기간 1/2를 경과하여 환불 가능 금액이 없습니다."],
    [{ ok: false, code: "REFUND_NOT_AVAILABLE", rule: "계산 불가", bracket_reason: "invalid" }, "남은 이용 기간이 없거나 환불 예상액을 계산할 수 없습니다."],
    [{ ok: false, code: "ACCOUNT_SUSPENDED" }, "일시 정지된 계정은 환불을 신청할 수 없어요."],
    [{ ok: false, code: "BRAND_NEW_CODE" }, REFUND_REQUEST_GENERIC_ERROR],
  ];
  for (const [payload, message] of cases) {
    const r = parseRefundRequestCreateResponse(payload);
    assert.equal(r.ok, false, String(payload.code));
    assert.equal(r.ok === false && r.message, message, String(payload.code));
  }
  const pg = parseRefundRequestCreateResponse(null, { message: "permission denied for schema api_app_v1" });
  assert.equal(pg.ok === false && pg.message, REFUND_REQUEST_GENERIC_ERROR);
});

test("배선: 학생 경로(목록·환불 화면·신청 액션·마이페이지)는 TS 계산을 import 하지 않고 RPC 만 쓴다 · service_role refunds INSERT 0 · 학원법 카피 유지", () => {
  const mgmt = read("lib/subscribe/studentSubscriptionManagement.ts");
  assert.ok(!mgmt.includes("subscriptionRefundProration"), "학생 목록이 TS 계산을 쓴다");
  assert.ok(!mgmt.includes("computeProratedRefundEstimate") && !mgmt.includes("bulkHasSubscriptionUsageStarted"), "TS 계산·이용 개시 판정 잔존");
  assert.ok(mgmt.includes(".rpc(REFUND_ESTIMATE_RPC, { p_subscription_id: subId })"), "refund_estimate 미배선");

  const action = read("lib/subscribe/subscriptionCancelActions.ts");
  assert.ok(!action.includes("subscriptionRefundProration") && !action.includes("computeProratedRefundEstimate"), "신청 액션이 TS 계산을 쓴다");
  assert.ok(action.includes('.rpc(REFUND_REQUEST_CREATE_RPC, { p_subscription_id: subscriptionId, p_reason: reason })'), "refund_request_create 미배선");
  assert.ok(!/from\(["']refunds["']\)[\s\S]{0,200}?\.insert\(/.test(action), "service_role 로 refunds 를 직접 쓴다");
  assert.ok(!action.includes('"subscription_prorated"'), "request_type 은 RPC 가 정한다");

  const mypage = read("lib/mypage/studentActiveSubscriptions.ts");
  assert.ok(!mypage.includes("subscriptionRefundProration"), "마이페이지 로더가 TS 계산 모듈을 import");

  const refundsPage = read("app/(student)/support/refunds/page.tsx");
  assert.ok(refundsPage.includes("학원법 시행령 별표4 기준"), "학원법 안내 카피가 사라짐");
  assert.ok(refundsPage.includes("item.refundEstimate.remainingDays") && refundsPage.includes("item.refundEstimate.totalDays"), "남은/전체 일수 표시 유지");
  const list = read("components/subscribe/StudentSubscriptionsList.tsx");
  assert.ok(list.includes("학원법 시행령 별표4 기준"), "구독 목록 학원법 안내 카피 유지");

  // 잔존 소비처(범위 밖 · DB-6/관리자 PR 몫)만 TS 계산을 쓴다 — 학생 경로 재유입 감시.
  const proration = read("lib/subscribe/subscriptionRefundProration.ts");
  assert.ok(proration.includes("학생 경로에 다시 import 하지 마라"), "폐기 경고 헤더 없음");
});
