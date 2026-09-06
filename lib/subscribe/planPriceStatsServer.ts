import "server-only";

import { unstable_cache } from "next/cache";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import {
  PLAN_PRICE_STATS_CACHE_TAG,
  PLAN_PRICE_STATS_REVALIDATE_SECONDS,
  PLAN_PRICE_STATS_RPC,
  parsePlanPriceStatsRows,
  type PlanPriceStatsByTier,
} from "@/lib/subscribe/planPriceStats";

/**
 * `plan_price_stats` 서버 로더 — 일 1회 캐시(revalidate 86400 · 지시서 "매일 갱신은 웹 캐시").
 *
 * - anon 호출 가능한 public RPC 이므로 쿠키 없는 anon 클라이언트로 부른다(캐시 스코프 안에서 cookies() 접근 불가).
 * - 실패·키 부재는 null → 호출부가 카탈로그 표시가로 폴백(랜딩·구독 안내가 500 나지 않게).
 * - Next 16 은 `use cache` 를 권하지만 cacheComponents 미채택 저장소라 `unstable_cache` 를 쓴다.
 */
async function fetchPlanPriceStats(): Promise<PlanPriceStatsByTier | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.SUPABASE_ANON_KEY ??
    "";
  if (!url.trim() || !anonKey.trim()) return null;
  try {
    const client = createSupabaseClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await client.rpc(PLAN_PRICE_STATS_RPC);
    if (error) {
      console.error("[planPriceStats] rpc failed", error.message);
      return null;
    }
    return parsePlanPriceStatsRows(data);
  } catch (e) {
    console.error("[planPriceStats] rpc threw", e instanceof Error ? e.message : String(e));
    return null;
  }
}

const cachedPlanPriceStats = unstable_cache(fetchPlanPriceStats, [PLAN_PRICE_STATS_CACHE_TAG], {
  revalidate: PLAN_PRICE_STATS_REVALIDATE_SECONDS,
  tags: [PLAN_PRICE_STATS_CACHE_TAG],
});

/** 랜딩·구독 안내용 평균가(캐시). 실패 시 null → 카탈로그 폴백. */
export async function loadPlanPriceStatsCached(): Promise<PlanPriceStatsByTier | null> {
  try {
    return await cachedPlanPriceStats();
  } catch (e) {
    console.error("[planPriceStats] cache failed", e instanceof Error ? e.message : String(e));
    return null;
  }
}
