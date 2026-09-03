/**
 * 커뮤니티 관리 목록(PR-11 §1-1) — 검색(제목·작성자) · 종류 탭(글·숏폼·댓글 — `type` 키라 화면이 직접 그린다, PR-7 방식) · 상태 탭(공용 `AdminDataTable.Tabs`) ·
 * `N / M` · 표 · 페이지네이션 · 빈 상태. Server Component.
 *
 * - 검색·탭·페이지는 전부 URL(서버) 기준. 검색 form 은 현재 종류가 기본(글)이 아닐 때 hidden `type`, 현재 탭이 기본(전체)이 아닐 때 hidden `status` 를 싣는다.
 * - 상태 배지: 게시·숨김·임시는 종류별 사전(`AdminStatusPill`) · 삭제됨은 `deleted_at` 판정이라 화면 배지(CHECK 가 deleted 를 막는다).
 * - 신고 건수 → 신고 검수 목록(대상 ID 검색) · 작성자 → 계정 상세 · 제목 → 공개 화면(새 탭).
 * - 조치는 행마다 `CommunityContentActionButtons`(확인 절차 — 종류별 삭제 방식 명시).
 */
import Link from "next/link";
import { AdminDataTable } from "@/components/admin/AdminDataTable";
import { AdminStatusPill } from "@/components/admin/AdminStatusPill";
import { CommunityContentActionButtons } from "@/components/admin/CommunityContentActionButtons";
import { StatusBadge } from "@/components/design-system/StatusBadge";
import { EmptyState } from "@/components/common/EmptyState";
import { accountDetailPath } from "@/lib/admin/accountDetailConsole";
import { toAdminDisplayError } from "@/lib/admin/adminDisplayError";
import { splitAdminListBasePath, type AdminListParams } from "@/lib/admin/adminListParams";
import {
  COMMUNITY_CONTENT_BASE_PATH,
  COMMUNITY_CONTENT_DEFAULT_TAB,
  COMMUNITY_CONTENT_DEFAULT_TYPE,
  COMMUNITY_CONTENT_DELETED_LABEL,
  COMMUNITY_CONTENT_EMPTY_STATE,
  COMMUNITY_CONTENT_KIND_LABELS,
  COMMUNITY_CONTENT_TABLES,
  COMMUNITY_CONTENT_TABS,
  COMMUNITY_CONTENT_TYPE_PARAM,
  COMMUNITY_CONTENT_TYPE_TABS,
  buildCommunityContentListUrl,
  buildCommunityContentTypeTabUrl,
  communityContentEmptyVariant,
  communityContentPublicPath,
  communityContentReportsUrl,
  type CommunityContentTab,
  type CommunityContentType,
} from "@/lib/admin/communityContentConsole";
import type { CommunityContentListItem, CommunityContentTabCounts } from "@/lib/admin/adminCommunityContentQueries";
import { formatKoDateTimeKst } from "@/lib/utils/kstTime";
import { cn } from "@/lib/utils/cn";

type Props = {
  items: CommunityContentListItem[];
  params: AdminListParams;
  type: CommunityContentType;
  tab: CommunityContentTab;
  /** 현재 종류의 상태 탭 건수 */
  counts: CommunityContentTabCounts;
  /** 종류 탭 건수(종류별 전체) */
  typeCounts: Record<CommunityContentType, number>;
  /** 필터(종류·탭·검색) 후 건수 */
  totalCount: number;
  error: string | null;
};

function CommunityContentEmptyState({ variant, tabLabel, search, resetHref }: { variant: "first" | "tab" | "search"; tabLabel: string; search: string; resetHref: string }) {
  if (variant === "search") {
    return (
      <EmptyState title="조건에 맞는 콘텐츠가 없습니다" description={`'${search}' 검색 결과가 없습니다. 검색어를 바꾸거나 초기화해 주세요.`}>
        <Link href={resetHref} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50" prefetch={false}>
          검색 초기화
        </Link>
      </EmptyState>
    );
  }
  if (variant === "tab") {
    return <EmptyState title={`'${tabLabel}' 상태의 콘텐츠가 없습니다`} description="다른 상태 탭이나 종류 탭에서 확인할 수 있습니다." />;
  }
  return <EmptyState title={COMMUNITY_CONTENT_EMPTY_STATE.title} description={COMMUNITY_CONTENT_EMPTY_STATE.description} />;
}

