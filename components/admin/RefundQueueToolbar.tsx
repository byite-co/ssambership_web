/**
 * 환불 목록 상단(PR-3 §1) — 검색(요청자 이름·이메일) · 상태 탭(`status` 하나) · `대기 N / 전체 M`. Server Component.
 *
 * 검색·탭·페이지는 전부 URL(서버) 기준이다. 클라이언트 필터 없음. 쿼리 키는 `q` · `status` · `page` 만.
 * 상태 탭과 `대기 N / 전체 M` 은 공용 `AdminDataTable`(PR-4) 조각을 쓴다. 검색 form 은 이 화면 고유다(페이지 폭 배치).
 */
import Link from "next/link";
import { AdminDataTable } from "@/components/admin/AdminDataTable";
import type { AdminListParams } from "@/lib/admin/adminListParams";
import { splitAdminListBasePath } from "@/lib/admin/adminListParams";
import { REFUND_BASE_PATH, REFUND_DEFAULT_TAB, REFUND_TABS, buildRefundListUrl, type RefundTab } from "@/lib/admin/refundConsole";
import type { RefundTabCounts } from "@/lib/admin/refundConsoleQueries";

type Props = {
  params: AdminListParams;
  tab: RefundTab;
  counts: RefundTabCounts;
  /** 필터(탭·검색) 후 건수 */
  totalCount: number;
};

export function RefundQueueToolbar({ params, tab, counts, totalCount }: Props) {
  const { path: actionPath } = splitAdminListBasePath(REFUND_BASE_PATH);

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <form action={actionPath} method="GET" className="flex min-w-0 flex-1 items-center gap-1.5" role="search">
          <input
            type="search"
            name="q"
            defaultValue={params.search}
            placeholder="요청자 이름 · 이메일"
            autoComplete="off"
            aria-label="환불 요청자 검색"
            className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 sm:max-w-xs"
          />
          {tab !== REFUND_DEFAULT_TAB ? <input type="hidden" name="status" value={tab} /> : null}
          <button type="submit" className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-extrabold text-white hover:bg-slate-800">
            검색
          </button>
          {params.search ? (
            <Link href={buildRefundListUrl(params, { search: "" })} className="text-xs font-bold text-blue-700 hover:underline">
              초기화
            </Link>
          ) : null}
        </form>
        <AdminDataTable.Counts counts={counts} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <AdminDataTable.Tabs basePath={REFUND_BASE_PATH} params={params} tabs={REFUND_TABS} activeTab={tab} counts={counts} />
        {params.search ? (
          <p className="text-[11px] font-semibold text-slate-500">
            &lsquo;{params.search}&rsquo; 검색 결과 <span className="tabular-nums text-slate-800">{totalCount}</span>건
          </p>
        ) : null}
      </div>
    </div>
  );
}
