import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  loadMentorAppliedPostIdSet,
  loadMentorRecentApplicationsWithPostHints,
  loadOpenCustomRequestPostsForMentorBrowse,
} from "@/lib/customRequest/customRequestQueries";
import { fetchMentorCustomRequestOrdersFromPrimaryTable } from "@/lib/home/mentorDashboardQueries";
import { fetchActiveOpenDisputeOrderIdSet } from "@/lib/customRequest/orderDisputeHelpers";
import { classifyMentorOrderBrowseTab } from "@/lib/customRequest/mentorOrderBrowseTabClassify";
import { countOpenPostsByCategory } from "@/lib/customRequest/mentorOpenPostCategory";
import { enrichMentorDashboardOrderRows } from "@/lib/customRequest/mentorDashboardOrderEnrichment";
import {
  MENTOR_DEADLINE_IMMINENT_DAYS,
  mentorOrderDeadlineDisplay,
} from "@/lib/customRequest/mentorCustomOrderBrowseDisplay";

/**
 * D-CR-6: 멘토 워크스페이스 카운트(지원 200 · 주문 200 · 오픈글 200 + 분쟁 + enrich)는 무겁다.
 * React `cache()` 로 요청 스코프 메모이즈해, 한 요청 안에서 (레이아웃·페이지 등) 중복 호출되면
 * 단일 실행으로 합친다. 키는 (supabase 인스턴스, userId) 참조.
 */
export const fetchMentorWorkspaceCounts = cache(async function fetchMentorWorkspaceCounts(
  supabase: SupabaseClient,
  userId: string,
) {
  const [appliedResp, ordersResp, openResp, appliedPostIds] = await Promise.all([
    loadMentorRecentApplicationsWithPostHints(supabase, userId, 200),
    fetchMentorCustomRequestOrdersFromPrimaryTable(supabase, userId, 200),
    loadOpenCustomRequestPostsForMentorBrowse(supabase, 200),
    loadMentorAppliedPostIdSet(supabase, userId),
  ]);

  const dashOrderIds = ordersResp.error ? [] : ordersResp.rows
    .map((r) => (typeof (r as Record<string, unknown>).id === "string" ? String((r as Record<string, unknown>).id) : ""))
    .filter(Boolean);
    
  const disputeSet = ordersResp.error
    ? new Set<string>()
    : await fetchActiveOpenDisputeOrderIdSet(supabase, dashOrderIds);

  const appliedCount = appliedResp.items.length;

  const filteredOpenRows = (openResp.rows ?? []).filter((row) => {
    const id = String((row as Record<string, unknown>).id ?? "").trim();
    return id && !appliedPostIds.has(id);
  });

  const openPoolCount = openResp.status === "ok" ? filteredOpenRows.length : 0;
  const openByCategory = countOpenPostsByCategory(filteredOpenRows as Record<string, unknown>[]);
  
  type Row = Record<string, unknown>;

  const billingCount = ordersResp.error ? 0 : ordersResp.rows.filter((r) => classifyMentorOrderBrowseTab(r as Row, disputeSet) === "billing").length;
  const workCount = ordersResp.error ? 0 : ordersResp.rows.filter((r) => classifyMentorOrderBrowseTab(r as Row, disputeSet) === "work").length;
  const deliveryPendingCount = ordersResp.error ? 0 : ordersResp.rows.filter((r) => classifyMentorOrderBrowseTab(r as Row, disputeSet) === "delivery").length;
  const revisionCount = ordersResp.error ? 0 : ordersResp.rows.filter((r) => classifyMentorOrderBrowseTab(r as Row, disputeSet) === "revision").length;
  const doneCount = ordersResp.error ? 0 : ordersResp.rows.filter((r) => classifyMentorOrderBrowseTab(r as Row, disputeSet) === "done").length;
  const disputeCount = ordersResp.error ? 0 : ordersResp.rows.filter((r) => classifyMentorOrderBrowseTab(r as Row, disputeSet) === "dispute").length;

  let deadlineOverdue = 0;
  let deadlineImminent = 0;
  if (!ordersResp.error && ordersResp.rows.length > 0) {
    const nonDoneRows = ordersResp.rows.filter(
      (r) => classifyMentorOrderBrowseTab(r as Row, disputeSet) !== "done",
    );
    const enriched = await enrichMentorDashboardOrderRows(supabase, userId, nonDoneRows as Row[]);
    for (const row of enriched) {
      const tab = classifyMentorOrderBrowseTab(row, disputeSet);
      if (tab === "dispute" || tab === "revision") continue;
      const { dday, sortKey } = mentorOrderDeadlineDisplay(row);
      if (dday === "—" || sortKey === 9999) continue;
      if (sortKey < 0) deadlineOverdue += 1;
      else if (sortKey <= MENTOR_DEADLINE_IMMINENT_DAYS) deadlineImminent += 1;
    }
  }

  return {
    open: openPoolCount,
    openByCategory,
    applied: appliedCount,
    billing: billingCount,
    work: workCount,
    delivery: deliveryPendingCount,
    revision: revisionCount,
    done: doneCount,
    dispute: disputeCount,
    ordersTotal:
      billingCount + workCount + deliveryPendingCount + revisionCount + doneCount + disputeCount,
    todo: {
      deadlineOverdue,
      deadlineImminent,
    },
  };
});

/** 사이드바 배지용 — openByCategory 제외 */
export function mentorWorkspaceSidebarCounts(
  counts: Awaited<ReturnType<typeof fetchMentorWorkspaceCounts>>,
): Record<string, number> {
  const { openByCategory: _ignored, todo: _todo, ...nav } = counts;
  return nav;
}
