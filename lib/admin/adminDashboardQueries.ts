import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { countAccountRoleTabs } from "@/lib/admin/accountListQueries";
import {
  ADMIN_DASHBOARD_ACTIVITY_LIMIT,
  adminDashboardActivityFilters,
  buildAdminStatusItems,
  buildAdminTodoCards,
  kstWeekStartIso,
  payoutAccountRegisteredForSettlement,
  type AdminStatusItem,
  type AdminTodoCard,
  type AdminTodoCountsInput,
} from "@/lib/admin/adminDashboardConsole";
import { countAccountDeletionStalled } from "@/lib/admin/accountDeletionQueries";
import { loadAuditLogList } from "@/lib/admin/auditLogQueries";
import type { AuditLogItem } from "@/lib/admin/auditLogConsole";
import { countContentReportTabs } from "@/lib/admin/contentReportQueueQueries";
import { countDisputeTabs } from "@/lib/admin/disputeConsoleQueries";
import { MENTOR_ACTIVITY_ROW_LIMIT } from "@/lib/admin/mentorActivityConsole";
import { loadMentorActivityList } from "@/lib/admin/mentorActivityQueries";
import { countMentorApprovalTabs } from "@/lib/admin/mentorApprovalWorkbenchQueries";
import { mentorProfilesAdminReadClient } from "@/lib/admin/mentorProfilesAdminRead";
import { countRefundTabs } from "@/lib/admin/refundConsoleQueries";
import { SCHOOL_VERIFICATION_TABLE } from "@/lib/admin/schoolClassificationConsole";
import { countTopupTabs } from "@/lib/admin/topupConsoleQueries";

/**
 * 관리자 대시보드(PR-12 §1) 서버 조회 — **조회 전용**.
 *
 * "오늘 할 일" 8칸은 각 화면이 쓰는 건수 함수를 **그대로 호출**한다(건수 로직 재작성 금지 — 지시서 절대 원칙 3):
 *   승인 대기 `countMentorApprovalTabs` · 미처리 신고 `countContentReportTabs` · 환불 요청 `countRefundTabs` · 분쟁 `countDisputeTabs` ·
 *   충전 대기 `countTopupTabs` · 미답변 질문/이탈 의심 `loadMentorActivityList`(전체 탭 · 상한 500 = 멘토 활동 화면과 같은 집계) ·
 *   탈퇴 멈춤 `countAccountDeletionStalled`(PR-13 — 탈퇴 요청 화면의 `멈춤` 과 같은 판정 함수).
 * 화면 탭이 없는 값(미확정 등급 · 현황 5개)만 이 모듈이 head count 로 센다 — 실패는 0 으로 위장하지 않고 null(`—`)로 남긴다.
 * 최근 활동은 감사 로그 화면의 `loadAuditLogList` 를 10건 · 열람 제외 기본으로 호출한다.
 *
 * `users`·`mentor_profiles`·`subscriptions`·`mentor_school_verifications` 는 관리자 읽기 클라이언트(service_role 우선 · 세션 폴백)로 읽는다.
 * (admin)/layout.tsx + (console)/layout.tsx 의 이중 requireRole("admin") 가드 뒤에서만 호출된다. 쓰기 없음.
 */

const MENTOR_PROFILE_ROW_LIMIT = 2000;

type Row = Record<string, unknown>;

export type AdminDashboardData = {
  todo: AdminTodoCard[];
  status: AdminStatusItem[];
  activity: { rows: AuditLogItem[]; error: string | null; showViews: boolean };
  /** 부분 실패 안내(비어 있으면 전 블록 정상) — 숫자를 0 으로 위장하지 않기 위해 표면화한다. */
  errors: string[];
};

async function headCountOrNull(query: PromiseLike<{ count: number | null; error: { message: string } | null }>, ctx: string): Promise<number | null> {
  const { count, error } = await query;
  if (error) {
    console.error(`[adminDashboard] ${ctx}:`, error.message);
    return null;
  }
  return count ?? 0;
}

/** 미확정 등급 — 자동 판정(잠정) 행: `status = pending AND reviewed_by IS NULL`(SQL 192 · 지시서 §1-2 표). */
async function countUnconfirmedSchoolTiers(readDb: SupabaseClient): Promise<number | null> {
  return headCountOrNull(readDb.from(SCHOOL_VERIFICATION_TABLE).select("id", { count: "exact", head: true }).eq("status", "pending").is("reviewed_by", null), "mentor_school_verifications(pending·reviewed_by NULL)");
}

