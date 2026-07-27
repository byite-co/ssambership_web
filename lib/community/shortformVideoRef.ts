// 숏폼 영상 저장 참조(ref) 순수 유틸 — node/브라우저/테스트 공용, crypto·`@/` 의존 없음.
//
// ref 형식: `shortform-videos/{userId}/{uuid}.{ext}`
//   - 서버 signed-upload 티켓이 경로를 만들고, finalize 액션이 소유권(경로 첫 세그먼트=userId)을 재검증한다.
//   - 계약 테스트가 소유권 판정을 회귀 방지한다.

// = communityShortformConstants.SHORTFORM_VIDEO_BUCKET (순수 모듈이라 리터럴 유지).
export const SHORTFORM_VIDEO_BUCKET = "shortform-videos";

export const SHORTFORM_VIDEO_MIME = new Set(["video/mp4", "video/quicktime", "video/webm"]);

export function shortformVideoExtForMime(mime: string): string {
  const m = mime.trim().toLowerCase();
  return m.includes("quicktime") ? "mov" : m.includes("webm") ? "webm" : "mp4";
}

/** 순수 경로 빌더(uuid 인자) — 서버 티켓 발급이 사용. */
export function buildShortformVideoPathWithId(userId: string, mime: string, uuid: string): string {
  return `${userId}/${uuid}.${shortformVideoExtForMime(mime)}`;
}

export function formatShortformVideoStoredRef(path: string): string {
  return `${SHORTFORM_VIDEO_BUCKET}/${path.replace(/^\/+/, "")}`;
}

/** 저장 문자열 → `{ bucket, path }`. ref / 과거 서명 URL / `a/b` 상대경로 3형태 수용. */
export function parseShortformVideoRef(
  stored: string | null | undefined,
): { bucket: string; path: string } | null {
  const raw = typeof stored === "string" ? stored.trim() : "";
  if (!raw) return null;
  const bucket = SHORTFORM_VIDEO_BUCKET;
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
 * ref 가 해당 사용자 네임스페이스(`{userId}/...`)에 속하는지. finalize 가 클라 제출 ref 를
 * 신뢰하기 전 검증(경로 위조·타인 객체 참조 차단).
 */
export function shortformVideoRefBelongsToUser(
  ref: string | null | undefined,
  userId: string,
): boolean {
  const parsed = parseShortformVideoRef(ref);
  if (!parsed || !userId) return false;
  const first = parsed.path.split("/")[0] ?? "";
  return first === userId && first.length > 0;
}
