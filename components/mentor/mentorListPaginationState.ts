/**
 * 멘토 찾기 하단 페이지네이션 순수 상태 — `‹ 이전 · N / M · 다음 ›` 하나(2단계 · 2026-09-06).
 *
 * 의존 0(next·lib 미의존)이라 계약 테스트가 그대로 import 한다. 링크 조립은 컴포넌트가
 * `mentorsListHref(hrefBase, { page })` 로 한다 — 이 모듈은 페이지 번호·버튼 상태만 정한다.
 *
 * 규격(AdminDataTable.Pagination 과 동일 · 관리자 컴포넌트 import 0):
 *  - totalPages = max(1, ceil(totalCount / pageSize)) · 1페이지에서도 항상 표시
 *  - 이전은 page > 1 일 때만 · 다음은 page < totalPages 일 때만 활성. 비활성은 href "#" + aria-disabled + 회색.
 *  - 범위를 넘긴 ?page=(예: 9 / 3)는 서버가 빈 목록을 돌려주므로 라벨은 요청값을 그대로 보이고 이전은 마지막 페이지로 보낸다.
 */
export type MentorListPaginationState = {
  page: number;
  totalPages: number;
  hasPrev: boolean;
  hasNext: boolean;
  /** hasPrev 일 때 이동할 페이지(범위 초과 요청이면 마지막 페이지로 클램프) */
  prevPage: number;
  /** hasNext 일 때 이동할 페이지 */
  nextPage: number;
  /** "N / M" */
  label: string;
};

export function mentorListPaginationState(input: { page: number; pageSize: number; totalCount: number }): MentorListPaginationState {
  const pageSize = Math.max(1, Math.trunc(input.pageSize) || 1);
  const totalCount = Math.max(0, Math.trunc(input.totalCount) || 0);
  const page = Math.max(1, Math.trunc(input.page) || 1);
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const hasPrev = page > 1;
  const hasNext = page < totalPages;
  return {
    page,
    totalPages,
    hasPrev,
    hasNext,
    prevPage: Math.min(page - 1, totalPages),
    nextPage: Math.min(page + 1, totalPages),
    label: `${page} / ${totalPages}`,
  };
}

/** `?page=` 값 — 1페이지는 파라미터를 싣지 않는다(`filtersToHrefRecord` 의 `page > 1` 규칙과 동일). */
export function mentorListPageParam(page: number): string | null {
  const p = Math.max(1, Math.trunc(page) || 1);
  return p > 1 ? String(p) : null;
}
