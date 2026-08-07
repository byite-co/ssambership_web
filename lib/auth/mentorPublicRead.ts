import type { SupabaseClient } from "@supabase/supabase-js";
import { rowsFromSupabaseData } from "@/lib/qna/safeSelect";
import { API_WEB_V1_SCHEMA } from "@/lib/apiWebV1/rpc";
import type { UserRow } from "@/lib/types/user";

/**
 * S2-2 전환 W1(C1): 공개 멘토 읽기 — V3 `api_web_v1.mentor_directory_v1` 단일 view.
 * 정본: 계약 §6 V3 (§17 #9 — 구 RPC 3종 `mentor_directory_list_v2` /
 * `mentor_profiles_for_directory_v2` / `mentor_user_public_v2` 를 1 view 로 대체).
 *
 * - V3 노출 조건이 곧 승인 판정이다: `users.role='mentor'` AND active AND
 *   `verification_status ∈ (approved, verified, active)` —
 *   `individual_question_user_is_approved_mentor` 와 동일 판정식. 따라서
 *   V3 에 행이 있으면 승인·활성 멘토이고, 없으면 미승인·비활성·부재다.
 * - PII: `nickname` 만 노출된다(`full_name`·`email`·`birth_date` 비노출 — §6 V3).
 *   기존 UserRow adapter 는 full_name 을 null 로 채운다.
 * - 실패 시 구 RPC 로 되돌아가는 fallback 은 없다(W1 지시 §4).
 */

export type PublicMentorProfileRow = {
  user_id: string;
  university_name: string | null;
  department_name: string | null;
  teaching_subjects: string[] | null;
  intro_line: string | null;
  verification_status: string | null;
  created_at: string | null;
  verified_university_name: string | null;
  verified_department_name: string | null;
  verified_major_category: string | null;
  school_tier: string | null;
  school_verified: boolean;
  high_school_name: string | null;
  profile_image_url: string | null;
  is_open_for_subscriptions: boolean;
  avg_rating: number | null;
  review_count: number | null;
  [key: string]: unknown;
};

type ViewError = { message?: string; code?: string; details?: string; hint?: string };

function viewErrorMessage(error: ViewError): string {
  const parts = [error.message, error.details, error.hint].filter(Boolean);
  return parts.join(" ");
}

/** V3 행 → 기존 UserRow adapter — V3 노출 조건상 role=mentor·status=active 확정값. */
function mapDirectoryRowToUserRow(row: Record<string, unknown>): UserRow {
  const createdAt = String(row.created_at ?? new Date().toISOString());
  return {
    id: String(row.mentor_id),
    role: "mentor",
    status: "active",
    full_name: null,
    nickname: (row.nickname as string | null) ?? null,
    email: null,
    grade_level: null,
    student_status: null,
    birth_date: null,
    terms_agreed_at: null,
    privacy_agreed_at: null,
    marketing_agreed: false,
    created_at: createdAt,
    updated_at: createdAt,
  };
}

/** V3 행 → 기존 프로필 행 adapter — 행 존재 = 승인 판정식 통과(§6 V3 노출 조건). */
function mapDirectoryRowToProfileRow(row: Record<string, unknown>): PublicMentorProfileRow | null {
  if (row.mentor_id == null) return null;
  return {
    user_id: String(row.mentor_id),
    university_name: (row.university_name as string | null) ?? null,
    department_name: (row.department_name as string | null) ?? null,
    teaching_subjects: Array.isArray(row.teaching_subjects)
      ? row.teaching_subjects.filter((subject): subject is string => typeof subject === "string")
      : null,
    intro_line: (row.intro_line as string | null) ?? null,
    // D-ST-10 계약: 이 값은 독립 심사 결과가 아니라 **view 불변식의 반영**이다.
    // api_web_v1.mentor_directory_v1 의 WHERE 가 이미 verification_status ∈ (approved,
    // verified, active) 로 필터하므로, 이 함수가 반환하는 행은 정의상 승인 멘토뿐이다.
    // 따라서 downstream mentorVerificationStatusAllowsActivity·assertMentorApprovedForAction
    // 은 이 상수에 대해 항상 참을 돌려주는 **방어적 이중화**이지 별도 게이트가 아니다.
    // 실차단은 view 의 WHERE 가 담당 — 그 계약은 __contract__/mentorDirectoryView 가 감시한다.
    verification_status: "approved",
    created_at: row.created_at == null ? null : String(row.created_at),
    verified_university_name: (row.verified_university_name as string | null) ?? null,
    verified_department_name: (row.verified_department_name as string | null) ?? null,
    verified_major_category: (row.verified_major_category as string | null) ?? null,
    school_tier: (row.school_tier as string | null) ?? null,
    school_verified: Boolean(row.school_verified),
    high_school_name: (row.high_school_name as string | null) ?? null,
    profile_image_url: (row.profile_image_url as string | null) ?? null,
    is_open_for_subscriptions: row.is_open_for_subscriptions !== false,
    avg_rating: typeof row.avg_rating === "number" ? row.avg_rating : row.avg_rating == null ? null : Number(row.avg_rating),
    review_count: typeof row.review_count === "number" ? row.review_count : row.review_count == null ? null : Number(row.review_count),
  };
}

