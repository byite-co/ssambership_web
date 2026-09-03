import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ACCOUNT_PLAN_TIERS,
  buildMentorCapBreakdown,
  maskAccountNumber,
  mentorPayoutRegistered,
  mentorPlansMissing,
  planTierLabel,
  type MentorCapTierBreakdown,
  type MentorPlanSummaryRow,
} from "@/lib/admin/accountDetailConsole";
import { loadUserNamesByIds } from "@/lib/admin/accountDetailQueries";
import type { DocumentViewerSource } from "@/lib/admin/documentViewerModel";
import { describeStudentIdDocument } from "@/lib/admin/mentorApprovalDocuments";
import {
  pickSchoolTierReviewRow,
  resolveSchoolTierReviewState,
  type SchoolTierReviewRowLite,
  type SchoolTierReviewState,
} from "@/lib/admin/mentorSchoolTierReview";
import { mentorActivityState, type MentorActivityState } from "@/lib/mentor/mentorActivity";
import { loadMentorCapUsage, type MentorCapUsage } from "@/lib/subscribe/mentorCapService";
import { mentorPlanCashKrw, mentorSubscriptionPriceRule, type MentorSubscriptionPriceRule } from "@/lib/subscribe/mentorPlanPricing";
import { isSubscribePlanTier, type SubscribePlanTier } from "@/lib/subscribe/subscribePageQueries";

/**
 * 계정 상세 — 멘토 탭(PR-7 §2-3) 조회. 전부 읽기(service_role 우선 · 리뷰 통계 RPC 만 관리자 세션 — `is_admin()` 게이트가 include_hidden 을 허용한다).
 *
 * - 프로필·학교 인증·서류: PR-2 작업대와 같은 정본(`mentor_school_verifications` → `resolveSchoolTierReviewState` · `describeStudentIdDocument`).
 * - 요금제: `mentor_plans` 3행(라이트·스탠다드·프리미엄). 현재가는 실차감 규칙(`mentorPlanCashKrw` — 행 금액 → 권장가 폴백)이고
 *   허용 범위는 저장 시 서버가 강제하는 정본 `mentorSubscriptionPriceRule` 이다. 행이 하나도 없으면 `plansMissing`.
 * - 정원: `loadMentorCapUsage`(RPC mentor_cap_used / mentor_cap_limit / subscription_cap_weight) 그대로. 요금제별 내역은 활성 구독을
 *   요금제별로 센 뒤 RPC 가중치를 곱한다(`buildMentorCapBreakdown`) — 가중치 상수 없음.
 * - 정산 계좌: `mentor_profiles.payout_bank_name` / `payout_account_number`(마스킹). 활동 상태: `activity_status` + 부속 시각.
 * - 받은 리뷰: `get_mentor_review_stats(p_include_hidden=true)` + 최근 5건(`reviews`).
 */

const PROFILE_COLUMNS =
  "user_id, university_name, department_name, teaching_subjects, high_school_name, intro_line, bio, verification_status, student_id_image_url, profile_image_url, created_at, payout_bank_name, payout_account_number, activity_status, pause_until, pause_reason, termination_effective_at, abandonment_flagged_at, is_open_for_subscriptions";
const SCHOOL_VERIFICATION_COLUMNS =
  "id, mentor_id, status, school_tier, verified_major_category, verified_university_name, verified_university_id, verified_department_name, document_storage_ref, reviewed_by, reviewed_at, created_at";
const PLAN_COLUMNS = "id, plan_tier, amount_cents, label, is_active, price_updated_at, updated_at";
const REVIEW_COLUMNS = "id, rating, body, created_at, is_hidden, is_blinded, moderation_state";
const RECENT_REVIEW_LIMIT = 5;
/** 활성 구독 행 상한 — 멘토 1인 기준(정원 28 이하) */
const ACTIVE_SUBSCRIPTION_ROW_LIMIT = 2000;

type Row = Record<string, unknown>;

