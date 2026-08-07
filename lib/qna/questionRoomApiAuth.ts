import { getServerUserWithProfile } from "@/lib/auth/getServerUserWithProfile";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";
import type { UserRow } from "@/lib/types/user";

export type QnaApiSession =
  | { ok: true; user: User; profile: UserRow; actor: "student" | "mentor"; supabase: SupabaseClient }
  | { ok: false; status: 401 | 403; error: string };

export async function getQnaApiSession(): Promise<QnaApiSession> {
  const { user, profile, error } = await getServerUserWithProfile();
  if (error || !user) {
    return { ok: false, status: 401, error: "로그인이 필요합니다." };
  }
  if (!profile || (profile.role !== "student" && profile.role !== "mentor")) {
    return { ok: false, status: 403, error: "학생 또는 멘토만 이용할 수 있습니다." };
  }
  const supabase = await createClient();
  return { ok: true, user, profile, actor: profile.role, supabase };
}
