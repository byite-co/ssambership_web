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

// W4(C10): 티어 판정은 mentor_plans.plan_tier(NOT NULL 정본 컬럼 — 187 baseline 실측,
// 값은 limited/standard/premium 3종뿐) 고정. 구 후보 키(tier/slug/code)와
// 이름 정규식(title/name/label/plan_name/tier_name) 스캔을 제거했다.
function detectTier(row: Row): SubscribePlanTier | null {
  const tierCol = String(row.plan_tier ?? "").trim().toLowerCase();
  return isSubscribePlanTier(tierCol) ? tierCol : null;
}

/**
 * DB 행을 Limited / Standard / Premium에 매핑 — mentor_plans.plan_tier 기준.
 * W4(C10): 구 "미매칭 행 순서 보강"(티어 불명 행을 빈 슬롯에 임의 배정)은 스키마 불확실성
 * 보정용 호환 로직이라 제거 — 불명 행은 배정하지 않는다(호출부가 플랜 부재로 처리, fail-visible).
 */
export function assignPlansByTier(rows: Row[]): { byTier: PlansByTier; fillProbe: string } {
  const byTier: PlansByTier = { limited: null, standard: null, premium: null };
  for (const r of rows) {
    const t = detectTier(r);
    if (t && !byTier[t]) byTier[t] = r;
  }
  return { byTier, fillProbe: "mentor_plans.plan_tier 정본 매핑" };
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

// W4(C10): mentor_plans 에 주간 한도 컬럼 부재 실측(187 baseline — weekly_* 후보 5종 전부 없음).
// 구 후보 키 스캔은 항상 불발되어 카탈로그 라벨로 낙하했으므로, 관측 동작(카탈로그 정본)을 고정한다.
export function weeklyQuestionsLabel(row: Row | null): string {
  if (!row) return "구독 플랜을 연결하면 이곳에 질문 한도를 표시해요";
  const tier = detectTier(row);
  if (tier) return getSubscribeCatalogPlan(tier).weeklyLabel;
  return "질문 한도는 구독 플랜에 따라 달라요";
}

// D-ST-12: 영구 빈 결과를 반환하던 프로모션 스텁과 loadStudentSubscribePage 반환의 promotions
// 필드를 제거했다. 프로모션 데이터 소스는 미연결이고 이 값은 /subscribe 렌더에 소비되지 않아,
// '데이터 없음'과 '기능 미구현'을 구분할 수 없는 사장 코드였다. 정본 테이블
// 연결(app_notices·promotion_campaigns)은 비범위. `PromotionsLoad` 타입은 유지한다.

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

  const [{ row: profileRow, error: profileError }, plans] = await Promise.all([
    fetchMentorProfileForPublicMentor(supabase, mentorId),
    fetchPlansForMentor(supabase, mentorId),
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
  };
}
