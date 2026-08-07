import type { SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;

export async function fetchMentorProfileRow(
  supabase: SupabaseClient,
  userId: string
): Promise<{ row: Row | null; error: string | null }> {
  const { data, error } = await supabase.from("mentor_profiles").select("*").eq("user_id", userId).maybeSingle();
  if (error) {
    return { row: null, error: error.message };
  }
  return { row: (data as Row) ?? null, error: null };
}

// D-MT-13: fetchMentorMediaSample 스텁 제거 — 후보 테이블 부재(mentor_media/mentor_content_links/
// mentor_link_items 모두 미생성)로 항상 빈 결과({rows:[],table:null})만 반환하던 미도입 기능.
// 이를 쓰던 3곳(프로필 편집 미디어 섹션·공개 멘토 상세 번들·/mentor/channel 라우트)과 관련 빈 UI 를
// 함께 제거했다. 미디어 기능 도입 시 정본 테이블과 함께 복원한다.

/** 폼 initial 용(문자열) */
export function getProfileFieldString(row: Row | null, keys: string[], fallback = ""): string {
  if (!row) return fallback;
  for (const k of keys) {
    const v = row[k];
    if (v === null || v === undefined) continue;
    if (Array.isArray(v)) return v.join(", ");
    if (typeof v === "string" || typeof v === "number") return String(v);
  }
  return fallback;
}

export function getProfileFieldBool(row: Row | null, keys: string[]): boolean | null {
  if (!row) return null;
  for (const k of keys) {
    if (!(k in row)) continue;
    const v = row[k];
    if (typeof v === "boolean") return v;
  }
  return null;
}
