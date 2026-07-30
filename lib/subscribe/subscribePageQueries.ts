import type { SupabaseClient } from "@supabase/supabase-js";
import {
  cashKrwForSubscribeTier,
  formatSubscribePlanCashMonthlyLabel,
  getSubscribeCatalogPlan,
} from "@/lib/subscribe/subscribePlanCatalog";
import { mentorPlanCashKrw } from "@/lib/subscribe/mentorPlanPricing";
import { getMentorUserPublic, fetchMentorProfileForPublicMentor } from "@/lib/auth/mentorPublicRead";
import { buildMentorProfileDisplay, type MentorProfileDisplay } from "@/lib/mentor/mentorDisplayFields";
import { fetchPlansForMentor, type MentorPlansLoad } from "@/lib/mentor/publicMentorBundle";
import { getStringField } from "@/lib/qna/safeSelect";
import type { UserRow } from "@/lib/types/user";

type Row = Record<string, unknown>;

export type SubscribePlanTier = "limited" | "standard" | "premium";

export function isSubscribePlanTier(v: unknown): v is SubscribePlanTier {
  return v === "limited" || v === "standard" || v === "premium";
}

export type PlansByTier = Record<SubscribePlanTier, Row | null>;

export type PromotionsLoad = {
  rows: Row[];
  table: string | null;
  probe: string;
  error: string | null;
};

function detectTier(row: Row): SubscribePlanTier | null {
  const tierCol = (getStringField(row, ["plan_tier", "tier", "slug", "code"]) ?? "").toLowerCase();
  if (tierCol === "limited" || tierCol === "standard" || tierCol === "premium") {
    return tierCol;
  }
  const title = (getStringField(row, ["title", "name", "label", "plan_name", "tier_name"]) ?? "").toLowerCase();
  if (/limited|리미티드|라이트|light/.test(title)) return "limited";
  if (/standard|스탠다드/.test(title)) return "standard";
  if (/premium|프리미엄|pro|프로/.test(title)) return "premium";
  return null;
}

/**
 * DB 행을 Limited / Standard / Premium에 매핑(이름 기준), 남는 행은 순서대로 빈 슬롯에 채움.
 */
export function assignPlansByTier(rows: Row[]): { byTier: PlansByTier; fillProbe: string } {
  const byTier: PlansByTier = { limited: null, standard: null, premium: null };
  const unmatched: Row[] = [];
  for (const r of rows) {
    const t = detectTier(r);
    if (t && !byTier[t]) byTier[t] = r;
    else unmatched.push(r);
  }
  let u = 0;
  for (const key of ["limited", "standard", "premium"] as const) {
    if (!byTier[key] && unmatched[u]) {
      byTier[key] = unmatched[u];
      u++;
    }
  }
  return {
    byTier,
    fillProbe: unmatched.length ? `미매칭 ${unmatched.length}행 중 ${u}건으로 슬롯 보강` : "티어 키워드 또는 순서 매핑",
  };
}

export function priceLabelFromPlanRow(row: Row | null, tier?: SubscribePlanTier): string {
  const resolvedTier = tier ?? (row ? detectTier(row) : null);

  let krw = 0;
  if (row) {
    krw = resolvedTier ? mentorPlanCashKrw(row, resolvedTier) : 0;
  }
  if (krw <= 0 && resolvedTier) {
    krw = cashKrwForSubscribeTier(resolvedTier);
  }
  if (krw <= 0 && row) {
    const tierFromRow = detectTier(row);
    if (tierFromRow) {
      krw = cashKrwForSubscribeTier(tierFromRow);
    }
  }

  if (krw <= 0) return "가격 확인";
  return formatSubscribePlanCashMonthlyLabel(krw);
}

