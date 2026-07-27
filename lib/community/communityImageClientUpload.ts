// 커뮤니티 이미지 클라이언트 직접 업로드(staged) — 브라우저에서 Supabase Storage 로 바로 올린다.
// Server Action body 로 대용량 파일을 전달하지 않아 413(1MB body 한도)을 회피한다.
// RLS(cpi_auth_insert_own): `{userId}/...` 경로 = auth.uid() 본인만 INSERT 허용.
// 성공하면 `community-post-images/{path}` ref 를 반환하고, finalize action 에는 ref(텍스트)만 넘긴다.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  COMMUNITY_IMAGE_ALLOWED_MIME,
  COMMUNITY_POST_IMAGES_BUCKET,
  buildCommunityImageObjectPathWithId,
  formatCommunityImageStoredRef,
} from "@/lib/community/communityImageRef";

export const COMMUNITY_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

function newUuid(): string {
  // 브라우저 crypto.randomUUID (안전 컨텍스트) — node crypto 미의존.
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  // 극히 드문 폴백(구형): 충돌 가능성 무시할 정도의 랜덤.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function validateCommunityImageFile(file: File): string | null {
  if (!COMMUNITY_IMAGE_ALLOWED_MIME.has(file.type)) return "지원하지 않는 이미지 형식입니다.";
  if (file.size > COMMUNITY_IMAGE_MAX_BYTES) return "이미지는 장당 5MB 이하로 올려주세요.";
  return null;
}

export type CommunityImageUploadResult =
  | { ok: true; refs: string[] }
  | { ok: false; error: string; uploadedRefs: string[] };

/**
 * 파일들을 순차로 직접 업로드한다. 하나라도 실패하면 그때까지 올린 객체를 즉시 보상 삭제하고
 * 실패를 반환한다(부분 고아 방지). 성공 시 저장용 ref 배열 반환.
 */
export async function uploadCommunityImagesFromBrowser(
  supabase: SupabaseClient,
  userId: string,
  files: readonly File[],
): Promise<CommunityImageUploadResult> {
  const uploadedPaths: string[] = [];
  const refs: string[] = [];
  for (const file of files) {
    const invalid = validateCommunityImageFile(file);
    if (invalid) {
      await compensate(supabase, uploadedPaths);
      return { ok: false, error: invalid, uploadedRefs: [] };
    }
    const path = buildCommunityImageObjectPathWithId(userId, file.type, file.name || "image", newUuid());
    const { error } = await supabase.storage
      .from(COMMUNITY_POST_IMAGES_BUCKET)
      .upload(path, file, { contentType: file.type, upsert: false });
    if (error) {
      await compensate(supabase, uploadedPaths);
      return { ok: false, error: "이미지 업로드에 실패했어요. 다시 시도해 주세요.", uploadedRefs: [] };
    }
    uploadedPaths.push(path);
    refs.push(formatCommunityImageStoredRef(path));
  }
  return { ok: true, refs };
}

async function compensate(supabase: SupabaseClient, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  try {
    await supabase.storage.from(COMMUNITY_POST_IMAGES_BUCKET).remove(paths);
  } catch {
    /* 보상 삭제 실패는 표면 오류를 가리지 않는다(다음 정리 배치·RLS 소유자 삭제로 회수). */
  }
}
