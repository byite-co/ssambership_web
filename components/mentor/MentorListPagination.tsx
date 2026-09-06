import Link from "next/link";
import { mentorsListHref } from "@/lib/mentor/mentorsListSearchParams";
import { mentorListPageParam, mentorListPaginationState } from "@/components/mentor/mentorListPaginationState";

/**
 * 멘토 찾기 하단 페이지네이션 — `‹ 이전 · N / M · 다음 ›` 하나(2단계 · 2026-09-06). Server Component.
 *
 * `AdminDataTable.Pagination` 과 같은 규격을 `components/mentor/` 안에 별도로 둔다(관리자 컴포넌트 import 0):
 *  - 항상 렌더(1페이지 포함) · 링크는 `<Link>` · 비활성은 `href="#"` + `aria-disabled` + `pointer-events-none` + 회색(slate-100/300)
 *  - 페이지는 `?page=`(1페이지는 파라미터 없음) · 나머지 필터·정렬·보기·scope 는 `hrefBase` 그대로 보존
 *  - 페이지 크기는 서버 결과(`list.pageSize` = MENTORS_PAGE_SIZE 12)를 그대로 받는다 — 클라이언트 슬라이스 없음
 * 크기만 공개 목록의 터치 규격(min-h 44px · text-sm)이다.
 */
export function MentorListPagination(props: {
  /** `filtersToHrefRecord(filters)` — 현재 필터·정렬·보기·scope */
  hrefBase: Record<string, string | undefined>;
  page: number;
  pageSize: number;
  totalCount: number;
  className?: string;
}) {
  const state = mentorListPaginationState({ page: props.page, pageSize: props.pageSize, totalCount: props.totalCount });
  const linkClass = (enabled: boolean) =>
    [
      "inline-flex min-h-[44px] items-center gap-1 rounded-xl border px-4 text-sm font-extrabold transition",
      enabled
        ? "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
        : "pointer-events-none border-slate-100 bg-white text-slate-300",
    ].join(" ");

  return (
    <nav
      aria-label="멘토 목록 페이지 이동"
      className={["flex items-center justify-center gap-3", props.className ?? ""].join(" ").trim()}
    >
      <Link
        href={state.hasPrev ? mentorsListHref(props.hrefBase, { page: mentorListPageParam(state.prevPage) }) : "#"}
        aria-disabled={!state.hasPrev}
        tabIndex={state.hasPrev ? undefined : -1}
        className={linkClass(state.hasPrev)}
      >
        <span aria-hidden>‹</span> 이전
      </Link>
      <span className="text-sm font-bold tabular-nums text-slate-500" aria-current="page">
        {state.label}
      </span>
      <Link
        href={state.hasNext ? mentorsListHref(props.hrefBase, { page: mentorListPageParam(state.nextPage) }) : "#"}
        aria-disabled={!state.hasNext}
        tabIndex={state.hasNext ? undefined : -1}
        className={linkClass(state.hasNext)}
      >
        다음 <span aria-hidden>›</span>
      </Link>
    </nav>
  );
}
