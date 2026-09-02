import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Wave1 L6 학생핵심 — 구독/cap 결함 회귀 방지(소스 스캔 tripwire).
const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

test("D-ST-11: cap usage 는 '판정 불가'(indeterminate)를 used 0 과 구분한다", () => {
  // PR-1b: 판정 로직은 순수 모듈(mentorCapUsageCore.ts)로 옮겨졌다 — 서버 진입점은 클라이언트 생성만 한다.
  const core = read("lib/subscribe/mentorCapUsageCore.ts");
  assert.ok(core.includes("indeterminate"), "indeterminate 신호가 없음");
  assert.ok(core.includes("indeterminateUsage("), "RPC 실패를 판정 불가로 전파하지 않음");
  assert.ok(
    /if\s*\(usage\.indeterminate\)\s*return true;/.test(core),
    "wouldExceedCap 이 indeterminate 를 fail-closed(true)로 처리하지 않음",
  );
  const svc = read("lib/subscribe/mentorCapService.ts");
  assert.ok(svc.includes("indeterminateUsage()"), "서비스 키 부재를 판정 불가로 전파하지 않음");
});

test("D-ST-11: 결제 경로는 cap 판정 불가 시 fail-closed 로 거부한다", () => {
  const svc = read("lib/subscribe/subscribeCheckoutService.ts");
  assert.ok(svc.includes("capUsage.indeterminate"), "checkout 이 indeterminate 를 명시 거부하지 않음");
});

test("D-ST-12: /subscribe 로더의 영구 빈 프로모션 스텁 제거", () => {
  const q = read("lib/subscribe/subscribePageQueries.ts");
  assert.ok(!q.includes("emptyPromotionsLoad"), "프로모션 스텁(emptyPromotionsLoad)이 잔존함");
});

test("D-ST-16: 해지 예약 만료는 'canceled', 미납 만료는 'expired' 로 구분 기록한다", () => {
  const q = read("lib/subscribe/subscriptionRenewalBatch.ts");
  const cancelFn = q.slice(
    q.indexOf("async function markCanceledAtPeriodEnd"),
    q.indexOf("async function markExpired"),
  );
  assert.ok(cancelFn.length > 0, "markCanceledAtPeriodEnd 를 찾지 못함");
  assert.ok(cancelFn.includes('eventType: "canceled"'), "해지 예약 만료가 여전히 'expired' 로 기록됨");
});
