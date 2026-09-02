/**
 * 멘토 구독 cap(정원) 사용 현황 — 순수 모듈 (server-only import 금지 · node:test 검증 가능)
 *
 * ★ 값의 정본은 DB 한 곳이다 (PR-1b 값 연동). 플랜 가중치(limited/standard/premium)·기본 한도는
 *   TS 에 두지 않는다 — 구 `CAP_WEIGHT_BY_TIER`·`MENTOR_CAP_LIMIT_DEFAULT` 사본과 TS 재합산을 제거했다.
 *   - 사용량 = public.mentor_cap_used(p_mentor_id)      활성 구독 가중치 합
 *   - 한도   = public.mentor_cap_limit(p_mentor_id)     mentor_profiles.cap_limit (행 부재 폴백도 DB 함수 소유)
 *   - 가중치 = public.subscription_cap_weight(p_tier)   신규 tier 가중치 — 결제 게이트(wouldExceedCap)·
 *              마감 판정(isFull = 가장 작은 플랜도 못 받음)에 필요하다
 *   셋 다 050 마이그레이션이 만든 함수이며 구독 insert 트리거(enforce_mentor_cap)·결제 RPC 가 같은 함수로
 *   판정한다 → 화면·게이트·DB 가 서로 다른 숫자를 낼 수 없다. cap 구조가 바뀌면 DB 만 바꾸면 된다.
 *
 * D-ST-11: '판정 불가'(indeterminate)는 used 0(=여유 있음)과 구분한다. RPC 실패·서비스키 부재 시 숫자를
 * 추측하지 않고 null 로 남긴다(폴백 리터럴 금지) — 결제 경로는 fail-closed(거부), 표시 경로는 '—' 로 그린다.
 *
 * 순수 판정(buildMentorCapUsage / loadMentorCapUsageBatchFrom / wouldExceedCap)과 supabase 어댑터
 * (createSupabaseMentorCapDataSource)를 분리해 계약 테스트가 네트워크 없이 RPC 이름·인자·판정을 고정한다.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SubscribePlanTier } from "./subscribePageQueries.ts";

export const SUBSCRIBE_CAP_TIERS: readonly SubscribePlanTier[] = ["limited", "standard", "premium"];

/** DB 함수 이름 — 호출부는 반드시 이 상수를 거친다(RPC 이름 사본 금지). */
export const MENTOR_CAP_RPC = {
  used: "mentor_cap_used",
  limit: "mentor_cap_limit",
  weight: "subscription_cap_weight",
} as const;

/** `.in()` id 배치 크기 — URL 길이·행수 상한 회피용. */
const IN_CHUNK = 200;
/** 활성 구독 행 조회 상한(배치당). */
const SUBSCRIPTIONS_ROW_LIMIT = 20000;
/** 멘토별 RPC 동시 실행 수(멘토 1인 = used·limit 2건 병렬). */
const DEFAULT_CONCURRENCY = 6;

export type CapWeightByTier = Readonly<Record<SubscribePlanTier, number>>;

export type MentorCapUsage = {
  /** 활성 구독 cap 가중치 합 — DB mentor_cap_used(). 판정 불가면 null */
  usedCap: number | null;
  /** 멘토 cap 상한 — DB mentor_cap_limit(). 판정 불가(한도 RPC 실패)면 null */
  capLimit: number | null;
  /** 활성 구독 수(명) — 표시 보조(가중치 아님). 집계 실패면 null (cap 판정과 무관) */
  activeCount: number | null;
  /** 사용률 % (0~100, 반올림). 판정 불가면 0 */
  pct: number;
  /** 구독 마감 여부 (가장 작은 플랜 limited 도 못 받는 상태). 판정 불가면 false(표시 degrade) */
  isFull: boolean;
  /**
   * D-ST-11: cap 을 **판정할 수 없었음**(서비스키 부재·RPC 실패). used 0(=여유 있음)과 반드시 구분한다.
   * 결제 경로는 이 값이 true 면 fail-closed(거부)하고, 목록/배지 표시에서는 degrade(마감 아님으로 표시)한다.
   */
  indeterminate: boolean;
  /** DB subscription_cap_weight(tier) — 배치 공용(동일 참조). 판정 불가면 null */
  capWeightByTier: CapWeightByTier | null;
};

