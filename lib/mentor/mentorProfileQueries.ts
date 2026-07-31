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

/**
 * W4(C10): 후보 테이블 부재 실측(187 baseline 0 — mentor_media/mentor_content_links/
 * mentor_link_items 모두 CREATE 없음) — 프로빙 제거, 현행 관측 동작(빈 결과) 고정.
 * 기능 정본화는 비범위. 소비처(공개 멘토 상세·프로필 편집·멘토 채널)는 기존과 동일하게
 * 빈 상태를 렌더한다.
 */
export async function fetchMentorMediaSample(
  supabase: SupabaseClient,
  userId: string,
  limit = 12
): Promise<{ rows: Row[]; table: string | null; error: string | null }> {
  void supabase;
  void userId;
  void limit;
  return { rows: [], table: null, error: null };
}

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
