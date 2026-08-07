import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import type { SubscribePlanTier } from "@/lib/subscribe/subscribePageQueries";

type Row = Record<string, unknown>;

/** 플랜별 cap 가중치 (잠금값). 050 마이그레이션 subscription_cap_weight와 동일. */
export const CAP_WEIGHT_BY_TIER: Record<SubscribePlanTier, number> = {
  limited: 1.0,
  standard: 2.5,
  premium: 4.5,
};

/** 멘토 1인 cap 상한 기본값 (관리자만 조정). */
export const MENTOR_CAP_LIMIT_DEFAULT = 28;

/** `.in()` id 배치 크기 — URL 길이·행수 상한 회피용. */
const IN_CHUNK = 200;

export function capWeightForTier(tier: SubscribePlanTier): number {
  return CAP_WEIGHT_BY_TIER[tier] ?? 0;
}

export type MentorCapUsage = {
  /** 활성 구독 cap 가중치 합 */
  usedCap: number;
  /** 멘토 cap 상한 (mentor_profiles.cap_limit, 미적용 시 28) */
  capLimit: number;
  /** 활성 구독 수(명) */
  activeCount: number;
  /** 사용률 % (0~100, 반올림) */
  pct: number;
  /** 구독 마감 여부 (가장 작은 플랜도 못 받는 상태) */
  isFull: boolean;
  /**
   * D-ST-11: cap 을 **판정할 수 없었음**(서비스키 부재·집계 실패). used 0(=여유 있음)과
   * 반드시 구분한다. 결제 경로는 이 값이 true 면 fail-closed(거부)하고, 목록/배지 표시에서는
   * degrade(마감 아님으로 표시)한다.
   */
  indeterminate: boolean;
};

/** 판정 불가 usage — used/isFull 를 신뢰하면 안 되는 상태(fail-closed 신호). */
function indeterminateUsage(capLimit = MENTOR_CAP_LIMIT_DEFAULT): MentorCapUsage {
  return { usedCap: 0, capLimit, activeCount: 0, pct: 0, isFull: false, indeterminate: true };
}

function tierWeightFromRow(row: Row): number {
  const t = String(row.plan_tier ?? "").toLowerCase().trim();
  if (t === "limited" || t === "standard" || t === "premium") {
    return CAP_WEIGHT_BY_TIER[t as SubscribePlanTier];
  }
  return 0;
}

function isActiveRow(row: Row): boolean {
  return String(row.status ?? "").toLowerCase().trim() === "active";
}

function buildUsage(usedCap: number, capLimit: number, activeCount: number): MentorCapUsage {
  const limit = Number.isFinite(capLimit) && capLimit > 0 ? capLimit : MENTOR_CAP_LIMIT_DEFAULT;
  const used = Number.isFinite(usedCap) && usedCap > 0 ? usedCap : 0;
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  // 가장 작은 플랜(limited=1.0)도 못 받으면 마감
  const isFull = used + CAP_WEIGHT_BY_TIER.limited > limit;
  return { usedCap: used, capLimit: limit, activeCount, pct, isFull, indeterminate: false };
}

