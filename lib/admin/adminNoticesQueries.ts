import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { rangeForPage, type AdminListParams } from "@/lib/admin/adminListParams";
import {
  NOTICE_TYPE_TAB_VALUES,
  normalizeNoticeSearchTerm,
  parseNoticeRow,
  parsePromotionRow,
  type NoticeListItem,
  type NoticeTypeTab,
  type PromotionListItem,
} from "@/lib/admin/noticeConsole";

/**
 * 관리자 · 공지·이벤트(PR-10 §1) 서버 조회 — 세션 클라이언트(`app_notices_select` · `promotion_campaigns_select` 가 관리자 전체 조회를 허용한다).
 * 유형 탭 · 제목 검색 · 페이지 전부 서버. 이 모듈에는 쓰기가 없다(쓰기는 `adminNoticesActions` → `adminNoticesMutations`).
 */

const TABLE_NOTICE = "app_notices" as const;
const TABLE_PROMOTION = "promotion_campaigns" as const;
const NOTICE_COLUMNS = "id, title, body, type, target, display_mode, is_active, starts_at, ends_at, created_at, updated_at";
const PROMOTION_COLUMNS = "id, title, is_active, starts_at, ends_at, created_at";
/** 탭 건수 집계 상한 — 공지는 소량(현행 5건)이라 한 번에 읽어 센다 */
const COUNT_SCAN_LIMIT = 1000;

type Row = Record<string, unknown>;

export type NoticeListResult = { rows: NoticeListItem[]; totalCount: number; error: string | null };
export type NoticeTabCounts = { tabs: Record<NoticeTypeTab, number>; active: number };
export type PromotionListResult = { rows: PromotionListItem[]; error: string | null };

function isRangeNotSatisfiable(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  return String(error.code ?? "") === "PGRST103" || /range not satisfiable|invalid range/i.test(String(error.message ?? ""));
}

export async function loadNoticeList(supabase: SupabaseClient, params: AdminListParams, tab: NoticeTypeTab): Promise<NoticeListResult> {
  const term = normalizeNoticeSearchTerm(params.search);
  const { from, to } = rangeForPage(params);
  let q = supabase.from(TABLE_NOTICE).select(NOTICE_COLUMNS, { count: "exact" });
  if (tab !== "all") q = q.eq("type", tab);
  if (term) q = q.ilike("title", `%${term}%`);
  const { data, error, count } = await q.order("created_at", { ascending: false }).range(from, to);
  if (error) {
    if (isRangeNotSatisfiable(error)) return { rows: [], totalCount: count ?? 0, error: null };
    console.error("[adminNotices] app_notices 조회 실패:", error.message);
    return { rows: [], totalCount: 0, error: error.message };
  }
  const rows = ((data as Row[] | null) ?? []).map(parseNoticeRow).filter((x): x is NoticeListItem => Boolean(x));
  return { rows, totalCount: count ?? rows.length, error: null };
}

export async function countNoticeTabs(supabase: SupabaseClient): Promise<NoticeTabCounts> {
  const tabs = Object.fromEntries(NOTICE_TYPE_TAB_VALUES.map((v) => [v, 0])) as Record<NoticeTypeTab, number>;
  const { data, error } = await supabase.from(TABLE_NOTICE).select("type, is_active").limit(COUNT_SCAN_LIMIT);
  if (error) {
    console.error("[adminNotices] 탭 건수 집계 실패:", error.message);
    return { tabs, active: 0 };
  }
  let active = 0;
  for (const row of (data as Row[] | null) ?? []) {
    const type = String(row.type ?? "").trim();
    tabs.all += 1;
    if ((NOTICE_TYPE_TAB_VALUES as readonly string[]).includes(type)) tabs[type as NoticeTypeTab] += 1;
    if (row.is_active === true) active += 1;
  }
  return { tabs, active };
}

export async function loadNoticeById(supabase: SupabaseClient, id: string): Promise<NoticeListItem | null> {
  const key = String(id ?? "").trim();
  if (!key) return null;
  const { data, error } = await supabase.from(TABLE_NOTICE).select(NOTICE_COLUMNS).eq("id", key).maybeSingle();
  if (error) {
    console.error("[adminNotices] app_notices 단건 조회 실패:", error.message);
    return null;
  }
  return parseNoticeRow((data as Row | null) ?? null);
}

export async function loadPromotionList(supabase: SupabaseClient, limit = 50): Promise<PromotionListResult> {
  const { data, error } = await supabase.from(TABLE_PROMOTION).select(PROMOTION_COLUMNS).order("created_at", { ascending: false }).limit(limit);
  if (error) {
    console.error("[adminNotices] promotion_campaigns 조회 실패:", error.message);
    return { rows: [], error: error.message };
  }
  const rows = ((data as Row[] | null) ?? []).map(parsePromotionRow).filter((x): x is PromotionListItem => Boolean(x));
  return { rows, error: null };
}