export type MentorAccountProfile = {
  university: string | null;
  department: string | null;
  subjects: string[];
  highSchool: string | null;
  introLine: string | null;
  bio: string | null;
  photoUrl: string | null;
  verificationStatus: string;
  isOpenForSubscriptions: boolean | null;
  createdAt: string | null;
};

export type MentorPlanRow = MentorPlanSummaryRow & { band: MentorSubscriptionPriceRule };

export type MentorReviewStats = { count: number; avg: number | null; distribution: Record<1 | 2 | 3 | 4 | 5, number> };
export type MentorRecentReview = { id: string; rating: number | null; body: string; createdAt: string | null; hidden: boolean; moderationState: string | null };

export type MentorAccountSection = {
  profile: MentorAccountProfile;
  schoolTier: SchoolTierReviewState;
  schoolTierReviewerName: string | null;
  studentIdDocument: DocumentViewerSource | null;
  schoolDocument: DocumentViewerSource | null;
  plans: MentorPlanRow[];
  plansError: string | null;
  plansMissing: boolean;
  individualQuestion: { cashKrw: number | null; updatedAt: string | null; error: string | null };
  cap: MentorCapUsage;
  capBreakdown: { rows: MentorCapTierBreakdown[]; total: number } | null;
  capBreakdownError: string | null;
  activity: {
    state: MentorActivityState;
    raw: string | null;
    pauseUntil: string | null;
    pauseReason: string | null;
    terminationEffectiveAt: string | null;
    abandonmentFlaggedAt: string | null;
  };
  payout: { registered: boolean; bankName: string | null; accountMasked: string | null };
  reviews: { stats: MentorReviewStats | null; statsError: string | null; recent: MentorRecentReview[]; recentError: string | null };
};

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}
function numOrNull(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

async function loadSchoolTierRows(db: SupabaseClient, mentorUserId: string): Promise<SchoolTierReviewRowLite[]> {
  const { data, error } = await db
    .from("mentor_school_verifications")
    .select(SCHOOL_VERIFICATION_COLUMNS)
    .eq("mentor_id", mentorUserId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) {
    console.error("[accountMentor] mentor_school_verifications:", error.message);
    return [];
  }
  return (data as unknown as SchoolTierReviewRowLite[] | null) ?? [];
}

async function loadPlans(db: SupabaseClient, mentorUserId: string): Promise<{ rows: MentorPlanRow[]; error: string | null; byId: Map<string, SubscribePlanTier> }> {
  const byId = new Map<string, SubscribePlanTier>();
  const { data, error } = await db.from("mentor_plans").select(PLAN_COLUMNS).eq("mentor_id", mentorUserId);
  if (error) {
    console.error("[accountMentor] mentor_plans:", error.message);
    return { rows: [], error: "요금제를 불러오지 못했습니다.", byId };
  }
  const raw = (data as Row[] | null) ?? [];
  for (const r of raw) {
    const tier = str(r.plan_tier).toLowerCase();
    if (str(r.id) && isSubscribePlanTier(tier)) byId.set(str(r.id), tier);
  }
  const rows: MentorPlanRow[] = ACCOUNT_PLAN_TIERS.map((tier) => {
    const row = raw.find((r) => str(r.plan_tier).toLowerCase() === tier) ?? null;
    const amountCents = row ? numOrNull(row.amount_cents) : null;
    return {
      tier,
      label: planTierLabel(tier),
      present: Boolean(row),
      cashKrw: row ? mentorPlanCashKrw(row, tier) : null,
      fallbackToRecommended: Boolean(row) && !(amountCents != null && amountCents > 0),
      isActive: row ? (typeof row.is_active === "boolean" ? row.is_active : null) : null,
      priceUpdatedAt: row ? (strOrNull(row.price_updated_at) ?? strOrNull(row.updated_at)) : null,
      band: mentorSubscriptionPriceRule(tier),
    };
  });
  return { rows, error: null, byId };
}

async function loadIndividualQuestionPricing(db: SupabaseClient, mentorUserId: string): Promise<MentorAccountSection["individualQuestion"]> {
  const { data, error } = await db.from("mentor_individual_question_pricing").select("mentor_id, amount_cents, updated_at").eq("mentor_id", mentorUserId).maybeSingle();
  if (error) {
    console.error("[accountMentor] mentor_individual_question_pricing:", error.message);
    return { cashKrw: null, updatedAt: null, error: "개별질문 단가를 불러오지 못했습니다." };
  }
  const row = data as Row | null;
  const cents = row ? numOrNull(row.amount_cents) : null;
  return { cashKrw: cents != null && cents > 0 ? Math.round(cents / 100) : null, updatedAt: strOrNull(row?.updated_at), error: null };
}

/** 활성 구독을 요금제별로 센다 — `plan_tier` 가 비면 `plan_id` → mentor_plans 행의 tier 로 보완. */
async function loadActiveCountByTier(
  db: SupabaseClient,
  mentorUserId: string,
  planTierById: ReadonlyMap<string, SubscribePlanTier>
): Promise<{ counts: Partial<Record<SubscribePlanTier, number>>; error: string | null }> {
  const { data, error } = await db
    .from("subscriptions")
    .select("plan_tier, plan_id")
    .eq("mentor_id", mentorUserId)
    .ilike("status", "active")
    .limit(ACTIVE_SUBSCRIPTION_ROW_LIMIT);
  if (error) {
    console.error("[accountMentor] subscriptions(active):", error.message);
    return { counts: {}, error: "활성 구독을 집계하지 못했습니다." };
  }
  const counts: Partial<Record<SubscribePlanTier, number>> = {};
  for (const r of (data as Row[] | null) ?? []) {
    const direct = str(r.plan_tier).toLowerCase();
    const tier: SubscribePlanTier | null = isSubscribePlanTier(direct) ? direct : (planTierById.get(str(r.plan_id)) ?? null);
    if (!tier) continue;
    counts[tier] = (counts[tier] ?? 0) + 1;
  }
  return { counts, error: null };
}

async function loadReviewStats(session: SupabaseClient, mentorUserId: string): Promise<{ stats: MentorReviewStats | null; error: string | null }> {
  const { data, error } = await session.rpc("get_mentor_review_stats", { p_mentor_id: mentorUserId, p_include_hidden: true });
  if (error) {
    console.error("[accountMentor] get_mentor_review_stats:", error.message);
    return { stats: null, error: "리뷰 통계를 불러오지 못했습니다." };
  }
  const row = (Array.isArray(data) ? data[0] : data) as Row | null | undefined;
  if (!row) return { stats: { count: 0, avg: null, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } }, error: null };
  return {
    stats: {
      count: numOrNull(row.review_count) ?? 0,
      avg: numOrNull(row.avg_rating),
      distribution: { 1: numOrNull(row.d1) ?? 0, 2: numOrNull(row.d2) ?? 0, 3: numOrNull(row.d3) ?? 0, 4: numOrNull(row.d4) ?? 0, 5: numOrNull(row.d5) ?? 0 },
    },
    error: null,
  };
}

