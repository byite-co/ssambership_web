import type { SubscribePlanTier } from "@/lib/subscribe/subscribePageQueries";

export type WeeklyUsageSnapshot = {
  used: number;
  limit: number;
  remaining: number;
  canAsk: boolean;
  limitLabel: string;
  planTier?: string | null;
  /** 구독 없이 무료 질문권 쿼터로 계산된 스냅샷 (한도 = 멘토당 무료 질문권) */
  freeQuota?: boolean;
  weekStart?: string | null;
  weekEnd?: string | null;
};

export type WeeklyQuestionUsage = {
  used: number;
  limit: number;
  remaining: number;
  canAsk: boolean;
  planTier: SubscribePlanTier | null;
  freeQuota?: boolean;
  weekStart: string | null;
  weekEnd: string | null;
};

export function weeklyUsageDisplayLimit(usage: WeeklyQuestionUsage): string {
  if (usage.limit >= 999) return "무제한";
  return String(usage.limit);
}

/** 질문방 UI — 주간 한도 표기 (예: 주 4개 질문 · 잔여 3/4, 무료 질문권 · 잔여 2/3) */
export function weeklyQuestionQuotaLabel(
  usage: (Pick<WeeklyQuestionUsage, "used" | "limit"> & { freeQuota?: boolean }) | WeeklyUsageSnapshot | null | undefined
): string {
  if (!usage) return "주 —개 질문";
  if (usage.freeQuota) return `무료 질문권 · 잔여 ${Math.max(0, usage.limit - usage.used)}/${usage.limit}`;
  if (usage.limit >= 999) return `주 무제한 질문 · ${usage.used} 사용`;
  return `주 ${usage.limit}개 질문 · 잔여 ${Math.max(0, usage.limit - usage.used)}/${usage.limit}`;
}

export function weeklyUsageToSnapshot(usage: WeeklyQuestionUsage): WeeklyUsageSnapshot {
  return {
    used: usage.used,
    limit: usage.limit,
    remaining: usage.remaining,
    canAsk: usage.canAsk,
    limitLabel: weeklyUsageDisplayLimit(usage),
    planTier: usage.planTier,
    freeQuota: usage.freeQuota,
    weekStart: usage.weekStart,
    weekEnd: usage.weekEnd,
  };
}
