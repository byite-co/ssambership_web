// 멘토 카드 정렬/필터 순수 유틸 — scope=favorite/recent 배선과 RecentMentorsScope 재정렬이 공유한다.
// (이전에 scopedMentorsList.ts 와 RecentMentorsScope.tsx 에 중복돼 있던 정렬 로직 통합.)
// 순수 함수라 node:test 로 직접 검증 가능(favorite/recent 순서·dedup 계약).

/** ids 순서대로 정렬(ids 에 없는 항목은 뒤로). 안정적 — 원본을 변형하지 않는다. */
export function orderItemsByIds<T>(
  items: readonly T[],
  ids: readonly string[],
  getId: (t: T) => string,
): T[] {
  const order = new Map(ids.map((id, i) => [id, i] as const));
  return [...items].sort((a, b) => (order.get(getId(a)) ?? 1e9) - (order.get(getId(b)) ?? 1e9));
}

/**
 * ids 집합으로 필터하고(디렉터리에 없는 ID 는 자동 제외), orderByIds=true 면 ids 순서 보존.
 * favorite: orderByIds=false(일반 정렬 유지) · recent: orderByIds=true(최근 본 순서).
 */
export function filterAndOrderByIds<T>(
  items: readonly T[],
  ids: readonly string[],
  getId: (t: T) => string,
  opts?: { orderByIds?: boolean },
): T[] {
  const idSet = new Set(ids);
  const filtered = items.filter((t) => idSet.has(getId(t)));
  return opts?.orderByIds ? orderItemsByIds(filtered, ids, getId) : filtered;
}
