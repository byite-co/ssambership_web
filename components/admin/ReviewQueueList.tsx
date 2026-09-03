/**
 * 리뷰 관리 목록(PR-11 §2-1) — 검색(멘토·작성자) · 상태 탭(공용 `AdminDataTable.Tabs` — 공개 · 숨김 · 블라인드 · 격리 · 전체) · `N / M` · 표 · 페이지네이션 · 빈 상태.
 * Server Component.
 *
 * - 열: 평점 · 내용 요약(→ 리뷰 상세) · 대상 멘토(→ 계정 상세) · 작성자(→ 계정 상세) · 신고 N(→ 신고 검수) · 작성일 · 상태(`AdminStatusPill(reviews.moderation_state)` — 유효 상태).
 * - 격리 탭은 보관함 두 곳(격리·중복)의 행을 그린다 — 출처 · 사유 · 보관일. 조회만.
 * - 조치는 리뷰 상세에서만 한다(목록 인라인 조치 없음).
 */
import Link from "next/link";
import { AdminDataTable } from "@/components/admin/AdminDataTable";
import { AdminStatusPill } from "@/components/admin/AdminStatusPill";
import { EmptyState } from "@/components/common/EmptyState";
import { accountDetailPath } from "@/lib/admin/accountDetailConsole";
import { toAdminDisplayError } from "@/lib/admin/adminDisplayError";
import { splitAdminListBasePath, type AdminListParams } from "@/lib/admin/adminListParams";
import type { ReviewArchiveItem, ReviewListItem, ReviewTabCounts } from "@/lib/admin/adminReviewQueries";
import {
  REVIEW_ARCHIVE_NOTE,
  REVIEW_BASE_PATH,
  REVIEW_DEFAULT_TAB,
  REVIEW_EMPTY_STATE,
  REVIEW_TABLE,
  REVIEW_TABS,
  buildReviewListUrl,
  reviewDetailPath,
  reviewEmptyVariant,
  reviewRatingLabel,
  reviewReportsUrl,
  reviewSummaryText,
  reviewTabIsArchive,
  type ReviewTab,
} from "@/lib/admin/reviewConsole";
import { formatKoDateTimeKst } from "@/lib/utils/kstTime";

type Props = {
  items: ReviewListItem[];
  archiveItems: ReviewArchiveItem[];
  params: AdminListParams;
  tab: ReviewTab;
  counts: ReviewTabCounts;
  /** 필터(탭·검색) 후 건수 */
  totalCount: number;
  error: string | null;
};

const TH = "px-3 py-3";

function ReviewEmptyState({ variant, tabLabel, search, resetHref }: { variant: "first" | "tab" | "search"; tabLabel: string; search: string; resetHref: string }) {
  if (variant === "search") {
    return (
      <EmptyState title="조건에 맞는 리뷰가 없습니다" description={`'${search}' 검색 결과가 없습니다. 검색어를 바꾸거나 초기화해 주세요.`}>
        <Link href={resetHref} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50" prefetch={false}>
          검색 초기화
        </Link>
      </EmptyState>
    );
  }
  if (variant === "tab") {
    return <EmptyState title={`'${tabLabel}' 상태의 리뷰가 없습니다`} description="다른 탭에서 확인할 수 있습니다." />;
  }
  return <EmptyState title={REVIEW_EMPTY_STATE.title} description={REVIEW_EMPTY_STATE.description} />;
}

