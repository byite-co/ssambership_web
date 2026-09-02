/**
 * 학적 변경 요청 목록(PR-5 §2-1) — 검색(멘토 이름·이메일·대학) · 상태 탭(`status` 하나 · CHECK 4종) · `대기 N / 전체 M` · 표 · 페이지네이션 · 빈 상태.
 * Server Component. 멘토 승인 작업대 목록(PR-2)의 축소판.
 *
 * - 검색 form 은 현재 탭이 기본 탭(대기)이 아닐 때만 hidden `status` 를 싣는다(PR-4 규칙).
 * - 행 클릭 = 같은 화면에서 `request` 키로 선택(탭·검색·페이지 링크에는 실리지 않는다). 선택된 요청은 아래 심사 패널에 보인다.
 * - 상태 배지는 `AdminStatusPill(mentor_academic_record_change_requests.status)` — 이 컬럼은 상태 사전에 없어 neutral 톤 + 원시 값으로 보인다(사전에 추가하지 않고 보고).
 */
import Link from "next/link";
import { AdminDataTable } from "@/components/admin/AdminDataTable";
import { AdminStatusPill } from "@/components/admin/AdminStatusPill";
import { EmptyState } from "@/components/common/EmptyState";
import { toAdminDisplayError } from "@/lib/admin/adminDisplayError";
import { splitAdminListBasePath, type AdminListParams } from "@/lib/admin/adminListParams";
import {
  ACADEMIC_RECORD_CHANGE_BASE_PATH,
  ACADEMIC_RECORD_CHANGE_DEFAULT_TAB,
  ACADEMIC_RECORD_CHANGE_EMPTY_STATE,
  ACADEMIC_RECORD_CHANGE_SELECTED_PARAM,
  ACADEMIC_RECORD_CHANGE_TABS,
  academicRecordChangeEmptyVariant,
  buildAcademicRecordChangeListUrl,
  type AcademicRecordChangeTab,
} from "@/lib/admin/academicRecordChangeConsole";
import type { AcademicRecordChangeQueueItem, AcademicRecordChangeTabCounts } from "@/lib/admin/academicRecordChangeQueries";
import { formatKoDateTimeKst } from "@/lib/utils/kstTime";
import { cn } from "@/lib/utils/cn";

type Props = {
  items: AcademicRecordChangeQueueItem[];
  /** `request` 키가 제거된 목록 파라미터 */
  params: AdminListParams;
  tab: AcademicRecordChangeTab;
  counts: AcademicRecordChangeTabCounts;
  /** 필터(탭·검색) 후 건수 */
  totalCount: number;
  selectedId: string | null;
  error: string | null;
};

function AcademicRecordChangeEmptyState({ variant, tabLabel, search, resetHref }: { variant: "first" | "tab" | "search"; tabLabel: string; search: string; resetHref: string }) {
  if (variant === "search") {
    return (
      <EmptyState title="조건에 맞는 학적 변경 요청이 없습니다" description={`'${search}' 검색 결과가 없습니다. 검색어를 바꾸거나 초기화해 주세요.`}>
        <Link href={resetHref} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">
          검색 초기화
        </Link>
      </EmptyState>
    );
  }
  if (variant === "tab") {
    return (
      <EmptyState
        title={tabLabel === "대기" ? "심사 대기 중인 요청이 없습니다" : `'${tabLabel}' 상태의 요청이 없습니다`}
        description={tabLabel === "대기" ? "새 요청이 들어오면 이 탭 맨 위에 오래된 것부터 보입니다." : "다른 탭에서 처리된 건을 확인할 수 있습니다."}
      />
    );
  }
  return <EmptyState title={ACADEMIC_RECORD_CHANGE_EMPTY_STATE.title} description={ACADEMIC_RECORD_CHANGE_EMPTY_STATE.description} />;
}