function directoryView(supabase: SupabaseClient) {
  return supabase.schema(API_WEB_V1_SCHEMA).from("mentor_directory_v1");
}

export async function loadMentorDirectoryUserRows(
  supabase: SupabaseClient,
  pLimit: number
): Promise<{ users: UserRow[]; error: string | null; usedRpc: boolean; probe: string }> {
  const { data, error } = await directoryView(supabase)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(pLimit);
  if (error) {
    console.error("[mentors] mentor_directory_v1 read failed", {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint,
      supabaseUrlExists: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL),
    });
    return {
      users: [],
      error: viewErrorMessage(error) || "mentor_directory_v1 failed",
      usedRpc: false,
      probe: "api_web_v1.mentor_directory_v1: " + error.message,
    };
  }
  const rows = rowsFromSupabaseData(data);
  return {
    users: rows.map((row) => mapDirectoryRowToUserRow(row)),
    error: null,
    usedRpc: false,
    probe: "api_web_v1.mentor_directory_v1(V3)",
  };
}

export async function loadMentorProfilesForDirectory(
  supabase: SupabaseClient,
  ids: string[]
): Promise<{ byUser: Map<string, PublicMentorProfileRow>; error: string | null; probe: string }> {
  const byUser = new Map<string, PublicMentorProfileRow>();
  if (ids.length === 0) {
    return { byUser, error: null, probe: "skip" };
  }

  const { data, error } = await directoryView(supabase).select("*").in("mentor_id", ids);
  if (error) {
    console.error("[mentors] mentor_directory_v1 read failed", {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint,
      supabaseUrlExists: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL),
    });
    return {
      byUser,
      error: viewErrorMessage(error) || "mentor_directory_v1 failed",
      probe: "api_web_v1.mentor_directory_v1: " + error.message,
    };
  }

  for (const row of rowsFromSupabaseData(data)) {
    const profile = mapDirectoryRowToProfileRow(row);
    if (profile) byUser.set(profile.user_id, profile);
  }
  return { byUser, error: null, probe: "api_web_v1.mentor_directory_v1(V3)" };
}

export async function getMentorUserPublic(
  supabase: SupabaseClient,
  mentorId: string
): Promise<{ data: UserRow | null; error: Error | null }> {
  const { data, error } = await directoryView(supabase)
    .select("*")
    .eq("mentor_id", mentorId)
    .maybeSingle();
  if (error) {
    return { data: null, error: new Error(viewErrorMessage(error) || "mentor_directory_v1 failed") };
  }
  const row = data as Record<string, unknown> | null;
  return { data: row ? mapDirectoryRowToUserRow(row) : null, error: null };
}

export async function fetchMentorProfileForPublicMentor(
  supabase: SupabaseClient,
  mentorId: string
): Promise<{ row: PublicMentorProfileRow | null; error: string | null }> {
  const batch = await loadMentorProfilesForDirectory(supabase, [mentorId]);
  if (batch.error) {
    return { row: null, error: batch.error };
  }
  return { row: batch.byUser.get(mentorId) ?? null, error: null };
}