/** cap 판정에 필요한 DB 읽기 4종 — 전부 실패 시 null(추측값 금지). */
export type MentorCapDataSource = {
  capUsed(mentorId: string): Promise<number | null>;
  capLimit(mentorId: string): Promise<number | null>;
  capWeight(tier: SubscribePlanTier): Promise<number | null>;
  /** 활성 구독 수(명) — 표시 보조. 실패 시 null(cap 판정과 무관) */
  activeSubscriptionCounts(mentorIds: readonly string[]): Promise<Map<string, number> | null>;
};

/** 판정 불가 usage — used/isFull 를 신뢰하면 안 되는 상태(fail-closed 신호). 한도만 알면 한도는 남긴다. */
export function indeterminateUsage(capLimit: number | null = null): MentorCapUsage {
  return {
    usedCap: null,
    capLimit,
    activeCount: null,
    pct: 0,
    isFull: false,
    indeterminate: true,
    capWeightByTier: null,
  };
}

/** RPC 결과 → usage. 사용량·한도·가중치 셋 중 하나라도 없으면 판정 불가. */
export function buildMentorCapUsage(input: {
  usedCap: number | null;
  capLimit: number | null;
  activeCount: number | null;
  capWeightByTier: CapWeightByTier | null;
}): MentorCapUsage {
  const { usedCap, capLimit, activeCount, capWeightByTier } = input;
  if (usedCap == null || capLimit == null || capWeightByTier == null) {
    return indeterminateUsage(capLimit);
  }
  const used = usedCap > 0 ? usedCap : 0;
  const pct = capLimit > 0 ? Math.min(100, Math.round((used / capLimit) * 100)) : 0;
  // 가장 작은 플랜(limited)도 못 받으면 마감 — 가중치는 DB subscription_cap_weight('limited').
  const isFull = used + capWeightByTier.limited > capLimit;
  return { usedCap: used, capLimit, activeCount, pct, isFull, indeterminate: false, capWeightByTier };
}

/**
 * 신규 구독 시 cap 초과 여부. (used + tier weight) > limit 이면 true.
 * D-ST-11: 판정 불가(indeterminate)면 결제 경로에서 통과시키지 않도록 true(초과로 간주)를 반환한다
 * (fail-closed). DB 트리거가 동시성 안전 최종 방어이며, 이 게이트는 그 앞단 1차 검증이다.
 */
export function wouldExceedCap(usage: MentorCapUsage, tier: SubscribePlanTier): boolean {
  if (usage.indeterminate) return true;
  const { usedCap, capLimit, capWeightByTier } = usage;
  if (usedCap == null || capLimit == null || capWeightByTier == null) return true;
  return usedCap + capWeightByTier[tier] > capLimit;
}

function uniqueIds(ids: readonly string[]): string[] {
  return Array.from(new Set(ids.filter((id) => typeof id === "string" && id.trim())));
}

function chunk<T>(arr: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i] as T);
    }
  });
  await Promise.all(workers);
  return results;
}

/** tier 3종 가중치를 DB 에서 읽는다. 하나라도 실패하면 null(부분 표 금지). */
export async function loadCapWeightByTier(source: MentorCapDataSource): Promise<CapWeightByTier | null> {
  const entries = await Promise.all(
    SUBSCRIBE_CAP_TIERS.map(async (tier) => [tier, await source.capWeight(tier)] as const)
  );
  const out: Partial<Record<SubscribePlanTier, number>> = {};
  for (const [tier, weight] of entries) {
    if (weight == null) return null;
    out[tier] = weight;
  }
  return out as CapWeightByTier;
}

