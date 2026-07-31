import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { pickDisplayField } from "@/lib/customRequest/customRequestQueries";
import { fetchMentorWorkspaceCounts } from "@/lib/customRequest/mentorCounts";
import {
  getMentorOpenPostCategoryId,
  MENTOR_OPEN_POST_CATEGORY_COLORS,
  MENTOR_OPEN_POST_CATEGORY_LABELS,
  type MentorOpenPostCategoryId,
} from "@/lib/customRequest/mentorOpenPostCategory";
import { classifyMentorOrderBrowseTab } from "@/lib/customRequest/mentorOrderBrowseTabClassify";
import { fetchActiveOpenDisputeOrderIdSet } from "@/lib/customRequest/orderDisputeHelpers";
import { loadOpenCustomRequestPostsForMentorBrowse } from "@/lib/customRequest/customRequestQueries";
import { aggregateThreadStatsForRooms } from "@/lib/home/threadStats";
import {
  countActiveSubscriptionsForMentor,
  fetchMentorCustomRequestOrdersFromPrimaryTable,
} from "@/lib/home/mentorDashboardQueries";
import { fetchRoomsForUser } from "@/lib/qna/questionRoomQueries";
import { loadMentorPayoutsPageData } from "@/lib/mentor/mentorPayoutsService";
import { MENTOR_CUSTOM_REQUEST_PLATFORM_SHARE } from "@/lib/mentor/mentorPayoutsConstants";
import { fetchMentorProfileRow } from "@/lib/mentor/mentorProfileQueries";
import {
  mapOrderRowToHub,
  mapOrderToScheduleItem,
} from "@/lib/mentor/dashboard/mentorHubDashboardDisplay";
import type {
  MentorHubCategorySlice,
  MentorHubDashboardData,
  MentorHubKeywordRow,
  MentorHubScheduleItem,
} from "@/lib/mentor/dashboard/mentorHubDashboardTypes";

type Row = Record<string, unknown>;

const KEYWORD_CANDIDATES = [
  "수학",
  "영어",
  "국어",
  "과학",
  "사회",
  "자기소개서",
  "자소서",
  "진로",
  "입시",
  "논술",
  "코딩",
  "프로그래밍",
  "면접",
  "포트폴리오",
] as const;

