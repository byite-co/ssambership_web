// 숏폼 썸네일 ref·데이터URL 계약 — 순수 모듈(node/브라우저/테스트 공용, 별칭 import 없음).
//
// 배경(QA-C15): shortform-thumbnails 버킷 객체가 0건이었다. 업로드 헬퍼
// (uploadShortformThumbnail)와 Storage 정책(sfv_mentor_insert)은 이미 있었는데
// **호출자가 없어서** finalize 가 thumbnailUrl 을 항상 null 로 넣고 있었다.
// 영상은 Storage 직접 업로드(서명 티켓)로 올라가지만, 썸네일은 수십 KB 라
// 서버 액션으로 받아 magic byte 를 검증한 뒤 올린다 — 더 안전하고 경로도 짧다.

/** 브라우저 canvas 가 만들 수 있고 서버가 magic byte 로 검증하는 형식만 허용한다. */
export const SHORTFORM_THUMBNAIL_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * 서버 액션 body 상한. 480px 폭 JPEG(q=0.7)이 보통 30~80KB 라 512KB 면 충분하고,
 * 액션 body 제한(1MB)에 여유를 둔다. base64 는 원본의 약 4/3 이다.
 */
export const SHORTFORM_THUMBNAIL_MAX_BYTES = 512 * 1024;

export type ParsedThumbnailDataUrl = { mime: string; base64: string };

/**
 * `data:image/jpeg;base64,....` 를 해석한다. 형식이 아니거나 허용 mime 이 아니면 null.
 * base64 문자 집합까지 확인한다 — 서버에서 Buffer.from 이 조용히 잘라내는 걸 막는다.
 */
export function parseShortformThumbnailDataUrl(value: unknown): ParsedThumbnailDataUrl | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  const m = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i.exec(raw);
  if (!m) return null;
  const mime = (m[1] ?? "").toLowerCase();
  const base64 = m[2] ?? "";
  if (!SHORTFORM_THUMBNAIL_MIME.has(mime)) return null;
  if (base64.length === 0) return null;
  // base64 길이로 디코딩 바이트 수를 계산한다(패딩 제외) — 디코딩 전에 상한을 건다.
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  const bytes = Math.floor((base64.length * 3) / 4) - padding;
  if (bytes <= 0 || bytes > SHORTFORM_THUMBNAIL_MAX_BYTES) return null;
  return { mime, base64 };
}

/**
 * 썸네일 stored ref 가 이 사용자 소유 경로인가 — `shortform-thumbnails/<uid>/...`.
 * 영상 ref 와 같은 규칙이다(Storage 정책 sfv_mentor_insert 의 foldername[1] = uid).
 * 위조 ref 를 그대로 DB 에 넣거나 보상 삭제 대상으로 삼지 않기 위한 관문이다.
 */
export function shortformThumbnailRefBelongsToUser(
  ref: string | null | undefined,
  userId: string,
): boolean {
  if (typeof ref !== "string" || !userId) return false;
  const raw = ref.trim();
  const prefix = "shortform-thumbnails/";
  if (!raw.startsWith(prefix)) return false;
  const path = raw.slice(prefix.length).replace(/^\/+/, "");
  const first = path.split("/")[0] ?? "";
  return first === userId && first.length > 0 && path.length > first.length + 1;
}
