import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchMentorProfileForPublicMentor } from "@/lib/auth/mentorPublicRead";

export const MENTOR_ACTIVITY_APPROVED_STATUSES = new Set(["approved", "verified", "active"]);

export function mentorVerificationStatusAllowsActivity(status: unknown): boolean {
  if (typeof status !== "string") return false;
  return MENTOR_ACTIVITY_APPROVED_STATUSES.has(status.trim().toLowerCase());
}

export async function assertMentorApprovedForAction(
  supabase: SupabaseClient,
  mentorId: string
): Promise<{ ok: true; status: string } | { ok: false; status: string | null; error: string }> {
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

  return { ok: true, status };
}