function adminClientOrNull(): SupabaseClient | null {
  try {
    return createServiceRoleClient();
  } catch {
    return null;
  }
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * 여러 멘토의 cap 사용 현황을 한 번에 조회.
 * - 구독은 service role로 집계(학생 RLS는 본인 쌍만 보이므로 멘토 전체 합계를 못 냄).
 * - D-ST-11: 서비스 키 부재·구독 집계 실패는 used 0(여유)이 아니라 `indeterminate`(판정 불가)로
 *   반환한다. cap_limit 컬럼 부재만 기본 28 폴백으로 흡수한다.
 */
export async function loadMentorCapUsageBatch(
  mentorIds: string[]
): Promise<Map<string, MentorCapUsage>> {
  const out = new Map<string, MentorCapUsage>();
  const ids = Array.from(new Set(mentorIds.filter((id) => typeof id === "string" && id.trim())));
  if (ids.length === 0) return out;

  const admin = adminClientOrNull();
  if (!admin) {
    // 서비스 키 부재 → 전 멘토 판정 불가(fail-closed 신호).
    for (const id of ids) out.set(id, indeterminateUsage());
    return out;
  }

  // cap_limit (없으면 28) — 컬럼 부재는 판정 불가가 아니라 기본값 폴백.
  const capLimitByMentor = new Map<string, number>();
  try {
    for (const idChunk of chunk(ids, IN_CHUNK)) {
      const { data, error } = await admin
        .from("mentor_profiles")
        .select("user_id, cap_limit")
        .in("user_id", idChunk);
      if (!error && Array.isArray(data)) {
        for (const row of data as Row[]) {
          const uid = String(row.user_id ?? "");
          const lim = typeof row.cap_limit === "number" ? row.cap_limit : Number(row.cap_limit ?? NaN);
          if (uid) capLimitByMentor.set(uid, Number.isFinite(lim) && lim > 0 ? lim : MENTOR_CAP_LIMIT_DEFAULT);
        }
      }
    }
  } catch {
    /* cap_limit 컬럼 미적용 → 기본 28 폴백 */
  }

  // 활성 구독 cap 합 + 인원수. 집계 실패(에러·예외)는 판정 불가로 전파(used 0 흡수 금지).
  const usedByMentor = new Map<string, number>();
  const countByMentor = new Map<string, number>();
  let aggregateFailed = false;
  try {
    for (const idChunk of chunk(ids, IN_CHUNK)) {
      const { data, error } = await admin
        .from("subscriptions")
        .select("mentor_id, plan_tier, status")
        .in("mentor_id", idChunk)
        .limit(20000);
      if (error) {
        console.error("[mentorCap] subscriptions aggregate failed", error.message);
        aggregateFailed = true;
        break;
      }
      if (Array.isArray(data)) {
        for (const row of data as Row[]) {
          if (!isActiveRow(row)) continue;
          const mid = String(row.mentor_id ?? "");
          if (!mid) continue;
          usedByMentor.set(mid, (usedByMentor.get(mid) ?? 0) + tierWeightFromRow(row));
          countByMentor.set(mid, (countByMentor.get(mid) ?? 0) + 1);
        }
      }
    }
  } catch (e) {
    console.error("[mentorCap] subscriptions aggregate threw", e);
    aggregateFailed = true;
  }

  if (aggregateFailed) {
    for (const id of ids) out.set(id, indeterminateUsage(capLimitByMentor.get(id) ?? MENTOR_CAP_LIMIT_DEFAULT));
    return out;
  }

  for (const id of ids) {
    out.set(
      id,
      buildUsage(
        usedByMentor.get(id) ?? 0,
        capLimitByMentor.get(id) ?? MENTOR_CAP_LIMIT_DEFAULT,
        countByMentor.get(id) ?? 0
      )
    );
  }
  return out;
}

/** 단일 멘토 cap 사용 현황. 조회에 없으면 판정 불가로 간주(fail-closed). */
export async function loadMentorCapUsage(mentorId: string): Promise<MentorCapUsage> {
  const map = await loadMentorCapUsageBatch([mentorId]);
  return map.get(mentorId) ?? indeterminateUsage();
}

/**
 * 신규 구독 시 cap 초과 여부. (used + tier weight) > limit 이면 true.
 * D-ST-11: 판정 불가(indeterminate)면 결제 경로에서 통과시키지 않도록 true(초과로 간주)를 반환한다
 * (fail-closed). DB 트리거가 동시성 안전 최종 방어이며, 이 게이트는 그 앞단 1차 검증이다.
 */
export function wouldExceedCap(usage: MentorCapUsage, tier: SubscribePlanTier): boolean {
  if (usage.indeterminate) return true;
  return usage.usedCap + capWeightForTier(tier) > usage.capLimit;
}
