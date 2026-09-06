import type { UserRow } from "@/lib/types/user";
import type { SupabaseClient } from "@supabase/supabase-js";

// W4(C10): 존재 컬럼 프로빙 제거 — users.suspended_until 은 102 마이그레이션으로
// 정본 존재(187 baseline 실측), users.display_name 은 부재 실측(187 baseline 0)이라 후보에서 삭제.
// S-C: identity_verified_at 은 S-B m2 로 정본 존재 — 게이트 판독 컬럼(수동 동기화, 생성 타입 없음).
// DB-5(206): profile_completed_at — 소셜 가입 직후 NULL(완성 전) · 완성/이메일 가입은 시각. role 은 완성 전 NULL.
const USER_SELECT =
  "id, role, status, full_name, nickname, email, grade_level, student_status, birth_date, terms_agreed_at, privacy_agreed_at, marketing_agreed, created_at, updated_at, suspended_until, identity_verified_at, profile_completed_at";

/**
 * Supabase Client + userId로 public.users 한 줄 조회 (서버/클라이언트 공용)
 * createClient()는 lib/supabase/client.ts(브라우저) 또는 server.ts(서버)에서 전달
 */
export async function getUserProfileById(
  supabase: SupabaseClient,
  userId: string
): Promise<{ data: UserRow | null; error: Error | null }> {
  const { data, error } = await supabase.from("users").select(USER_SELECT).eq("id", userId).maybeSingle();
  if (error) {
    return { data: null, error: new Error(error.message) };
  }
  return { data: data as UserRow | null, error: null };
}
