import type { SupabaseClient } from "@supabase/supabase-js";
import { getMentorUserPublic, loadMentorProfilesForDirectory } from "@/lib/auth/mentorPublicRead";
import { fetchPlansForMentor } from "@/lib/mentor/publicMentorBundle";
import { buildMentorProfileDisplay } from "@/lib/mentor/mentorDisplayFields";
import { rowsFromSupabaseData } from "@/lib/qna/safeSelect";
import { getSubscribeCatalogPlan } from "@/lib/subscribe/subscribePlanCatalog";
import { assignPlansByTier, isSubscribePlanTier, type SubscribePlanTier } from "@/lib/subscribe/subscribePageQueries";
import { mentorPlanDebitAmountCents } from "@/lib/subscribe/mentorPlanPricing";
import {
  SUBSCRIPTIONS_ORDER_COLUMN,
  SUBSCRIPTIONS_SELECT,
  SUBSCRIPTIONS_TABLE,
} from "@/lib/subscribe/subscriptionsTable";
import {
  formatSubscriptionPeriodLabel,
  nextBillingDisplayLabel,
  subscriptionRenewalEnabled,
  subscriptionStatusDisplayLabel,
  subscriptionStatusTone,
  weeklyQuestionResetLabel,
  type SubscriptionStatusTone,
} from "@/lib/subscribe/subscriptionDisplay";
import {
  computeProratedRefundEstimate,
  formatCashFromCents,
  formatDateLabel,
  refundBracketLabelKo,
  type ProratedRefundEstimate,
} from "@/lib/subscribe/subscriptionRefundProration";
import { bulkHasSubscriptionUsageStarted } from "@/lib/subscribe/subscriptionUsageStarted";

type Row = Record<string, unknown>;

export type StudentSubscriptionManagementItem = {
  subscriptionId: string;
  mentorId: string;
  mentorName: string;
  planTier: SubscribePlanTier | null;
  planLabel: string;
  status: string;
  statusLabel: string;
  statusTone: SubscriptionStatusTone;
  cancelAtPeriodEnd: boolean;
  canCancel: boolean;
  canUndoCancel: boolean;
  canRequestRefund: boolean;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  nextBillingAt: string | null;
  graceUntil: string | null;
  currentPeriodLabel: string;
  currentPeriodEndLabel: string;
  nextBillingAtLabel: string;
  nextBillingAmountCents: number | null;
  nextBillingAmountLabel: string | null;
  nextBillingDisplayLabel: string;
  weeklyQuestionLimitLabel: string;
  weeklyResetLabel: string;
  paymentId: string | null;
  latestBillingAmountCents: number | null;
  latestBillingAmountLabel: string;
  refundEstimate: ProratedRefundEstimate;
  refundEstimateLabel: string;
  /** 학원법 별표4 분기 사유(한글) — UI 안내용 */
  refundEstimateBracketLabel: string;
  pendingRefundId: string | null;
  resubscribeHref: string;
};

export type StudentSubscriptionManagementList = {
  items: StudentSubscriptionManagementItem[];
  error: string | null;
};

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
  }
  return null;
}

function boolValue(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}

function parsePlanTier(value: unknown): SubscribePlanTier | null {
  if (isSubscribePlanTier(value)) return value;
  const normalized = String(value ?? "").trim().toLowerCase();
  return isSubscribePlanTier(normalized) ? normalized : null;
}

