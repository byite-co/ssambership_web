import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

import { validateMagicBytesForMime } from "@/lib/storage/uploadMagicBytes";

export const MENTOR_AVATAR_BUCKET = "profile-avatars";

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 5 * 1024 * 1024;

export const MENTOR_AVATAR_TYPE_ERROR = "JPG, PNG, WEBP 이미지만 올릴 수 있어요.";
export const MENTOR_AVATAR_SIZE_ERROR = "이미지는 최대 5MB까지 올릴 수 있어요.";

function extensionFor(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

export function buildMentorAvatarObjectPath(userId: string, mime: string): string {
  return `${userId}/${randomUUID()}.${extensionFor(mime)}`;
}

/**
 * 멘토 프로필 사진을 profile-avatars 버킷(public read)에 올리고 영구 public URL을 돌려준다.
 * community-post-images 업로드 흐름을 모델로 하되, 버킷이 public 이므로 signed 대신 getPublicUrl.
 */
export async function uploadMentorAvatar(
  supabase: SupabaseClient,
  userId: string,
  file: { buffer: Buffer; mime: string }
): Promise<{ url: string | null; path: string | null; error: string | null }> {
  if (!ALLOWED.has(file.mime)) {
    return { url: null, path: null, error: MENTOR_AVATAR_TYPE_ERROR };
  }
  if (file.buffer.length > MAX_BYTES) {
    return { url: null, path: null, error: MENTOR_AVATAR_SIZE_ERROR };
  }
  const magicError = validateMagicBytesForMime(file.buffer, file.mime);
  if (magicError) {
    return { url: null, path: null, error: magicError };
  }

  const path = buildMentorAvatarObjectPath(userId, file.mime);
  const { error } = await supabase.storage.from(MENTOR_AVATAR_BUCKET).upload(path, file.buffer, {
    contentType: file.mime,
    cacheControl: "3600",
    upsert: false,
  });
  if (error) {
    return { url: null, path: null, error: error.message };
  }

  const { data } = supabase.storage.from(MENTOR_AVATAR_BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, path, error: null };
}

/** public URL 또는 `bucket/path`/`path` 문자열에서 profile-avatars 객체 경로를 추출한다. */
function mentorAvatarObjectPath(urlOrPath: string | null | undefined): string | null {
  const raw = typeof urlOrPath === "string" ? urlOrPath.trim() : "";
  if (!raw) return null;
  const marker = `/${MENTOR_AVATAR_BUCKET}/`;
  const idx = raw.indexOf(marker);
  if (idx >= 0) {
    const p = raw.slice(idx + marker.length).split("?")[0]?.split("#")[0]?.trim() ?? "";
    return p || null;
  }
  // 이미 순수 경로(userId/uuid.ext)인 경우
  if (!raw.startsWith("http")) return raw.replace(/^\/+/, "") || null;
  return null;
}

/**
 * 멘토 아바타 객체를 삭제한다(고아·교체 구객체 보상용). profile-avatars 버킷만 대상.
 * 삭제 오류를 은폐하지 않고 { ok, error } 로 반환한다.
 */
export async function deleteMentorAvatarObject(
  supabase: SupabaseClient,
  urlOrPath: string | null | undefined
): Promise<{ ok: true } | { ok: false; error: string }> {
  const path = mentorAvatarObjectPath(urlOrPath);
  if (!path) return { ok: false, error: "invalid_avatar_ref" };
  const { error } = await supabase.storage.from(MENTOR_AVATAR_BUCKET).remove([path]);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
