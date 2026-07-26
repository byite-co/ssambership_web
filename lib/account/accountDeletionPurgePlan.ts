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

// ── W5-c §3-3 (b): storage.objects.owner_id 실측 기반 분류 ────────────────────
//
// staging 실측(2026-07-26, 13버킷 전수): with_owner > 0 버킷 다수
// (community-post-images 64/64 · question-room-attachments 7/7 · custom-* 각 2/2 ·
//  profile-avatars 1/1 · student-id-images 1/1 · individual-question-attachments 0/5).
// → (b) 분기: 수집을 DB 조인 refs ∪ owner_id=대상(전 버킷) ∪ prefix ∪ 유저-스코프
//   전 버킷 인벤토리의 합집합으로 넓히고, 각 후보를 아래 표로 분류한다.
//
//   DB 조인 O · owner 일치(또는 owner 부재)  → 정상 삭제 대상
//   DB 조인 O · owner 존재·불일치            → OWNERSHIP_CONFLICT (삭제 0 · 차단)
//   DB 조인 X · owner = 대상                 → owner 귀속 삭제 대상 (별도 표기)
//   인벤토리에 있으나 셋 다 아님(커버 버킷 내) → UNATTRIBUTABLE (삭제 0 · 차단)
//
// owner 부재(null)를 충돌로 보지 않는 이유: individual-question-attachments 실측이
// owner_id 전부 NULL 이다 — 등록 RPC(SECURITY DEFINER) 경유 업로드는 owner 를 남기지
// 않으므로, DB 조인이 소유의 정본이고 owner 는 **모순 신호가 있을 때만** 우선한다.
// 차단(충돌·판별불능 ≥ 1 → real-run 0 · storage_purged 전이 0)은 워커가
// 미커버 버킷 차단과 동일 관문에서 강제한다.

/** storage.objects 실측 1행: 해당 객체가 실재하며 owner_id 가 이 값이다(null = owner 미기록). */
export type StorageOwnerEvidence = { bucket: string; path: string; ownerId: string | null };

export type OwnershipConflict = { bucket: string; path: string; ownerId: string };

/**
 * 분류된 삭제 계획. `refs` 는 실제 삭제 대상(정상 + owner 귀속)이고,
 * `ownershipConflicts`·`unattributable` 은 삭제 대상에 **넣지 않으며** 하나라도 있으면
 * real-run 시작·storage_purged 전이가 차단된다(§3-3 (b)).
 */
export type ClassifiedDeletionPlan = StoragePurgePlan & {
  /** DB 조인 없이 storage owner 로만 귀속된 삭제 대상(refs 에도 포함 — 별도 표기용). */
  ownerAttributed: StorageObjectRef[];
  /** DB 는 대상 사용자 것이라는데 storage owner 는 타인 — 사람이 볼 사안. */
  ownershipConflicts: OwnershipConflict[];
  /** 유저-스코프 인벤토리에 있으나 DB 조인·owner·prefix 어느 것으로도 귀속 불가. */
  unattributable: StorageObjectRef[];
};

/**
 * 계획 산출 + 분류 정본 — 실행 경로와 dry-run 경로가 같은 함수를 쓴다(§3-1 계약 6 유지).
 *
 * 입력 의미:
 *   dbRefs        DB 조인으로 "이 사용자 소유"라고 판정된 refs
 *   inventory     유저-스코프 인벤토리(prefix 스캔 + owner 증거의 {uid}/ 행 — 어댑터 합산)
 *   ownerEvidence storage.objects 실측(owner_id=대상 전 버킷 ∪ 후보 refs 의 owner lookup)
 *   prefixBuckets 키 첫 세그먼트가 사용자 uuid 라는 **선언된** 규약이 있는 버킷만.
 *                 선언 밖 버킷의 {uid}/ 경로는 prefix 귀속으로 인정하지 않는다(과삭제 방지).
 */
export function classifyDeletionPlan(input: {
  userId: string;
  dbRefs: readonly StorageObjectRef[];
  inventory: readonly StorageObjectRef[];
  ownerEvidence: readonly StorageOwnerEvidence[];
  uncoveredBuckets: readonly string[];
  prefixBuckets: readonly string[];
}): ClassifiedDeletionPlan {
  const { userId } = input;
  const prefix = `${userId}/`;
  const prefixBuckets = new Set(input.prefixBuckets);

  const normalize = (r: { bucket: string; path: string }): StorageObjectRef => ({
    bucket: r.bucket,
    path: r.path.replace(/^\/+/, ""),
  });

  const dbKeys = new Set(
    input.dbRefs.filter((r) => r && r.bucket && r.path).map((r) => key(normalize(r)))
  );

  // 실측 owner. Map 에 없는 후보는 "owner 미실측/객체 부재" — 모순 신호가 아니므로 충돌 아님.
  const ownersByKey = new Map<string, string | null>();
  for (const e of input.ownerEvidence) {
    if (!e || !e.bucket || !e.path) continue;
    ownersByKey.set(key(normalize(e)), e.ownerId);
  }

  // 후보 합집합 = DB refs ∪ 인벤토리 ∪ (owner 증거 중 owner=대상 또는 {uid}/ 경로).
  const candidates = new Map<string, StorageObjectRef>();
  const addCandidate = (r: { bucket: string; path: string }) => {
    if (!r || !r.bucket || !r.path) return;
    const n = normalize(r);
    const k = key(n);
    if (!candidates.has(k)) candidates.set(k, n);
  };
  for (const r of input.dbRefs) addCandidate(r);
  for (const r of input.inventory) addCandidate(r);
  for (const e of input.ownerEvidence) {
    if (!e || !e.bucket || !e.path) continue;
    const n = normalize(e);
    if (e.ownerId === userId || n.path.startsWith(prefix)) addCandidate(n);
  }

  const refs: StorageObjectRef[] = [];
  const ownerAttributed: StorageObjectRef[] = [];
  const ownershipConflicts: OwnershipConflict[] = [];
  const unattributable: StorageObjectRef[] = [];

  const orderedKeys = [...candidates.keys()].sort((a, b) => a.localeCompare(b));
  for (const k of orderedKeys) {
    const ref = candidates.get(k) as StorageObjectRef;
    const owner = ownersByKey.get(k); // string | null | undefined
    const isDbRef = dbKeys.has(k);
    const ownerMatches = owner === userId;
    const prefixAttributed = prefixBuckets.has(ref.bucket) && ref.path.startsWith(prefix);

    if (isDbRef && typeof owner === "string" && !ownerMatches) {
      ownershipConflicts.push({ bucket: ref.bucket, path: ref.path, ownerId: owner });
    } else if (isDbRef) {
      refs.push(ref);
    } else if (ownerMatches) {
      refs.push(ref);
      ownerAttributed.push(ref);
    } else if (prefixAttributed) {
      refs.push(ref);
    } else {
      unattributable.push(ref);
    }
  }

  return {
    refs,
    ownerAttributed,
    ownershipConflicts,
    unattributable,
    uncoveredBuckets: [...new Set(input.uncoveredBuckets.filter((b) => b && b.trim() !== ""))].sort(),
  };
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