function isCreatedToday(iso: string): boolean {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function pickCreatedAt(row: Row): string {
  for (const k of ["created_at", "posted_at", "published_at"]) {
    const v = row[k];
    if (typeof v === "string" && v) return v;
  }
  return "";
}

function extractTopKeywords(rows: Row[]): MentorHubKeywordRow[] {
  const counts = new Map<string, number>();

  for (const row of rows) {
    const catId = getMentorOpenPostCategoryId(row);
    const catLabel = MENTOR_OPEN_POST_CATEGORY_LABELS[catId];
    counts.set(catLabel, (counts.get(catLabel) ?? 0) + 1);

    const blob = [
      pickDisplayField(row, ["subject", "title", "body", "description"]),
      pickDisplayField(row, ["category_label", "category", "subject_area"]),
      pickDisplayField(row, ["tags", "keywords", "interests"]),
    ]
      .filter((s) => s !== "—")
      .join(" ");

    for (const kw of KEYWORD_CANDIDATES) {
      if (blob.includes(kw)) {
        counts.set(kw, (counts.get(kw) ?? 0) + 1);
      }
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([keyword, count], i) => ({ rank: i + 1, keyword, count }));
}

function buildCategorySlices(
  openByCategory: Record<MentorOpenPostCategoryId, number>,
  total: number
): MentorHubCategorySlice[] {
  return (["study", "career", "essay", "other"] as const).map((id) => ({
    id,
    label: MENTOR_OPEN_POST_CATEGORY_LABELS[id],
    count: openByCategory[id],
    pct: total > 0 ? Math.round((openByCategory[id] / total) * 100) : 0,
    color: MENTOR_OPEN_POST_CATEGORY_COLORS[id],
  }));
}

async function loadMentorRating(
  supabase: SupabaseClient,
  mentorId: string,
  profileRow: Row | null
): Promise<{ avg: number | null; count: number }> {
  const fromProfile =
    typeof profileRow?.avg_rating === "number"
      ? profileRow.avg_rating
      : typeof profileRow?.average_rating === "number"
        ? profileRow.average_rating
        : null;
  const reviewCountFromProfile =
    typeof profileRow?.review_count === "number"
      ? profileRow.review_count
      : typeof profileRow?.reviews_count === "number"
        ? profileRow.reviews_count
        : 0;

  // W4(C10): reviews/mentor_reviews/subscription_reviews 테이블·FK 프로빙 제거 — 정본
  // public.reviews(mentor_id, rating) 단일 쿼리(187 baseline 실측). 멘토 본인 대시보드라
  // hidden/blinded 무필터인 현행 의미를 유지한다. 오류 시 console.error 후 프로필 행
  // 필드 폴백 — KPI 표시 전용 degrade(성공 아님). 빈 결과(리뷰 0건)도 기존과 동일하게
  // 프로필 행 값으로 폴백한다.
  const { data, error } = await supabase
    .from("reviews")
    .select("rating")
    .eq("mentor_id", mentorId)
    .limit(500);
  if (error) {
    console.error("[loadMentorRating] reviews", error.message);
    return { avg: fromProfile, count: reviewCountFromProfile };
  }
  const ratings = ((data as Row[]) ?? [])
    .map((r) => (typeof r.rating === "number" ? r.rating : Number(r.rating)))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!ratings.length) {
    return { avg: fromProfile, count: reviewCountFromProfile };
  }
  const avg = ratings.reduce((a, b) => a + b, 0) / ratings.length;
  return { avg: Math.round(avg * 10) / 10, count: ratings.length };
}

function estimateInProgressRevenue(orders: Row[], disputeSet: ReadonlySet<string>): number {
  let sum = 0;
  for (const row of orders) {
    const tab = classifyMentorOrderBrowseTab(row, disputeSet);
    if (tab === "done" || tab === "billing" || tab === "dispute") continue;
    for (const k of ["agreed_price", "final_price", "paid_amount", "amount", "price", "mentor_amount"]) {
      const v = row[k];
      const n = typeof v === "number" ? v : Number(v);
      if (Number.isFinite(n) && n > 0) {
        sum += Math.floor(n * (1 - MENTOR_CUSTOM_REQUEST_PLATFORM_SHARE));
        break;
      }
    }
  }
  return sum;
}

function buildQuestionScheduleItems(
  roomIds: string[],
  pendingCount: number
): MentorHubScheduleItem[] {
  if (pendingCount <= 0) return [];
  return [
    {
      id: "pending-questions",
      kind: "question",
      title: `답변 대기 질문 ${pendingCount}건`,
      badgeLabel: "질문",
      badgeClassName: "bg-blue-50 text-blue-700 border-blue-200",
      meta: "확인 필요",
      href: "/mentor/question-room",
      urgent: pendingCount > 0,
    },
  ];
}

export async function loadMentorHubDashboardData(
  supabase: SupabaseClient,
  mentorId: string
): Promise<MentorHubDashboardData> {
  const roomsQ = await fetchRoomsForUser(supabase, "mentor", mentorId);
  const roomIds = (roomsQ.rows ?? [])
    .map((r) => (typeof r.id === "string" ? r.id : null))
    .filter((x): x is string => x !== null);

  const [threadStats, payoutsData, ordersResp, workspaceCounts, openPostsResp, mentorProfile, activeSubs] =
    await Promise.all([
      aggregateThreadStatsForRooms(supabase, roomIds, { maxRooms: 20, mode: "mentor" }),
      loadMentorPayoutsPageData(supabase, mentorId),
      fetchMentorCustomRequestOrdersFromPrimaryTable(supabase, mentorId, 50),
      fetchMentorWorkspaceCounts(supabase, mentorId),
      loadOpenCustomRequestPostsForMentorBrowse(supabase, 200),
      fetchMentorProfileRow(supabase, mentorId),
      countActiveSubscriptionsForMentor(supabase, mentorId),
    ]);

  const profileRow = (mentorProfile.row ?? {}) as Row;
  const rating = await loadMentorRating(supabase, mentorId, profileRow);

  const orderIds = ordersResp.rows
    .map((r) => (typeof (r as Row).id === "string" ? String((r as Row).id) : ""))
    .filter(Boolean);
  const disputeSet = ordersResp.error
    ? new Set<string>()
    : await fetchActiveOpenDisputeOrderIdSet(supabase, orderIds);

  const inProgressOrders = ordersResp.error
    ? []
    : ordersResp.rows.filter((r) => {
        const tab = classifyMentorOrderBrowseTab(r as Row, disputeSet);
        return tab === "work" || tab === "delivery" || tab === "revision";
      });

  const activeOrders = inProgressOrders
    .map((r) => mapOrderRowToHub(r as Row, disputeSet))
    .filter((x): x is NonNullable<typeof x> => x != null)
    .slice(0, 8);

  const openRows = (openPostsResp.rows ?? []) as Row[];
  const openTotal = workspaceCounts.open;
  const openToday = openRows.filter((r) => isCreatedToday(pickCreatedAt(r))).length;
  const categorySlices = buildCategorySlices(workspaceCounts.openByCategory, openTotal);
  const topKeywords = extractTopKeywords(openRows);

  const monthlyRevenue = payoutsData.kpis.total.amount;
  const completedPending = payoutsData.revenueShare.total - payoutsData.kpis.lifetimePaid > 0
    ? Math.max(0, payoutsData.schedule.expectedPayoutAmount)
    : payoutsData.schedule.expectedPayoutAmount;
  const inProgressRevenue = estimateInProgressRevenue(inProgressOrders as Row[], disputeSet);

  const scheduleFromOrders = activeOrders.slice(0, 3).map(mapOrderToScheduleItem);
  const scheduleFromQuestions = buildQuestionScheduleItems(roomIds, threadStats.mentorQueueEstimate);
  const todaySchedule = [...scheduleFromOrders, ...scheduleFromQuestions].slice(0, 5);

  const now = new Date();
  const monthLabel = `${now.getMonth() + 1}월`;

  return {
    kpis: {
      newQuestions: threadStats.error ? 0 : threadStats.mentorQueueEstimate,
      activeSubscribers: activeSubs,
      newRequestsOpen: openTotal,
      newRequestsToday: openToday,
      monthlyRevenue,
      monthlyRevenueMomPct: payoutsData.kpis.total.momPct,
      avgRating: rating.avg,
      reviewCount: rating.count,
    },
    activeOrders,
    openPosts: {
      total: openTotal,
      categories: categorySlices,
    },
    topKeywords,
    todaySchedule,
    revenuePanel: {
      monthLabel,
      totalExpected: monthlyRevenue,
      inProgress: inProgressRevenue,
      completedPending,
    },
    rating,
  };
}
