/**
 * 충전 관리 목록 상단(PR-9 §2-1) — 검색(입금자명·요청자) · 상태 탭(`status` 하나 — 사전 라벨) · `대기 N / 전체 M`. Server Component.
 * 검색·탭·페이지는 전부 URL(서버) 기준. 공용 `AdminDataTable` 조각(PR-4)을 prop 추가 없이 그대로 쓴다.
 */
import Link from "next/link";
import { AdminDataTable } from "@/components/admin/AdminDataTable";
import type { AdminListParams } from "@/lib/admin/adminListParams";
import { splitAdminListBasePath } from "@/lib/admin/adminListParams";
import { TOPUP_BASE_PATH, TOPUP_DEFAULT_TAB, TOPUP_TABS, buildTopupListUrl, type TopupTab } from "@/lib/admin/topupConsole";
import type { TopupTabCounts } from "@/lib/admin/topupConsoleQueries";

type Props = {
  params: AdminListParams;
  tab: TopupTab;
  counts: TopupTabCounts;
  /** 필터(탭·검색) 후 건수 */
  totalCount: number;
};

export function TopupQueueToolbar({ params, tab, counts, totalCount }: Props) {
  const { path: actionPath } = splitAdminListBasePath(TOPUP_BASE_PATH);

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white px-4 py-3" data-topup-toolbar>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <form action={actionPath} method="GET" className="flex min-w-0 flex-1 items-center gap-1.5" role="search">
          <input
            type="search"
            name="q"
            defaultValue={params.search}
            placeholder="입금자명 · 요청자 이름 · 이메일"
            autoComplete="off"
            aria-label="충전 요청 검색"
            className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 sm:max-w-xs"
          />
          {tab !== TOPUP_DEFAULT_TAB ? <input type="hidden" name="status" value={tab} /> : null}
          <button type="submit" className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-extrabold text-white hover:bg-slate-800">
            검색
          </button>
          {params.search ? (
            <Link href={buildTopupListUrl(params, { search: "" })} className="text-xs font-bold text-blue-700 hover:underline" prefetch={false}>
              초기화
            </Link>
          ) : null}
        </form>
        <AdminDataTable.Counts counts={counts} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <AdminDataTable.Tabs basePath={TOPUP_BASE_PATH} params={params} tabs={TOPUP_TABS} activeTab={tab} counts={counts} />
        {params.search ? (
          <p className="text-[11px] font-semibold text-slate-500">
            &lsquo;{params.search}&rsquo; 검색 결과 <span className="tabular-nums text-slate-800">{totalCount}</span>건
          </p>
        ) : null}
      </div>
    </div>
  );
}