async function countActiveSubscriptions(readDb: SupabaseClient): Promise<number | null> {
  return headCountOrNull(readDb.from("subscriptions").select("id", { count: "exact", head: true }).eq("status", "active"), "subscriptions(active)");
}

async function countUsersCreatedSince(readDb: SupabaseClient, sinceIso: string): Promise<number | null> {
  return headCountOrNull(readDb.from("users").select("id", { count: "exact", head: true }).gte("created_at", sinceIso), "users(created_at ≥ 주 시작)");
}

/** 승인 멘토 중 계좌 미등록 — 판정은 정산 RPC 규칙(`payoutAccountRegisteredForSettlement`). 상한 2000(멘토 74명). */
async function countMentorsWithoutPayoutAccount(readDb: SupabaseClient): Promise<number | null> {
  const { data, error } = await readDb.from("mentor_profiles").select("user_id, payout_account_number").eq("verification_status", "approved").limit(MENTOR_PROFILE_ROW_LIMIT);
  if (error) {
    console.error("[adminDashboard] mentor_profiles(payout_account_number):", error.message);
    return null;
  }
  let missing = 0;
  for (const row of (data as Row[] | null) ?? []) if (!payoutAccountRegisteredForSettlement(row.payout_account_number)) missing += 1;
  return missing;
}

export async function loadAdminDashboardData(supabase: SupabaseClient, opts: { showViews: boolean; now?: Date }): Promise<AdminDashboardData> {
  const now = opts.now ?? new Date();
  const readDb = mentorProfilesAdminReadClient(supabase);
  const errors: string[] = [];

  const [mentorApproval, contentReport, refund, dispute, topup, mentorActivity, schoolTierUnconfirmed, roleCounts, activeSubscriptions, weeklySignups, payoutMissing, activity, deletionStalled] =
    await Promise.all([
      countMentorApprovalTabs(supabase),
      countContentReportTabs(supabase),
      countRefundTabs(supabase),
      countDisputeTabs(supabase),
      countTopupTabs(),
      // 전체 탭 · 상한 크기 한 페이지 = 멘토 활동 화면이 세는 것과 같은 행 집합(미답변 합 · 이탈 의심 건수).
      loadMentorActivityList({ tab: "all", search: "", page: 1, pageSize: MENTOR_ACTIVITY_ROW_LIMIT, now }),
      countUnconfirmedSchoolTiers(readDb),
      countAccountRoleTabs(),
      countActiveSubscriptions(readDb),
      countUsersCreatedSince(readDb, kstWeekStartIso(now)),
      countMentorsWithoutPayoutAccount(readDb),
      loadAuditLogList(supabase, { search: "", status: "", page: 1, pageSize: ADMIN_DASHBOARD_ACTIVITY_LIMIT, extra: {} }, adminDashboardActivityFilters(opts.showViews), now.toISOString()),
      countAccountDeletionStalled(now.toISOString()),
    ]);

  if (mentorActivity.list.error) errors.push(`미답변 질문·이탈 의심: ${mentorActivity.list.error}`);
  if (schoolTierUnconfirmed === null) errors.push("미확정 등급 건수를 불러오지 못했습니다.");
  if (deletionStalled === null) errors.push("탈퇴 멈춤 건수를 불러오지 못했습니다.");

  const todoInput: AdminTodoCountsInput = {
    mentorApproval: { pending: mentorApproval.pending },
    schoolTierUnconfirmed: schoolTierUnconfirmed ?? 0,
    mentorActivity: {
      unansweredTotal: mentorActivity.list.rows.reduce((sum, item) => sum + item.unansweredCount, 0),
      counts: { abandoned: mentorActivity.counts.abandoned },
    },
    contentReport: { pending: contentReport.pending },
    refund: { pending: refund.pending },
    dispute: { open: dispute.open, under_review: dispute.under_review },
    topup: { pending: topup.pending },
    accountDeletion: { stalled: deletionStalled ?? 0 },
  };

  return {
    todo: buildAdminTodoCards(todoInput),
    status: buildAdminStatusItems({
      mentorCount: roleCounts.mentor,
      studentCount: roleCounts.student,
      activeSubscriptionCount: activeSubscriptions,
      weeklySignupCount: weeklySignups,
      mentorsWithoutPayoutAccount: payoutMissing,
    }),
    activity: { rows: activity.rows, error: activity.error, showViews: opts.showViews },
    errors,
  };
}
