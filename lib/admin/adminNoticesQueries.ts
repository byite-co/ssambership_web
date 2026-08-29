import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { formatKoDateTimeKst } from "@/lib/utils/kstTime";

const NOTICE_LIST_FAIL = "공지 목록을 불러올 수 없습니다.";
const PROMO_LIST_FAIL = "프로모션 목록을 불러올 수 없습니다.";

const TABLE_NOTICE = "app_notices" as const;
const TABLE_PROMOTION = "promotion_campaigns" as const;

type Row = Record<string, unknown>;

function fmt(e: PostgrestError | null): string | null {
  return e ? e.message : null;
}

/** 폼 placeholder용(고정 스키마; DB 프로브 없음) */
export const ADMIN_NOTICES_FORM_HINTS = {
  title: "title",
  body: "body",
  type: "type",
  target: "target",
  start: "starts_at",
  end: "ends_at",
  active: "is_active",
} as const;

const NOTICE_TYPE_LABEL: Record<string, string> = {
  notice: "공지",
  event: "이벤트",
  maintenance: "점검",
  update: "업데이트",
};

function formatTs(v: unknown): string {
  // TZ-FIX R2 #27: UTC ISO slice 절단 → KST 고정 표기 위임 (저장 수정 #2와 동시 배포).
  return formatKoDateTimeKst(v);
}

function pickTargetCell(r: Row): string {
  const v = r.target ?? r.target_screen ?? r.target_path ?? r.placement;
  if (v === null || v === undefined || String(v).trim() === "") return "—";
  return String(v);
}

function pickTitleCell(r: Row): string {
  const v = r.title ?? r.name ?? r.headline;
  if (v === null || v === undefined) return "—";
  const s = String(v);
  if (!s.length) return "—";
  return s.length > 80 ? s.slice(0, 80) + "…" : s;
}

function pickStartEnd(r: Row): { start: string; end: string } {
  const start = r.starts_at ?? r.start_at ?? r.valid_from ?? r.active_from;
  const end = r.ends_at ?? r.end_at ?? r.valid_to ?? r.active_to;
  return { start: formatTs(start), end: formatTs(end) };
}

function exposureFromRow(r: Row): { label: string; isOn: boolean } {
  const v = r.is_active;
  if (typeof v === "boolean") {
    return { label: v ? "표시 중" : "숨김", isOn: v };
  }
  return { label: "숨김", isOn: false };
}

function periodLabel(start: string, end: string): string {
  if (start === "—" && end === "—") return "기간 미설정";
  if (start === "—") return `~ ${end}`;
  if (end === "—") return `${start} ~`;
  return `${start} ~ ${end}`;
}

export type NoticeListSection = {
  name: "notices" | "promotions";
  table: string;
  error: string | null;
  rows: Row[];
};

export type NoticeListRow = {
  id: string;
  title: string;
  typeLabel: string;
  target: string;
  periodLabel: string;
  exposure: { label: string; isOn: boolean };
  createdLabel: string;
  _raw: Row;
  _source: "notices" | "promotions";
};

function mapNoticeRows(rows: Row[]): NoticeListRow[] {
  return rows.map((r) => {
    const id = String(r.id ?? "");
    const { start, end } = pickStartEnd(r);
    const rawType = String(r.type ?? "notice").toLowerCase();
    return {
      id,
      title: pickTitleCell(r),
      typeLabel: NOTICE_TYPE_LABEL[rawType] ?? rawType,
      target: pickTargetCell(r),
      periodLabel: periodLabel(start, end),
      exposure: exposureFromRow(r),
      createdLabel: formatTs(r.created_at),
      _raw: r,
      _source: "notices",
    };
  });
}

function mapPromoRows(rows: Row[]): NoticeListRow[] {
  return rows.map((r) => {
    const id = String(r.id ?? "");
    const { start, end } = pickStartEnd(r);
    return {
      id,
      title: pickTitleCell(r),
      typeLabel: "프로모션",
      target: pickTargetCell(r),
      periodLabel: periodLabel(start, end),
      exposure: exposureFromRow(r),
      createdLabel: formatTs(r.created_at),
      _raw: r,
      _source: "promotions",
    };
  });
}

async function loadNoticeTable(
  supabase: SupabaseClient,
  limit: number
): Promise<{ rows: Row[]; error: string | null }> {
  const { data, error } = await supabase
    .from(TABLE_NOTICE)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return { rows: [], error: fmt(error) };
  return { rows: (data as Row[]) ?? [], error: null };
}

async function loadPromoTable(
  supabase: SupabaseClient,
  limit: number
): Promise<{ rows: Row[]; error: string | null }> {
  const { data, error } = await supabase
    .from(TABLE_PROMOTION)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return { rows: [], error: fmt(error) };
  return { rows: (data as Row[]) ?? [], error: null };
}

export async function loadAdminNoticesPage(supabase: SupabaseClient, listLimit = 50): Promise<{
  noticeSection: NoticeListSection;
  promoSection: NoticeListSection;
  mappedNotices: NoticeListRow[];
  mappedPromos: NoticeListRow[];
  listErrors: string[];
}> {
  const listErrors: string[] = [];

  const n = await loadNoticeTable(supabase, listLimit);
  if (n.error) listErrors.push(NOTICE_LIST_FAIL);
  const noticeSection: NoticeListSection = {
    name: "notices",
    table: TABLE_NOTICE,
    error: n.error,
    rows: n.error ? [] : n.rows,
  };

  const p = await loadPromoTable(supabase, listLimit);
  if (p.error) listErrors.push(PROMO_LIST_FAIL);
  const promoSection: NoticeListSection = {
    name: "promotions",
    table: TABLE_PROMOTION,
    error: p.error,
    rows: p.error ? [] : p.rows,
  };

  const mappedNotices = mapNoticeRows(noticeSection.rows);
  const mappedPromos = mapPromoRows(promoSection.rows);

  return { noticeSection, promoSection, mappedNotices, mappedPromos, listErrors };
}
