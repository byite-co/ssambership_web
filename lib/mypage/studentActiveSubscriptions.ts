import type { SupabaseClient } from "@supabase/supabase-js";
import { loadMentorProfilesForDirectory } from "@/lib/auth/mentorPublicRead";
import { buildMentorProfileDisplay } from "@/lib/mentor/mentorDisplayFields";
import type { UserRow } from "@/lib/types/user";
import { rowsFromSupabaseData } from "@/lib/qna/safeSelect";
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

// W4(C10): 후보 테이블 부재 실측(187 baseline 0 — subscription_usage_counters 없음) — 구
// usage counter 테이블·컬럼 프로빙은 프로덕션에서 항상 빈 Map 이었으므로 제거하고, 현행 관측
// 동작(플랜 기준 정적 라벨)을 고정. 기능 정본화는 비범위 — 실시간 잔여 질문 수의 정본은
// RPC get_weekly_question_usage(lib/qna/weeklyQuestionUsage.ts, student·mentor 쌍 키).
export function formatQuestionsRemainingLabel(tier: SubscribePlanTier | null): string {
  if (tier === "premium") return "주 무제한 질문";
  if (tier === "standard") return "주 9개 질문 (플랜 기준)";
  if (tier === "limited") return "주 4개 질문 (플랜 기준)";
  return "—";
}

// D-ST-18: 멘토별 fetchPlansForMentor N+1 을 mentor_plans 단일 배치 조회로 합친다(공개 목록의
// batchPlanLabels 와 동일 패턴 — 학생 세션이 public.mentor_plans 를 읽을 수 있다). display-only:
// 다음 결제 금액 "표시"만 권장가로 낙하하며, 실차감은 갱신 배치가 서버에서 재계산한다.
async function planTierRowsByMentorIdBatch(
  supabase: SupabaseClient,
  mentorIds: string[]
): Promise<Map<string, Partial<Record<SubscribePlanTier, Row>>>> {
  const out = new Map<string, Partial<Record<SubscribePlanTier, Row>>>();
  if (!mentorIds.length) return out;
  const { data, error } = await supabase
    .from("mentor_plans")
    .select("*")
    .in("mentor_id", mentorIds)
    .limit(2000);
  if (error) {
    console.error("[loadActiveSubscriptionsForStudent] mentor plans batch", error.message);
    return out;
  }
  const rowsByMentor = new Map<string, Row[]>();
  for (const row of rowsFromSupabaseData(data) as Row[]) {
    const mid = String(row.mentor_id ?? "");
    if (!mid) continue;
    const list = rowsByMentor.get(mid) ?? [];
    list.push(row);
    rowsByMentor.set(mid, list);
  }
  for (const [mid, rows] of rowsByMentor) {
    out.set(mid, assignPlansByTier(rows).byTier as Partial<Record<SubscribePlanTier, Row>>);
  }
  return out;
}

/** V6 소비 형상에 맞춘 최소 UserRow — mentor_directory_v1 nickname 배치용(displayName 만 소비). */
function minimalMentorUserRow(mentorId: string, nickname: unknown): UserRow {
  return {
    id: mentorId,
    role: "mentor",
    status: "active",
    full_name: null,
    nickname: typeof nickname === "string" ? nickname : null,
    email: null,
    grade_level: null,
    student_status: null,
    birth_date: null,
    terms_agreed_at: null,
    privacy_agreed_at: null,
    marketing_agreed: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

// D-ST-18: 멘토별 단건 공개 유저 조회(N+1)를 mentor_directory_v1 nickname 단일 배치로 합친다.
async function mentorUserRowsByIdBatch(
  supabase: SupabaseClient,
  mentorIds: string[]
): Promise<Map<string, UserRow>> {
  const out = new Map<string, UserRow>();
  if (!mentorIds.length) return out;
  const { data, error } = await supabase
    .schema(API_WEB_V1_SCHEMA)
    .from("mentor_directory_v1")
    .select("mentor_id, nickname")
    .in("mentor_id", mentorIds);
  if (error) {
    console.warn("[loadActiveSubscriptionsForStudent] mentor nicknames batch", error.message);
    return out;
  }
  for (const row of rowsFromSupabaseData(data) as Row[]) {
    const id = String(row.mentor_id ?? "");
    if (!id) continue;
    out.set(id, minimalMentorUserRow(id, row.nickname));
  }
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

  const [profilesLoad, planRowsByMentor, usersByMentor] = await Promise.all([
    loadMentorProfilesForDirectory(supabase, mentorIds),
    planTierRowsByMentorIdBatch(supabase, mentorIds),
    mentorUserRowsByIdBatch(supabase, mentorIds),
  ]);

  const items: ActiveSubscriptionCard[] = rows.map((row) => {
    const subscriptionId = String(row.id ?? "");
    const mentorId = String(row.mentor_id ?? "");
    const profileRow = profilesLoad.byUser.get(mentorId) ?? null;
    const userRow = usersByMentor.get(mentorId) ?? null;
    const display = buildMentorProfileDisplay(profileRow, userRow);
    const tier = parsePlanTier(row.plan_tier);
    const planLabel = tier ? `${getSubscribeCatalogPlan(tier).label} 플랜` : "구독 플랜";
    const subscribedAt = stringValue(row.started_at) ?? stringValue(row.created_at) ?? "";
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
      questionsRemainingLabel: formatQuestionsRemainingLabel(tier),
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
