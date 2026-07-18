import type { SupabaseClient } from "@supabase/supabase-js";
import { createSignedStorageUrl } from "@/lib/storage/signedStorageUrl";

export const STUDENT_ID_IMAGES_BUCKET = "student-id-images" as const;
export const STUDENT_ID_IMAGE_SIGNED_URL_TTL_SEC = 300;
export const STUDENT_ID_IMAGE_ALLOWED_EXTENSIONS = ["jpg", "jpeg", "png", "pdf"] as const;
export const STUDENT_ID_IMAGE_MAX_BYTES = 20 * 1024 * 1024;
export const STUDENT_ID_IMAGE_MAX_BYTES_LABEL = "20MB";
const SCHOOL_VERIFICATION_DIR = "school-verifications";
const ACADEMIC_RECORD_CHANGE_DIR = "academic-record-changes";

export type StudentIdImageAllowedExtension = (typeof STUDENT_ID_IMAGE_ALLOWED_EXTENSIONS)[number];

/** DB `mentor_profiles.student_id_image_url` 에 저장할 값 (버킷/경로만, 공개 URL 아님) */
export function formatStudentIdImageStoredRef(objectPath: string): string {
  const p = objectPath.replace(/^\/+/, "");
  if (p.startsWith(`${STUDENT_ID_IMAGES_BUCKET}/`)) {
    return p;
  }
  return `${STUDENT_ID_IMAGES_BUCKET}/${p}`;
}

export function safeStudentIdImageFileExtension(fileName: string): StudentIdImageAllowedExtension | null {
  const match = /\.([A-Za-z0-9]+)$/.exec(fileName.trim());
  const ext = match?.[1]?.toLowerCase();
  return STUDENT_ID_IMAGE_ALLOWED_EXTENSIONS.includes(ext as StudentIdImageAllowedExtension)
    ? (ext as StudentIdImageAllowedExtension)
    : null;
}

function randomStorageToken(): string {
  const randomUuid =
    typeof globalThis.crypto?.randomUUID === "function" ? globalThis.crypto.randomUUID().replace(/-/g, "") : "";
  if (randomUuid) return randomUuid;
  return Math.random().toString(36).slice(2, 14);
}

function buildSafeStorageFileName(fileName: string): string {
  const ext = safeStudentIdImageFileExtension(fileName) ?? "bin";
  return `${Date.now()}-${randomStorageToken()}.${ext}`;
}

/** 업로드 객체 경로: `{userId}/{timestamp-random.ext}` */
export function buildStudentIdImageObjectPath(userId: string, fileName: string): string {
  return `${userId}/${buildSafeStorageFileName(fileName)}`;
}

/** 학교·전공 증명 서류 업로드 경로: `{userId}/school-verifications/{timestamp-random.ext}` */
export function buildMentorSchoolVerificationObjectPath(userId: string, fileName: string): string {
  return `${userId}/${SCHOOL_VERIFICATION_DIR}/${buildSafeStorageFileName(fileName)}`;
}

/** 학적변경 증명 서류 업로드 경로: `{userId}/academic-record-changes/{timestamp-random.ext}` */
export function buildMentorAcademicRecordChangeObjectPath(userId: string, fileName: string): string {
  return `${userId}/${ACADEMIC_RECORD_CHANGE_DIR}/${buildSafeStorageFileName(fileName)}`;
}

/**
 * 저장값(경로 또는 레거시 public URL) → 버킷·객체 경로.
 * 레거시 URL은 `.../student-id-images/{path}` 패턴만 복원한다.
 */
export function parseStudentIdImageStorageRef(
  stored: string | null | undefined
): { bucket: string; path: string } | null {
  const raw = typeof stored === "string" ? stored.trim() : "";
  if (!raw) return null;

  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    const marker = `/${STUDENT_ID_IMAGES_BUCKET}/`;
    const idx = raw.indexOf(marker);
    if (idx < 0) return null;
    const path = raw.slice(idx + marker.length).split("?")[0]?.split("#")[0]?.trim() ?? "";
    return path ? { bucket: STUDENT_ID_IMAGES_BUCKET, path } : null;
  }

  if (raw.startsWith(`${STUDENT_ID_IMAGES_BUCKET}/`)) {
    const path = raw.slice(STUDENT_ID_IMAGES_BUCKET.length + 1).replace(/^\/+/, "");
    return path ? { bucket: STUDENT_ID_IMAGES_BUCKET, path } : null;
  }

  if (raw.includes("/")) {
    return { bucket: STUDENT_ID_IMAGES_BUCKET, path: raw.replace(/^\/+/, "") };
  }

  return null;
}

/** 관리자 조회: 저장 path 기준 단기 signed URL (기본 300초) */
export async function resolveStudentIdImageSignedUrl(
  supabase: SupabaseClient,
  stored: string | null | undefined,
  expiresInSec = STUDENT_ID_IMAGE_SIGNED_URL_TTL_SEC
): Promise<string | null> {
  const ref = parseStudentIdImageStorageRef(stored);
  if (!ref) return null;
  const { url, error } = await createSignedStorageUrl(supabase, ref.bucket, ref.path, expiresInSec);
  if (error) {
    console.error("[resolveStudentIdImageSignedUrl]", error);
    return null;
  }
  return url;
}