/**
 * 여러 멘토의 cap 사용 현황 — 멘토별 mentor_cap_used/mentor_cap_limit RPC(병렬, 동시 수 제한) +
 * 배치 공용 가중치 표 + 활성 구독 수(표시 보조).
 */
export async function loadMentorCapUsageBatchFrom(
  source: MentorCapDataSource,
  mentorIds: readonly string[],
  opts?: { concurrency?: number }
): Promise<Map<string, MentorCapUsage>> {
  const out = new Map<string, MentorCapUsage>();
  const ids = uniqueIds(mentorIds);
  if (ids.length === 0) return out;

  const [capWeightByTier, counts, perMentor] = await Promise.all([
    loadCapWeightByTier(source),
    source.activeSubscriptionCounts(ids),
    mapWithConcurrency(ids, opts?.concurrency ?? DEFAULT_CONCURRENCY, async (id) => {
      const [usedCap, capLimit] = await Promise.all([source.capUsed(id), source.capLimit(id)]);
      return { id, usedCap, capLimit };
    }),
  ]);

  for (const { id, usedCap, capLimit } of perMentor) {
    out.set(
      id,
      buildMentorCapUsage({
        usedCap,
        capLimit,
        activeCount: counts ? (counts.get(id) ?? 0) : null,
        capWeightByTier,
      })
    );
  }
  return out;
}

function numericOrNull(data: unknown): number | null {
  const n = typeof data === "number" ? data : Number(data);
  return Number.isFinite(n) ? n : null;
}

/**
 * supabase-js 클라이언트 → 데이터 소스 어댑터. RPC 이름·인자와 활성 구독 수 쿼리는 여기 한 곳에만 있다.
 * 활성 판정은 DB 함수 mentor_cap_used 의 `lower(coalesce(status,'')) = 'active'` 와 같게 ilike 로 맞춘다.
 */
export function createSupabaseMentorCapDataSource(
  client: SupabaseClient,
  opts?: { inChunk?: number }
): MentorCapDataSource {
  const inChunk = opts?.inChunk ?? IN_CHUNK;

  async function rpcNumeric(fn: string, args: Record<string, unknown>, label: string): Promise<number | null> {
    try {
      const { data, error } = await client.rpc(fn, args);
      if (error) {
        console.error(`[mentorCap] ${fn} failed`, label, error.message);
        return null;
      }
      const n = numericOrNull(data);
      if (n == null) console.error(`[mentorCap] ${fn} returned non-numeric`, label, data);
      return n;
    } catch (e) {
      console.error(`[mentorCap] ${fn} threw`, label, e);
      return null;
    }
  }

  return {
    capUsed: (mentorId) => rpcNumeric(MENTOR_CAP_RPC.used, { p_mentor_id: mentorId }, mentorId),
    capLimit: (mentorId) => rpcNumeric(MENTOR_CAP_RPC.limit, { p_mentor_id: mentorId }, mentorId),
    capWeight: (tier) => rpcNumeric(MENTOR_CAP_RPC.weight, { p_tier: tier }, tier),
    async activeSubscriptionCounts(mentorIds) {
      const counts = new Map<string, number>();
      try {
        for (const part of chunk(mentorIds, inChunk)) {
          const { data, error } = await client
            .from("subscriptions")
            .select("mentor_id")
            .in("mentor_id", part)
            .ilike("status", "active")
            .limit(SUBSCRIPTIONS_ROW_LIMIT);
          if (error) {
            console.error("[mentorCap] active subscription count failed", error.message);
            return null;
          }
          for (const row of ((data ?? []) as Array<{ mentor_id?: unknown }>)) {
            const mid = String(row.mentor_id ?? "");
            if (mid) counts.set(mid, (counts.get(mid) ?? 0) + 1);
          }
        }
      } catch (e) {
        console.error("[mentorCap] active subscription count threw", e);
        return null;
      }
      return counts;
    },
  };
}
