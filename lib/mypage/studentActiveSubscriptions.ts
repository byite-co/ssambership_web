import type { SupabaseClient } from "@supabase/supabase-js";
import { getMentorUserPublic, loadMentorProfilesForDirectory } from "@/lib/auth/mentorPublicRead";
import { fetchPlansForMentor } from "@/lib/mentor/publicMentorBundle";
import { buildMentorProfileDisplay } from "@/lib/mentor/mentorDisplayFields";
import { pickExistingColumn, rowsFromSupabaseData } from "@/lib/qna/safeSelect";
import { getSubscribeCatalogPlan } from "@/lib/subscribe/subscribePlanCatalog";
import {
  assignPlansByTier,
  isSubscribePlanTier,
  type SubscribePlanTier,
} from "@/lib/subscribe/subscribePageQueries";
import { mentorPlanDebitAmountCents } from "@/lib/subscribe/mentorPlanPricing";
import {
  formatSubscriptionDate,
  formatSubscriptionPeriodLabel,
  nextBillingDisplayLabel,
  subscriptionRenewalEnabled,
  subscriptionStatusDisplayLabel,
  subscriptionStatusTone,
  weeklyQuestionResetLabel,
  type SubscriptionStatusTone,
} from "@/lib/subscribe/subscriptionDisplay";
import { formatCashFromCents } from "@/lib/subscribe/subscriptionRefundProration";
import { API_WEB_V1_SCHEMA } from "@/lib/apiWebV1/rpc";

type Row = Record<string, unknown>;

/**
 * S2-2 전환 W1(C1): 구독 조회 — V6 RPC `api_web_v1.my_subscriptions_self()`
 * (계약 §6 V6 · §17 #15). 당사자 판정은 함수 내부(`auth.uid()`)가 수행하므로
 * 세션 클라이언트 전제이며, 구 `subscriptions` 직접 SELECT 는 제거했다.
 * V6 행을 기존 소비 형상(id 키)으로 정규화한다(adapter — 필드 추정 금지).
 */
async function fetchMySubscriptionsSelf(
  supabase: SupabaseClient
): Promise<{ rows: Row[]; error: string | null }> {
  const { data, error } = await supabase.schema(API_WEB_V1_SCHEMA).rpc("my_subscriptions_self");
  if (error) return { rows: [], error: error.message };
  const rows = (rowsFromSupabaseData(data) as Row[])
    .map((r): Row => ({ ...r, id: r.subscription_id }))
    .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
  return { rows, error: null };
}

const USAGE_COUNTERS_TABLE = "subscription_usage_counters";

export type ActiveSubscriptionCard = {
  subscriptionId: string;
  mentorId: string;
  mentorName: string;
  photoUrl: string | null;
  mentorInitial: string;
  planTier: SubscribePlanTier | null;
  planLabel: string;
  subscribedAt: string;
  subscribedAtLabel: string;
  questionsRemainingLabel: string;
  currentPeriodLabel: string;
  currentPeriodEndLabel: string;
  nextBillingDisplayLabel: string;
  weeklyResetLabel: string;
  statusLabel: string;
  statusTone: SubscriptionStatusTone;
};

