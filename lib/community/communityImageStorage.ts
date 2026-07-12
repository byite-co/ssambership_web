import type { SupabaseClient } from "@supabase/supabase-js";
import { createSignedStorageUrl } from "@/lib/storage/signedStorageUrl";
import { COMMUNITY_POST_IMAGES_BUCKET } from "@/lib/community/communityStorage";

/**
 * 커뮤니티 게시글 이미지 저장 형식(BUG-B 수정).
 *
 * 문제: 업로드 시 7일 서명 URL 을 만들어 `community_posts.image_urls` 에 그대로
 *   저장 → 게시 7일 뒤 목록 썸네일·본문 이미지가 영구히 깨졌다.
 * 방침: 숏폼·학생증과 동일하게 **DB 에는 `bucket/path` 참조(ref)만 저장**하고
 *   서명 URL 은 표시 시점에 단기(1h) 발급한다. 기존에 저장된 http(s) 서명 URL 은
 *   리졸버가 그대로 통과시켜(하위호환) 배포 직후 깨지지 않으며, 선택적 백필로
 *   ref 로 전환하면 영구 복구된다.
 */

/** 표시 시점 서명 TTL(초). 전역 기본 7일(signedStorageUrl)은 다른 도메인이 쓰므로 여기서 명시. */
export const COMMUNITY_IMAGE_SIGNED_URL_TTL_SEC = 60 * 60;

/** DB `community_posts.image_urls[]` 에 저장할 참조 문자열(`bucket/path`). */
export function formatCommunityImageStoredRef(objectPath: string): string {
  return `${COMMUNITY_POST_IMAGES_BUCKET}/${objectPath.replace(/^\/+/, "")}`;
}

/**
 * 저장 문자열에서 `{ bucket, path }` 추출. 셋 다 수용:
 *  1) `bucket/path` ref(정상 신규),
 *  2) 과거 서명 URL(`.../object/sign/{bucket}/{path}?token=...`) — 하위호환,
 *  3) 그 외는 null(리졸버가 원문 폴백 판단).
 */
export function parseCommunityImageRef(
  stored: string | null | undefined
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
 * 저장 문자열 1건 → 표시용 URL.
 *  - ref/과거 URL 에서 path 를 얻으면 1h 서명해 반환(재발급이라 만료 무관).
 *  - path 추출 실패 시: 이미 http(s) 면 원문 그대로(최후 폴백), 아니면 null.
 */
export async function resolveCommunityImageUrl(
  supabase: SupabaseClient,
  stored: string | null | undefined
): Promise<string | null> {
  const ref = parseCommunityImageRef(stored);
  if (!ref) {
    const raw = typeof stored === "string" ? stored.trim() : "";
    return raw.startsWith("http://") || raw.startsWith("https://") ? raw : null;
  }
  const signed = await createSignedStorageUrl(
    supabase,
    ref.bucket,
    ref.path,
    COMMUNITY_IMAGE_SIGNED_URL_TTL_SEC
  );
  if (signed.error || !signed.url) return null;
  return signed.url;
}

/** 저장 문자열 배열 → 표시용 URL 배열(null 제거). 목록/상세 공용. */
export async function resolveCommunityImageUrls(
  supabase: SupabaseClient,
  stored: readonly (string | null | undefined)[]
): Promise<string[]> {
  const urls = await Promise.all(stored.map((s) => resolveCommunityImageUrl(supabase, s)));
  return urls.filter((u): u is string => typeof u === "string" && u.length > 0);
}
