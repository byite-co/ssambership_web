import type { SupabaseClient } from "@supabase/supabase-js";
import { callApiWebV1Rpc } from "@/lib/apiWebV1/rpc";

/**
 * 멘토 self "신규 구독 받기" flag (is_open_for_subscriptions 계열).
 * 읽기·쓰기 전용 헬퍼 — escrow/정산/cap 계산과 무관. 컬럼 쓰기 패턴은 mentorProfileMutations 와 동일하게
 * 여러 후보 컬럼을 순차 시도하고 missing-column 은 건너뛴다(스키마 유연).
 */

/**
 * 멘토가 신규 구독을 받는 중인지. 기본 OPEN(true) — 명시적 false 만 차단.
 * 읽기 실패/행 없음/컬럼 부재 시 안전하게 true(기존 동작 유지: 게이트가 막지 않음).
 */
export async function loadMentorSubscribeOpen(
  supabase: SupabaseClient,
  mentorId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("mentor_profiles")
    .select("*")
    .eq("user_id", mentorId)
    .maybeSingle();
  if (error || !data) return true;
  const row = data as Record<string, unknown>;
  for (const k of ["is_open_for_subscriptions", "accepts_subscriptions", "accept_subscriptions"] as const) {
    const v = row[k];
    if (v === false || v === 0 || v === "false") return false;
  }
  return true;
}

/**
 * S2-2 전환 W2(C6): 멘토 self 토글 — F7 `api_web_v1.mentor_profile_update_self` 사용.
 * F7 은 허용 9필드 전면 교체이므로 현재 행 값을 읽어 그대로 전달하고
 * `is_open_for_subscriptions` 만 바꾼다. 구 후보 컬럼 순차 UPDATE(직접 쓰기·프로빙)는
 * 제거했다(계약 §7 F7 · §17 #10 — mentor_profiles 직접 쓰기 0건 게이트).
 */
export async function setMentorSubscribeOpen(
  supabase: SupabaseClient,
  mentorId: string,
  open: boolean
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from("mentor_profiles")
    .select("university_name, department_name, high_school_name, teaching_subjects, intro_line, bio, answer_style, profile_image_url")
    .eq("user_id", mentorId)
    .maybeSingle();
  if (error || !data) {
    return { ok: false, error: "프로필 현재 값을 확인하지 못했어요. 잠시 후 다시 시도해 주세요." };
  }
  const row = data as Record<string, unknown>;
  const res = await callApiWebV1Rpc(supabase, "mentor_profile_update_self", {
    p_university_name: typeof row.university_name === "string" ? row.university_name : "",
    p_department_name: typeof row.department_name === "string" ? row.department_name : "",
    p_high_school_name: typeof row.high_school_name === "string" ? row.high_school_name : null,
    p_teaching_subjects: Array.isArray(row.teaching_subjects)
      ? (row.teaching_subjects as unknown[]).filter((s): s is string => typeof s === "string")
      : [],
    p_intro_line: typeof row.intro_line === "string" ? row.intro_line : null,
    p_bio: typeof row.bio === "string" ? row.bio : null,
    p_answer_style: typeof row.answer_style === "string" ? row.answer_style : null,
    p_profile_image_url: typeof row.profile_image_url === "string" ? row.profile_image_url : null,
    p_is_open_for_subscriptions: open,
  });
  if (!res.ok) {
    return { ok: false, error: "구독 받기 설정을 저장하지 못했어요." };
  }
  return { ok: true };
}
