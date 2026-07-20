import type { SupabaseClient } from "@supabase/supabase-js";
import { MENTORS_PAGE_SIZE, type MentorsListFilters } from "@/lib/mentor/mentorsListSearchParams";
import { loadPublicMentorsList, type PublicMentorsListResult } from "@/lib/mentor/publicMentorsListQueries";
import { filterAndOrderByIds } from "@/lib/mentor/orderCardsByIds";

// P2-27: scope=favorite/recent 실제 배선. publicMentorsListQueries(격리)는 수정하지 않고
// 전체 필터 결과 카드셋을 받아 scope ID 로 제한·정렬·페이지네이션한다.
// → "현재 첫 페이지만 필터"가 아니라 전체 디렉터리 셋에서 걸러내므로 누락이 없다.
// → 디렉터리에 없는(삭제·비활성) 멘토 ID 는 자동 제외(접근 불가능 안전 제외).
const SCOPED_FETCH_LIMIT = 300;
const SCOPED_INTERNAL_PAGE_SIZE = 100_000;

type ScopedOpts = {
  schoolTierLabels?: Record<string, string>;
  majorCategoryLabels?: Record<string, string>;
  pageSize?: number;
};

export function emptyMentorsResult(page: number, pageSize: number): PublicMentorsListResult {
  return {
    cards: [],
    totalCount: 0,
    page,
    pageSize,
    hasMore: false,
    usersError: null,
    profilesError: null,
    onlySelfVisibleHint: false,
  };
}

/**
 * scope(찜/최근) ID 집합으로 제한된 멘토 목록. orderByIds=true 면 ids 순서를 보존(최근 본),
 * false 면 일반 목록 정렬(filters.sort)을 유지(찜).
 */
export async function loadScopedMentorsList(
  supabase: SupabaseClient,
  filters: MentorsListFilters,
  opts: ScopedOpts,
  scope: { ids: string[]; orderByIds: boolean }
): Promise<PublicMentorsListResult> {
  const pageSize = opts.pageSize ?? MENTORS_PAGE_SIZE;
  if (!scope.ids.length) return emptyMentorsResult(filters.page, pageSize);

  const full = await loadPublicMentorsList(
    supabase,
    { ...filters, page: 1 },
    {
      schoolTierLabels: opts.schoolTierLabels,
      majorCategoryLabels: opts.majorCategoryLabels,
      fetchLimit: SCOPED_FETCH_LIMIT,
      pageSize: SCOPED_INTERNAL_PAGE_SIZE,
    }
  );
  if (full.usersError) {
    return { ...emptyMentorsResult(filters.page, pageSize), usersError: full.usersError };
  }

  const scoped = filterAndOrderByIds(full.cards, scope.ids, (c) => c.mentorId, {
    orderByIds: scope.orderByIds,
  });

  const totalCount = scoped.length;
  const start = (filters.page - 1) * pageSize;
  const sliced = scoped.slice(start, start + pageSize);
  return {
    cards: sliced,
    totalCount,
    page: filters.page,
    pageSize,
    hasMore: start + pageSize < totalCount,
    usersError: null,
    profilesError: full.profilesError,
    onlySelfVisibleHint: false,
  };
}
