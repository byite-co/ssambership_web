/**
 * 환불 목록 상단(PR-3 §1) — 검색(요청자 이름·이메일) · 상태 탭(`status` 하나) · `대기 N / 전체 M`. Server Component.
 *
 * 검색·탭·페이지는 전부 URL(서버) 기준이다. 클라이언트 필터 없음. 쿼리 키는 `q` · `status` · `page` 만.
 * PR-2 의 `MentorApprovalQueueList` 상단과 같은 구조 — PR-4 `AdminDataTable` 추출 입력.
 */
import Link from "next/link";
import type { AdminListParams } from "@/lib/admin/adminListParams";
import { splitAdminListBasePath } from "@/lib/admin/adminListParams";
import { REFUND_BASE_PATH, REFUND_DEFAULT_TAB, REFUND_TABS, buildRefundListUrl, type RefundTab } from "@/lib/admin/refundConsole";
import type { RefundTabCounts } from "@/lib/admin/refundConsoleQueries";
import { cn } from "@/lib/utils/cn";

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
        <p className="text-xs font-bold text-slate-600" aria-live="polite" data-refund-counts>
          대기 <span className="tabular-nums text-slate-900">{counts.pending}</span> / 전체{" "}
          <span className="tabular-nums text-slate-900">{counts.all}</span>
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav className="flex flex-wrap gap-1" aria-label="상태 탭">
          {REFUND_TABS.map((t) => {
            const active = t.value === tab;
            return (
              <Link
                key={t.value}
                href={buildRefundListUrl(params, { status: t.value })}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-lg border px-2.5 py-1 text-[11px] font-extrabold transition",
                  active ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                )}
              >
                {t.label}
                <span className={cn("ml-1 tabular-nums", active ? "text-blue-100" : "text-slate-400")}>{counts[t.value]}</span>
              </Link>
            );
          })}
        </nav>
        {params.search ? (
          <p className="text-[11px] font-semibold text-slate-500">
            &lsquo;{params.search}&rsquo; 검색 결과 <span className="tabular-nums text-slate-800">{totalCount}</span>건
          </p>
        ) : null}
      </div>
    </div>
  );
}
