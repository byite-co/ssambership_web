// 회원탈퇴 Storage purge 계획 순수 로직 — 부수효과 없음(node:test 검증).
//
// 원칙(P1-10 saga):
//   * 삭제 대상 = DB 에 기록된 Storage refs ∪ owner_id 귀속 객체 ∪ 버킷 인벤토리(유저 prefix) 합집합.
//   * dedup(bucket/path).
//   * Storage 성공(빈 상태 재검증) 전에는 finalized 금지 — emptyStateSatisfied 로 확인.
//   * (W5 §3-4) 수집 경로가 없는 버킷이 하나라도 남으면 real-run 자체를 금지한다 —
//     "표시만 하고 진행"은 파일이 남은 채 completed 가 찍히는 거짓 완료를 만든다.
//   * (W5-c §3-3-b) storage.objects.owner_id 실측 채움률 > 0 (staging 2026-07-26:
//     13버킷 중 7버킷 with_owner>0, 예: community-post-images 64/64) → 소유 분류를 배선한다.
//       DB 조인 O · owner 일치(또는 owner 미기록)  → 정상 삭제 대상
//       DB 조인 O · owner 존재·불일치              → OWNERSHIP_CONFLICT (차단)
//       DB 조인 X · owner = 대상                   → owner 귀속 삭제 대상(별도 표기)
//       수집됐으나 셋 다 아님(커버 버킷 내)         → UNATTRIBUTABLE (차단)
//     차단 분류가 1건이라도 있으면 real-run 시작 0 · purging→storage_purged 전이 0
//     (미커버 버킷 차단과 동일 관문 — 워커가 배선).

export type StorageObjectRef = { bucket: string; path: string };

/**
 * storage.objects.owner_id 실측 결과(어댑터가 공급).
 *   ownedByUser: owner_id = 대상 uid 인 객체 전수(전 버킷) — 수집 합집합의 owner 축.
 *   owners: 수집 범위 객체의 owner_id. 값 null = 행은 있으나 owner 미기록,
 *           엔트리 부재 = storage.objects 행 자체가 확인되지 않음(이미 삭제된 DB ref 등).
 */
export type ObjectOwnership = {
  ownedByUser: readonly StorageObjectRef[];
  owners: ReadonlyMap<string, string | null>;
};

/** DB 조인으로 수집됐지만 storage 소유자가 다른 사용자로 실측된 객체 — 삭제 금지·차단. */
export type OwnershipConflict = StorageObjectRef & { ownerId: string };

/**
 * 삭제 계획. `refs` 는 실제 삭제 대상이고 `uncoveredBuckets` 는 **수집 경로 자체가 없는** 버킷이다.
 * `ownershipConflicts`·`unattributable` 이 비어 있지 않으면 계획은 오염됐다 —
 * 워커는 real-run 을 시작하지 않고 storage_purged 로도 넘어가지 않는다(§3-3-b·§3-4).
 */
export type StoragePurgePlan = {
  refs: StorageObjectRef[];
  uncoveredBuckets: string[];
  /** DB 조인 X · owner = 대상 — refs 에 포함되는 삭제 대상이지만 근거가 owner 뿐이라 별도 표기. */
  ownerAttributed: StorageObjectRef[];
  ownershipConflicts: OwnershipConflict[];
  unattributable: StorageObjectRef[];
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
 *
 * `ownership` 이 주어지면(§3-3-b — 워커 경로는 항상 준다) 수집 합집합을
 * DB조인 × owner 실측으로 4분류하고, 없으면 구(§3-4 이전) 합집합 계획만 만든다
 * (순수 유틸 소비자용 하위호환 — 차단 분류는 전부 빈 배열).
 */
export function buildDeletionPlan(input: {
  dbRefs: readonly StorageObjectRef[];
  inventory: readonly StorageObjectRef[];
  uncoveredBuckets: readonly string[];
  /** 소유 분류 대상 사용자. `ownership` 을 줄 때 필수. */
  userId?: string;
  ownership?: ObjectOwnership;
}): StoragePurgePlan {
  const uncoveredBuckets = [
    ...new Set(input.uncoveredBuckets.filter((b) => b && b.trim() !== "")),
  ].sort();

  if (!input.ownership) {
    return {
      refs: buildStoragePurgePlan(input.dbRefs, input.inventory),
      uncoveredBuckets,
      ownerAttributed: [],
      ownershipConflicts: [],
      unattributable: [],
    };
  }
  const userId = input.userId;
  if (!userId) {
    // ownership 을 주고 userId 를 빠뜨리면 분류가 전부 오판된다 — 조용히 진행하지 않는다.
    throw new Error("buildDeletionPlan: ownership 분류에는 userId 가 필요하다");
  }

  const dbSet = new Set(buildStoragePurgePlan(input.dbRefs, []).map(key));
  const ownedSet = new Set(buildStoragePurgePlan(input.ownership.ownedByUser, []).map(key));
  const scope = buildStoragePurgePlan(
    [...input.dbRefs, ...input.ownership.ownedByUser],
    input.inventory
  );

  const refs: StorageObjectRef[] = [];
  const ownerAttributed: StorageObjectRef[] = [];
  const ownershipConflicts: OwnershipConflict[] = [];
  const unattributable: StorageObjectRef[] = [];

  for (const ref of scope) {
    const k = key(ref);
    // owner 실측: owners 맵 우선, 맵에 없으면 ownedByUser 목록 소속으로 보강.
    const measured: string | null | undefined = input.ownership.owners.has(k)
      ? input.ownership.owners.get(k)
      : ownedSet.has(k)
        ? userId
        : undefined;
    if (dbSet.has(k)) {
      if (typeof measured === "string" && measured !== userId) {
        // DB 조인 O · owner 존재·불일치 — 삭제하지 않는다(과삭제는 미삭제보다 나쁘다).
        ownershipConflicts.push({ ...ref, ownerId: measured });
      } else {
        // owner 일치 또는 owner 미기록(레거시 업로드·이미 삭제된 ref) → 정상 삭제 대상.
        refs.push(ref);
      }
    } else if (measured === userId) {
      // DB 조인 X · owner = 대상 → owner 귀속 삭제 대상(별도 표기).
      refs.push(ref);
      ownerAttributed.push(ref);
    } else {
      // 수집됐으나(인벤토리 등) DB 조인도 owner 귀속도 아니다 → 귀속 불능, 차단.
      unattributable.push(ref);
    }
  }

  return { refs, uncoveredBuckets, ownerAttributed, ownershipConflicts, unattributable };
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
