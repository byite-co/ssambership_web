import { cashKrwForSubscribeTier } from "./subscribePlanCatalog.ts";
import type { SubscribePlanTier } from "@/lib/subscribe/subscribePageQueries";

/**
 * 요금제 평균가 — `public.plan_price_stats()`(DB-5 205 · anon 가능 · `supabase.rpc('plan_price_stats')`) 순수 코어.
 *
 * 응답 3행 `{plan_tier, sample_count, avg_won, min_won, max_won, fallback}`(limited·standard·premium 순 · 원 단위):
 *   · 승인 멘토 × 활성 플랜 · 평균(중앙값 아님) · 100원 반올림
 *   · 표본 5명 미만이면 `fallback true` · `avg_won = min_won` → 문구 "최저 N원부터"
 *   · 표본 0 이면 금액 NULL → 카탈로그 표시가(`lib/subscribe/subscribePlanCatalog.ts`) 폴백
 * 안내 전용이다 — 결제 금액은 `mentor_plans` 행(실차감액)이며 평균가로 바꾸지 않는다.
 * 갱신은 일 1회 웹 캐시(`planPriceStatsServer.ts` · revalidate 86400).
 */

export const PLAN_PRICE_STATS_RPC = "plan_price_stats" as const;
export const PLAN_PRICE_STATS_REVALIDATE_SECONDS = 86_400;
export const PLAN_PRICE_STATS_CACHE_TAG = "plan-price-stats" as const;

export const PLAN_PRICE_TIERS: readonly SubscribePlanTier[] = ["limited", "standard", "premium"] as const;

export type PlanPriceStat = {
  tier: SubscribePlanTier;
  sampleCount: number;
  /** 원 단위 · 표본 0 이면 null */
  avgWon: number | null;
  minWon: number | null;
  maxWon: number | null;
  /** 표본 5명 미만(avg_won = min_won) */
  fallback: boolean;
};

export type PlanPriceStatsByTier = Record<SubscribePlanTier, PlanPriceStat | null>;

export function emptyPlanPriceStats(): PlanPriceStatsByTier {
  return { limited: null, standard: null, premium: null };
}

function intOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Math.trunc(Number(v));
  return null;
}

function isTier(v: unknown): v is SubscribePlanTier {
  return v === "limited" || v === "standard" || v === "premium";
}

/** RPC 행 배열 → 티어별 통계. 모르는 티어·깨진 행은 버린다(없는 티어는 null → 카탈로그 폴백). */
export function parsePlanPriceStatsRows(data: unknown): PlanPriceStatsByTier {
  const out = emptyPlanPriceStats();
  if (!Array.isArray(data)) return out;
  for (const raw of data) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const tier = row.plan_tier;
    if (!isTier(tier) || out[tier]) continue;
    const sampleCount = Math.max(0, intOrNull(row.sample_count) ?? 0);
    const avgWon = intOrNull(row.avg_won);
    out[tier] = {
      tier,
      sampleCount,
      avgWon: avgWon != null && avgWon > 0 ? avgWon : null,
      minWon: intOrNull(row.min_won),
      maxWon: intOrNull(row.max_won),
      fallback: row.fallback === true || sampleCount < 5,
    };
  }
  return out;
}

export type PlanPriceGuideKind = "average" | "minimum" | "catalog";

export type PlanPriceGuide = {
  kind: PlanPriceGuideKind;
  /** 표시 문구 — "평균 84,900원 / 월" · "최저 29,900원부터" · 카탈로그 "29,900원 / 월" */
  label: string;
  /** 문구에 쓴 금액(원) */
  won: number;
  sampleCount: number;
};

function formatWon(n: number): string {
  return `${Math.max(0, Math.round(n)).toLocaleString("ko-KR")}원`;
}

/**
 * 티어 안내 문구. 폴백 2종:
 *  - `fallback true`(표본 < 5) → "최저 N원부터"(N = min_won · 없으면 avg_won)
 *  - 표본 0(금액 NULL) 또는 통계 없음 → 카탈로그 표시가 "N원 / 월"
 */
export function planPriceGuide(stat: PlanPriceStat | null | undefined, tier: SubscribePlanTier): PlanPriceGuide {
  const catalogWon = cashKrwForSubscribeTier(tier);
  if (!stat || stat.sampleCount <= 0 || (stat.avgWon == null && stat.minWon == null)) {
    return { kind: "catalog", label: `${formatWon(catalogWon)} / 월`, won: catalogWon, sampleCount: stat?.sampleCount ?? 0 };
  }
  if (stat.fallback) {
    const minWon = stat.minWon ?? stat.avgWon ?? catalogWon;
    return { kind: "minimum", label: `최저 ${formatWon(minWon)}부터`, won: minWon, sampleCount: stat.sampleCount };
  }
  const avgWon = stat.avgWon ?? stat.minWon ?? catalogWon;
  return { kind: "average", label: `평균 ${formatWon(avgWon)} / 월`, won: avgWon, sampleCount: stat.sampleCount };
}

/** 티어별 안내 문구 묶음(랜딩·구독 화면 공용). 통계가 없으면 3티어 전부 카탈로그 폴백. */
export function planPriceGuidesByTier(stats: PlanPriceStatsByTier | null | undefined): Record<SubscribePlanTier, PlanPriceGuide> {
  const s = stats ?? emptyPlanPriceStats();
  return {
    limited: planPriceGuide(s.limited, "limited"),
    standard: planPriceGuide(s.standard, "standard"),
    premium: planPriceGuide(s.premium, "premium"),
  };
}
