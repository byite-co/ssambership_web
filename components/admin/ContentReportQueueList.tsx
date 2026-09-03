/**
 * 콘텐츠 검수 목록(PR-5 §1-1) — 검색(신고 대상·신고자) · 상태 탭(`status` 하나) · `대기 N / 전체 M` · 표 · 페이지네이션 · 빈 상태. Server Component.
 *
 * - 검색·탭·페이지는 전부 URL(서버) 기준이다. 검색 form 은 현재 탭이 기본 탭(대기)이 아닐 때만 hidden `status` 를 싣는다
 *   (PR-4 규칙 — 전체 탭에서 검색해도 전체 탭 유지).
 * - 상태 탭·건수·페이지네이션은 공용 `AdminDataTable` 조각. 상태 배지는 `AdminStatusPill(content_reports.status)`.
 * - 오래된 신고가 위. 미처리 건의 경과가 24시간을 넘으면 주의색, 48시간을 넘으면 위험색.
 * - 행의 신고 대상 링크 → 신고 상세(`/admin/reports/[id]`). 조치는 상세에서만 한다(목록 인라인 조치·일괄 처리 폼은 두지 않는다).
 */
import Link from "next/link";
import { AdminDataTable } from "@/components/admin/AdminDataTable";
import { AdminStatusPill } from "@/components/admin/AdminStatusPill";
import { EmptyState } from "@/components/common/EmptyState";
import { accountDetailPath } from "@/lib/admin/accountDetailConsole";
import { toAdminDisplayError } from "@/lib/admin/adminDisplayError";
import { splitAdminListBasePath, type AdminListParams } from "@/lib/admin/adminListParams";
import {
  CONTENT_REPORT_BASE_PATH,
  CONTENT_REPORT_DEFAULT_TAB,
  CONTENT_REPORT_EMPTY_STATE,
  CONTENT_REPORT_TABS,
  buildContentReportListUrl,
  contentReportDetailPath,
  contentReportElapsedToneClass,
  contentReportEmptyVariant,
  type ContentReportTab,
} from "@/lib/admin/contentReportConsole";
import type { ContentReportQueueItem, ContentReportTabCounts } from "@/lib/admin/contentReportQueueQueries";
import { formatKoDateTimeKst } from "@/lib/utils/kstTime";
import { cn } from "@/lib/utils/cn";

type Props = {
  items: ContentReportQueueItem[];
  params: AdminListParams;
  tab: ContentReportTab;
  counts: ContentReportTabCounts;
  /** 필터(탭·검색) 후 건수 */
  totalCount: number;
  error: string | null;
};

function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id || "—";
}