function normalizeStatus(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

// W4(C10): subscription_billing_events(064 — 정본 테이블·고정 컬럼) 조회 실패를 빈 Map
// ("청구 이력 없음" 표시)으로 삼키던 silent-catch 제거 — 오류를 error 필드로 전파한다.
async function latestSucceededBillingEventsBySubscription(
  supabase: SupabaseClient,
  subscriptionIds: string[]
): Promise<{ map: Map<string, Row>; error: string | null }> {
  const out = new Map<string, Row>();
  if (!subscriptionIds.length) return { map: out, error: null };

  const { data, error } = await supabase
    .from("subscription_billing_events")
    .select("subscription_id, amount_cents, payment_id, period_start, period_end, billing_at, event_type, status")
    .in("subscription_id", subscriptionIds)
    .eq("status", "succeeded")
    .in("event_type", ["initial", "renewal"])
    .order("billing_at", { ascending: false });

  if (error) {
    return { map: out, error: error.message };
  }

  for (const row of rowsFromSupabaseData(data) as Row[]) {
    const subscriptionId = stringValue(row.subscription_id);
    if (subscriptionId && !out.has(subscriptionId)) out.set(subscriptionId, row);
  }
  return { map: out, error: null };
}

// W4(C10): refunds(004·069 — 정본 테이블) 조회 실패를 빈 Map(pendingRefundId=null →
// canRequestRefund가 UI에서 fail-open)으로 삼키던 silent-catch 제거 — 오류를 전파한다.
async function pendingRefundsBySubscription(
  supabase: SupabaseClient,
  studentId: string,
  subscriptionIds: string[]
): Promise<{ map: Map<string, string>; error: string | null }> {
  const out = new Map<string, string>();
  if (!subscriptionIds.length) return { map: out, error: null };

  const { data, error } = await supabase
    .from("refunds")
    .select("id, subscription_id, status")
    .eq("user_id", studentId)
    .in("subscription_id", subscriptionIds)
    .eq("status", "pending");

  if (error) {
    return { map: out, error: error.message };
  }

  for (const row of rowsFromSupabaseData(data) as Row[]) {
    const subscriptionId = stringValue(row.subscription_id);
    const refundId = stringValue(row.id);
    if (subscriptionId && refundId) out.set(subscriptionId, refundId);
  }
  return { map: out, error: null };
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
        // W4(C10): display-only degrade — 다음 결제 금액 "표시"만 권장가(CLAUDE.md 정본 폴백)로
        // 낙하하며 성공으로 위장하지 않는다(로그 유지). 실차감은 갱신 배치가 서버에서 재계산.
        console.error("[planRowsByMentorId]", { mentorId, error: plans.error });
      }
      out.set(mentorId, assignPlansByTier(plans.rows).byTier as Partial<Record<SubscribePlanTier, Row>>);
    })
  );
  return out;
}

