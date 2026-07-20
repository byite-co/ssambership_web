import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import {
  SHORTFORM_THUMB_BUCKET,
  SHORTFORM_VIDEO_BUCKET,
  SHORTFORM_VIDEO_MAX_BYTES,
} from "@/lib/community/communityShortformConstants";
import { createSignedStorageUrl } from "@/lib/storage/signedStorageUrl";
import { validateMagicBytesForMime } from "@/lib/storage/uploadMagicBytes";
import {
  SHORTFORM_VIDEO_MIME,
  shortformVideoExtForMime,
  shortformVideoRefBelongsToUser,
} from "@/lib/community/shortformVideoRef";

export { shortformVideoRefBelongsToUser };

function formatStorageRef(bucket: string, path: string): string {
  return `${bucket}/${path.replace(/^\/+/, "")}`;
}

function parseStorageRef(stored: string | null | undefined, bucket: string): { bucket: string; path: string } | null {
  const raw = typeof stored === "string" ? stored.trim() : "";
  if (!raw) return null;

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

  if (raw.includes("/")) {
    return { bucket, path: raw.replace(/^\/+/, "") };
  }

  return null;
}

async function resolveShortformStorageUrl(
  supabase: SupabaseClient,
  stored: string | null | undefined,
  bucket: string
): Promise<string | null> {
  const raw = typeof stored === "string" ? stored.trim() : "";
  if (!raw) return null;
  const ref = parseStorageRef(raw, bucket);
  if (!ref) return raw.startsWith("http://") || raw.startsWith("https://") ? raw : null;

  const signed = await createSignedStorageUrl(supabase, ref.bucket, ref.path);
  if (signed.error || !signed.url) return null;
  return signed.url;
}

export function formatShortformVideoStoredRef(path: string): string {
  return formatStorageRef(SHORTFORM_VIDEO_BUCKET, path);
}

export function formatShortformThumbnailStoredRef(path: string): string {
  return formatStorageRef(SHORTFORM_THUMB_BUCKET, path);
}

export function isShortformStoredVideoRef(value: string | null | undefined): boolean {
  return parseStorageRef(value, SHORTFORM_VIDEO_BUCKET) != null;
}

export function isShortformStoredThumbnailRef(value: string | null | undefined): boolean {
  return parseStorageRef(value, SHORTFORM_THUMB_BUCKET) != null;
}

/**
 * 저장된 숏폼 video ref 를 Storage 에서 삭제한다(고아·교체 구파일 보상용).
 * - parseStorageRef 로 검증해 `shortform-videos` 버킷 형식이 아니면 삭제하지 않는다(임의 ref 삭제 방지).
 * - 삭제 오류를 조용히 삼키지 않고 { ok, error } 로 반환 → 호출자가 primary DB 오류와 함께 기록한다.
 */
export async function deleteShortformVideoStoredRef(
  supabase: SupabaseClient,
  storedRef: string | null | undefined
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ref = parseStorageRef(storedRef, SHORTFORM_VIDEO_BUCKET);
  if (!ref) return { ok: false, error: "invalid_ref" };
  const { error } = await supabase.storage.from(ref.bucket).remove([ref.path]);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export function resolveShortformVideoUrl(
  supabase: SupabaseClient,
  stored: string | null | undefined
): Promise<string | null> {
  return resolveShortformStorageUrl(supabase, stored, SHORTFORM_VIDEO_BUCKET);
}

export function resolveShortformThumbnailUrl(
  supabase: SupabaseClient,
  stored: string | null | undefined
): Promise<string | null> {
  return resolveShortformStorageUrl(supabase, stored, SHORTFORM_THUMB_BUCKET);
}

export async function uploadShortformVideo(
  supabase: SupabaseClient,
  userId: string,
  buffer: Buffer,
  mime: string
): Promise<{ url: string | null; error: string | null }> {
  const normalizedMime = mime.trim().toLowerCase();
  if (!SHORTFORM_VIDEO_MIME.has(normalizedMime)) {
    return { url: null, error: "type" };
  }
  if (buffer.length > SHORTFORM_VIDEO_MAX_BYTES) {
    return { url: null, error: "size" };
  }
  const magicError = validateMagicBytesForMime(buffer, normalizedMime);
  if (magicError) {
    return { url: null, error: "type" };
  }
  const ext = shortformVideoExtForMime(normalizedMime);
  const path = `${userId}/${randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(SHORTFORM_VIDEO_BUCKET).upload(path, buffer, {
    contentType: normalizedMime,
    upsert: false,
  });
  if (error) return { url: null, error: error.message };
  return { url: formatShortformVideoStoredRef(path), error: null };
}

/**
 * 숏폼 영상 직접 업로드용 서명 티켓 발급(413 회피). 서버가 `{userId}/{uuid}.{ext}` 경로를 만들고
 * 서명 URL·token 을 반환하면, 브라우저가 uploadToSignedUrl 로 Storage 에 직접 올린다(액션 body 미경유).
 * 호출자(액션)가 멘토·계정활성·본인 userId 를 강제한 뒤 호출한다. 서명은 service-role 권장(경로는 서버 통제).
 */
export async function createShortformVideoUploadTicket(
  supabase: SupabaseClient,
  userId: string,
  mime: string
): Promise<
  | { ok: true; path: string; token: string; ref: string }
  | { ok: false; error: "type" | "sign" }
> {
  const normalizedMime = mime.trim().toLowerCase();
  if (!SHORTFORM_VIDEO_MIME.has(normalizedMime)) return { ok: false, error: "type" };
  const path = `${userId}/${randomUUID()}.${shortformVideoExtForMime(normalizedMime)}`;
  const { data, error } = await supabase.storage.from(SHORTFORM_VIDEO_BUCKET).createSignedUploadUrl(path);
  if (error || !data?.token) return { ok: false, error: "sign" };
  return { ok: true, path, token: data.token, ref: formatShortformVideoStoredRef(path) };
}

export async function uploadShortformThumbnail(
  supabase: SupabaseClient,
  userId: string,
  buffer: Buffer,
  mime: string
): Promise<{ url: string | null; error: string | null }> {
  const normalizedMime = mime.trim().toLowerCase();
  const magicError = validateMagicBytesForMime(buffer, normalizedMime);
  if (magicError) {
    return { url: null, error: "type" };
  }
  const ext = normalizedMime.includes("png") ? "png" : normalizedMime.includes("webp") ? "webp" : "jpg";
  const path = `${userId}/${randomUUID()}-thumb.${ext}`;
  const { error } = await supabase.storage.from(SHORTFORM_THUMB_BUCKET).upload(path, buffer, {
    contentType: normalizedMime,
    upsert: false,
  });
  if (error) return { url: null, error: error.message };
  return { url: formatShortformThumbnailStoredRef(path), error: null };
}
