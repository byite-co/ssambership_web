import "server-only";

import { createServiceRoleClient } from "@/lib/supabase/admin";
import { fetchWeeklyQuestionUsagePairParty } from "@/lib/qna/weeklyQuestionUsage";

export async function fetchWeeklyQuestionUsageServiceRole(
  studentId: string,
  mentorId: string
) {
  try {
    const admin = createServiceRoleClient();
    // service_role 경로 — 레거시 pair-party 함수 유지(M15 가드가 service_role 통과)
    const r = await fetchWeeklyQuestionUsagePairParty(admin, studentId, mentorId);
    return { usage: r.usage, error: r.error };
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return { usage: null, error: m };
  }
}