export async function loadStudentSubscriptionManagementList(
  supabase: SupabaseClient,
  studentId: string
): Promise<StudentSubscriptionManagementList> {
  const { data, error } = await supabase
    .from(SUBSCRIPTIONS_TABLE)
    .select(SUBSCRIPTIONS_SELECT)
    .eq("student_id", studentId)
    .order(SUBSCRIPTIONS_ORDER_COLUMN, { ascending: false });

  if (error) {
    return { items: [], error: error.message };
  }

  const rows = rowsFromSupabaseData(data) as Row[];
  const subscriptionIds = rows.map((row) => stringValue(row.id)).filter(Boolean) as string[];
  const mentorIds = [...new Set(rows.map((row) => stringValue(row.mentor_id)).filter(Boolean))] as string[];

  const [profilesLoad, billingLoad, pendingRefundLoad, planRowsByMentor] = await Promise.all([
    loadMentorProfilesForDirectory(supabase, mentorIds),
    latestSucceededBillingEventsBySubscription(supabase, subscriptionIds),
    pendingRefundsBySubscription(supabase, studentId, subscriptionIds),
    planRowsByMentorId(supabase, mentorIds),
  ]);

  // W4(C10): 결제 이력·환불 대기 조회 실패는 목록 오류로 전파(구 silent-catch — 빈 Map — 폐기).
  if (billingLoad.error) {
    return { items: [], error: billingLoad.error };
  }
  if (pendingRefundLoad.error) {
    return { items: [], error: pendingRefundLoad.error };
  }
  const billingBySubscription = billingLoad.map;
  const pendingRefundBySubscription = pendingRefundLoad.map;

  // 학원법 별표4 "이용 개시" 판정을 카드별로 한 번에 조회.
  const usageStartedBySub = await bulkHasSubscriptionUsageStarted(
    supabase,
    rows.flatMap((row) => {
      const subId = stringValue(row.id);
      const mId = stringValue(row.mentor_id);
      const billingEvent = subId ? billingBySubscription.get(subId) ?? null : null;
      const periodStart = stringValue(row.current_period_start) ?? stringValue(billingEvent?.period_start);
      return subId && mId ? [{ subscriptionId: subId, studentId, mentorId: mId, periodStartIso: periodStart }] : [];
    })
  );

  const usersByMentor = new Map<string, Awaited<ReturnType<typeof getMentorUserPublic>>["data"]>();
  await Promise.all(
    mentorIds.map(async (mentorId) => {
      const { data: userRow } = await getMentorUserPublic(supabase, mentorId);
      usersByMentor.set(mentorId, userRow);
    })
  );

  const items = rows.map((row): StudentSubscriptionManagementItem => {
    const subscriptionId = stringValue(row.id) ?? "";
    const mentorId = stringValue(row.mentor_id) ?? "";
    const profileRow = profilesLoad.byUser.get(mentorId) ?? null;
    const userRow = usersByMentor.get(mentorId) ?? null;
    const display = buildMentorProfileDisplay(profileRow, userRow);
    const tier = parsePlanTier(row.plan_tier);
    const status = normalizeStatus(row.status);
    const cancelAtPeriodEnd = boolValue(row.cancel_at_period_end);
    const billingEvent = billingBySubscription.get(subscriptionId) ?? null;
    const amountCents = numberValue(billingEvent?.amount_cents);
    const currentPeriodStart = stringValue(row.current_period_start) ?? stringValue(billingEvent?.period_start);
    const currentPeriodEnd = stringValue(row.current_period_end) ?? stringValue(billingEvent?.period_end);
    const nextBillingAt = stringValue(row.next_billing_at);
    const graceUntil = stringValue(row.grace_until);
    const paymentId = stringValue(billingEvent?.payment_id) ?? stringValue(row.payment_id);
    const currentPlanRow = tier ? (planRowsByMentor.get(mentorId)?.[tier] ?? null) : null;
    const nextBillingAmountCents = tier ? mentorPlanDebitAmountCents(currentPlanRow, tier) : null;
    const nextBillingAmountLabel = nextBillingAmountCents == null ? null : formatCashFromCents(nextBillingAmountCents);
    const usageStarted = usageStartedBySub.get(subscriptionId) ?? true;
    const refundEstimate = computeProratedRefundEstimate({
      amountCents,
      periodStartIso: currentPeriodStart,
      periodEndIso: currentPeriodEnd,
      usageStarted,
      mode: "student_voluntary",
    });
    const pendingRefundId = pendingRefundBySubscription.get(subscriptionId) ?? null;
    const canUsePeriod = status === "active" || status === "past_due";

    return {
      subscriptionId,
      mentorId,
      mentorName: display.displayName,
      planTier: tier,
      planLabel: tier ? `${getSubscribeCatalogPlan(tier).label} 플랜` : "구독 플랜",
      status,
      statusLabel: subscriptionStatusDisplayLabel({ status, cancelAtPeriodEnd, currentPeriodEnd, graceUntil }),
      statusTone: subscriptionStatusTone(status, cancelAtPeriodEnd),
      cancelAtPeriodEnd,
      canCancel: canUsePeriod && !cancelAtPeriodEnd,
      canUndoCancel: canUsePeriod && cancelAtPeriodEnd,
      canRequestRefund: canUsePeriod && refundEstimate.amountCents > 0 && !pendingRefundId,
      currentPeriodStart,
      currentPeriodEnd,
      nextBillingAt,
      graceUntil,
      currentPeriodLabel: formatSubscriptionPeriodLabel(currentPeriodStart, currentPeriodEnd),
      currentPeriodEndLabel: formatDateLabel(currentPeriodEnd),
      nextBillingAtLabel: formatDateLabel(nextBillingAt),
      nextBillingAmountCents,
      nextBillingAmountLabel,
      nextBillingDisplayLabel: nextBillingDisplayLabel({
        status,
        cancelAtPeriodEnd,
        nextBillingAt,
        amountLabel: nextBillingAmountLabel,
        renewalEnabled: subscriptionRenewalEnabled(),
      }),
      weeklyQuestionLimitLabel: tier ? getSubscribeCatalogPlan(tier).weeklyLabel : "—",
      weeklyResetLabel: weeklyQuestionResetLabel(stringValue(row.started_at) ?? stringValue(row.created_at)),
      paymentId,
      latestBillingAmountCents: amountCents,
      latestBillingAmountLabel: amountCents == null ? "결제 금액 확인 필요" : formatCashFromCents(amountCents),
      refundEstimate,
      refundEstimateLabel: formatCashFromCents(refundEstimate.amountCents),
      refundEstimateBracketLabel: refundBracketLabelKo(refundEstimate.bracketReason),
      pendingRefundId,
      resubscribeHref: `/subscribe?mentorId=${encodeURIComponent(mentorId)}${tier ? `&plan=${encodeURIComponent(tier)}` : ""}`,
    };
  });

  if (profilesLoad.error) {
    console.warn("[loadStudentSubscriptionManagementList] mentor profiles", profilesLoad.error);
  }

  return { items, error: null };
}
