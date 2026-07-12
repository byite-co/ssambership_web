import type { SupabaseClient } from "@supabase/supabase-js";
import { createSignedStorageUrl } from "@/lib/storage/signedStorageUrl";
import { QUESTION_ROOM_ATTACHMENTS_BUCKET } from "@/lib/qna/questionRoomAttachmentStorage";
import type {
  AttachmentPreviewInfo,
  ThreadAttachmentView,
} from "@/lib/qna/questionRoomAttachmentView";

/**
 * 계약 §2-2: 서명 URL 은 표시 시점에 발급한다(SSR 재발급 → 만료 문제 구조적 소멸).
 * 질문방 전용 TTL 1h — 전역 기본 7일(signedStorageUrl)은 다른 도메인이 쓰므로 건드리지 않는다.
 */
export const QUESTION_ATTACHMENT_SIGNED_URL_TTL_SEC = 60 * 60;

type Row = Record<string, unknown>;

/**
 * 웹 <img> 로 직접 렌더 가능한 이미지 mime. HEIC/HEIF(앱 업로드 허용 포맷)는
 * 브라우저 미지원이 많아 파일 칩으로 강등한다(탭 → 다운로드) — 기획서 §6 확인 항목 처리.
 */
function isWebRenderableImageMime(mime: string | null): boolean {
  return typeof mime === "string" && /^image\/(png|jpe?g|webp|gif|avif)$/i.test(mime);
}

function rowStr(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function fileNameFromPath(storagePath: string): string {
  const tail = storagePath.split("/").pop() ?? storagePath;
  // 업로더 규약: `{uuid}-{name}`(웹) / `{ts}_{name}`(앱) — 접두를 벗겨 원 파일명에 근접.
  const m = tail.match(/^(?:[0-9a-fA-F-]{36}-|\d{10,}_)(.+)$/);
  return (m?.[1] ?? tail) || "첨부 파일";
}

function toPreviewInfo(row: Row): AttachmentPreviewInfo {
  const storagePath = rowStr(row.storage_path) ?? "";
  return {
    isImage: isWebRenderableImageMime(rowStr(row.mime_type)),
    fileName: rowStr(row.file_name) ?? fileNameFromPath(storagePath),
    createdAt: rowStr(row.created_at) ?? "",
  };
}

/**
 * 선택 스레드의 첨부 전체(시간 오름차순) + 표시용 서명 URL(1h) 발급.
 * 개별 서명 실패는 url=null 로 강등(파일명 칩 폴백) — 페이지 전체를 막지 않는다.
 */
export async function loadThreadAttachmentsWithUrls(
  supabase: SupabaseClient,
  threadId: string | null
): Promise<{ rows: ThreadAttachmentView[]; error: string | null }> {
  if (!threadId) return { rows: [], error: null };
  const { data, error } = await supabase
    .from("question_attachments")
    .select("id, thread_id, message_id, author_id, storage_path, file_name, mime_type, created_at")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true });
  if (error) return { rows: [], error: error.message };

  const rows = (data ?? []) as Row[];
  const views = await Promise.all(
    rows.map(async (row): Promise<ThreadAttachmentView | null> => {
      const id = row.id != null ? String(row.id) : null;
      const storagePath = rowStr(row.storage_path);
      if (!id || !storagePath) return null;
      const signed = await createSignedStorageUrl(
        supabase,
        QUESTION_ROOM_ATTACHMENTS_BUCKET,
        storagePath,
        QUESTION_ATTACHMENT_SIGNED_URL_TTL_SEC
      );
      const preview = toPreviewInfo(row);
      return {
        id,
        threadId: rowStr(row.thread_id) ?? threadId,
        messageId: rowStr(row.message_id),
        authorId: rowStr(row.author_id),
        url: signed.url,
        isImage: preview.isImage,
        fileName: preview.fileName,
        createdAt: preview.createdAt,
      };
    })
  );
  return { rows: views.filter((v): v is ThreadAttachmentView => v !== null), error: null };
}

/**
 * 목록 미리보기용: thread 별 마지막 첨부의 경량 정보(서명 발급 없음).
 * threadPreviewText 가 마지막 메시지와 시각 비교해 계약 §2-7 라벨을 결정한다.
 */
export async function loadLastAttachmentByThreadId(
  supabase: SupabaseClient,
  threadIds: string[]
): Promise<Record<string, AttachmentPreviewInfo>> {
  const out: Record<string, AttachmentPreviewInfo> = {};
  const ids = [...new Set(threadIds.filter((id) => id.length > 0))];
  if (ids.length === 0) return out;
  const { data, error } = await supabase
    .from("question_attachments")
    .select("thread_id, storage_path, file_name, mime_type, created_at")
    .in("thread_id", ids)
    .order("created_at", { ascending: true });
  if (error || !data) return out; // 미리보기는 best-effort — 실패 시 라벨 없이 진행.
  for (const row of data as Row[]) {
    const tid = rowStr(row.thread_id);
    if (tid) out[tid] = toPreviewInfo(row); // asc 순회 → 마지막 대입 = 최신.
  }
  return out;
}