async function loadRecentReviews(db: SupabaseClient, mentorUserId: string): Promise<{ rows: MentorRecentReview[]; error: string | null }> {
  const { data, error } = await db.from("reviews").select(REVIEW_COLUMNS).eq("mentor_id", mentorUserId).order("created_at", { ascending: false }).limit(RECENT_REVIEW_LIMIT);
  if (error) {
    console.error("[accountMentor] reviews:", error.message);
    return { rows: [], error: "최근 리뷰를 불러오지 못했습니다." };
  }
  return {
    rows: ((data as Row[] | null) ?? []).map((r) => ({
      id: str(r.id),
      rating: numOrNull(r.rating),
      body: str(r.body),
      createdAt: strOrNull(r.created_at),
      hidden: r.is_hidden === true || r.is_blinded === true,
      moderationState: strOrNull(r.moderation_state),
    })),
    error: null,
  };
}

/** 멘토 탭 재료 — `mentor_profiles` 행이 없으면 null(역할은 멘토인데 프로필이 없는 계정). */
export async function loadMentorAccountSection(session: SupabaseClient, db: SupabaseClient, mentorUserId: string): Promise<MentorAccountSection | null> {
  const id = str(mentorUserId);
  if (!id) return null;
  const { data, error } = await db.from("mentor_profiles").select(PROFILE_COLUMNS).eq("user_id", id).maybeSingle();
  if (error) {
    console.error("[accountMentor] mentor_profiles:", error.message);
    return null;
  }
  const profile = data as Row | null;
  if (!profile) return null;

  const studentIdRef = str(profile.student_id_image_url);
  const [schoolRows, plans, individualQuestion, cap, studentIdDocument, reviewStats, recentReviews] = await Promise.all([
    loadSchoolTierRows(db, id),
    loadPlans(db, id),
    loadIndividualQuestionPricing(db, id),
    loadMentorCapUsage(id),
    studentIdRef ? describeStudentIdDocument(db, studentIdRef) : Promise.resolve(null),
    loadReviewStats(session, id),
    loadRecentReviews(db, id),
  ]);

  const schoolTier = resolveSchoolTierReviewState(pickSchoolTierReviewRow(schoolRows));
  const schoolDocRef = str(schoolTier.row?.document_storage_ref);
  const [schoolDocument, reviewerNames, activeCounts] = await Promise.all([
    schoolDocRef ? describeStudentIdDocument(db, schoolDocRef) : Promise.resolve(null),
    loadUserNamesByIds(db, [schoolTier.row?.reviewed_by ?? null]),
    loadActiveCountByTier(db, id, plans.byId),
  ]);

  const subjects = Array.isArray(profile.teaching_subjects) ? (profile.teaching_subjects as unknown[]).map((s) => str(s)).filter(Boolean) : [];
  const capBreakdown = activeCounts.error ? null : buildMentorCapBreakdown({ activeCountByTier: activeCounts.counts, capWeightByTier: cap.capWeightByTier });

  return {
    profile: {
      university: strOrNull(profile.university_name),
      department: strOrNull(profile.department_name),
      subjects,
      highSchool: strOrNull(profile.high_school_name),
      introLine: strOrNull(profile.intro_line),
      bio: strOrNull(profile.bio),
      photoUrl: strOrNull(profile.profile_image_url),
      verificationStatus: str(profile.verification_status),
      isOpenForSubscriptions: typeof profile.is_open_for_subscriptions === "boolean" ? profile.is_open_for_subscriptions : null,
      createdAt: strOrNull(profile.created_at),
    },
    schoolTier,
    schoolTierReviewerName: schoolTier.row?.reviewed_by ? (reviewerNames.get(schoolTier.row.reviewed_by) ?? null) : null,
    studentIdDocument,
    schoolDocument,
    plans: plans.rows,
    plansError: plans.error,
    plansMissing: !plans.error && mentorPlansMissing(plans.rows),
    individualQuestion,
    cap,
    capBreakdown,
    capBreakdownError: activeCounts.error ?? (cap.capWeightByTier ? null : "가중치(RPC)를 읽지 못해 요금제별 내역을 표시할 수 없습니다."),
    activity: {
      state: mentorActivityState({
        activity_status: strOrNull(profile.activity_status),
        pause_until: strOrNull(profile.pause_until),
        termination_effective_at: strOrNull(profile.termination_effective_at),
      }),
      raw: strOrNull(profile.activity_status),
      pauseUntil: strOrNull(profile.pause_until),
      pauseReason: strOrNull(profile.pause_reason),
      terminationEffectiveAt: strOrNull(profile.termination_effective_at),
      abandonmentFlaggedAt: strOrNull(profile.abandonment_flagged_at),
    },
    payout: {
      registered: mentorPayoutRegistered(strOrNull(profile.payout_bank_name), strOrNull(profile.payout_account_number)),
      bankName: strOrNull(profile.payout_bank_name),
      accountMasked: maskAccountNumber(strOrNull(profile.payout_account_number)),
    },
    reviews: { stats: reviewStats.stats, statsError: reviewStats.error, recent: recentReviews.rows, recentError: recentReviews.error },
  };
}
