// 계약 테스트: 요금제 평균가 `plan_price_stats`(DB-5 205) 웹 표시 — 웹 PR-2 §4.
// 실행: node --test --experimental-strip-types lib/subscribe/__contract__/planPriceStats.contract.test.ts
//
// 고정하는 것: 응답 3행 해석 · 폴백 2종(표본<5 "최저 N원부터" · 표본 0 → 카탈로그 표시가) · 일 1회 캐시 ·
// 결제 금액은 평균가로 바꾸지 않는다(구독 화면은 mentor_plans 그대로 · 안내만).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PLAN_PRICE_STATS_REVALIDATE_SECONDS,
  PLAN_PRICE_STATS_RPC,
  emptyPlanPriceStats,
  parsePlanPriceStatsRows,
  planPriceGuide,
  planPriceGuidesByTier,
} from "../planPriceStats.ts";
import { SUBSCRIBE_PLAN_CATALOG } from "../subscribePlanCatalog.ts";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const ROWS = [
  { plan_tier: "limited", sample_count: 75, avg_won: 30000, min_won: 29900, max_won: 69900, fallback: false },
  { plan_tier: "standard", sample_count: 4, avg_won: 84900, min_won: 84900, max_won: 120000, fallback: true },
  { plan_tier: "premium", sample_count: 0, avg_won: null, min_won: null, max_won: null, fallback: true },
];

test("RPC 이름·캐시 주기(일 1회) — 지시서 A '매일 갱신은 웹 캐시'", () => {
  assert.equal(PLAN_PRICE_STATS_RPC, "plan_price_stats");
  assert.equal(PLAN_PRICE_STATS_REVALIDATE_SECONDS, 86_400);
  const server = read("lib/subscribe/planPriceStatsServer.ts");
  assert.ok(server.includes("unstable_cache(") && server.includes("revalidate: PLAN_PRICE_STATS_REVALIDATE_SECONDS"), "일 1회 캐시 미배선");
  assert.ok(server.includes('import "server-only"'), "서버 전용");
  assert.ok(!server.includes('from "next/headers"'), "캐시 스코프 안에서 cookies 접근 금지 — anon 클라이언트");
});

test("응답 3행 해석: 티어별 통계 · 표본 0 은 금액 null · 미지 티어·깨진 행 무시", () => {
  const s = parsePlanPriceStatsRows([...ROWS, { plan_tier: "gold", sample_count: 9, avg_won: 1 }, "x", null]);
  assert.equal(s.limited?.avgWon, 30000);
  assert.equal(s.limited?.fallback, false);
  assert.equal(s.standard?.fallback, true);
  assert.equal(s.premium?.sampleCount, 0);
  assert.equal(s.premium?.avgWon, null);
  assert.deepEqual(parsePlanPriceStatsRows(null), emptyPlanPriceStats());
  assert.deepEqual(parsePlanPriceStatsRows({ plan_tier: "limited" }), emptyPlanPriceStats());
});

test("표본 ≥ 5 → '평균 N원 / 월'", () => {
  const g = planPriceGuide(parsePlanPriceStatsRows(ROWS).limited, "limited");
  assert.deepEqual(g, { kind: "average", label: "평균 30,000원 / 월", won: 30000, sampleCount: 75 });
});

test("폴백 ① 표본 < 5(fallback true) → '최저 N원부터'(min_won)", () => {
  const g = planPriceGuide(parsePlanPriceStatsRows(ROWS).standard, "standard");
  assert.deepEqual(g, { kind: "minimum", label: "최저 84,900원부터", won: 84900, sampleCount: 4 });
  // fallback 플래그가 없어도 표본 < 5 면 최소값 문구
  const g2 = planPriceGuide(parsePlanPriceStatsRows([{ plan_tier: "premium", sample_count: 2, avg_won: 200000, min_won: 180000 }]).premium, "premium");
  assert.equal(g2.kind, "minimum");
  assert.equal(g2.won, 180000);
});

test("폴백 ② 표본 0(금액 NULL) · 통계 없음 · 로드 실패(null) → 카탈로그 표시가", () => {
  const catalogPremium = SUBSCRIBE_PLAN_CATALOG.find((p) => p.tier === "premium")!.cashKrw;
  const g = planPriceGuide(parsePlanPriceStatsRows(ROWS).premium, "premium");
  assert.deepEqual(g, { kind: "catalog", label: `${catalogPremium.toLocaleString("ko-KR")}원 / 월`, won: catalogPremium, sampleCount: 0 });
  assert.equal(planPriceGuide(null, "limited").kind, "catalog");
  const all = planPriceGuidesByTier(null);
  for (const p of SUBSCRIBE_PLAN_CATALOG) {
    assert.equal(all[p.tier].kind, "catalog", p.tier);
    assert.equal(all[p.tier].won, p.cashKrw, `${p.tier} 카탈로그 값(29,900/84,900/174,900)`);
  }
});

test("배선: 랜딩 요금제 카드는 평균가 문구 · 구독 화면 결제 금액은 mentor_plans 그대로(평균가는 안내만)", () => {
  const landing = read("components/landing/PublicGuestLanding.tsx");
  assert.ok(landing.includes("planPriceGuidesByTier("), "랜딩 카드가 평균가를 쓰지 않음");
  assert.ok(!landing.includes("멘토 재량"), "구 고정 문구 잔존");
  const loader = read("lib/landing/landingPageQueries.ts");
  assert.ok(loader.includes("loadPlanPriceStatsCached()"), "랜딩 로더가 캐시 로더를 쓰지 않음");
  const subscribe = read("app/(student)/subscribe/page.tsx");
  assert.ok(subscribe.includes("cashKrw: mentorPlanCashKrw("), "결제 금액이 mentor_plans 행이 아니다");
  assert.ok(subscribe.includes("priceGuideLabel"), "구독 화면 안내 문구 미배선");
  const client = read("components/subscribe/SubscribeCheckoutClient.tsx");
  assert.ok(client.includes("const amountCents = selected.cashKrw * 100;"), "결제 금액 계산이 바뀌었다");
});
