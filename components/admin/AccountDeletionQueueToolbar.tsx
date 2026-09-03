/**
 * 탈퇴 요청 목록 상단(PR-13 §1-2) — 상태 탭(`status` 하나 — 진행 중 · 완료 · 실패 · 취소) + `진행 중 N · 멈춤 S · 전체 M`. Server Component.
 * 검색 없음(요청자는 개인정보 삭제 대상이라 이름 검색을 두지 않는다). 공용 `AdminDataTable.Tabs`(PR-4)를 prop 추가 없이 그대로 쓴다.
 */
import { AdminDataTable } from "@/components/admin/AdminDataTable";
import { ACCOUNT_DELETION_BASE_PATH, ACCOUNT_DELETION_TABS, type AccountDeletionSummary, type AccountDeletionTab } from "@/lib/admin/accountDeletionConsole";
import type { AccountDeletionTabCounts } from "@/lib/admin/accountDeletionQueries";
import type { AdminListParams } from "@/lib/admin/adminListParams";
import { cn } from "@/lib/utils/cn";

type Props = {
  params: AdminListParams;
  tab: AccountDeletionTab;
  counts: AccountDeletionTabCounts;
  summary: AccountDeletionSummary;
};

export function AccountDeletionQueueToolbar({ params, tab, counts, summary }: Props) {
  const stalledAttention = (summary.stalled ?? 0) > 0;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3" data-deletion-toolbar>
      <AdminDataTable.Tabs basePath={ACCOUNT_DELETION_BASE_PATH} params={params} tabs={ACCOUNT_DELETION_TABS} activeTab={tab} counts={counts} />
      <p className="text-xs font-bold text-slate-600" aria-live="polite" data-deletion-summary>
        진행 중 <span className="tabular-nums text-slate-900">{summary.active.toLocaleString("ko-KR")}</span>
        <span aria-hidden="true" className="mx-1.5 text-slate-300">
          ·
        </span>
        멈춤{" "}
        <span className={cn("tabular-nums", stalledAttention ? "font-black text-amber-700" : "text-slate-900")} data-deletion-stalled={summary.stalled ?? ""}>
          {summary.stalled == null ? "—" : summary.stalled.toLocaleString("ko-KR")}
        </span>
        <span aria-hidden="true" className="mx-1.5 text-slate-300">
          ·
        </span>
        전체 <span className="tabular-nums text-slate-900">{summary.all.toLocaleString("ko-KR")}</span>
      </p>
    </div>
  );
}
