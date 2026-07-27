import type { SupabaseClient } from "@supabase/supabase-js";
import { createSignedStorageUrl } from "@/lib/storage/signedStorageUrl";
import {
  COMMUNITY_POST_IMAGES_BUCKET,
  formatCommunityImageStoredRef,
  parseCommunityImageRef,
} from "@/lib/community/communityImageRef";

export { formatCommunityImageStoredRef, parseCommunityImageRef };

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

// formatCommunityImageStoredRef / parseCommunityImageRef 는 lib/community/communityImageRef.ts
// (순수·공용)로 이동해 위에서 re-export 한다. 클라 직접 업로드·서버 소유권 검증과 한 소스를 공유.

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

/**
 * 저장된 커뮤니티 이미지 ref 들을 Storage 에서 삭제한다(고아·교체 구이미지 보상용).
 *  - parseCommunityImageRef 로 `community-post-images` 버킷 형식만 대상(임의 버킷/ref 삭제 방지).
 *  - 파싱 불가(빈 값·레거시 http 원문 등)는 건너뛴다 → 삭제하지 않는다.
 *  - 삭제 오류를 조용히 삼키지 않고 { ok, error, failed } 로 반환해 호출자가 primary 오류와 함께 기록한다.
 */
export async function deleteCommunityImageStoredRefs(
  supabase: SupabaseClient,
  storedRefs: readonly (string | null | undefined)[]
): Promise<{ ok: true } | { ok: false; error: string; failed: string[] }> {
  const paths: string[] = [];
  for (const s of storedRefs) {
    const ref = parseCommunityImageRef(s);
    if (ref) paths.push(ref.path);
  }
  if (paths.length === 0) return { ok: true };
  const { error } = await supabase.storage.from(COMMUNITY_POST_IMAGES_BUCKET).remove(paths);
  if (error) return { ok: false, error: error.message, failed: paths };
  return { ok: true };
}