function ContentReportEmptyState({ variant, tabLabel, search, resetHref }: { variant: "first" | "tab" | "search"; tabLabel: string; search: string; resetHref: string }) {
  if (variant === "search") {
    return (
      <EmptyState title="조건에 맞는 신고가 없습니다" description={`'${search}' 검색 결과가 없습니다. 검색어를 바꾸거나 초기화해 주세요.`}>
        <Link href={resetHref} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">
          검색 초기화
        </Link>
      </EmptyState>
    );
  }
  if (variant === "tab") {
    return (
      <EmptyState
        title={tabLabel === "대기" ? "대기 중인 신고가 없습니다" : `'${tabLabel}' 상태의 신고가 없습니다`}
        description={tabLabel === "대기" ? "새 신고가 들어오면 이 탭 맨 위에 오래된 것부터 보입니다." : "다른 탭에서 처리된 건을 확인할 수 있습니다."}
      />
    );
  }
  return (
    <div className="space-y-4" data-content-report-empty="first">
      <EmptyState title={CONTENT_REPORT_EMPTY_STATE.title} description={CONTENT_REPORT_EMPTY_STATE.description} />
      <section className="rounded-2xl border border-slate-200 bg-white px-5 py-4">
        <h3 className="text-sm font-extrabold text-slate-900">{CONTENT_REPORT_EMPTY_STATE.stepsTitle}</h3>
        <ol className="mt-3 space-y-2 text-sm text-slate-700">
          {CONTENT_REPORT_EMPTY_STATE.steps.map((step, i) => (
            <li key={step} className="flex items-start gap-3">
              <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[11px] font-black text-white">
                {i + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

export function ContentReportQueueList({ items, params, tab, counts, totalCount, error }: Props) {
  const { path: actionPath } = splitAdminListBasePath(CONTENT_REPORT_BASE_PATH);
  const tabLabel = CONTENT_REPORT_TABS.find((t) => t.value === tab)?.label ?? "대기";
  const emptyVariant = contentReportEmptyVariant(params.search, counts.all);

  return (
    <div className="space-y-4" data-content-report-queue>
      <div className="space-y-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <form action={actionPath} method="GET" className="flex min-w-0 flex-1 items-center gap-1.5" role="search">
            <input
              type="search"
              name="q"
              defaultValue={params.search}
              placeholder="신고 대상 ID · 신고자 이름 · 이메일 · 사유"
              autoComplete="off"
              aria-label="신고 검색"
              className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 sm:max-w-xs"
            />
            {tab !== CONTENT_REPORT_DEFAULT_TAB ? <input type="hidden" name="status" value={tab} /> : null}
            <button type="submit" className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-extrabold text-white hover:bg-slate-800">
              검색
            </button>
            {params.search ? (
              <Link href={buildContentReportListUrl(params, { search: "" })} className="text-xs font-bold text-blue-700 hover:underline">
                초기화
              </Link>
            ) : null}
          </form>
          <AdminDataTable.Counts counts={counts} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <AdminDataTable.Tabs basePath={CONTENT_REPORT_BASE_PATH} params={params} tabs={CONTENT_REPORT_TABS} activeTab={tab} counts={counts} />
          {params.search ? (
            <p className="text-[11px] font-semibold text-slate-500">
              &lsquo;{params.search}&rsquo; 검색 결과 <span className="tabular-nums text-slate-800">{totalCount}</span>건
            </p>
          ) : null}
        </div>
      </div>

      {error ? (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50/60 p-5 text-sm text-red-950">
          <p className="font-bold">신고 목록을 불러오지 못했습니다.</p>
          <p className="mt-1 text-xs text-red-900/90">{toAdminDisplayError(error, "reports") ?? "잠시 후 다시 시도하거나 담당자에게 문의해 주세요."}</p>
        </div>
      ) : items.length === 0 ? (
        <ContentReportEmptyState variant={emptyVariant} tabLabel={tabLabel} search={params.search} resetHref={buildContentReportListUrl(params, { search: "" })} />
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full min-w-[880px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/60 text-xs font-bold text-slate-600">
                  <th scope="col" className="px-3 py-3">신고 대상</th>
                  <th scope="col" className="px-3 py-3">유형</th>
                  <th scope="col" className="px-3 py-3">신고자</th>
                  <th scope="col" className="px-3 py-3">접수일</th>
                  <th scope="col" className="px-3 py-3">경과</th>
                  <th scope="col" className="px-3 py-3">상태</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((item) => (
                  <tr key={item.id} className="transition-colors hover:bg-slate-50/60" data-content-report-row={item.id}>
                    <td className="max-w-[320px] px-3 py-3 align-top">
                      <Link href={contentReportDetailPath(item.id)} className="block font-extrabold text-slate-900 hover:underline" prefetch={false} title="신고 상세·증거 보기">
                        <span className="font-mono text-xs text-slate-500">{shortId(item.targetId)}</span>
                        {item.reason ? <span className="ml-2 font-bold">{item.reason.length > 60 ? `${item.reason.slice(0, 57)}…` : item.reason}</span> : null}
                      </Link>
                      <p className="mt-0.5 font-mono text-[11px] text-slate-400" title={item.id}>
                        신고 {shortId(item.id)}
                      </p>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 align-top text-xs font-bold text-slate-700" title={item.targetType || undefined}>
                      {item.targetLabel}
                    </td>
                    <td className="max-w-[160px] truncate px-3 py-3 align-top text-slate-800" title={item.reporterId || undefined}>
                      {item.reporterId ? (
                        <Link href={accountDetailPath(item.reporterId)} className="hover:underline" prefetch={false}>
                          {item.reporterName}
                        </Link>
                      ) : (
                        item.reporterName
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 align-top text-xs tabular-nums text-slate-600">{formatKoDateTimeKst(item.createdAt)}</td>
                    <td className="whitespace-nowrap px-3 py-3 align-top">
                      <span
                        className={cn("inline-block rounded-md border px-1.5 py-0.5 text-[11px] font-bold tabular-nums", contentReportElapsedToneClass(item.elapsed.tone))}
                        data-elapsed-tone={item.elapsed.tone}
                      >
                        {item.elapsed.label}
                      </span>
                    </td>
                    <td className="px-3 py-3 align-top">
                      <AdminStatusPill table="content_reports" column="status" value={item.status} size="sm" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <AdminDataTable.Pagination
            className="rounded-2xl border border-slate-200 bg-white px-4 py-2"
            basePath={CONTENT_REPORT_BASE_PATH}
            params={params}
            totalCount={totalCount}
            rowsOnPage={items.length}
          />
        </>
      )}
    </div>
  );
}
