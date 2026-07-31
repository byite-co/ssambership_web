import type { SupabaseClient } from "@supabase/supabase-js";
import { FREE_QUESTION_PER_MENTOR_LIMIT, FREE_QUESTION_TOTAL_LIMIT } from "@/lib/mentor/freeQuestionPolicy";
import { countFreeQuestionsTotal, loadFreeQuestionRemainingForMentor } from "@/lib/qna/freeQuestionUsage";
import { isSubscribePlanTier } from "@/lib/subscribe/subscribePageQueries";
import { callApiWebV1Rpc } from "@/lib/apiWebV1/rpc";
import type { WeeklyQuestionUsage } from "@/lib/qna/weeklyQuestionUsageDisplay";
export type { WeeklyQuestionUsage, WeeklyUsageSnapshot } from "@/lib/qna/weeklyQuestionUsageDisplay";
export {
  weeklyQuestionQuotaLabel,
  weeklyUsageDisplayLimit,
  weeklyUsageToSnapshot,
} from "@/lib/qna/weeklyQuestionUsageDisplay";

/**
 * S2-2 전환 W1(C2): 주간 질문 사용량 조회.
 *
 * - 학생 본인 경로는 F1 `api_web_v1.weekly_question_usage_self(p_mentor_id)` 를
 *   사용한다(계약 §7 F1 — 학생 id 는 인자로 받지 않고 서버가 `auth.uid()` 로 도출).
 * - 멘토 질문방·service_role 서버 경로는 레거시
 *   `public.get_weekly_question_usage(p_student_id, p_mentor_id)` 를 유지한다
 *   (계약 §7 F1 rev 8 A-8 — M15 pair-party 가드가 학생·멘토 당사자·service_role 만
 *   통과시킨다. §18.2: 레거시는 유지 대상이며 F1 대체는 웹 학생 경로 한정).
 * - 구 JS fallback(구독 프로빙·question_threads 직접 집계·컬럼 프로빙)은 제거했다.
 *   RPC 실패 시 구 경로로 되돌아가지 않는다(W1 지시 §4).
 * - 무료 질문권 스냅샷은 RPC 실패 폴백이 아니라, RPC 정본 판정(활성 구독 없음 =
 *   limit 0·plan_tier null)에 따른 무료 질문권 UI 표시 경로다(기존 기능 유지 —
 *   free_question_usage 는 V1~V7 계약 대상이 아니다).
 */

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function subscriptionAnchorWeekBounds(
  anchorValue: string | Date | null | undefined,
  nowValue: Date = new Date()
): { start: Date; end: Date } | null {
  const anchor =
    anchorValue instanceof Date
      ? anchorValue
      : typeof anchorValue === "string"
        ? new Date(anchorValue)
        : null;
  if (!anchor || Number.isNaN(anchor.getTime())) return null;

  const now = Number.isNaN(nowValue.getTime()) ? new Date() : nowValue;
  const elapsed = Math.max(0, now.getTime() - anchor.getTime());
  const periodIndex = Math.floor(elapsed / WEEK_MS);
  const start = new Date(anchor.getTime() + periodIndex * WEEK_MS);
  return { start, end: new Date(start.getTime() + WEEK_MS) };
}

/** F1/레거시 공통 — 사용량 필드 파싱(계약 §7 F1 성공 반환 필드). */
function parseWeeklyUsageFields(o: Record<string, unknown>): WeeklyQuestionUsage {
  const used = typeof o.used === "number" ? o.used : Number(o.used ?? 0);
  const limit = typeof o.limit === "number" ? o.limit : Number(o.limit ?? 0);
  const remaining =
    typeof o.remaining === "number" ? o.remaining : Math.max(0, limit - used);
  const canAsk = typeof o.can_ask === "boolean" ? o.can_ask : used < limit;
  const tierRaw = typeof o.plan_tier === "string" ? o.plan_tier : null;
  const planTier = tierRaw && isSubscribePlanTier(tierRaw) ? tierRaw : null;
  return {
    used: Number.isFinite(used) ? used : 0,
    limit: Number.isFinite(limit) ? limit : 0,
    remaining: Number.isFinite(remaining) ? remaining : 0,
    canAsk,
    planTier,
    weekStart: typeof o.week_start === "string" ? o.week_start : null,
    weekEnd: typeof o.week_end === "string" ? o.week_end : null,
  };
}

/**
 * 활성 구독이 없다고 정본이 판정한 방(무료 질문권 진입)의 UI 스냅샷.
 * 실제 차감·집행은 F2/F3 서버 판정이 정본이다 — 이 값은 표시·버튼 활성화에만 쓰인다.
 */
