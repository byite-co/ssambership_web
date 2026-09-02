/**
 * 멘토 승인 작업대 — 좌측 지원자 목록(PR-2 §2). Server Component.
 *
 * - 검색·탭·페이지는 전부 URL(서버) 기준이다. 클라이언트 필터 없음. 쿼리 키는 `q` · `status` · `page` 만.
 *   검색 form 은 현재 탭이 기본 탭(대기)이 아닐 때만 hidden `status` 를 싣는다 — 전체 탭에서 검색해도 전체 탭이 유지된다
 *   (구 조건 `tab !== "all"` 은 전체 탭 검색을 대기 탭으로 튕겼다. 환불 툴바와 같은 규칙).
 * - 선택 행은 `mentor` 키로 싣되, 탭·검색·페이지 링크에는 싣지 않는다(params.extra 에서 제거된 채 넘어온다).
 * - 상단 `대기 N / 전체 M` · 상태 탭 · 하단 `첫–끝 / 필터 후 건수` 는 공용 `AdminDataTable`(PR-4) 조각을 쓴다.
 *   검색 form 과 지원자 카드(행)는 이 화면 고유다(300px 사이드바에 맞춘 배치).
 */
import Link from "next/link";
import { AdminDataTable } from "@/components/admin/AdminDataTable";
import { AdminStatusPill } from "@/components/admin/AdminStatusPill";
import { StatusBadge } from "@/components/design-system/StatusBadge";
import { EmptyState } from "@/components/common/EmptyState";
import { splitAdminListBasePath, type AdminListParams } from "@/lib/admin/adminListParams";
import {
  MENTOR_APPROVAL_BASE_PATH,
  MENTOR_APPROVAL_DEFAULT_TAB,
  MENTOR_APPROVAL_SELECTED_PARAM,
  MENTOR_APPROVAL_TABS,
  buildMentorApprovalListUrl,
  type MentorApprovalTab,
} from "@/lib/admin/mentorApprovalQueue";
import { identityListBadgeLabel, identityReviewTone } from "@/lib/admin/mentorIdentityReview";
import type { MentorApprovalQueueItem, MentorApprovalTabCounts } from "@/lib/admin/mentorApprovalWorkbenchQueries";
import { formatKoreanDate } from "@/lib/utils/formatDisplay";
import { cn } from "@/lib/utils/cn";

type Props = {
  items: MentorApprovalQueueItem[];
  /** `mentor` 키가 제거된 목록 파라미터 */
  params: AdminListParams;
  tab: MentorApprovalTab;
  counts: MentorApprovalTabCounts;
  /** 필터(탭·검색) 후 건수 */
  totalCount: number;
  selectedId: string | null;
  error: string | null;
  identityError: string | null;
};

export function MentorApprovalQueueList(props: Props) {
  const { items, params, tab, counts, totalCount, selectedId, error, identityError } = props;
  const { path: actionPath } = splitAdminListBasePath(MENTOR_APPROVAL_BASE_PATH);
  const rowHref = (id: string) =>
    buildMentorApprovalListUrl(params, { page: params.page, extra: { [MENTOR_APPROVAL_SELECTED_PARAM]: id } });

  return (
    <div className="flex h-full min-h-0 flex-col rounded-2xl border border-slate-200 bg-white">
      <div className="space-y-2 border-b border-slate-100 px-3 py-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-black text-slate-900">지원자</h2>
          <AdminDataTable.Counts counts={counts} />
        </div>
        <form action={actionPath} method="GET" className="flex items-center gap-1.5" role="search">
          <input
            type="search"
            name="q"
            defaultValue={params.search}
            placeholder="이름 · 이메일 · 대학"
            autoComplete="off"
            aria-label="지원자 검색"
            className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          />
          {tab !== MENTOR_APPROVAL_DEFAULT_TAB ? <input type="hidden" name="status" value={tab} /> : null}
          <button type="submit" className="rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-extrabold text-white hover:bg-slate-800">
            검색
          </button>
        </form>
        {params.search ? (
          <p className="flex items-center justify-between text-[11px] font-semibold text-slate-500">
            <span>
              &lsquo;{params.search}&rsquo; 검색 결과 <span className="tabular-nums text-slate-800">{totalCount}</span>건
            </span>
            <Link href={buildMentorApprovalListUrl(params, { search: "" })} className="font-bold text-blue-700 hover:underline">
              초기화
            </Link>
          </p>
        ) : null}
        <AdminDataTable.Tabs basePath={MENTOR_APPROVAL_BASE_PATH} params={params} tabs={MENTOR_APPROVAL_TABS} activeTab={tab} counts={counts} />
      </div>

      {error ? (
        <p className="m-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-900">
          목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
        </p>
      ) : null}
      {identityError ? (
        <p className="mx-3 mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-900">{identityError}</p>
      ) : null}

      <ol className="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto" aria-label="지원자 목록">
        {items.length === 0 && !error ? (
          <li className="p-3">
            <EmptyState
              title={tab === "pending" && !params.search ? "대기 건이 없습니다" : "조건에 맞는 지원자가 없습니다"}
              description={params.search ? "검색어를 바꾸거나 초기화해 주세요." : undefined}
            />
          </li>
        ) : null}
        {items.map((item) => {
          const selected = item.mentorUserId === selectedId;
          return (
            <li key={item.mentorUserId}>
              <Link
                href={rowHref(item.mentorUserId)}
                aria-current={selected ? "true" : undefined}
                data-mentor-row={item.mentorUserId}
                className={cn(
                  "block border-l-4 px-3 py-2.5 transition hover:bg-slate-50",
                  selected ? "border-l-blue-600 bg-blue-50/60" : "border-l-transparent"
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 truncate text-sm font-extrabold text-slate-900">{item.name}</p>
                  <AdminStatusPill table="mentor_profiles" column="verification_status" value={item.status} size="sm" className="shrink-0" />
                </div>
                <p className="mt-0.5 truncate text-xs text-slate-600">
                  {[item.university, item.department].filter(Boolean).join(" · ") || "학교 미입력"}
                </p>
                <div className="mt-1.5 flex items-center justify-between gap-2">
                  <span className="text-[11px] tabular-nums text-slate-500">신청 {formatKoreanDate(item.appliedAt)}</span>
                  {item.identity ? (
                    <StatusBadge label={identityListBadgeLabel(item.identity)} tone={identityReviewTone(item.identity)} size="sm" />
                  ) : (
                    <StatusBadge label="인증 확인 불가" tone="neutral" size="sm" />
                  )}
                </div>
              </Link>
            </li>
          );
        })}
      </ol>

      <AdminDataTable.Pagination
        className="border-t border-slate-100 px-3 py-2"
        basePath={MENTOR_APPROVAL_BASE_PATH}
        params={params}
        totalCount={totalCount}
        rowsOnPage={items.length}
      />
    </div>
  );
}