export function ReviewQueueList({ items, archiveItems, params, tab, counts, totalCount, error }: Props) {
  const { path: actionPath } = splitAdminListBasePath(REVIEW_BASE_PATH);
  const tabLabel = REVIEW_TABS.find((t) => t.value === tab)?.label ?? "전체";
  const archive = reviewTabIsArchive(tab);
  const rowsOnPage = archive ? archiveItems.length : items.length;
  // 격리 탭은 보관함이 비었을 때 '탭만 비었음' 으로 본다(리뷰 0건이어도 보관함 안내가 먼저).
  const emptyVariant = archive ? (params.search ? "search" : "tab") : reviewEmptyVariant(params.search, counts.all);

  return (
    <div className="space-y-4" data-review-queue>
      <div className="space-y-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <form action={actionPath} method="GET" className="flex min-w-0 flex-1 items-center gap-1.5" role="search">
            <input
              type="search"
              name="q"
              defaultValue={params.search}
              placeholder="멘토 · 작성자 이름 · 이메일 · 내용"
              autoComplete="off"
              aria-label="리뷰 검색"
              className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 sm:max-w-xs"
            />
            {tab !== REVIEW_DEFAULT_TAB ? <input type="hidden" name="status" value={tab} /> : null}
            <button type="submit" className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-extrabold text-white hover:bg-slate-800">
              검색
            </button>
            {params.search ? (
              <Link href={buildReviewListUrl(params, { search: "" })} className="text-xs font-bold text-blue-700 hover:underline" prefetch={false}>
                초기화
              </Link>
            ) : null}
          </form>
          {/* 건수 줄 — 공용 Counts 는 대기 키 전용이라 직접 그린다(prop 추가 0). */}
          <p className="text-xs font-bold text-slate-600" aria-live="polite" data-review-counts>
            <span className="tabular-nums text-slate-900">{totalCount.toLocaleString("ko-KR")}</span>
            {" / "}
            전체 <span className="tabular-nums text-slate-900">{counts.all.toLocaleString("ko-KR")}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <AdminDataTable.Tabs basePath={REVIEW_BASE_PATH} params={params} tabs={REVIEW_TABS} activeTab={tab} counts={counts} />
          {params.search ? (
            <p className="text-[11px] font-semibold text-slate-500">
              &lsquo;{params.search}&rsquo; 검색 결과 <span className="tabular-nums text-slate-800">{totalCount}</span>건
            </p>
          ) : null}
        </div>
        {archive ? <p className="text-[11px] font-semibold leading-5 text-slate-500">{REVIEW_ARCHIVE_NOTE}</p> : null}
      </div>

      {error ? (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50/60 p-5 text-sm text-red-950">
          <p className="font-bold">리뷰 목록을 불러오지 못했습니다.</p>
          <p className="mt-1 text-xs text-red-900/90">{toAdminDisplayError(error, "reviews") ?? "잠시 후 다시 시도하거나 담당자에게 문의해 주세요."}</p>
        </div>
      ) : rowsOnPage === 0 ? (
        <ReviewEmptyState variant={emptyVariant} tabLabel={tabLabel} search={params.search} resetHref={buildReviewListUrl(params, { search: "" })} />
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
            {archive ? (
              <table className="w-full min-w-[960px] text-left text-sm" data-review-archive-table>
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/60 text-xs font-bold text-slate-600">
                    <th scope="col" className={TH}>출처</th>
                    <th scope="col" className={TH}>평점</th>
                    <th scope="col" className={TH}>내용 요약</th>
                    <th scope="col" className={TH}>대상 멘토</th>
                    <th scope="col" className={TH}>작성자</th>
                    <th scope="col" className={TH}>보관 사유</th>
                    <th scope="col" className={TH}>보관일</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {archiveItems.map((item) => (
                    <tr key={`${item.source}-${item.archiveId}`} className="hover:bg-slate-50/60" data-review-archive-row={item.archiveId}>
                      <td className="whitespace-nowrap px-3 py-3 align-top text-xs font-bold text-slate-700">{item.sourceLabel}</td>
                      <td className="whitespace-nowrap px-3 py-3 align-top text-xs font-bold tabular-nums text-slate-900">{reviewRatingLabel(item.rating)}</td>
                      <td className="max-w-[320px] px-3 py-3 align-top text-slate-800">
                        <p className="line-clamp-2">{reviewSummaryText(item.body)}</p>
                        {item.originalId ? (
                          <p className="mt-0.5 font-mono text-[11px] text-slate-400" title={item.originalId}>
                            원본 {item.originalId.slice(0, 8)}…
                          </p>
                        ) : null}
                      </td>
                      <td className="max-w-[140px] truncate px-3 py-3 align-top text-slate-800">
                        {item.mentorId ? (
                          <Link href={accountDetailPath(item.mentorId)} className="hover:underline" prefetch={false}>
                            {item.mentorName}
                          </Link>
                        ) : (
                          item.mentorName
                        )}
                      </td>
                      <td className="max-w-[140px] truncate px-3 py-3 align-top text-slate-800">
                        {item.authorId ? (
                          <Link href={accountDetailPath(item.authorId)} className="hover:underline" prefetch={false}>
                            {item.authorName}
                          </Link>
                        ) : (
                          item.authorName
                        )}
                      </td>
                      <td className="max-w-[200px] px-3 py-3 align-top font-mono text-[11px] text-slate-500">{item.reason || "—"}</td>
                      <td className="whitespace-nowrap px-3 py-3 align-top text-xs tabular-nums text-slate-600">{formatKoDateTimeKst(item.archivedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="w-full min-w-[960px] text-left text-sm" data-review-table>
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/60 text-xs font-bold text-slate-600">
                    <th scope="col" className={TH}>평점</th>
                    <th scope="col" className={TH}>내용 요약</th>
                    <th scope="col" className={TH}>대상 멘토</th>
                    <th scope="col" className={TH}>작성자</th>
                    <th scope="col" className={TH}>신고</th>
                    <th scope="col" className={TH}>작성일</th>
                    <th scope="col" className={TH}>상태</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((item) => (
                    <tr key={item.id} className="transition-colors hover:bg-slate-50/60" data-review-row={item.id} data-review-state={item.state}>
                      <td className="whitespace-nowrap px-3 py-3 align-top text-xs font-bold tabular-nums text-slate-900">{reviewRatingLabel(item.rating)}</td>
                      <td className="max-w-[360px] px-3 py-3 align-top">
                        <Link href={reviewDetailPath(item.id)} className="line-clamp-2 font-extrabold text-slate-900 hover:underline" prefetch={false} title="리뷰 상세">
                          {reviewSummaryText(item.body)}
                        </Link>
                        <p className="mt-0.5 font-mono text-[11px] text-slate-400" title={item.id}>
                          {item.id.slice(0, 8)}…
                        </p>
                      </td>
                      <td className="max-w-[140px] truncate px-3 py-3 align-top text-slate-800">
                        {item.mentorId ? (
                          <Link href={accountDetailPath(item.mentorId)} className="hover:underline" prefetch={false} title="계정 상세">
                            {item.mentorName}
                          </Link>
                        ) : (
                          item.mentorName
                        )}
                      </td>
                      <td className="max-w-[140px] truncate px-3 py-3 align-top text-slate-800">
                        {item.authorId ? (
                          <Link href={accountDetailPath(item.authorId)} className="hover:underline" prefetch={false} title="계정 상세">
                            {item.authorName}
                          </Link>
                        ) : (
                          item.authorName
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 align-top text-xs">
                        {item.reportCount > 0 ? (
                          <Link href={reviewReportsUrl(item.id)} className="font-extrabold text-red-700 hover:underline" prefetch={false} title="신고 검수에서 보기">
                            신고 {item.reportCount}
                          </Link>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 align-top text-xs tabular-nums text-slate-600">{formatKoDateTimeKst(item.createdAt)}</td>
                      <td className="px-3 py-3 align-top">
                        <AdminStatusPill table={REVIEW_TABLE} column="moderation_state" value={item.state} size="sm" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <AdminDataTable.Pagination className="rounded-2xl border border-slate-200 bg-white px-4 py-2" basePath={REVIEW_BASE_PATH} params={params} totalCount={totalCount} rowsOnPage={rowsOnPage} />
        </>
      )}
    </div>
  );
}
