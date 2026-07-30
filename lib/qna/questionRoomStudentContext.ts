import type { SupabaseClient } from "@supabase/supabase-js";
import { findActiveSubscriptionForPair } from "@/lib/subscribe/subscribeCheckoutService";
import { isSubscribePlanTier } from "@/lib/subscribe/subscribePageQueries";
import { getSubscribeCatalogPlan } from "@/lib/subscribe/subscribePlanCatalog";
import { partyUserIdFromRoomRow } from "@/lib/qna/questionRoomUiLabels";
import { fetchMessagesForThreads, fetchThreadsForRooms } from "@/lib/qna/questionRoomQueries";
import { readQuestionThreadWorkflowStatus } from "@/lib/qna/questionThreadStatus";
import { threadMentorStudentRoomId } from "@/lib/qna/questionThreadRoomRef";
import {
  loadWeeklyUsageByMentorIds,
  subscriptionAnchorWeekBounds,
  weeklyUsageToSnapshot,
} from "@/lib/qna/weeklyQuestionUsage";
import type { WeeklyUsageSnapshot } from "@/lib/qna/weeklyQuestionUsage";

type Row = Record<string, unknown>;

export type QuestionRoomSubscriptionContext = {
  planTier: string | null;
  planLabel: string;
  subscribedAtLabel: string;
  weekRenewalLabel: string;
  nextRenewalLabel: string;
  /** 상단 메타 압축용 짧은 갱신일 (예: "7/5") */
  nextRenewalShort: string;
};

function formatKoDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("ko-KR", {
      timeZone: "Asia/Seoul",
      month: "long",
      day: "numeric",
    });
  } catch {
    return "—";
  }
}

function subscriptionAnchorIso(row: Row | null | undefined): string | null {
  for (const key of ["started_at", "created_at"] as const) {
    const value = row?.[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

function anchorRenewalLabel(anchorIso: string | null): string {
  if (!anchorIso) return "구독 시작일 기준 7일마다 갱신";
  const anchor = new Date(anchorIso);
  if (Number.isNaN(anchor.getTime())) return "구독 시작일 기준 7일마다 갱신";
  const weekday = anchor.toLocaleDateString("ko-KR", {
    timeZone: "Asia/Seoul",
    weekday: "long",
  });
  return `매주 ${weekday} 갱신 (구독 시작 시각 기준)`;
}

function nextAnchorRenewalShort(anchorIso: string | null): string {
  const bounds = subscriptionAnchorWeekBounds(anchorIso);
  if (!bounds) return "—";
  const parts = bounds.end.toLocaleDateString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
  });
  const m = parts.match(/(\d+)\D+(\d+)/);
  return m ? `${m[1]}/${m[2]}` : "—";
}

function nextAnchorRenewalLabel(anchorIso: string | null): string {
  const bounds = subscriptionAnchorWeekBounds(anchorIso);
  if (!bounds) return "구독 후 7일째";
  return bounds.end.toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export async function loadQuestionRoomSubscriptionContext(
  supabase: SupabaseClient,
  studentId: string,
  room: Row | null
): Promise<QuestionRoomSubscriptionContext> {
  const mentorId = room ? partyUserIdFromRoomRow(room, "mentor") : null;
  if (!mentorId) {
    return {
      planTier: null,
      planLabel: "—",
      subscribedAtLabel: "—",
      weekRenewalLabel: "구독 시작일 기준 7일마다 갱신",
      nextRenewalLabel: "구독 후 7일째",
      nextRenewalShort: "—",
    };
  }

  // W4(C10): 정본 subscriptions 단일 조회. 조회 실패는 로그로 구분하고 표시만 기본값으로 둔다.
  const lookup = await findActiveSubscriptionForPair(supabase, studentId, mentorId);
  if (lookup.error) {
    console.error("[loadQuestionRoomSubscriptionContext] subscriptions select", lookup.error);
  }
  const active = lookup.active;
  const tierRaw = active?.row.plan_tier;
  const planTier = typeof tierRaw === "string" && isSubscribePlanTier(tierRaw) ? tierRaw : null;
  const catalog = planTier ? getSubscribeCatalogPlan(planTier) : null;
  const anchorIso = subscriptionAnchorIso(active?.row);

  return {
    planTier,
    planLabel: catalog?.label ?? (planTier ? planTier.toUpperCase() : "구독 플랜"),
    subscribedAtLabel: formatKoDate(anchorIso),
    weekRenewalLabel: anchorRenewalLabel(anchorIso),
    nextRenewalLabel: nextAnchorRenewalLabel(anchorIso),
    nextRenewalShort: nextAnchorRenewalShort(anchorIso),
  };
}

export async function loadMessageCountsByThreadId(
  supabase: SupabaseClient,
  threadIds: string[]
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const id of threadIds) out[id] = 0;
  if (threadIds.length === 0) return out;

  const pack = await fetchMessagesForThreads(supabase, threadIds);
  if (pack.error) return out;

  for (const m of pack.rows) {
    const tid = typeof m.thread_id === "string" ? m.thread_id : null;
    if (tid) out[tid] = (out[tid] ?? 0) + 1;
  }
  return out;
}

export async function loadUnreadCountsByRoomId(
  supabase: SupabaseClient,
  roomIds: string[]
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const id of roomIds) out[id] = 0;
  if (roomIds.length === 0) return out;

  const pack = await fetchThreadsForRooms(supabase, roomIds);
  if (pack.error) return out;

  for (const t of pack.rows) {
    const rid = threadMentorStudentRoomId(t) ?? "";
    if (!rid) continue;
    if (readQuestionThreadWorkflowStatus(t) === "answered") {
      out[rid] = (out[rid] ?? 0) + 1;
    }
  }
  return out;
}

export async function loadLastMessageByThreadId(
  supabase: SupabaseClient,
  threadIds: string[]
): Promise<Record<string, Row>> {
  const out: Record<string, Row> = {};
  if (threadIds.length === 0) return out;
  const pack = await fetchMessagesForThreads(supabase, threadIds);
  for (const m of pack.rows) {
    const tid = typeof m.thread_id === "string" ? m.thread_id : null;
    if (tid) out[tid] = m;
  }
  return out;
}

export async function loadInitialWeeklyUsageSnapshots(
  supabase: SupabaseClient,
  studentId: string,
  roomRows: Row[]
): Promise<Record<string, WeeklyUsageSnapshot>> {
  const mentorIds = [
    ...new Set(
      roomRows
        .map((r) => partyUserIdFromRoomRow(r, "mentor"))
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const map = await loadWeeklyUsageByMentorIds(supabase, studentId, mentorIds);
  const out: Record<string, WeeklyUsageSnapshot> = {};
  for (const [mid, u] of Object.entries(map)) {
    out[mid] = weeklyUsageToSnapshot(u);
  }
  return out;
}
