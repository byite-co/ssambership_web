import "server-only";

import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSignedStorageUrl } from "@/lib/storage/signedStorageUrl";
import {
  JPG_PNG_PDF_EXTENSION_ERROR,
  normalizeJpgPngPdfExtension,
  validateJpgPngPdfMagicBytes,
  type JpgPngPdfKind,
} from "@/lib/storage/uploadMagicBytes";

export const INDIVIDUAL_QUESTION_ATTACHMENTS_BUCKET = "individual-question-attachments";

const MAX_BYTES = 20 * 1024 * 1024;

function fileExtension(name: string): string | null {
  const match = /\.([A-Za-z0-9]+)$/.exec(name.trim());
  return match?.[1]?.toLowerCase() ?? null;
}

function safeObjectName(name: string, extension: JpgPngPdfKind): string {
  const withoutExt = name.replace(/\.[^/.]+$/, "");
  const safe = withoutExt.replace(/[^\w.\-]+/g, "_").replace(/^\.+/, "").slice(0, 80) || "file";
  return `${safe}.${extension}`;
}

function buildObjectPath(questionId: string, extension: JpgPngPdfKind, originalName: string): string {
  return `${questionId}/${randomUUID()}-${safeObjectName(originalName, extension)}`;
}

export function fileHasContent(file: File | null | undefined): file is File {
  return Boolean(file && file.size > 0 && file.name);
}

export async function uploadIndividualQuestionAttachment(
  supabase: SupabaseClient,
  params: {
    questionId: string;
    messageId: string | null;
    // 상위 server action에서 requireRole/requireQnaActor로 인증된 actor uid.
    // service-role 클라이언트로는 auth.uid()를 복원할 수 없어 명시 전달이 정본이다.
    authorId: string;
    file: File;
  }
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  if (!params.authorId) {
    return { ok: false, error: "첨부 작성자 정보가 올바르지 않습니다. 다시 로그인해 주세요." };
  }
  const extension = fileExtension(params.file.name);
  if (!normalizeJpgPngPdfExtension(extension)) {
    return { ok: false, error: JPG_PNG_PDF_EXTENSION_ERROR };
  }
  if (params.file.size > MAX_BYTES) {
    return { ok: false, error: "첨부 파일은 20MB 이하로 올려 주세요." };
  }

  const bytes = await params.file.arrayBuffer();
  const verified = validateJpgPngPdfMagicBytes(bytes, extension);
  if (!verified.ok) {
    return { ok: false, error: verified.error };
  }

  const buffer = Buffer.from(bytes);
  const path = buildObjectPath(params.questionId, verified.file.extension, params.file.name);
  const { error: uploadError } = await supabase.storage
    .from(INDIVIDUAL_QUESTION_ATTACHMENTS_BUCKET)
    .upload(path, buffer, { contentType: verified.file.mimeType, upsert: false });

  if (uploadError) {
    return { ok: false, error: uploadError.message };
  }

  const { error: insertError } = await supabase.from("individual_question_attachments").insert({
    question_id: params.questionId,
    message_id: params.messageId,
    author_id: params.authorId,
    storage_path: path,
    file_name: params.file.name,
    mime_type: verified.file.mimeType,
  });

  if (insertError) {
    return { ok: false, error: insertError.message };
  }

  return { ok: true, path };
}

export async function signIndividualQuestionAttachment(
  supabase: SupabaseClient,
  storagePath: string
): Promise<string | null> {
  const signed = await createSignedStorageUrl(supabase, INDIVIDUAL_QUESTION_ATTACHMENTS_BUCKET, storagePath, 60 * 10);
  return signed.url;
}
