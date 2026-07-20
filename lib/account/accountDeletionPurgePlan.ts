// 회원탈퇴 Storage purge 계획 순수 로직 — 부수효과 없음(node:test 검증).
//
// 원칙(P1-10 saga):
//   * 삭제 대상 = DB 에 기록된 Storage refs ∪ 버킷 인벤토리(유저 prefix) 합집합(둘 중 한쪽에만 있어도 삭제).
//   * dedup(bucket/path).
//   * Storage 성공(빈 상태 재검증) 전에는 finalized 금지 — emptyStateSatisfied 로 확인.

export type StorageObjectRef = { bucket: string; path: string };

function key(r: StorageObjectRef): string {
  return `${r.bucket}/${r.path.replace(/^\/+/, "")}`;
}

/** DB refs 와 버킷 인벤토리를 합집합·dedup 하여 삭제 계획을 만든다. */
export function buildStoragePurgePlan(
  dbRefs: readonly StorageObjectRef[],
  inventory: readonly StorageObjectRef[],
): StorageObjectRef[] {
  const seen = new Map<string, StorageObjectRef>();
  for (const r of [...dbRefs, ...inventory]) {
    if (!r || !r.bucket || !r.path) continue;
    const k = key(r);
    if (!seen.has(k)) seen.set(k, { bucket: r.bucket, path: r.path.replace(/^\/+/, "") });
  }
  return [...seen.values()].sort((a, b) => key(a).localeCompare(key(b)));
}

/**
 * 삭제 후 빈 상태 재검증: 재조사 인벤토리에 유저 소유 객체가 하나도 남지 않아야 true.
 * 하나라도 남으면 Storage 미완료 → finalized 금지(재시도 대상).
 */
export function emptyStateSatisfied(reinventory: readonly StorageObjectRef[]): boolean {
  return reinventory.length === 0;
}

/** 삭제 결과 검사: 계획 대비 실제 삭제 실패(남은) 목록 반환. 빈 배열이면 전부 성공. */
export function purgeResidue(
  plan: readonly StorageObjectRef[],
  removedKeys: readonly string[],
): StorageObjectRef[] {
  const removed = new Set(removedKeys);
  return plan.filter((r) => !removed.has(key(r)));
}

export function storageObjectKey(r: StorageObjectRef): string {
  return key(r);
}
