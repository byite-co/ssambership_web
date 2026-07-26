// 회원탈퇴 Storage purge 계획 순수 로직 — 부수효과 없음(node:test 검증).
//
// 원칙(P1-10 saga):
//   * 삭제 대상 = DB 에 기록된 Storage refs ∪ 버킷 인벤토리(유저 prefix) 합집합(둘 중 한쪽에만 있어도 삭제).
//   * dedup(bucket/path).
//   * Storage 성공(빈 상태 재검증) 전에는 finalized 금지 — emptyStateSatisfied 로 확인.
//   * (W5 §3-4) 수집 경로가 없는 버킷이 하나라도 남으면 real-run 자체를 금지한다 —
//     "표시만 하고 진행"은 파일이 남은 채 completed 가 찍히는 거짓 완료를 만든다.

export type StorageObjectRef = { bucket: string; path: string };

/**
 * 삭제 계획. `refs` 는 실제 삭제 대상이고 `uncoveredBuckets` 는 **수집 경로 자체가 없는** 버킷이다.
 * 후자가 비어 있지 않으면 계획은 불완전하다 — 워커는 real-run 을 시작하지 않는다(§3-4).
 */
export type StoragePurgePlan = {
  refs: StorageObjectRef[];
  uncoveredBuckets: string[];
};

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
 * 계획 산출 정본 — 실행 경로와 dry-run 경로가 **같은 함수**를 쓴다(§3-1 계약 6).
 * 계획과 실제 삭제 대상이 갈라지면 dry-run 의 의미가 없다.
 */
export function buildDeletionPlan(input: {
  dbRefs: readonly StorageObjectRef[];
  inventory: readonly StorageObjectRef[];
  uncoveredBuckets: readonly string[];
}): StoragePurgePlan {
  return {
    refs: buildStoragePurgePlan(input.dbRefs, input.inventory),
    uncoveredBuckets: [...new Set(input.uncoveredBuckets.filter((b) => b && b.trim() !== ""))].sort(),
  };
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

/**
 * DB 에 저장된 참조 문자열 → 버킷 내부 경로.
 *
 * 저장 형식이 버킷·시대별로 셋이라 한 곳에서 흡수한다(실측):
 *   ① `"{bucket}/{path}"` ref  — community_posts.image_urls / shortform_posts.video_url 등
 *   ② 과거 서명 URL(`.../object/sign/{bucket}/{path}?token=…`)
 *   ③ 맨 경로(`"{uuid}/file.png"`) — *_attachments.storage_path 계열
 *
 * 다른 버킷의 ref 가 섞여 들어오면 **null** 을 준다(과삭제 방지 — 미삭제보다 나쁘다).
 * 토큰이 붙은 서명 URL 은 쿼리스트링을 잘라 버리므로 계획·로그에 token 이 남지 않는다.
 */
export function normalizeStoredObjectPath(
  bucket: string,
  stored: string | null | undefined,
): string | null {
  const raw = typeof stored === "string" ? stored.trim() : "";
  if (!raw || !bucket) return null;

  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    const marker = `/${bucket}/`;
    const idx = raw.indexOf(marker);
    if (idx < 0) return null;
    const path = raw.slice(idx + marker.length).split("?")[0]?.split("#")[0]?.trim() ?? "";
    return path ? path.replace(/^\/+/, "") : null;
  }

  const bare = raw.replace(/^\/+/, "");
  if (bare.startsWith(`${bucket}/`)) {
    const path = bare.slice(bucket.length + 1).replace(/^\/+/, "");
    return path || null;
  }
  // 다른 버킷 접두가 붙어 있으면 이 버킷 객체가 아니다.
  if (/^[a-z0-9][a-z0-9-]*\//.test(bare) && looksLikeBucketPrefix(bare)) {
    return null;
  }
  return bare || null;
}

/**
 * 첫 세그먼트가 "버킷 이름처럼 생겼는지"(= uuid 도 타임스탬프도 아닌 kebab 문자열) 판정.
 * uuid 로 시작하는 맨 경로를 버킷 접두로 오인해 버리지 않기 위한 보수적 검사다.
 */
function looksLikeBucketPrefix(bare: string): boolean {
  const first = bare.split("/")[0] ?? "";
  if (first === "") return false;
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(first);
  if (isUuid) return false;
  if (/^\d+$/.test(first)) return false;
  return /^[a-z][a-z0-9-]*$/.test(first) && first.includes("-");
}