async function freeQuotaSnapshot(
  supabase: SupabaseClient,
  studentId: string,
  mentorId: string
): Promise<WeeklyQuestionUsage | null> {
  const freeRemainingForMentor = await loadFreeQuestionRemainingForMentor(supabase, studentId, mentorId);
  if (freeRemainingForMentor == null) return null;
  const total = await countFreeQuestionsTotal(supabase, studentId);
  const totalRemaining = total.error
    ? freeRemainingForMentor
    : Math.max(0, FREE_QUESTION_TOTAL_LIMIT - total.count);
  const remaining = Math.min(freeRemainingForMentor, totalRemaining);
  return {
    used: FREE_QUESTION_PER_MENTOR_LIMIT - remaining,
    limit: FREE_QUESTION_PER_MENTOR_LIMIT,
    remaining,
    canAsk: remaining > 0,
    planTier: null,
    freeQuota: true,
    weekStart: null,
    weekEnd: null,
  };
}

/**
 * 학생 본인 주간 사용량 — F1 (C2 전환 정본 경로).
 * `supabase` 는 학생 세션 클라이언트여야 하고 `studentId` 는 세션 사용자여야 한다
 * (F1 이 `auth.uid()` 로 판정 — studentId 는 무료 질문권 표시 조회에만 쓰인다).
 */
export async function fetchWeeklyQuestionUsageSelf(
  supabase: SupabaseClient,
  studentId: string,
  mentorId: string
): Promise<{ usage: WeeklyQuestionUsage; error: string | null }> {
  const res = await callApiWebV1Rpc(supabase, "weekly_question_usage_self", {
    p_mentor_id: mentorId,
  });
  if (!res.ok) {
    // 실패 시 구 public 경로 fallback 금지(W1 §4) — 빈 사용량 + 오류로 반환한다.
    return {
      usage: { used: 0, limit: 0, remaining: 0, canAsk: false, planTier: null, weekStart: null, weekEnd: null },
      error: res.code || res.message || "weekly_question_usage_self failed",
    };
  }
  const parsed = parseWeeklyUsageFields(res.row);
  if (parsed.limit > 0 || parsed.planTier) {
    return { usage: parsed, error: null };
  }
  // 정본 판정: 활성 구독 없음 → 무료 질문권 스냅샷(표시용)
  const free = await freeQuotaSnapshot(supabase, studentId, mentorId);
  return { usage: free ?? parsed, error: null };
}

/**
 * pair-party 주간 사용량 — 레거시 유지 경로(멘토 질문방·service_role 서버).
 * M15 가드: 학생·멘토 당사자 또는 service_role 만 통과(NULL-safe, 42501).
 * JS fallback 없음 — 실패는 실패로 반환한다.
 */
export async function fetchWeeklyQuestionUsagePairParty(
  supabase: SupabaseClient,
  studentId: string,
  mentorId: string
): Promise<{ usage: WeeklyQuestionUsage; error: string | null }> {
  const { data, error } = await supabase.rpc("get_weekly_question_usage", {
    p_student_id: studentId,
    p_mentor_id: mentorId,
  });
  if (error) {
    return {
      usage: { used: 0, limit: 0, remaining: 0, canAsk: false, planTier: null, weekStart: null, weekEnd: null },
      error: error.message,
    };
  }
  const o =
    data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  const parsed = parseWeeklyUsageFields(o);
  if (parsed.limit > 0 || parsed.planTier) {
    return { usage: parsed, error: null };
  }
  // 활성 구독 없음(무료 질문권 방) — 표시용 무료 스냅샷(기존 동작 유지)
  const free = await freeQuotaSnapshot(supabase, studentId, mentorId);
  return { usage: free ?? parsed, error: null };
}

/** 학생 본인 경로 호환 시그니처 — F1 사용(usage nullable 호환). */
export async function fetchWeeklyQuestionUsage(
  supabase: SupabaseClient,
  studentId: string,
  mentorId: string
): Promise<{ usage: WeeklyQuestionUsage | null; error: string | null }> {
  const r = await fetchWeeklyQuestionUsageSelf(supabase, studentId, mentorId);
  return { usage: r.usage, error: r.error };
}

export async function loadWeeklyUsageByMentorIds(
  supabase: SupabaseClient,
  studentId: string,
  mentorIds: string[]
): Promise<Record<string, WeeklyQuestionUsage>> {
  const out: Record<string, WeeklyQuestionUsage> = {};
  await Promise.all(
    mentorIds.map(async (mid) => {
      const { usage } = await fetchWeeklyQuestionUsageSelf(supabase, studentId, mid);
      out[mid] = usage;
    })
  );
  return out;
}
