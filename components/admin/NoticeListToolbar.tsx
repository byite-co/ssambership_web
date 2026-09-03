/**
 * 공지·이벤트 목록 상단(PR-10 §1-2) — 검색(제목) · 유형 탭(`type` — `status` 전용 공용 Tabs 를 쓸 수 없어 화면이 같은 모양으로 직접 그린다 · prop 추가 0) ·
 * `활성 N / 전체 M`(공용 Counts 는 대기 전용이라 직접 그린다). Server Component — 검색·탭·페이지는 전부 URL(서버) 기준.
 */
import Link from "next/link";
import type { AdminListParams } from "@/lib/admin/adminListParams";
import { splitAdminListBasePath } from "@/lib/admin/adminListParams";
import {
  NOTICE_BASE_PATH,
  NOTICE_DEFAULT_TYPE_TAB,
  NOTICE_TYPE_PARAM,
  NOTICE_TYPE_TABS,
  buildNoticeListUrl,
  buildNoticeTypeTabUrl,
  type NoticeTypeTab,
} from "@/lib/admin/noticeConsole";
import type { NoticeTabCounts } from "@/lib/admin/adminNoticesQueries";
import { cn } from "@/lib/utils/cn";

type Props = {
  params: AdminListParams;
  tab: NoticeTypeTab;
  counts: NoticeTabCounts;
  /** 필터(탭·검색) 후 건수 */
  totalCount: number;
};

export function NoticeListToolbar({ params, tab, counts, totalCount }: Props) {
  const { path: actionPath } = splitAdminListBasePath(NOTICE_BASE_PATH);

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white px-4 py-3" data-notice-toolbar>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <form action={actionPath} method="GET" className="flex min-w-0 flex-1 items-center gap-1.5" role="search">
          <input
            type="search"
            name="q"
            defaultValue={params.search}
            placeholder="제목"
            autoComplete="off"
            aria-label="공지 검색"
            className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 sm:max-w-xs"
          />
          {tab !== NOTICE_DEFAULT_TYPE_TAB ? <input type="hidden" name={NOTICE_TYPE_PARAM} value={tab} /> : null}
          <button type="submit" className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-extrabold text-white hover:bg-slate-800">
            검색
          </button>
          {params.search ? (
            <Link href={buildNoticeListUrl(params, { search: "" })} className="text-xs font-bold text-blue-700 hover:underline" prefetch={false}>
              초기화
            </Link>
          ) : null}
        </form>
        {/* 건수 줄 — 공용 Counts 는 `대기 N` 전용이라 직접 그린다(prop 추가 0). */}
        <p className="text-xs font-bold text-slate-600" aria-live="polite" data-notice-counts>
          활성 <span className="tabular-nums text-slate-900">{counts.active}</span>
          {" / "}
          전체 <span className="tabular-nums text-slate-900">{counts.tabs.all}</span>
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* 유형 탭 — 키가 `type`(extra)이라 공용 Tabs(status 전용)와 같은 모양으로 직접 그린다 */}
        <nav className="flex flex-wrap gap-1" aria-label="유형 탭">
          {NOTICE_TYPE_TABS.map((t) => {
            const active = t.value === tab;
            return (
              <Link
                key={t.value}
                href={buildNoticeTypeTabUrl(params, t.value)}
                aria-current={active ? "page" : undefined}
                prefetch={false}
                className={cn(
                  "rounded-lg border px-2.5 py-1 text-[11px] font-extrabold transition",
                  active ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                )}
              >
                {t.label}
                <span className={cn("ml-1 tabular-nums", active ? "text-blue-100" : "text-slate-400")}>{counts.tabs[t.value]}</span>
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
