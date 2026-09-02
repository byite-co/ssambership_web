"use server";

import { requireRole } from "@/lib/auth/routeGuard";
import { createClient } from "@/lib/supabase/server";
import { mentorProfilesAdminReadClient } from "@/lib/admin/mentorProfilesAdminRead";
import { describeStudentIdDocument } from "@/lib/admin/mentorApprovalDocuments";
import type { DocumentViewerSource } from "@/lib/admin/documentViewerModel";

/**
 * 서류 뷰어의 서명 URL 재요청(만료·실패 재시도) — 클라이언트 `DocumentViewer` 가 호출한다.
 * 읽기 전용(서명 URL 발급 + 메타 조회). DB 쓰기 없음.
 */
export async function refreshStudentIdDocumentAction(storedRef: string): Promise<DocumentViewerSource> {
  await requireRole("admin");
  const ref = typeof storedRef === "string" ? storedRef.trim() : "";
  if (!ref) {
    return {
      storedRef: "",
      storagePath: null,
      signedUrl: null,
      mimeType: null,
      sizeBytes: null,
      kind: "unknown",
      expiresAt: null,
      error: "서류 경로가 비어 있습니다.",
    };
  }
  const supabase = await createClient();
  return describeStudentIdDocument(mentorProfilesAdminReadClient(supabase), ref);
}
