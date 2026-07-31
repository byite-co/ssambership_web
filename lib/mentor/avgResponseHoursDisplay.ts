import type { SupabaseClient } from "@supabase/supabase-js";

/** mentor_profiles.avg_response_hours → 정책 버킷 표기 (12 / 24 / 48 / 48+) */
export function formatAvgResponseHoursLabel(hours: number | null | undefined): string {
  if (hours == null || !Number.isFinite(hours) || hours < 0) {
    return "—";
  }
  if (hours <= 12) return "12시간 이내";
  if (hours <= 24) return "24시간 이내";
  if (hours <= 48) return "48시간 이내";
  return "48시간 이상";
}

export function avgResponseHoursFromProfileRow(row: Record<string, unknown> | null): number | null {
  if (!row) return null;
  for (const key of ["avg_response_hours", "average_response_hours", "response_hours"] as const) {
    const v = row[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

/**
 * W4(C10): PGRST202/42883 등 스키마 부재 판정 regex 의 로그 억제 분기 제거 —
 * public.get_mentor_avg_response_hours 는 187 baseline 에 실존(pg_proc 실측)하므로 해당
 * 분기는 사문이었고, 실제 오류 로그만 삼켰다. 이제 모든 오류를 로깅한다.
 * 오류 시 null 반환은 표시 전용 degrade(응답 시간 라벨 '—' 표기)로 유지 — 성공 아님.
 */
export async function loadMentorAvgResponseHours(
  supabase: SupabaseClient,
  mentorId: string
): Promise<number | null> {
  const { data, error } = await supabase.rpc("get_mentor_avg_response_hours", { p_mentor_id: mentorId });
  if (error) {
    console.error("[loadMentorAvgResponseHours]", error.message);
    return null;
  }
  const value = typeof data === "number" ? data : Number(data);
  return Number.isFinite(value) ? value : null;
}
