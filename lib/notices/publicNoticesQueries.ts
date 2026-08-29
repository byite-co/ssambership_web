import type { SupabaseClient } from "@supabase/supabase-js";

const NOTICE_TYPE_LABEL: Record<string, string> = {
  notice: "공지",
  event: "이벤트",
  maintenance: "점검",
  update: "업데이트",
};

type Row = Record<string, unknown>;

export type PublicNoticeItem = {
  id: string;
  title: string;
  body: string;
  typeLabel: string;
  createdAtLabel: string;
  isPinned: boolean;
};

function formatDate(v: unknown): string {
  if (typeof v !== "string" || !v.trim()) return "";
  try {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return "";
    // TZ-FIX R3 #33: 서버 UTC 달력 → Asia/Seoul 고정 ('년 월 일' 포맷 유지, P-A).
    return d.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Seoul" });
  } catch {
    return "";
  }
}

function mapRow(r: Row): PublicNoticeItem | null {
  const id = typeof r.id === "string" ? r.id : "";
  if (!id) return null;
  const rawType = String(r.type ?? "notice").toLowerCase();
  return {
    id,
    title: String(r.title ?? "").trim() || "제목 없음",
    body: String(r.body ?? "").trim(),
    typeLabel: NOTICE_TYPE_LABEL[rawType] ?? rawType,
    createdAtLabel: formatDate(r.created_at),
    isPinned: rawType === "maintenance" || rawType === "notice",
  };
}

/**
 * 공개 공지 — `app_notices` (RLS: is_active + 노출 기간 내 행만 anon/authenticated 조회)
 */
export async function loadPublicNotices(
  supabase: SupabaseClient,
  limit = 50
): Promise<{ items: PublicNoticeItem[]; error: string | null; accessDenied: boolean }> {
  const { data, error } = await supabase
    .from("app_notices")
    .select("id, title, body, type, created_at, is_active")
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    const accessDenied = /permission|policy|rls|denied|42501/i.test(error.message);
    return { items: [], error: error.message, accessDenied };
  }

  const items = ((data as Row[]) ?? []).map(mapRow).filter((x): x is PublicNoticeItem => Boolean(x));
  return { items, error: null, accessDenied: false };
}
