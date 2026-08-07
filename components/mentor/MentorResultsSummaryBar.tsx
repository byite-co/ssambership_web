import type { MentorsListFilters } from "@/lib/mentor/mentorsListSearchParams";
import { filtersToHrefRecord, mentorsListHref } from "@/lib/mentor/mentorsListSearchParams";

const SORT_LABEL: Record<MentorsListFilters["sort"], string> = {
  popular: "인기순",
  new: "최신순",
  review: "리뷰많은순",
  price_asc: "가격낮은순",
  price_desc: "가격높은순",
  rating: "평점순",
};

export function MentorResultsSummaryBar(props: {
  filters: MentorsListFilters;
  total: number;
  profilesError: boolean;
}) {
  const { filters, total, profilesError } = props;
  const q = filters.q?.trim();
  const hrefClear = mentorsListHref(filtersToHrefRecord(filters), { q: null });

  return (
    <div className="min-w-0 rounded-2xl border border-slate-200/90 bg-gradient-to-r from-white via-slate-50/80 to-sky-50/40 px-4 py-4 shadow-sm sm:px-5">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-slate-500">
            검색 결과
          </p>
          <p className="mt-1 text-lg font-black text-slate-900 sm:text-xl">
            멘토 <span className="text-blue-700">{total}</span>명
          </p>
          <p className="mt-1 text-xs font-medium text-slate-600">
            정렬: <span className="font-bold text-slate-800">{SORT_LABEL[filters.sort]}</span>
            {profilesError ? (
              <>
                {" "}
                · <span className="font-bold text-amber-800">일부 프로필은 요약만 표시해요</span>
              </>
            ) : null}
          </p>
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:justify-end">
          {q ? (
            <span className="inline-flex max-w-full items-center gap-2 rounded-full border border-blue-100 bg-blue-50/90 px-3 py-1.5 text-xs font-bold text-blue-950">
              <span className="truncate">검색 &quot;{q}&quot;</span>
              <a
                href={hrefClear}
                className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[11px] font-extrabold text-blue-700 ring-1 ring-blue-200 hover:bg-blue-50"
              >
                지우기
              </a>
            </span>
          ) : (
            <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600">
              전체 멘토 기준
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

