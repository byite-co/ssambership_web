import type { SubscribePlanTier } from "@/lib/subscribe/subscribePageQueries";

export type SubscribePlanCatalogItem = {
  tier: SubscribePlanTier;
  /** UI 표기명 (내부 tier id는 limited/standard/premium 유지) */
  label: string;
  cashKrw: number;
  weeklyLabel: string;
  priorityLabel: string;
  recommend?: boolean;
};

/** 보고서 잠금 구독 플랜 (1캐시 = 1원). DB plan_id는 런타임에 멘토 플랜 행에서 조회. */
export const SUBSCRIBE_PLAN_CATALOG: readonly SubscribePlanCatalogItem[] = [
  {
    tier: "limited",
    label: "라이트",
    cashKrw: 29_900,
    weeklyLabel: "주 4개 질문",
    priorityLabel: "답변 우선순위 일반",
  },
  {
    tier: "standard",
    label: "스탠다드",
    cashKrw: 84_900,
    weeklyLabel: "주 9개 질문",
    priorityLabel: "답변 우선순위 높음",
    recommend: true,
  },
  {
    tier: "premium",
    label: "프리미엄",
    cashKrw: 174_900,
    weeklyLabel: "질문 무제한",
    priorityLabel: "",
  },
] as const;

export function getSubscribeCatalogPlan(tier: SubscribePlanTier): SubscribePlanCatalogItem {
  return SUBSCRIBE_PLAN_CATALOG.find((p) => p.tier === tier) ?? SUBSCRIBE_PLAN_CATALOG[1];
}

export function cashKrwForSubscribeTier(tier: SubscribePlanTier): number {
  return getSubscribeCatalogPlan(tier).cashKrw;
}

/** UI: `84,900캐시 / 월` (잠금 플랜 캐시 단위 — 예시는 스탠다드 권장가) */
export function formatSubscribePlanCashMonthlyLabel(cashKrw: number): string {
  return `${cashKrw.toLocaleString("ko-KR")}캐시 / 월`;
}

export function isSubscribeAmountForTier(amountKrw: number, tier: SubscribePlanTier): boolean {
  return getSubscribeCatalogPlan(tier).cashKrw === amountKrw;
}

export function planIdFromRow(row: Record<string, unknown> | null): string | null {
  if (!row) return null;
  const id = row.id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}
