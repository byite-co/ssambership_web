import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSignedStorageUrl } from "@/lib/storage/signedStorageUrl";
import {
  parseStudentIdImageStorageRef,
  STUDENT_ID_IMAGE_SIGNED_URL_TTL_SEC,
} from "@/lib/storage/studentIdImageStorage";
import { classifyDocumentKind, type DocumentViewerSource } from "@/lib/admin/documentViewerModel";

/**
 * 서류 뷰어용 서버 조회 — 컬럼값(버킷명 포함 경로) → 서명 URL + 스토리지 메타데이터(mimetype·size).
 *
 * - 경로에서 버킷 접두를 벗겨 `.from('student-id-images').createSignedUrl()` 에 넘긴다(§3).
 * - mimetype·크기는 Storage `list(dir, { search: fileName })` 의 `metadata` 에서 읽는다. 실패하면 확장자 판정으로 폴백
 *   (뷰어가 빈 화면이 되지 않게 — 메타 조회 실패는 서명 URL 발급을 막지 않는다).
 * - 반환값에 경로 원문·토큰 이외의 민감 정보는 없다. 오류 문구는 운영자용 안내만.
 */
const METADATA_LIST_LIMIT = 50;

type StorageListItem = {
  name?: string | null;
  metadata?: { mimetype?: unknown; size?: unknown; contentLength?: unknown } | null;
};

function splitPath(path: string): { dir: string; fileName: string } {
  const idx = path.lastIndexOf("/");
  if (idx < 0) return { dir: "", fileName: path };
  return { dir: path.slice(0, idx), fileName: path.slice(idx + 1) };
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}

async function readStorageMetadata(
  db: SupabaseClient,
  bucket: string,
  path: string
): Promise<{ mimeType: string | null; sizeBytes: number | null }> {
  const { dir, fileName } = splitPath(path);
  try {
    const { data, error } = await db.storage.from(bucket).list(dir, { limit: METADATA_LIST_LIMIT, search: fileName });
    if (error || !Array.isArray(data)) {
      if (error) console.error("[describeStudentIdDocument] metadata list 실패:", error.message);
      return { mimeType: null, sizeBytes: null };
    }
    const hit = (data as StorageListItem[]).find((item) => item.name === fileName) ?? null;
    const meta = hit?.metadata ?? null;
    const mimeType = typeof meta?.mimetype === "string" && meta.mimetype.trim() ? meta.mimetype.trim() : null;
    const sizeBytes = toNumber(meta?.size) ?? toNumber(meta?.contentLength);
    return { mimeType, sizeBytes };
  } catch (e) {
    console.error("[describeStudentIdDocument] metadata 예외:", e instanceof Error ? e.message : String(e));
    return { mimeType: null, sizeBytes: null };
  }
}

/** 컬럼값 → 뷰어 소스. 파싱 불가·발급 실패도 throw 하지 않고 `error` 로 돌려준다. */
export async function describeStudentIdDocument(db: SupabaseClient, storedRef: string): Promise<DocumentViewerSource> {
  const ref = parseStudentIdImageStorageRef(storedRef);
  if (!ref) {
    return {
      storedRef,
      storagePath: null,
      signedUrl: null,
      mimeType: null,
      sizeBytes: null,
      kind: "unknown",
      expiresAt: null,
      error: "서류 경로를 해석할 수 없습니다. 저장값 형식을 확인해 주세요.",
    };
  }

  // 만료 시각은 발급 요청 **전** 시각 기준으로 잡아 보수적으로 계산한다.
  const issuedAt = Date.now();
  const [meta, signed] = await Promise.all([
    readStorageMetadata(db, ref.bucket, ref.path),
    createSignedStorageUrl(db, ref.bucket, ref.path, STUDENT_ID_IMAGE_SIGNED_URL_TTL_SEC),
  ]);
  if (signed.error) console.error("[describeStudentIdDocument] signed url 실패:", signed.error);

  return {
    storedRef,
    storagePath: ref.path,
    signedUrl: signed.url,
    mimeType: meta.mimeType,
    sizeBytes: meta.sizeBytes,
    kind: classifyDocumentKind(meta.mimeType, ref.path),
    expiresAt: signed.url ? issuedAt + STUDENT_ID_IMAGE_SIGNED_URL_TTL_SEC * 1000 : null,
    error: signed.url ? null : "서류 링크를 발급하지 못했습니다. 다시 시도해 주세요.",
  };
}
