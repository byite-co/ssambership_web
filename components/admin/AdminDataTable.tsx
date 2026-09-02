/**
 * 관리자 목록 공용 부품 `AdminDataTable`(PR-4) — 멘토 승인 목록(PR-2 `MentorApprovalQueueList`)과 환불 목록
 * (PR-3 `RefundQueueToolbar` · `RefundQueuePagination`)이 **실제로 같게** 그리던 조각만 모았다. Server Component.
 *
 *   <AdminDataTable.Counts />      `대기 N / 전체 M`
 *   <AdminDataTable.Tabs />        상태 탭(`status` 키 하나 · 탭별 건수 · 전체 탭 `status=all` 유지)
 *   <AdminDataTable.Pagination />  `첫–끝 / 전체 N` + ← 이전 / 다음 →
 *
 * 경계(PR-1 `AdminListToolbar` 와 중복하지 않는다):
 * - URL 파라미터의 파싱·보존은 `lib/admin/adminListParams.ts` 가 한다. 이 부품은 그 위에서 `status=all` 만 되살리는
 *   `buildAdminDataTableUrl` 로 링크를 만든다(기본 탭이 대기인 화면의 전체 탭이 대기 탭으로 튀지 않게).
 * - 검색 form · 행(표/카드) · 빈 상태 문구 · 로딩 스켈레톤은 두 화면의 배치·구조가 달라 화면에 남긴다.
 * - 두 화면이 지금 넘기는 것만 prop 으로 받는다. 선택 prop(`?:`)은 없다 — 한 화면만 쓰는 옵션을 두지 않기 위해서다.
 */
import Link from "next/link";
import type { AdminListParams } from "@/lib/admin/adminListParams";
import { adminListProgressRange, buildAdminDataTableUrl, type AdminDataTableTab } from "@/lib/admin/adminDataTable";
import { cn } from "@/lib/utils/cn";

type CountsProps = {
  /** 탭 건수 — 대기·전체만 읽는다 */
  counts: { pending: number; all: number };
};

function Counts({ counts }: CountsProps) {
  return (
    <p className="text-xs font-bold text-slate-600" aria-live="polite">
      대기 <span className="tabular-nums text-slate-900">{counts.pending}</span> / 전체{" "}
      <span className="tabular-nums text-slate-900">{counts.all}</span>
    </p>
  );
}

type TabsProps<V extends string> = {
  /** 목록 경로(예: `/admin/refunds`) */
  basePath: string;
  /** 현재 목록 파라미터(화면 전용 키는 이미 제거된 상태) */
  params: AdminListParams;
  tabs: readonly AdminDataTableTab<V>[];
  activeTab: V;
  counts: Readonly<Record<V, number>>;
};

function Tabs<V extends string>({ basePath, params, tabs, activeTab, counts }: TabsProps<V>) {
  return (
    <nav className="flex flex-wrap gap-1" aria-label="상태 탭">
      {tabs.map((t) => {
        const active = t.value === activeTab;
        return (
          <Link
            key={t.value}
            href={buildAdminDataTableUrl(basePath, params, { status: t.value })}
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
  );
}

type PaginationProps = {
  basePath: string;
  params: AdminListParams;
  /** 필터(탭·검색) 후 건수 */
  totalCount: number;
  rowsOnPage: number;
  /** 배치 클래스 — 카드 안 하단(border-t)인지 독립 카드인지는 화면이 정한다 */
  className: string;
};

function Pagination({ basePath, params, totalCount, rowsOnPage, className }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalCount / Math.max(1, params.pageSize)));
  const hasPrev = params.page > 1;
  const hasNext = params.page < totalPages;
  const progress = adminListProgressRange(params.page, params.pageSize, rowsOnPage, totalCount);
  const linkClass = (enabled: boolean) =>
    cn(
      "rounded-lg border px-2.5 py-1 text-[11px] font-extrabold",
      enabled ? "border-slate-200 bg-white text-slate-700 hover:bg-slate-50" : "pointer-events-none border-slate-100 text-slate-300"
    );

  return (
    <div className={cn("flex items-center justify-between gap-2", className)}>
      <p className="text-[11px] font-semibold tabular-nums text-slate-600">
        {progress.first}–{progress.last} / 전체 {totalCount.toLocaleString("ko-KR")}
      </p>
      <div className="flex items-center gap-1">
        <Link
          href={hasPrev ? buildAdminDataTableUrl(basePath, params, { page: params.page - 1 }) : "#"}
          aria-disabled={!hasPrev}
          className={linkClass(hasPrev)}
        >
          ← 이전
        </Link>
        <Link
          href={hasNext ? buildAdminDataTableUrl(basePath, params, { page: params.page + 1 }) : "#"}
          aria-disabled={!hasNext}
          className={linkClass(hasNext)}
        >
          다음 →
        </Link>
      </div>
    </div>
  );
}

export const AdminDataTable = { Counts, Tabs, Pagination };
