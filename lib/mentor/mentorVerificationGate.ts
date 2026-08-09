import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchMentorProfileForPublicMentor, type PublicMentorProfileRow } from "@/lib/auth/mentorPublicRead";

export const MENTOR_ACTIVITY_APPROVED_STATUSES = new Set(["approved", "verified", "active"]);

export function mentorVerificationStatusAllowsActivity(status: unknown): boolean {
  if (typeof status !== "string") return false;
  return MENTOR_ACTIVITY_APPROVED_STATUSES.has(status.trim().toLowerCase());
}

/**
 * ok=true 는 뷰(mentor_directory_v1)에서 읽은 행(`profile`)을 함께 돌려준다.
 * C1(F0): 게이트 통과 직후 같은 멘토의 공개 필드(`is_open_for_subscriptions` 등)가 필요한
 * 호출부는 이 행을 재사용하라 — 별도 mentor_profiles 직접 조회는 학생 세션 RLS 에서 항상
 * 0행이라 fail-closed 오차단을 만든다(결제 경로 게이트 4가 그렇게 전 구독을 막고 있었다).
 */
export async function assertMentorApprovedForAction(
  supabase: SupabaseClient,
  mentorId: string
): Promise<
  | { ok: true; status: string; profile: PublicMentorProfileRow }
  | { ok: false; status: string | null; error: string }
> {
  const { row: data, error } = await fetchMentorProfileForPublicMentor(supabase, mentorId);

  if (error || !data) {
    return {
      ok: false,
      status: null,
      error: "멘토 인증 상태를 확인하지 못했습니다. 인증 완료 후 이용해 주세요.",
    };
  }

  const status = typeof data.verification_status === "string" ? data.verification_status : "";
  if (!mentorVerificationStatusAllowsActivity(status)) {
    return {
      ok: false,
      status,
      error: "관리자 승인 완료 후 이용할 수 있습니다. 현재 인증 검토 상태를 확인해 주세요.",
    };
  }

  return { ok: true, status, profile: data };
}
