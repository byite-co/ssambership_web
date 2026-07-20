// 커뮤니티 이미지 저장 참조(ref) 순수 유틸 — node/브라우저 공용, 부수효과·crypto 의존 없음.
//
// ref 형식: `community-post-images/{userId}/{uuid}-{safeName}.{ext}`
//   - 클라 직접 업로드(staged)·서버 소유권 검증·표시 리졸버가 이 한 곳을 공유한다.
//   - 계약 테스트가 소유권 판정(경로 첫 세그먼트 = userId)을 회귀 방지한다.

export const COMMUNITY_POST_IMAGES_BUCKET = "community-post-images";

export const COMMUNITY_IMAGE_ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export function communityImageExtForMime(mime: string): string {
  return mime === "image/png"
    ? "png"
    : mime === "image/webp"
      ? "webp"
      : mime === "image/gif"
        ? "gif"
        : "jpg";
}

/** 순수 경로 빌더: uuid 를 인자로 받아 결정적(테스트·클라·서버 공용). */
export function buildCommunityImageObjectPathWithId(
  userId: string,
  mime: string,
  originalName: string,
  uuid: string,
): string {
  const ext = communityImageExtForMime(mime);
  const safe = originalName.replace(/[^\w.\-]+/g, "_").slice(0, 40);
  return `${userId}/${uuid}-${safe || "image"}.${ext}`;
}

/** DB `community_posts.image_urls[]` 에 저장할 참조 문자열(`bucket/path`). */
export function formatCommunityImageStoredRef(objectPath: string): string {
  return `${COMMUNITY_POST_IMAGES_BUCKET}/${objectPath.replace(/^\/+/, "")}`;
}

/**
 * 저장 문자열에서 `{ bucket, path }` 추출. 셋 다 수용:
 *  1) `bucket/path` ref(정상 신규),
 *  2) 과거 서명 URL(`.../object/sign/{bucket}/{path}?token=...`) — 하위호환,
 *  3) 그 외는 null.
 */
export function parseCommunityImageRef(
  stored: string | null | undefined,
): { bucket: string; path: string } | null {
  const raw = typeof stored === "string" ? stored.trim() : "";
  if (!raw) return null;
  const bucket = COMMUNITY_POST_IMAGES_BUCKET;

  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    const marker = `/${bucket}/`;
    const idx = raw.indexOf(marker);
    if (idx < 0) return null;
    const path = raw.slice(idx + marker.length).split("?")[0]?.split("#")[0]?.trim() ?? "";
    return path ? { bucket, path } : null;
  }
  if (raw.startsWith(`${bucket}/`)) {
    const path = raw.slice(bucket.length + 1).replace(/^\/+/, "");
    return path ? { bucket, path } : null;
  }
  return null;
}

/**
 * ref 가 해당 사용자 네임스페이스(`{userId}/...`)에 속하는지 판정.
 * 클라가 제출한 이미지 ref 를 서버가 신뢰하기 전 검증하는 계약(경로 위조·타인 객체 참조 차단).
 * 과거 http 서명 URL 은 path 첫 세그먼트가 userId 여야 통과(레거시 본인 객체만).
 */
export function communityImageRefBelongsToUser(
  ref: string | null | undefined,
  userId: string,
): boolean {
  const parsed = parseCommunityImageRef(ref);
  if (!parsed || !userId) return false;
  const first = parsed.path.split("/")[0] ?? "";
  return first === userId && first.length > 0;
}
