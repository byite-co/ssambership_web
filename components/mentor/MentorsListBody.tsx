import Link from "next/link";
import { SearchX } from "lucide-react";
import type { MentorsListFilters } from "@/lib/mentor/mentorsListSearchParams";
import type { MentorSchoolFilter, MentorTypeFilter } from "@/lib/mentor/mentorsListSearchParams";
import { filtersToHrefRecord, mentorsListHref } from "@/lib/mentor/mentorsListSearchParams";
import type { PublicMentorsListResult } from "@/lib/mentor/publicMentorsListQueries";
import { MentorGrid } from "@/components/mentor/MentorGrid";
import { MentorsListFilterSidebar } from "@/components/mentor/MentorsListFilterSidebar";
import { MentorsListSidebar } from "@/components/mentor/MentorsListSidebar";
import { MentorsListTopFilterBar } from "@/components/mentor/MentorsListTopFilterBar";

const COPY_PUBLIC_LIST_HINT =
  "현재 공개된 멘토 정보만 표시하고 있어요. 더 많은 멘토는 순차적으로 준비 중이에요.";

function mentorsListFiltersApplied(filters: MentorsListFilters): boolean {
  return Boolean(
    filters.q.trim() ||
      filters.subject ||
      filters.school ||
      filters.university.trim() ||
      filters.verification ||
      filters.verifiedOnly ||
      filters.grades.length > 0 ||
      filters.mentorTypes.length > 0 ||
      filters.priceBand
  );
}

export function MentorsListBody(props: {
  filters: MentorsListFilters;
  list: PublicMentorsListResult;
  favoriteIds: string[];
  isLoggedIn: boolean;
  schoolOptions: { id: MentorSchoolFilter; label: string }[];
  mentorTypeOptions: { id: MentorTypeFilter; label: string }[];
}) {
  const { filters, list } = props;
  const hrefBase = filtersToHrefRecord(filters);
  const favoriteSet = new Set(props.favoriteIds);
  const favoriteCards = list.cards.filter((c) => favoriteSet.has(c.mentorId));
  const showListHint = list.onlySelfVisibleHint && list.cards.length === 0;
  const from = list.totalCount === 0 ? 0 : (list.page - 1) * list.pageSize + 1;
  const to = Math.min(list.page * list.pageSize, list.totalCount);

  if (list.usersError) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-4 sm:p-5">
        <p className="text-sm font-extrabold text-red-900">멘토 목록을 불러오지 못했어요</p>
        <p className="mt-2 text-sm text-red-800/95">
          잠시 후 다시 시도하거나, 로그인한 뒤에도 동일하면 고객센터로 문의해 주세요.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1600px] min-w-0 px-4 pb-12 sm:px-5 lg:px-6">
      <header className="mb-6">
        <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-[#2563EB]">쌤버십</p>
        <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">멘토 찾기</h1>
        <p className="mt-2 max-w-2xl text-sm font-medium leading-relaxed text-slate-600">
          <span className="md:hidden">과목·학년·요금으로 멘토를 찾아 구독하세요.</span>
          <span className="hidden md:inline">과목·학년·요금으로 멘토를 찾고, 라이트·스탠다드·프리미엄 플랜으로 구독을 시작하세요.</span>
        </p>
      </header>

      <MentorsListTopFilterBar
        filters={filters}
        favoriteCount={props.favoriteIds.length}
        totalCount={list.totalCount}
        schoolOptions={props.schoolOptions}
        mentorTypeOptions={props.mentorTypeOptions}
      />

      <div className="mt-6 flex flex-col gap-6 xl:grid xl:grid-cols-12 xl:items-start">
        <aside className="hidden xl:col-span-2 xl:block">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-[14px] font-black text-slate-900">필터</h2>
            <div className="mt-3">
              <MentorsListFilterSidebar
                filters={filters}
                totalCount={list.totalCount}
                schoolOptions={props.schoolOptions}
                mentorTypeOptions={props.mentorTypeOptions}
              />
            </div>
          </div>
        </aside>

        <main className="min-w-0 xl:col-span-7">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
            <p className="text-sm font-bold text-slate-700">
              {list.totalCount > 0 ? (
                <>
                  검색 결과 <span className="font-black text-[#2563EB]">{list.totalCount}</span>명 · {from}–{to}
                  번째
                </>
              ) : (
                "조건에 맞는 멘토 0명"
              )}
            </p>
            {list.profilesError ? (
              <p className="text-[11px] font-medium text-amber-800">일부 프로필 정보가 누락될 수 있어요.</p>
            ) : null}
          </div>

          {showListHint ? (
            <div className="mb-4 rounded-xl border border-blue-100 bg-blue-50/50 px-4 py-3 text-sm text-slate-700">
              {COPY_PUBLIC_LIST_HINT}
            </div>
          ) : null}

          {list.cards.length === 0 && mentorsListFiltersApplied(filters) ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-16 text-center">
              <SearchX className="h-12 w-12 text-slate-400" strokeWidth={1.5} aria-hidden />
              <h3 className="mt-4 text-lg font-black text-slate-900">조건에 맞는 멘토가 없어요</h3>
              <p className="mt-2 max-w-sm text-sm font-medium text-slate-600">
                필터를 바꾸거나 검색어를 수정해보세요.
              </p>
              <Link
                href="/mentors"
                className="mt-6 inline-flex min-h-[44px] items-center justify-center rounded-xl bg-[#2563EB] px-5 text-sm font-extrabold text-white hover:bg-[#1D4ED8]"
              >
                필터 초기화
              </Link>
            </div>
          ) : list.cards.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center">
              <p className="text-lg font-black text-slate-900">아직 데이터가 없어요</p>
              <p className="mt-2 text-sm text-slate-600">필터를 조정하거나 검색어를 바꿔 보세요.</p>
              <Link href="/mentors" className="mt-4 inline-block text-sm font-bold text-[#2563EB] underline">
                필터 초기화
              </Link>
            </div>
          ) : (
            <>
              <MentorGrid
                cards={list.cards}
                favoriteIds={favoriteSet}
                isLoggedIn={props.isLoggedIn}
                view={filters.view}
              />

              {list.hasMore ? (
                <div className="mt-6">
                  <Link
                    href={mentorsListHref(hrefBase, { page: String(list.page + 1) })}
                    className="flex min-h-[48px] w-full items-center justify-center rounded-xl border-2 border-dashed border-[#2563EB]/40 bg-blue-50/50 text-sm font-extrabold text-[#2563EB] transition hover:bg-blue-50"
                  >
                    더 많은 멘토 보기
                  </Link>
                </div>
              ) : null}

              <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                {list.page > 1 ? (
                  <Link
                    href={mentorsListHref(hrefBase, { page: String(list.page - 1) })}
                    className="min-h-[44px] rounded-xl border border-slate-200 bg-white px-5 text-sm font-extrabold text-slate-800 hover:bg-slate-50"
                  >
                    이전
                  </Link>
                ) : null}
                <span className="text-sm font-bold text-slate-500">
                  {list.page} / {Math.max(1, Math.ceil(list.totalCount / list.pageSize))}
                </span>
              </div>
            </>
          )}
        </main>

        <aside className="min-w-0 xl:col-span-3">
          <MentorsListSidebar favoriteCards={favoriteCards} />
        </aside>
      </div>
    </div>
  );
}