export function CommunityContentList({ items, params, type, tab, counts, typeCounts, totalCount, error }: Props) {
  const { path: actionPath } = splitAdminListBasePath(COMMUNITY_CONTENT_BASE_PATH);
  const tabLabel = COMMUNITY_CONTENT_TABS.find((t) => t.value === tab)?.label ?? "전체";
  const emptyVariant = communityContentEmptyVariant(params.search, counts.all);
  const returnTo = buildCommunityContentListUrl(params, {});
  const table = COMMUNITY_CONTENT_TABLES[type];

  return (
    <div className="space-y-4" data-community-content-list data-community-content-type={type}>
      <div className="space-y-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <form action={actionPath} method="GET" className="flex min-w-0 flex-1 items-center gap-1.5" role="search">
            <input
              type="search"
              name="q"
              defaultValue={params.search}
              placeholder="제목 · 내용 · 작성자 이름 · 이메일"
              autoComplete="off"
              aria-label="콘텐츠 검색"
              className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 sm:max-w-xs"
            />
            {type !== COMMUNITY_CONTENT_DEFAULT_TYPE ? <input type="hidden" name={COMMUNITY_CONTENT_TYPE_PARAM} value={type} /> : null}
            {tab !== COMMUNITY_CONTENT_DEFAULT_TAB ? <input type="hidden" name="status" value={tab} /> : null}
            <button type="submit" className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-extrabold text-white hover:bg-slate-800">
              검색
            </button>
            {params.search ? (
              <Link href={buildCommunityContentListUrl(params, { search: "" })} className="text-xs font-bold text-blue-700 hover:underline" prefetch={false}>
                초기화
              </Link>
            ) : null}
          </form>
          {/* 건수 줄 — 공용 Counts 는 대기 키 전용이라 직접 그린다(prop 추가 0). */}
          <p className="text-xs font-bold text-slate-600" aria-live="polite" data-community-content-counts>
            <span className="tabular-nums text-slate-900">{totalCount.toLocaleString("ko-KR")}</span>
            {" / "}
            전체 <span className="tabular-nums text-slate-900">{counts.all.toLocaleString("ko-KR")}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* 종류 탭 — AdminDataTable.Tabs 와 같은 모양, 키만 type(extra). */}
          <nav className="flex flex-wrap gap-1" aria-label="종류 탭" data-community-content-type-tabs>
            {COMMUNITY_CONTENT_TYPE_TABS.map((t) => {
              const active = t.value === type;
              return (
                <Link
                  key={t.value}
                  href={buildCommunityContentTypeTabUrl(params, t.value)}
                  aria-current={active ? "page" : undefined}
                  prefetch={false}
                  className={cn(
                    "rounded-lg border px-2.5 py-1 text-[11px] font-extrabold transition",
                    active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  )}
                >
                  {t.label}
                  <span className={cn("ml-1 tabular-nums", active ? "text-slate-300" : "text-slate-400")}>{typeCounts[t.value]}</span>
                </Link>
              );
            })}
          </nav>
          <AdminDataTable.Tabs basePath={COMMUNITY_CONTENT_BASE_PATH} params={params} tabs={COMMUNITY_CONTENT_TABS} activeTab={tab} counts={counts} />
        </div>
      </div>

      {error ? (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50/60 p-5 text-sm text-red-950">
          <p className="font-bold">콘텐츠 목록을 불러오지 못했습니다.</p>
          <p className="mt-1 text-xs text-red-900/90">{toAdminDisplayError(error, "default") ?? "잠시 후 다시 시도하거나 담당자에게 문의해 주세요."}</p>
        </div>
      ) : items.length === 0 ? (
        <CommunityContentEmptyState variant={emptyVariant} tabLabel={tabLabel} search={params.search} resetHref={buildCommunityContentListUrl(params, { search: "" })} />
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full min-w-[1040px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/60 text-xs font-bold text-slate-600">
                  <th scope="col" className="px-3 py-3">종류</th>
                  <th scope="col" className="px-3 py-3">제목/내용 요약</th>
                  <th scope="col" className="px-3 py-3">작성자</th>
                  <th scope="col" className="px-3 py-3">상태</th>
                  <th scope="col" className="px-3 py-3">신고</th>
                  <th scope="col" className="px-3 py-3">작성일</th>
                  <th scope="col" className="px-3 py-3">조치</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((item) => {
                  const publicPath = communityContentPublicPath(item.type, item.id, { postType: item.postType, postId: item.postId });
                  return (
                    <tr key={item.id} className="transition-colors hover:bg-slate-50/60" data-community-content-row={item.id} data-community-content-status={item.status}>
                      <td className="whitespace-nowrap px-3 py-3 align-top text-xs font-bold text-slate-700">
                        {COMMUNITY_CONTENT_KIND_LABELS[item.type]}
                        {item.type === "comments" && item.postType ? (
                          <span className="ml-1 text-[11px] font-semibold text-slate-400">{item.postType === "shortform" ? "숏폼" : "게시판"}</span>
                        ) : null}
                      </td>
                      <td className="max-w-[360px] px-3 py-3 align-top">
                        {publicPath ? (
                          <a href={publicPath} target="_blank" rel="noreferrer" className="line-clamp-2 font-extrabold text-slate-900 hover:underline" title="공개 화면에서 보기(새 탭)">
                            {item.summary}
                          </a>
                        ) : (
                          <p className="line-clamp-2 font-extrabold text-slate-900">{item.summary}</p>
                        )}
                        <p className="mt-0.5 font-mono text-[11px] text-slate-400" title={item.id}>
                          {item.id.slice(0, 8)}…
                        </p>
                      </td>
                      <td className="max-w-[160px] px-3 py-3 align-top text-slate-800">
                        {item.authorId ? (
                          <Link href={accountDetailPath(item.authorId)} className="block truncate hover:underline" prefetch={false} title="계정 상세">
                            {item.authorName}
                          </Link>
                        ) : (
                          <span className="block truncate">{item.authorName}</span>
                        )}
                        {item.authorLabel && item.authorLabel !== item.authorName ? <p className="truncate text-[11px] text-slate-500">{item.authorLabel}</p> : null}
                      </td>
                      <td className="px-3 py-3 align-top">
                        {item.status === "deleted" ? (
                          <StatusBadge label={COMMUNITY_CONTENT_DELETED_LABEL} tone="danger" size="sm" />
                        ) : (
                          <AdminStatusPill table={table} column="status" value={item.rawStatus} size="sm" />
                        )}
                        {item.deletedAt ? <p className="mt-0.5 text-[11px] tabular-nums text-slate-500">{formatKoDateTimeKst(item.deletedAt)}</p> : null}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 align-top text-xs">
                        {item.reportCount > 0 ? (
                          <Link href={communityContentReportsUrl(item.id)} className="font-extrabold text-red-700 hover:underline" prefetch={false} title="신고 검수에서 보기">
                            신고 {item.reportCount}
                          </Link>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 align-top text-xs tabular-nums text-slate-600">{formatKoDateTimeKst(item.createdAt)}</td>
                      <td className="px-3 py-3 align-top">
                        <CommunityContentActionButtons type={item.type} targetId={item.id} status={item.status} returnTo={returnTo} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <AdminDataTable.Pagination
            className="rounded-2xl border border-slate-200 bg-white px-4 py-2"
            basePath={COMMUNITY_CONTENT_BASE_PATH}
            params={params}
            totalCount={totalCount}
            rowsOnPage={items.length}
          />
        </>
      )}
    </div>
  );
}
