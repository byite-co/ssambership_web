import type { SupabaseClient } from "@supabase/supabase-js";
import { rowsFromSupabaseData } from "@/lib/qna/safeSelect";
import type { AppRole, UserRow } from "@/lib/types/user";

type RpcError = { message?: string; code?: string; details?: string; hint?: string };

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
  [key: string]: unknown;
};

function rpcErrorMessage(error: RpcError): string {
  const parts = [error.message, error.details, error.hint].filter(Boolean);
  return parts.join(" ");
}

function mapRpcUserToUserRow(row: Record<string, unknown>): UserRow {
  const createdAt = String(row.created_at ?? new Date().toISOString());
  return {
    id: String(row.id),
    role: (row.role as AppRole) ?? "mentor",
    status: String(row.status ?? "active"),
    full_name: (row.full_name as string | null) ?? null,
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

function mapRpcProfileRow(row: Record<string, unknown>): PublicMentorProfileRow | null {
  if (row.user_id == null) return null;
  return {
    user_id: String(row.user_id),
    university_name: (row.university_name as string | null) ?? null,
    department_name: (row.department_name as string | null) ?? null,
    teaching_subjects: Array.isArray(row.teaching_subjects)
      ? row.teaching_subjects.filter((subject): subject is string => typeof subject === "string")
      : null,
    intro_line: (row.intro_line as string | null) ?? null,
    verification_status: (row.verification_status as string | null) ?? null,
    created_at: row.created_at == null ? null : String(row.created_at),
    verified_university_name: (row.verified_university_name as string | null) ?? null,
    verified_department_name: (row.verified_department_name as string | null) ?? null,
    verified_major_category: (row.verified_major_category as string | null) ?? null,
    school_tier: (row.school_tier as string | null) ?? null,
    school_verified: Boolean(row.school_verified),
    high_school_name: (row.high_school_name as string | null) ?? null,
    profile_image_url: (row.profile_image_url as string | null) ?? null,
  };
}

export async function loadMentorDirectoryUserRows(
  supabase: SupabaseClient,
  pLimit: number
): Promise<{ users: UserRow[]; error: string | null; usedRpc: boolean; probe: string }> {
  const { data, error } = await supabase.rpc("mentor_directory_list_v2", { p_limit: pLimit });
  if (error) {
    console.error("[mentors] mentor_directory_list_v2 RPC failed", {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint,
      supabaseUrlExists: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL),
    });
    return {
      users: [],
      error: rpcErrorMessage(error) || "mentor_directory_list_v2 failed",
      usedRpc: true,
      probe: "mentor_directory_list_v2: " + error.message,
    };
  }
  const rows = rowsFromSupabaseData(data);
  return {
    users: rows.map((row) => mapRpcUserToUserRow(row)),
    error: null,
    usedRpc: true,
    probe: "mentor_directory_list_v2(RPC)",
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

  const { data, error } = await supabase.rpc("mentor_profiles_for_directory_v2", { p_ids: ids });
  if (error) {
    console.error("[mentors] mentor_profiles_for_directory_v2 RPC failed", {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint,
      supabaseUrlExists: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL),
    });
    return {
      byUser,
      error: rpcErrorMessage(error) || "mentor_profiles_for_directory_v2 failed",
      probe: "mentor_profiles_for_directory_v2: " + error.message,
    };
  }

  const profileRows = rowsFromSupabaseData(data);
  for (const row of profileRows) {
    const profile = mapRpcProfileRow(row);
    if (profile) byUser.set(profile.user_id, profile);
  }
  return { byUser, error: null, probe: "mentor_profiles_for_directory_v2(RPC)" };
}

export async function getMentorUserPublic(
  supabase: SupabaseClient,
  mentorId: string
): Promise<{ data: UserRow | null; error: Error | null }> {
  const { data, error } = await supabase.rpc("mentor_user_public_v2", { p_mentor_id: mentorId });
  if (error) {
    return { data: null, error: new Error(rpcErrorMessage(error) || "mentor_user_public_v2 failed") };
  }
  const row = rowsFromSupabaseData(data)[0];
  return { data: row ? mapRpcUserToUserRow(row) : null, error: null };
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
