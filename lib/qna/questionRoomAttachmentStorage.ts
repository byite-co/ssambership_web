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

/**
 * 첨부 v2 계약(§2-1): `question_attachments` 행이 첨부의 유일한 정본 — insert 는 필수.
 * 실패 시 호출측이 방금 올린 storage 객체를 정리(remove)하고 사용자에게 에러를 돌려준다.
 */
export async function insertQuestionAttachmentRecord(
  supabase: SupabaseClient,
  params: {
    threadId: string;
    messageId: string | null;
    authorId: string;
    storagePath: string;
    fileName: string | null;
    mimeType: string | null;
  }
): Promise<{ error: string | null }> {
  const { error } = await supabase.from("question_attachments").insert({
    thread_id: params.threadId,
    message_id: params.messageId,
    author_id: params.authorId,
    storage_path: params.storagePath,
    file_name: params.fileName,
    mime_type: params.mimeType,
  });
  return { error: error ? error.message : null };
}

/** 행 insert 실패 시 고아 객체 정리(best-effort — 실패해도 사용자 흐름은 막지 않음). */
export async function removeQuestionRoomAttachmentObjectBestEffort(
  supabase: SupabaseClient,
  storagePath: string
): Promise<void> {
  const { error } = await supabase.storage.from(QUESTION_ROOM_ATTACHMENTS_BUCKET).remove([storagePath]);
  if (error) {
    console.error("[removeQuestionRoomAttachmentObjectBestEffort]", error.message);
  }
}
