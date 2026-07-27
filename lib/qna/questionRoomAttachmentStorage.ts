import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { validateMagicBytesForMime } from "@/lib/storage/uploadMagicBytes";

export const QUESTION_ROOM_ATTACHMENTS_BUCKET = "question-room-attachments";

const ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
  "application/zip",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

const MAX_BYTES = 20 * 1024 * 1024;

function buildObjectPath(roomId: string, threadId: string, mime: string, originalName: string): string {
  const safe = originalName.replace(/[^\w.\-]+/g, "_").slice(0, 60) || "file";
  const hasExt = /\.[a-z0-9]{1,8}$/i.test(safe);
  const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : mime === "image/gif" ? "gif" : mime === "image/jpeg" ? "jpg" : "";
  const name = hasExt || !ext ? safe : `${safe}.${ext}`;
  return `${roomId}/${threadId}/${randomUUID()}-${name}`;
}

/**
 * 질문방 첨부를 private 버킷에 업로드. (서버 액션에서만 호출)
 * 첨부 v2 계약(§2): 서명 URL 을 여기서 발급·저장하지 않는다 — URL 은 표시 시점에
 * `questionRoomAttachmentsQueries` 가 1h TTL 로 발급한다.
 */
export async function uploadQuestionRoomAttachment(
  supabase: SupabaseClient,
  params: { roomId: string; threadId: string; buffer: Buffer; mime: string; name: string }
): Promise<{
  isImage: boolean;
  filename: string;
  storagePath: string | null;
  mime: string;
  error: string | null;
}> {
  const { roomId, threadId, buffer, mime, name } = params;
  const isImage = mime.startsWith("image/");
  if (!ALLOWED_MIME.has(mime)) {
    return { isImage, filename: name, storagePath: null, mime, error: "지원하지 않는 파일 형식입니다." };
  }
  if (buffer.length > MAX_BYTES) {
    return { isImage, filename: name, storagePath: null, mime, error: "파일은 20MB 이하로 올려주세요." };
  }
  const magicError = validateMagicBytesForMime(buffer, mime);
  if (magicError) {
    return { isImage, filename: name, storagePath: null, mime, error: magicError };
  }
  const path = buildObjectPath(roomId, threadId, mime, name);
  const { error: upErr } = await supabase.storage
    .from(QUESTION_ROOM_ATTACHMENTS_BUCKET)
    .upload(path, buffer, { contentType: mime, upsert: false });
  if (upErr) return { isImage, filename: name, storagePath: null, mime, error: upErr.message };
  return { isImage, filename: name, storagePath: path, mime, error: null };
}

// P1-8A: `question_attachments` 행 등록은 `qna_register_attachment` RPC 로 일원화(경로 thread-id 검증 +
//  멘토 첫 첨부 answered 전이 + exactly-once 알림 원자화). 구 직접 INSERT helper(insertQuestionAttachmentRecord)
//  는 제거됐다. 업로드/보상 삭제만 이 모듈이 담당한다.

/** 행 등록 실패 시 방금 올린 미등록 객체 정리(best-effort — 실패해도 사용자 흐름은 막지 않음). */
export async function removeQuestionRoomAttachmentObjectBestEffort(
  supabase: SupabaseClient,
  storagePath: string
): Promise<void> {
  const { error } = await supabase.storage.from(QUESTION_ROOM_ATTACHMENTS_BUCKET).remove([storagePath]);
  if (error) {
    console.error("[removeQuestionRoomAttachmentObjectBestEffort]", error.message);
  }
}
