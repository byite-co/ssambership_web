import "server-only";

import { toAdminDisplayError } from "@/lib/admin/adminDisplayError";
import { ALREADY_PROCESSED_PARAM } from "@/lib/admin/mentorApprovalHold";
import { MENTOR_APPROVAL_BASE_PATH, MENTOR_APPROVAL_SELECTED_PARAM } from "@/lib/admin/mentorApprovalQueue";
import { describeMentorAlreadyProcessed } from "@/lib/admin/mentorApprovalWorkbenchQueries";
import { createClient } from "@/lib/supabase/server";

/**
 * 멘토 승인 화면 서버 액션들의 복귀 URL 빌더(PR-2b).
 *
 * - `?ok=<kind>` (+ `mentor=<id>` 면 그 지원자를 선택한 채 복귀 · 없으면 첫 대기 건 자동 선택 = 다음 건 이동)
 * - `?error=<안전 문구>` (+ `mentor`) — 원문은 `toAdminDisplayError` 로 걸러진다
 * - `?already=<09-03 14:20 박운영 승인>` (+ `mentor`) — `.in(...)` 게이트에 걸려 거절될 때 감사 로그에서 읽은 마지막 처리(§2-3)
 *
 * "use server" 파일에서는 액션 외 함수를 export 할 수 없으므로 여기(server-only)에 둔다.
 */

export type MentorApprovalOkKind = "approve" | "reject" | "documents" | "hold" | "hold-release" | "revoke" | "reject-revert";

function withMentor(q: URLSearchParams, mentorUserId?: string | null): string {
  if (mentorUserId) q.set(MENTOR_APPROVAL_SELECTED_PARAM, mentorUserId);
  return `${MENTOR_APPROVAL_BASE_PATH}?${q.toString()}`;
}

export function mentorApprovalOkUrl(kind: MentorApprovalOkKind, mentorUserId?: string | null): string {
  const q = new URLSearchParams();
  q.set("ok", kind);
  return withMentor(q, mentorUserId);
}

export function mentorApprovalErrorUrl(rawMessage: string, mentorUserId?: string | null): string {
  const q = new URLSearchParams();
  q.set("error", toAdminDisplayError(rawMessage, "mentorApprovals") ?? "처리에 실패했습니다. 잠시 후 다시 시도해 주세요.");
  return withMentor(q, mentorUserId);
}

/** 게이트 거절 → 마지막 처리를 읽어 `already` 로 싣는다. 기록이 없으면 일반 실패 문구. */
export async function mentorApprovalAlreadyProcessedUrl(mentorUserId: string): Promise<string> {
  const supabase = await createClient();
  const text = await describeMentorAlreadyProcessed(supabase, mentorUserId);
  if (!text) return mentorApprovalErrorUrl("이미 처리되었거나 처리할 수 없는 상태입니다.", mentorUserId);
  const q = new URLSearchParams();
  q.set(ALREADY_PROCESSED_PARAM, text);
  return withMentor(q, mentorUserId);
}
