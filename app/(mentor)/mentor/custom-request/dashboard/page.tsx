import { PageScaffold } from "@/components/shell/PageScaffold";
import { MentorCustomRequestDashboardView } from "@/components/customRequest/MentorCustomRequestDashboardView";
import { MentorCustomRequestWorkspaceLayout } from "@/components/customRequest/MentorCustomRequestWorkspaceLayout";
import { requireRole } from "@/lib/auth/routeGuard";
import { createClient } from "@/lib/supabase/server";
import { loadMentorRecentApplicationsWithPostHints } from "@/lib/customRequest/customRequestQueries";
import { fetchActiveOpenDisputeOrderIdSet } from "@/lib/customRequest/orderDisputeHelpers";
import { classifyMentorOrderBrowseTab } from "@/lib/customRequest/mentorOrderBrowseTabClassify";
import { fetchMentorCustomRequestOrdersFromPrimaryTable } from "@/lib/home/mentorDashboardQueries";
import { loadMentorPayoutsBundle } from "@/lib/mentor/mentorPayoutsQueries";
import { aggregateSettlementTotalsInPeriod } from "@/lib/mentor/settlementPeriodTotals";
import { fetchMentorProfileRow } from "@/lib/mentor/mentorProfileQueries";
import { fetchMentorWorkspaceCounts, mentorWorkspaceSidebarCounts } from "@/lib/customRequest/mentorCounts";
import { enrichMentorDashboardOrderRows } from "@/lib/customRequest/mentorDashboardOrderEnrichment";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Row = Record<string, unknown>;

export default async function MentorCustomRequestDashboardPage() {
  const { user } = await requireRole("mentor");
  const supabase = await createClient();
  const [{ items: recentApplied }, orders, dashboardCounts, payouts, mentorProfile] = await Promise.all([
    loadMentorRecentApplicationsWithPostHints(supabase, user.id, 5),
    fetchMentorCustomRequestOrdersFromPrimaryTable(supabase, user.id, 12),
    fetchMentorWorkspaceCounts(supabase, user.id),
    loadMentorPayoutsBundle(supabase, user.id),
    fetchMentorProfileRow(supabase, user.id),
  ]);

  void recentApplied;

  const profileRow = mentorProfile.row ?? {};
  const avgRating =
    typeof profileRow.avg_rating === "number"
      ? profileRow.avg_rating
      : typeof profileRow.average_rating === "number"
        ? profileRow.average_rating
        : null;
  const reviewCount =
    typeof profileRow.review_count === "number"
      ? profileRow.review_count
      : typeof profileRow.reviews_count === "number"
        ? profileRow.reviews_count
        : 0;
  // D-MT-3: 사문 monthExpectedCents(상시 0) 대신 settlementPayouts 실집계로 이번 달 수익 표시.
  // D-MT-3 회귀 수정: totals 는 월 경계 없는 전 기간(최근 200행) 합계라 '이번 달 수익' KPI 에
  // 그대로 쓰면 라벨과 집계 기간이 어긋난다. KPI 는 bundle 의 monthBounds(periodStart/periodEnd)로
  // 당월 정산 행만 걸러 재집계한다. '진행 중 정산'/'완료(정산 예정)' 분해 행(월 표기 없는
  // 수익 영역)은 기존 전 기간 totals 를 그대로 쓴다.
  const expectedSettlementCash = payouts.settlementPayouts.totals.expectedMentorAmount;
  const paidSettlementCash = payouts.settlementPayouts.totals.paidMentorAmount;
  const monthSettlementTotals = aggregateSettlementTotalsInPeriod(
    payouts.settlementPayouts.lines.map((line) => line.settlement),
    payouts.periodStart,
    payouts.periodEnd
  );
  const monthRevenueCash = monthSettlementTotals.expectedMentorAmount + monthSettlementTotals.paidMentorAmount;

  const dashOrderIds = orders.rows
    .map((r) => (typeof (r as { id?: unknown }).id === "string" ? String((r as { id: string }).id) : ""))
    .filter(Boolean);
  const activeDisputeOrderIds = orders.error
    ? new Set<string>()
    : await fetchActiveOpenDisputeOrderIdSet(supabase, dashOrderIds);

  const orderCount = dashboardCounts.ordersTotal ?? 0;
  const appliedCount = dashboardCounts.applied;
  const sidebarCounts = mentorWorkspaceSidebarCounts(dashboardCounts);
  const openPoolCount = sidebarCounts.open;
  const deliveryPendingCount = dashboardCounts.delivery ?? 0;
  const doneCount = dashboardCounts.done ?? 0;

  const activeOrdersRaw = orders.error
    ? []
    : orders.rows.filter((r) => {
        const tab = classifyMentorOrderBrowseTab(r, activeDisputeOrderIds);
        return tab !== "done";
      });

  const activeOrders = orders.error
    ? []
    : await enrichMentorDashboardOrderRows(supabase, user.id, activeOrdersRaw as Row[]);

  return (
    <PageScaffold
      eyebrow="멘토 · 맞춤의뢰"
      title="맞춤의뢰 대시보드"
      description="멘토님의 맞춤의뢰 활동 현황을 한눈에 확인하세요."
      ctas={[]}
      sections={[]}
      emptyState=""
      hideFooterPlaceholderCards
      hideHero={true}
    >
      <MentorCustomRequestWorkspaceLayout active="dashboard" counts={sidebarCounts} showAuxCards>
        <MentorCustomRequestDashboardView
          ordersError={orders.error}
          openPoolCount={openPoolCount}
          appliedCount={appliedCount}
          orderCount={orderCount}
          doneCount={doneCount}
          deliveryPendingCount={deliveryPendingCount}
          monthRevenueCash={monthRevenueCash}
          dashboardCounts={dashboardCounts}
          activeOrders={activeOrders as Row[]}
          activeDisputeOrderIds={activeDisputeOrderIds}
          avgRating={avgRating}
          reviewCount={reviewCount}
          expectedSettlementCash={expectedSettlementCash}
          paidSettlementCash={paidSettlementCash}
        />
      </MentorCustomRequestWorkspaceLayout>
    </PageScaffold>
  );
}
