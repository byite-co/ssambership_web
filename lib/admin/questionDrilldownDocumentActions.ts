"use server";

import { requireRole } from "@/lib/auth/routeGuard";
import type { DocumentViewerSource } from "@/lib/admin/documentViewerModel";
import { describeQuestionAttachmentDocument, serviceRoleOrNull } from "@/lib/admin/questionDrilldownQueries";

/**
 * 질문 첨부·필기 주석 뷰어의 서명 URL 재요청(만료·실패 재시도) — 클라이언트 `DocumentViewer` 가 `refreshSource` 로 호출한다(PR-8).
 * 읽기 전용(서명 URL 발급 + 스토리지 메타 조회). DB 쓰기 없음. 버킷은 `parseQuestionAttachmentStoredRef` 의 허용 3종만.
 */
export async function refreshQuestionAttachmentDocumentAction(storedRef: string): Promise<DocumentViewerSource> {
  await requireRole("admin");
  const ref = typeof storedRef === "string" ? storedRef.trim() : "";
  const empty = (error: string): DocumentViewerSource => ({
    storedRef: ref,
    storagePath: null,
    signedUrl: null,
    mimeType: null,
    sizeBytes: null,
    kind: "unknown",
    expiresAt: null,
    error,
  });
  if (!ref) return empty("첨부 경로가 비어 있습니다.");
  const db = serviceRoleOrNull();
  if (!db) return empty("서비스 키가 없어 첨부 링크를 발급할 수 없습니다.");
  return describeQuestionAttachmentDocument(db, ref);
}