function parsePlanTier(v: unknown): SubscribePlanTier | null {
  if (isSubscribePlanTier(v)) return v;
  const s = String(v ?? "").toLowerCase().trim();
  return isSubscribePlanTier(s) ? s : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function boolValue(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}

function normalizeStatus(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function mentorInitialFromName(name: string): string {
  const t = name.trim();
  if (!t) return "멘";
  return t.slice(0, 1).toUpperCase();
}

export function formatSubscriptionStartedAt(iso: string): string {
  try {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleDateString("ko-KR", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

export function formatQuestionsRemainingLabel(
  counterRow: Row | null | undefined,
  tier: SubscribePlanTier | null
): string {
  if (counterRow) {
    for (const k of ["weekly_questions_remaining", "questions_remaining", "remaining_questions"] as const) {
      const v = counterRow[k];
      if (typeof v === "number" && Number.isFinite(v)) {
        if (tier === "premium" && v >= 999) return "주 무제한 질문";
        const cap =
          tier === "limited" ? 4 : tier === "standard" ? 9 : tier === "premium" ? 999 : null;
        if (cap != null && cap < 999) {
          return `주 ${cap}개 질문 · 잔여 ${Math.max(0, v)}/${cap}`;
        }
        return `남은 질문 ${v}회`;
      }
    }
  }
  if (tier === "premium") return "주 무제한 질문";
  if (tier === "standard") return "주 9개 질문 (플랜 기준)";
  if (tier === "limited") return "주 4개 질문 (플랜 기준)";
  return "—";
}

async function fetchUsageCountersBySubscriptionId(
  supabase: SupabaseClient,
  subscriptionIds: string[]
): Promise<Map<string, Row>> {
  const out = new Map<string, Row>();
  if (subscriptionIds.length === 0) return out;

  const { error: pe } = await supabase.from(USAGE_COUNTERS_TABLE).select("id").limit(1);
  if (pe) return out;

  const { column: subCol } = await pickExistingColumn(supabase, USAGE_COUNTERS_TABLE, [
    "subscription_id",
  ]);
  if (!subCol) return out;

  const { data, error } = await supabase
    .from(USAGE_COUNTERS_TABLE)
    .select("*")
    .in(subCol, subscriptionIds);
  if (error) {
    console.error("[fetchUsageCountersBySubscriptionId]", error.message);
    return out;
  }

  const usageRows = rowsFromSupabaseData(data) as Row[];
  for (const row of usageRows) {
    const sid = row[subCol];
    if (typeof sid === "string" && sid.trim()) out.set(sid.trim(), row);
  }
  return out;
}

async function planRowsByMentorId(
  supabase: SupabaseClient,
  mentorIds: string[]
): Promise<Map<string, Partial<Record<SubscribePlanTier, Row>>>> {
  const out = new Map<string, Partial<Record<SubscribePlanTier, Row>>>();
  await Promise.all(
    mentorIds.map(async (mentorId) => {
      const plans = await fetchPlansForMentor(supabase, mentorId);
      if (plans.error) {
        console.warn("[loadActiveSubscriptionsForStudent] mentor plans", { mentorId, error: plans.error });
      }
      out.set(mentorId, assignPlansByTier(plans.rows).byTier as Partial<Record<SubscribePlanTier, Row>>);
    })
  );
  return out;
}

export async function loadActiveSubscriptionsForStudent(
  supabase: SupabaseClient,
  studentId: string
): Promise<{ items: ActiveSubscriptionCard[]; error: string | null }> {
  void studentId; // V6 이 auth.uid() 로 본인 당사자 행만 반환한다(세션 클라이언트 전제)
  const loaded = await fetchMySubscriptionsSelf(supabase);
  if (loaded.error) {
    return { items: [], error: loaded.error };
  }

  const rows = loaded.rows.filter((r) => String(r.status ?? "").toLowerCase() === "active");
  const mentorIds = [...new Set(rows.map((r) => String(r.mentor_id ?? "").trim()).filter(Boolean))];
  const subscriptionIds = rows.map((r) => String(r.id ?? "").trim()).filter(Boolean);

  const [profilesLoad, usageBySubId, planRowsByMentor] = await Promise.all([
    loadMentorProfilesForDirectory(supabase, mentorIds),
    fetchUsageCountersBySubscriptionId(supabase, subscriptionIds),
    planRowsByMentorId(supabase, mentorIds),
  ]);

  const usersByMentor = new Map<string, Awaited<ReturnType<typeof getMentorUserPublic>>["data"]>();
  await Promise.all(
    mentorIds.map(async (mentorId) => {
      const { data: userRow } = await getMentorUserPublic(supabase, mentorId);
      usersByMentor.set(mentorId, userRow);
    })
  );

  const items: ActiveSubscriptionCard[] = rows.map((row) => {
    const subscriptionId = String(row.id ?? "");
    const mentorId = String(row.mentor_id ?? "");
    const profileRow = profilesLoad.byUser.get(mentorId) ?? null;
    const userRow = usersByMentor.get(mentorId) ?? null;
    const display = buildMentorProfileDisplay(profileRow, userRow);
    const tier = parsePlanTier(row.plan_tier);
    const planLabel = tier ? `${getSubscribeCatalogPlan(tier).label} 플랜` : "구독 플랜";
    const subscribedAt = stringValue(row.started_at) ?? stringValue(row.created_at) ?? "";
    const counterRow = usageBySubId.get(subscriptionId);
    const status = normalizeStatus(row.status);
    const cancelAtPeriodEnd = boolValue(row.cancel_at_period_end);
    const currentPeriodStart = stringValue(row.current_period_start) ?? subscribedAt;
    const currentPeriodEnd = stringValue(row.current_period_end);
    const nextBillingAt = stringValue(row.next_billing_at);
    const graceUntil = stringValue(row.grace_until);
    const currentPlanRow = tier ? (planRowsByMentor.get(mentorId)?.[tier] ?? null) : null;
    const nextBillingAmountCents = tier ? mentorPlanDebitAmountCents(currentPlanRow, tier) : null;
    const nextBillingAmountLabel = nextBillingAmountCents == null ? null : formatCashFromCents(nextBillingAmountCents);

    return {
      subscriptionId,
      mentorId,
      mentorName: display.displayName,
      photoUrl: display.photoUrl?.trim() ? display.photoUrl.trim() : null,
      mentorInitial: mentorInitialFromName(display.displayName),
      planTier: tier,
      planLabel,
      subscribedAt,
      subscribedAtLabel: subscribedAt ? formatSubscriptionStartedAt(subscribedAt) : "—",
      questionsRemainingLabel: formatQuestionsRemainingLabel(counterRow, tier),
      currentPeriodLabel: formatSubscriptionPeriodLabel(currentPeriodStart, currentPeriodEnd),
      currentPeriodEndLabel: formatSubscriptionDate(currentPeriodEnd),
      nextBillingDisplayLabel: nextBillingDisplayLabel({
        status,
        cancelAtPeriodEnd,
        nextBillingAt,
        amountLabel: nextBillingAmountLabel,
        renewalEnabled: subscriptionRenewalEnabled(),
      }),
      weeklyResetLabel: weeklyQuestionResetLabel(subscribedAt),
      statusLabel: subscriptionStatusDisplayLabel({ status, cancelAtPeriodEnd, currentPeriodEnd, graceUntil }),
      statusTone: subscriptionStatusTone(status, cancelAtPeriodEnd),
    };
  });

  if (profilesLoad.error) {
    console.warn("[loadActiveSubscriptionsForStudent] mentor profiles", profilesLoad.error);
  }

  return { items, error: null };
}

export async function countActiveSubscriptionsForStudent(
  supabase: SupabaseClient,
  studentId: string
): Promise<{ count: number; error: string | null }> {
  void studentId; // V6 이 auth.uid() 당사자 행만 반환(세션 클라이언트 전제)
  const loaded = await fetchMySubscriptionsSelf(supabase);
  if (loaded.error) return { count: 0, error: loaded.error };
  return {
    count: loaded.rows.filter((r) => String(r.status ?? "").toLowerCase() === "active").length,
    error: null,
  };
}
