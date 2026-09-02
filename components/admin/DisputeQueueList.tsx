/**
 * 분쟁 목록(PR-6 §2-2 · 패턴 A) — 검색(당사자 이름 · 접수 내용) · 상태 탭(`status` 하나 · 제재 3종은 한 탭) · `접수·진행 N / 전체 M` ·
 * 표(클라이언트 — 행 선택·일괄 상태 변경) · 페이지네이션 · 빈 상태. Server Component.
 *
 * - 검색·탭·페이지는 전부 URL(서버) 기준. 검색 form 은 현재 탭이 기본 탭(open)이 아닐 때만 hidden `status` 를 싣는다(PR-4 규칙).
 * - 상태 탭·페이지네이션은 공용 `AdminDataTable` 조각. **건수 줄은 `AdminDataTable.Counts` 를 쓰지 않는다** — 그 부품은 `pending` 키만
 *   읽는데 이 화면의 기본 탭은 `open` 이다(PR #111 §8). prop 을 더하지 않고(지시서 §2-1) 이 화면이 한 줄을 직접 그린다.
 * - 오래된 분쟁이 위. 종결이 아닌 건의 경과가 24시간을 넘으면 주의색, 48시간을 넘으면 위험색.
 */
import Link from "next/link";
import { AdminDataTable } from "@/components/admin/AdminDataTable";
import { DisputeQueueTable } from "@/components/admin/DisputeQueueTable";
import { EmptyState } from "@/components/common/EmptyState";
import { toAdminDisplayError } from "@/lib/admin/adminDisplayError";
import { splitAdminListBasePath, type AdminListParams } from "@/lib/admin/adminListParams";
import {
  DISPUTE_BASE_PATH,
  DISPUTE_DEFAULT_TAB,
  DISPUTE_EMPTY_STATE,
  DISPUTE_TABS,
  buildDisputeListUrl,
  disputeEmptyVariant,
  type DisputeTab,
} from "@/lib/admin/disputeConsole";
import type { DisputeQueueItem, DisputeTabCounts } from "@/lib/admin/disputeConsoleQueries";

type Props = {
  items: DisputeQueueItem[];
  params: AdminListParams;
  tab: DisputeTab;
  counts: DisputeTabCounts;
  /** 필터(탭·검색) 후 건수 */
  totalCount: number;
  error: string | null;
};

function DisputeEmptyState({ variant, tabLabel, search, resetHref }: { variant: "first" | "tab" | "search"; tabLabel: string; search: string; resetHref: string }) {
  if (variant === "search") {
    return (
      <EmptyState title="조건에 맞는 분쟁이 없습니다" description={`'${search}' 검색 결과가 없습니다. 검색어를 바꾸거나 초기화해 주세요.`}>
        <Link href={resetHref} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">
          검색 초기화
        </Link>
      </EmptyState>
    );
  }
  if (variant === "tab") {
    return (
      <EmptyState
        title={`'${tabLabel}' 상태의 분쟁이 없습니다`}
        description={tabLabel === DISPUTE_TABS[0].label ? "새 분쟁이 들어오면 이 탭 맨 위에 오래된 것부터 보입니다." : "다른 탭에서 처리된 건을 확인할 수 있습니다."}
      />
    );
  }
  return (
    <div className="space-y-4" data-dispute-empty="first">
      <EmptyState title={DISPUTE_EMPTY_STATE.title} description={DISPUTE_EMPTY_STATE.description} />
      <section className="rounded-2xl border border-slate-200 bg-white px-5 py-4">
        <h3 className="text-sm font-extrabold text-slate-900">{DISPUTE_EMPTY_STATE.stepsTitle}</h3>
        <ol className="mt-3 space-y-2 text-sm text-slate-700">
          {DISPUTE_EMPTY_STATE.steps.map((step, i) => (
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

export function DisputeQueueList({ items, params, tab, counts, totalCount, error }: Props) {
  const { path: actionPath } = splitAdminListBasePath(DISPUTE_BASE_PATH);
  const tabLabel = DISPUTE_TABS.find((t) => t.value === tab)?.label ?? DISPUTE_TABS[0].label;
  const openLabel = DISPUTE_TABS.find((t) => t.value === DISPUTE_DEFAULT_TAB)?.label ?? "접수";
  const emptyVariant = disputeEmptyVariant(params.search, counts.all);

  return (
    <div className="space-y-4" data-dispute-queue>
      <div className="space-y-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <form action={actionPath} method="GET" className="flex min-w-0 flex-1 items-center gap-1.5" role="search">
            <input
              type="search"
              name="q"
              defaultValue={params.search}
              placeholder="당사자 이름 · 이메일 · 접수 내용"
              autoComplete="off"
              aria-label="분쟁 검색"
              className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 sm:max-w-xs"
            />
            {tab !== DISPUTE_DEFAULT_TAB ? <input type="hidden" name="status" value={tab} /> : null}
            <button type="submit" className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-extrabold text-white hover:bg-slate-800">
              검색
            </button>
            {params.search ? (
              <Link href={buildDisputeListUrl(params, { search: "" })} className="text-xs font-bold text-blue-700 hover:underline">
                초기화
              </Link>
            ) : null}
          </form>
          {/* 건수 줄 — 이 화면의 기본 탭은 open 이라 공용 Counts(pending 전용)를 쓰지 않고 직접 그린다(prop 추가 0). */}
          <p className="text-xs font-bold text-slate-600" aria-live="polite" data-dispute-counts>
            {openLabel} <span className="tabular-nums text-slate-900">{counts.open}</span>
            {" / "}
            전체 <span className="tabular-nums text-slate-900">{counts.all}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <AdminDataTable.Tabs basePath={DISPUTE_BASE_PATH} params={params} tabs={DISPUTE_TABS} activeTab={tab} counts={counts} />
          {params.search ? (
            <p className="text-[11px] font-semibold text-slate-500">
              &lsquo;{params.search}&rsquo; 검색 결과 <span className="tabular-nums text-slate-800">{totalCount}</span>건
            </p>
          ) : null}
        </div>
      </div>

      {error ? (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50/60 p-5 text-sm text-red-950">
          <p className="font-bold">분쟁 목록을 불러오지 못했습니다.</p>
          <p className="mt-1 text-xs text-red-900/90">{toAdminDisplayError(error, "disputes") ?? "잠시 후 다시 시도하거나 담당자에게 문의해 주세요."}</p>
        </div>
      ) : items.length === 0 ? (
        <DisputeEmptyState variant={emptyVariant} tabLabel={tabLabel} search={params.search} resetHref={buildDisputeListUrl(params, { search: "" })} />
      ) : (
        <>
          <DisputeQueueTable items={items} />
          <AdminDataTable.Pagination
            className="rounded-2xl border border-slate-200 bg-white px-4 py-2"
            basePath={DISPUTE_BASE_PATH}
            params={params}
            totalCount={totalCount}
            rowsOnPage={items.length}
          />
        </>
      )}
    </div>
  );
}
