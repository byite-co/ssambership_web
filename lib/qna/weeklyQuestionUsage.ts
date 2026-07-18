import type { SupabaseClient } from "@supabase/supabase-js";
import { FREE_QUESTION_PER_MENTOR_LIMIT, FREE_QUESTION_TOTAL_LIMIT } from "@/lib/mentor/freeQuestionPolicy";
import { countFreeQuestionsTotal, loadFreeQuestionRemainingForMentor } from "@/lib/qna/freeQuestionUsage";
import { findActiveSubscriptionForPair } from "@/lib/subscribe/subscribeCheckoutService";
import { isSubscribePlanTier, type SubscribePlanTier } from "@/lib/subscribe/subscribePageQueries";
import { pickExistingColumn } from "@/lib/qna/safeSelect";
import { QUESTION_THREADS_ROOM_FK_CANDIDATES } from "@/lib/qna/questionThreadRoomRef";
import type { WeeklyQuestionUsage } from "@/lib/qna/weeklyQuestionUsageDisplay";
export type { WeeklyQuestionUsage, WeeklyUsageSnapshot } from "@/lib/qna/weeklyQuestionUsageDisplay";
export {
  weeklyQuestionQuotaLabel,
  weeklyUsageDisplayLimit,
  weeklyUsageToSnapshot,
} from "@/lib/qna/weeklyQuestionUsageDisplay";

function limitForTier(tier: SubscribePlanTier | null): number {
  if (tier === "limited") return 4;
  if (tier === "standard") return 9;
  if (tier === "premium") return 999;
  return 0;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Forward (non-discarded) thread states counted toward weekly usage.
// Mirrors get_weekly_question_usage (098): quota is consumed on create.
const COUNTED_THREAD_STATUSES = ["pending", "answered", "confirmed", "closed", "archived"];

function isoFromRow(row: Record<string, unknown> | null | undefined, keys: string[]): string | null {
  for (const key of keys) {
    const value = row?.[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

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

function parseRpcWeeklyUsage(data: unknown): WeeklyQuestionUsage {
  const o =
    data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
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

async function countCreatedThisWeekFallback(
  supabase: SupabaseClient,
  studentId: string,
  mentorId: string,
  bounds: { start: Date; end: Date } | null
): Promise<number> {
  if (!bounds) return 0;
  const { start, end } = bounds;
  const rooms = await supabase.from("mentor_student_rooms").select("id").eq("student_id", studentId).eq("mentor_id", mentorId);
  const roomIds = ((rooms.data as { id: string }[] | null) ?? []).map((r) => String(r.id));
  if (roomIds.length === 0) return 0;

  const { column: fkCol } = await pickExistingColumn(supabase, "question_threads", [...QUESTION_THREADS_ROOM_FK_CANDIDATES]);
  if (!fkCol) return 0;

  const { data, error } = await supabase
    .from("question_threads")
    .select("id, status, created_at")
    .in(fkCol, roomIds)
    .in("status", COUNTED_THREAD_STATUSES);

  if (error) return 0;
  let count = 0;
  for (const row of (data as Record<string, unknown>[]) ?? []) {
    const ts = String(row.created_at ?? "");
    const ms = Date.parse(ts);
    if (!Number.isNaN(ms) && ms >= start.getTime() && ms < end.getTime()) count += 1;
  }
  return count;
}

export async function fetchWeeklyQuestionUsageWithFallback(
  supabase: SupabaseClient,
  studentId: string,
  mentorId: string
): Promise<{ usage: WeeklyQuestionUsage; error: string | null }> {
  const { data, error } = await supabase.rpc("get_weekly_question_usage", {
    p_student_id: studentId,
    p_mentor_id: mentorId,
  });

  if (!error && data) {
    const parsed = parseRpcWeeklyUsage(data);
    if (parsed.limit > 0 || parsed.planTier) {
      return { usage: parsed, error: null };
    }
  }

  const active = await findActiveSubscriptionForPair(supabase, studentId, mentorId);

  // 구독이 없는 방(무료 질문권 진입)은 주간 한도 대신 무료 질문권 쿼터로 스냅샷을 만든다.
  // 서버 게이트(questionThreadSubscriptionGuard/questionRoomThreadService)는 구독이 없으면
  // 무료 질문 경로를 먼저 타므로 이 값은 UI 표시·버튼 활성화에만 쓰인다.
  if (!active) {
    const freeRemainingForMentor = await loadFreeQuestionRemainingForMentor(supabase, studentId, mentorId);
    if (freeRemainingForMentor != null) {
      const total = await countFreeQuestionsTotal(supabase, studentId);
      const totalRemaining = total.error
        ? freeRemainingForMentor
        : Math.max(0, FREE_QUESTION_TOTAL_LIMIT - total.count);
      const remaining = Math.min(freeRemainingForMentor, totalRemaining);
      return {
        usage: {
          used: FREE_QUESTION_PER_MENTOR_LIMIT - remaining,
          limit: FREE_QUESTION_PER_MENTOR_LIMIT,
          remaining,
          canAsk: remaining > 0,
          planTier: null,
          freeQuota: true,
          weekStart: null,
          weekEnd: null,
        },
        error: error?.message ?? null,
      };
    }
  }

  const tierRaw = active?.row.plan_tier;
  const planTier =
    typeof tierRaw === "string" && isSubscribePlanTier(tierRaw) ? tierRaw : null;
  const limit = limitForTier(planTier);
  const anchor = isoFromRow(active?.row, ["started_at", "created_at"]);
  const bounds = subscriptionAnchorWeekBounds(anchor);
  const used = await countCreatedThisWeekFallback(supabase, studentId, mentorId, bounds);

  return {
    usage: {
      used,
      limit,
      remaining: Math.max(0, limit - used),
      canAsk: used < limit,
      planTier,
      weekStart: bounds?.start.toISOString() ?? null,
      weekEnd: bounds?.end.toISOString() ?? null,
    },
    error: error?.message ?? null,
  };
}

export async function fetchWeeklyQuestionUsage(
  supabase: SupabaseClient,
  studentId: string,
  mentorId: string
): Promise<{ usage: WeeklyQuestionUsage | null; error: string | null }> {
  const r = await fetchWeeklyQuestionUsageWithFallback(supabase, studentId, mentorId);
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
      const { usage } = await fetchWeeklyQuestionUsageWithFallback(supabase, studentId, mid);
      out[mid] = usage;
    })
  );
  return out;
}
