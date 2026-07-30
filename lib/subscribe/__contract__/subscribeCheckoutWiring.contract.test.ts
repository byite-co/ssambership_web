import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// S2-2 W3(C8) 배선 회귀 방지(소스 스캔 tripwire).
// 구독 checkout 확정은 F12 subscription_checkout_confirm_v2 단일 호출이 정본이고,
// 레거시 confirm 직접 호출·JS 방 생성·SUB/PAY_TABLES 확정 경로 프로빙은 금지다(W3 §8).

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

test("W3(C8): 확정은 F12 단일 호출 — 레거시 confirm 직접 호출 0", () => {
  const svc = read("lib/subscribe/subscribeCheckoutService.ts");
  assert.ok(svc.includes('"subscription_checkout_confirm_v2"'), "F12 호출이 없음");
  assert.ok(svc.includes("callApiWebV1Rpc"), "공용 envelope helper 미사용(임의 parser 중복 금지 — W3 §9)");
  assert.ok(!svc.includes('rpc("confirm_subscription_checkout"'), "레거시 confirm_subscription_checkout 직접 호출이 부활함");
  // 기존 안정 멱등키 유지(재시도마다 새 키 금지).
  assert.ok(svc.includes("sub_checkout_${paymentId}"), "안정 멱등키 sub_checkout_<paymentId> 가 사라짐");
});

test("W3(C8): checkout 의 JS 방 생성·참조 복구 0 — room 은 F12 응답 room_id 정본", () => {
  const svc = read("lib/subscribe/subscribeCheckoutService.ts");
  assert.ok(!svc.includes("ensureMentorStudentRoom"), "JS 직접 방 확보 helper 가 부활함");
  assert.ok(!svc.includes('from("mentor_student_rooms")'), "mentor_student_rooms 직접 접근이 부활함");
  assert.ok(!svc.includes("23505"), "room 23505 재조회 수렴 경로가 부활함");
  assert.ok(svc.includes("room_id"), "F12 응답 room_id 사용이 사라짐");
});

test("W3(C8): 확정 경로의 원장 보정·현재 가격 기반 확정 0", () => {
  const svc = read("lib/subscribe/subscribeCheckoutService.ts");
  assert.ok(!svc.includes("repairMissingSubscriptionCashLedger"), "JS 원장 보정 경로가 부활함");
  assert.ok(!svc.includes('rpc("record_subscription_cash_debit"'), "JS 직접 구독 차감 RPC 가 부활함");
  assert.ok(!svc.includes("resolveMentorPlanDebitAmount"), "확정 직전 mentor_plans 가격 재조회 기반 확정이 부활함");
  assert.ok(svc.includes("p_expected_amount_cents"), "불변 동의 금액 인자가 사라짐");
  assert.ok(svc.includes("expected_amount_cents"), "intent 의 동의 금액 보존(payments.metadata)이 사라짐");
});

test("W3(C8): route 는 표시 금액(amountCents)을 필수로 받아 F12 까지 전달한다", () => {
  const route = read("app/api/subscribe/checkout/route.ts");
  assert.ok(route.includes("expectedAmountCents: amountCents"), "표시 금액이 확정 경로로 전달되지 않음");
  const svc = read("lib/subscribe/subscribeCheckoutService.ts");
  assert.ok(svc.includes("expectedAmountCents"), "expectedAmountCents 인자가 없음");
  // 재생에서 현재 가격으로 교체 금지 — 보존 사본 우선.
  assert.ok(svc.includes("preserved ?? expectedAmountCents"), "재생 시 intent 보존 동의 사본 우선 규칙이 사라짐");
});
