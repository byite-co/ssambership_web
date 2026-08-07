import type { SupabaseClient } from "@supabase/supabase-js";

const TABLE = "favorites";

export async function loadFavoriteMentorIdsForUser(
  supabase: SupabaseClient,
  userId: string
): Promise<{ ids: Set<string>; error: string | null }> {
  const { data, error } = await supabase.from(TABLE).select("mentor_id").eq("user_id", userId);
  if (error) {
    // D-ST-17: 문자열(메시지) 정규식으로 오류를 정상 결과로 위장하지 않는다.
    // favorites 테이블 자체가 없는 배포(42P01 undefined_table)만 '찜 기능 미배포'로 간주해
    // 빈 목록으로 흡수하고, 그 외 오류(권한·네트워크 등)는 error 를 그대로 전파한다.
    if (error.code === "42P01") {
      return { ids: new Set(), error: null };
    }
    return { ids: new Set(), error: error.message };
  }
  const ids = new Set<string>();
  for (const row of data ?? []) {
    const mid = (row as { mentor_id?: string }).mentor_id;
    if (mid) ids.add(String(mid));
  }
  return { ids, error: null };
}

export async function addMentorFavorite(
  supabase: SupabaseClient,
  userId: string,
  mentorId: string
): Promise<{ ok: boolean; error: string | null }> {
  // mentor_profiles 사전검사 제거: 해당 select는 mentor_select_own RLS(본인 행만)에 막혀
  // 학생이 멘토를 찜할 때 항상 0행→500이 났다. favorites.mentor_id FK(users)가 무결성 보장.
  const { error } = await supabase.from(TABLE).insert({ user_id: userId, mentor_id: mentorId });
  if (error) {
    if (/duplicate|unique/i.test(error.message)) return { ok: true, error: null };
    return { ok: false, error: error.message };
  }
  return { ok: true, error: null };
}

export async function removeMentorFavorite(
  supabase: SupabaseClient,
  userId: string,
  mentorId: string
): Promise<{ ok: boolean; error: string | null }> {
  const { error } = await supabase.from(TABLE).delete().eq("user_id", userId).eq("mentor_id", mentorId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, error: null };
}