export function weeklyQuestionsLabel(row: Row | null): string {
  if (!row) return "구독 플랜을 연결하면 이곳에 질문 한도를 표시해요";
  const s = getStringField(row, [
    "weekly_new_questions",
    "weekly_question_limit",
    "questions_per_week",
    "quota_per_week",
    "new_questions_per_week",
  ]);
  if (s) {
    const trimmed = s.trim();
    if (/^주\s*\d/.test(trimmed) || trimmed.includes("무제한")) return trimmed;
    const n = Number(trimmed.replace(/[^\d]/g, ""));
    if (Number.isFinite(n) && n > 0) return `주 ${n}개 질문`;
    return trimmed;
  }
  for (const k of ["weekly_new_questions", "questions_per_week", "weekly_question_limit"] as const) {
    const v = row[k];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) {
      return v >= 999 ? "주 무제한 질문" : `주 ${v}개 질문`;
    }
  }
  const tier = detectTier(row);
  if (tier) return getSubscribeCatalogPlan(tier).weeklyLabel;
  return "질문 한도는 구독 플랜에 따라 달라요";
}

async function fetchPromotionsProbe(supabase: SupabaseClient): Promise<PromotionsLoad> {
  const tables = ["promotions", "site_notices", "notices", "active_promotions"] as const;
  for (const table of tables) {
    const { error: pe } = await supabase.from(table).select("id").limit(1);
    if (pe) continue;
    const { data, error } = await supabase.from(table).select("*").limit(5);
    if (error) return { rows: [], table, probe: `${table}: ${error.message}`, error: error.message };
    return {
      rows: (data as Row[]) ?? [],
      table,
      probe: `${table} · 최대 5행(is_active·기간 컬럼은 후속 필터)`,
      error: null,
    };
  }
  return { rows: [], table: null, probe: "promotions / notices 테이블 없음 또는 RLS", error: null };
}

// S2-2 전환 W1(C1 — 계약 §17 #15): 구 SUB_TABLES/PAY_TABLES 페어 프로빙
// (`fetchSubscriptionForPair`·`fetchLatestPaymentProbe`)은 결과 필드가 모든 호출부에서
// 미사용(사장)임이 실측돼 제거했다. 구독 조회 정본은 V6 RPC `my_subscriptions_self()`
// (lib/mypage/studentActiveSubscriptions.ts) — mentor_subscriptions·user_subscriptions 는
// 실측 부재 테이블이다(XW-10).

export type StudentSubscribePageData =
  | { kind: "no_mentor" }
  | { kind: "mentor_error"; message: string }
  | {
      kind: "ok";
      mentorId: string;
      userRow: UserRow;
      display: MentorProfileDisplay;
      profileError: string | null;
      plans: MentorPlansLoad;
      byTier: PlansByTier;
      fillProbe: string;
      promotions: PromotionsLoad;
    };

export async function loadStudentSubscribePage(
  supabase: SupabaseClient,
  args: { mentorId: string | null; studentId: string }
): Promise<StudentSubscribePageData> {
  if (!args.mentorId?.trim()) {
    return { kind: "no_mentor" };
  }
  const mentorId = args.mentorId.trim();
  const { data: userRow, error: uErr } = await getMentorUserPublic(supabase, mentorId);
  if (!userRow) {
    return { kind: "mentor_error", message: uErr?.message ?? "멘토를 찾을 수 없습니다." };
  }
  if (userRow.role !== "mentor") {
    return { kind: "mentor_error", message: "멘토에 대해서만 구독할 수 있습니다." };
  }

  const [{ row: profileRow, error: profileError }, plans, promotions] = await Promise.all([
    fetchMentorProfileForPublicMentor(supabase, mentorId),
    fetchPlansForMentor(supabase, mentorId),
    fetchPromotionsProbe(supabase),
  ]);

  const { byTier, fillProbe } = assignPlansByTier((plans.rows as Row[]) ?? []);
  const display = buildMentorProfileDisplay(profileRow, userRow);

  return {
    kind: "ok",
    mentorId,
    userRow,
    display,
    profileError: profileError,
    plans,
    byTier,
    fillProbe,
    promotions,
  };
}
