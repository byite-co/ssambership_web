/**
 * 맞춤의뢰 주문 목록 상단(PR-5 §3) — 검색 · 상태 탭(`status` 하나 · 기본 탭 전체) · `대기 N / 전체 M`. Server Component.
 * 검색 form 은 현재 탭이 기본 탭(전체)이 아닐 때만 hidden `status` 를 싣는다(PR-4 규칙 — 세 화면 공통).
 */
import Link from "next/link";
import { AdminDataTable } from "@/components/admin/AdminDataTable";
import { splitAdminListBasePath, type AdminListParams } from "@/lib/admin/adminListParams";
import {
  CUSTOM_REQUEST_ORDER_BASE_PATH,
  CUSTOM_REQUEST_ORDER_DEFAULT_TAB,
  CUSTOM_REQUEST_ORDER_TABS,
  buildCustomRequestOrderListUrl,
  type CustomRequestOrderTab,
} from "@/lib/admin/customRequestOrderConsole";

export type CustomRequestOrderTabCounts = Record<CustomRequestOrderTab, number>;

type Props = {
  params: AdminListParams;
  tab: CustomRequestOrderTab;
  counts: CustomRequestOrderTabCounts;
  /** 필터(탭·검색) 후 건수 */
  totalCount: number;
};

export function CustomRequestOrderQueueToolbar({ params, tab, counts, totalCount }: Props) {
  const { path: actionPath } = splitAdminListBasePath(CUSTOM_REQUEST_ORDER_BASE_PATH);

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <form action={actionPath} method="GET" className="flex min-w-0 flex-1 items-center gap-1.5" role="search">
          <input
            type="search"
            name="q"
            defaultValue={params.search}
            placeholder="주문/공모/학생/멘토 ID, 상태 검색"
            autoComplete="off"
            aria-label="맞춤의뢰 주문 검색"
            className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 sm:max-w-xs"
          />
          {tab !== CUSTOM_REQUEST_ORDER_DEFAULT_TAB ? <input type="hidden" name="status" value={tab} /> : null}
          <button type="submit" className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-extrabold text-white hover:bg-slate-800">
            검색
          </button>
          {params.search ? (
            <Link href={buildCustomRequestOrderListUrl(params, { search: "" })} className="text-xs font-bold text-blue-700 hover:underline">
              초기화
            </Link>
          ) : null}
        </form>
        <AdminDataTable.Counts counts={counts} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <AdminDataTable.Tabs basePath={CUSTOM_REQUEST_ORDER_BASE_PATH} params={params} tabs={CUSTOM_REQUEST_ORDER_TABS} activeTab={tab} counts={counts} />
        {params.search ? (
          <p className="text-[11px] font-semibold text-slate-500">
            &lsquo;{params.search}&rsquo; 검색 결과 <span className="tabular-nums text-slate-800">{totalCount}</span>건
          </p>
        ) : null}
      </div>
    </div>
  );
}
