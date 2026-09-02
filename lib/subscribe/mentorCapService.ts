import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import {
  createSupabaseMentorCapDataSource,
  indeterminateUsage,
  loadMentorCapUsageBatchFrom,
  type MentorCapUsage,
} from "@/lib/subscribe/mentorCapUsageCore";

export { wouldExceedCap } from "@/lib/subscribe/mentorCapUsageCore";
export type { CapWeightByTier, MentorCapUsage } from "@/lib/subscribe/mentorCapUsageCore";

/**
 * 멘토 cap 사용 현황 — 서버 진입점. 계산은 전부 DB 함수(mentor_cap_used / mentor_cap_limit /
 * subscription_cap_weight)에 위임한다(lib/subscribe/mentorCapUsageCore.ts). 이 파일은 클라이언트 생성만 한다.
 *
 * 서비스 롤을 쓰는 이유: 활성 구독 수(명) 집계가 subscriptions 를 읽는데 학생 RLS 는 본인 쌍만 보인다.
 * cap RPC 셋은 anon/authenticated 도 실행 가능하지만 판정 경로를 한 클라이언트로 통일한다.
 * D-ST-11: 서비스 키 부재는 used 0 이 아니라 판정 불가(indeterminate, fail-closed)다.
 */
function adminClientOrNull(): SupabaseClient | null {
  try {
    return createServiceRoleClient();
  } catch {
    return null;
  }
}

/** 여러 멘토의 cap 사용 현황을 한 번에 조회. */
export async function loadMentorCapUsageBatch(mentorIds: string[]): Promise<Map<string, MentorCapUsage>> {
  const ids = Array.from(new Set(mentorIds.filter((id) => typeof id === "string" && id.trim())));
  const out = new Map<string, MentorCapUsage>();
  if (ids.length === 0) return out;

  const admin = adminClientOrNull();
  if (!admin) {
    // 서비스 키 부재 → 전 멘토 판정 불가(fail-closed 신호). 숫자를 지어내지 않는다.
    for (const id of ids) out.set(id, indeterminateUsage());
    return out;
  }
  return loadMentorCapUsageBatchFrom(createSupabaseMentorCapDataSource(admin), ids);
}

/** 단일 멘토 cap 사용 현황. 조회에 없으면 판정 불가로 간주(fail-closed). */
export async function loadMentorCapUsage(mentorId: string): Promise<MentorCapUsage> {
  const map = await loadMentorCapUsageBatch([mentorId]);
  return map.get(mentorId) ?? indeterminateUsage();
}