export function AcademicRecordChangeQueueList({ items, params, tab, counts, totalCount, selectedId, error }: Props) {
  const { path: actionPath } = splitAdminListBasePath(ACADEMIC_RECORD_CHANGE_BASE_PATH);
  const tabLabel = ACADEMIC_RECORD_CHANGE_TABS.find((t) => t.value === tab)?.label ?? "대기";
  const emptyVariant = academicRecordChangeEmptyVariant(params.search, counts.all);
  const rowHref = (id: string) => buildAcademicRecordChangeListUrl(params, { page: params.page, extra: { [ACADEMIC_RECORD_CHANGE_SELECTED_PARAM]: id } });

  return (
    <div className="space-y-4" data-academic-record-change-queue>
      <div className="space-y-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <form action={actionPath} method="GET" className="flex min-w-0 flex-1 items-center gap-1.5" role="search">
            <input
              type="search"
              name="q"
              defaultValue={params.search}
              placeholder="멘토 이름 · 이메일 · 대학"
              autoComplete="off"
              aria-label="학적 변경 요청 검색"
              className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 sm:max-w-xs"
            />
            {tab !== ACADEMIC_RECORD_CHANGE_DEFAULT_TAB ? <input type="hidden" name="status" value={tab} /> : null}
            <button type="submit" className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-extrabold text-white hover:bg-slate-800">
              검색
            </button>
            {params.search ? (
              <Link href={buildAcademicRecordChangeListUrl(params, { search: "" })} className="text-xs font-bold text-blue-700 hover:underline">
                초기화
              </Link>
            ) : null}
          </form>
          <AdminDataTable.Counts counts={counts} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <AdminDataTable.Tabs basePath={ACADEMIC_RECORD_CHANGE_BASE_PATH} params={params} tabs={ACADEMIC_RECORD_CHANGE_TABS} activeTab={tab} counts={counts} />
          {params.search ? (
            <p className="text-[11px] font-semibold text-slate-500">
              &lsquo;{params.search}&rsquo; 검색 결과 <span className="tabular-nums text-slate-800">{totalCount}</span>건
            </p>
          ) : null}
        </div>
      </div>

      {error ? (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50/60 p-5 text-sm text-red-950">
          <p className="font-bold">학적 변경 요청 목록을 불러오지 못했습니다.</p>
          <p className="mt-1 text-xs text-red-900/90">{toAdminDisplayError(error, "default") ?? "잠시 후 다시 시도하거나 담당자에게 문의해 주세요."}</p>
        </div>
      ) : items.length === 0 ? (
        <AcademicRecordChangeEmptyState variant={emptyVariant} tabLabel={tabLabel} search={params.search} resetHref={buildAcademicRecordChangeListUrl(params, { search: "" })} />
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/60 text-xs font-bold text-slate-600">
                  <th scope="col" className="px-3 py-3">멘토</th>
                  <th scope="col" className="px-3 py-3">현재 학교</th>
                  <th scope="col" className="px-3 py-3">요청 학교</th>
                  <th scope="col" className="px-3 py-3">사유</th>
                  <th scope="col" className="px-3 py-3">요청일</th>
                  <th scope="col" className="px-3 py-3">상태</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((item) => {
                  const selected = item.id === selectedId;
                  return (
                    <tr key={item.id} className={cn("transition-colors hover:bg-slate-50/60", selected && "bg-blue-50/60")} data-academic-record-change-row={item.id} aria-selected={selected}>
                      <td className="px-3 py-3 align-top">
                        <Link href={rowHref(item.id)} aria-current={selected ? "true" : undefined} className="block font-extrabold text-slate-900 hover:underline" prefetch={false}>
                          {item.mentorName}
                        </Link>
                        <p className="font-mono text-[11px] text-slate-400" title={item.mentorId}>
                          {item.mentorId.slice(0, 8)}… {item.hasDocument ? "· 서류 있음" : "· 서류 없음"}
                        </p>
                      </td>
                      <td className="px-3 py-3 align-top text-slate-800">
                        {item.currentUniversity || "—"}
                        {item.currentDepartment ? <p className="text-[11px] text-slate-500">{item.currentDepartment}</p> : null}
                      </td>
                      <td className="px-3 py-3 align-top font-bold text-slate-900">{item.requestedUniversity || "—"}</td>
                      <td className="max-w-[240px] px-3 py-3 align-top text-xs text-slate-700">
                        <p className="break-words" title={item.changeReason || undefined}>
                          {item.changeReason ? (item.changeReason.length > 60 ? `${item.changeReason.slice(0, 57)}…` : item.changeReason) : "—"}
                        </p>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 align-top text-xs tabular-nums text-slate-600">{formatKoDateTimeKst(item.createdAt)}</td>
                      <td className="px-3 py-3 align-top">
                        <AdminStatusPill table="mentor_academic_record_change_requests" column="status" value={item.status} size="sm" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <AdminDataTable.Pagination
            className="border-t border-slate-100 px-4 py-2"
            basePath={ACADEMIC_RECORD_CHANGE_BASE_PATH}
            params={params}
            totalCount={totalCount}
            rowsOnPage={items.length}
          />
        </div>
      )}
    </div>
  );
}
