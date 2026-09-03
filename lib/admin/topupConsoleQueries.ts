import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { buildAdminUsersSearchOr } from "@/lib/admin/adminDataTable";
import { isUuidLike } from "@/lib/admin/accountDetailConsole";
import { rangeForPage, type AdminListParams } from "@/lib/admin/adminListParams";
import {
  TOPUP_SEARCH_USER_ID_LIMIT,
  TOPUP_TAB_VALUES,
  buildTopupSearchOr,
  normalizeTopupSearchTerm,
  parseTopupRow,
  topupListOrder,
  topupTabStatus,
  type TopupListItem,
  type TopupTab,
} from "@/lib/admin/topupConsole";

/**
 * 관리자 · 충전 관리(PR-9 §2) 서버 조회 — **조회 전용**, service_role 읽기.
 * `paysync_invoices` 는 본인 행 SELECT 정책만 있어(관리자 정책 없음) 세션 클라이언트로는 남의 주문이 보이지 않는다.
 * 이 모듈에는 insert/update/rpc 가 없다 — 입금 확인·적립은 웹훅·보정 크론·학생 재확인 경로(`recordPaysyncTopup`)만이 한다(§0 결론).
 */

type Row = Record<string, unknown>;
type PgQuery = ReturnType<ReturnType<SupabaseClient["from"]>["select"]>;

const INVOICE_COLUMNS = "id, user_id, paysync_invoice_id, pay_krw, cash_krw, bonus_krw, depositor_name, status, issued_at, expires_at, paid_at, paid_trigger";
const USER_COLUMNS = "id, full_name, nickname";
const SERVICE_ROLE_MISSING = "서버 설정(서비스 키)이 없어 충전 요청을 읽을 수 없습니다.";

export type TopupListResult = { rows: TopupListItem[]; totalCount: number; error: string | null };
export type TopupTabCounts = Record<TopupTab, number>;

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
function strOrNull(v: unknown): string | null {
  const s = str(v);
  return s || null;
}

function serviceRoleOrNull(): SupabaseClient | null {
  try {
    return createServiceRoleClient();
  } catch {
    return null;
  }
}

function isRangeNotSatisfiable(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  return String(error.code ?? "") === "PGRST103" || /range not satisfiable|invalid range/i.test(String(error.message ?? ""));
}

async function searchRequesterIds(db: SupabaseClient, term: string): Promise<string[]> {
  if (isUuidLike(term)) return [term];
  const { data, error } = await db.from("users").select("id").or(buildAdminUsersSearchOr(term)).limit(TOPUP_SEARCH_USER_ID_LIMIT);
  if (error) {
    console.error("[topupConsole] users 검색 실패:", error.message);
    return [];
  }
  return ((data as { id?: string }[] | null) ?? []).map((r) => str(r.id)).filter(Boolean);
}

type Scope = { status: string | null; term: string; userIds: readonly string[] };

function applyScope(q: PgQuery, scope: Scope): PgQuery {
  let r = q;
  if (scope.status) r = r.eq("status", scope.status);
  if (scope.term) r = r.or(buildTopupSearchOr(scope.term, scope.userIds));
  return r;
}

async function loadRequesters(db: SupabaseClient, ids: readonly string[]): Promise<Map<string, { fullName: string | null; nickname: string | null }>> {
  const map = new Map<string, { fullName: string | null; nickname: string | null }>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return map;
  const { data, error } = await db.from("users").select(USER_COLUMNS).in("id", unique);
  if (error) {
    console.error("[topupConsole] users 조회 실패:", error.message);
    return map;
  }
  for (const row of (data as Row[] | null) ?? []) {
    const id = str(row.id);
    if (id) map.set(id, { fullName: strOrNull(row.full_name), nickname: strOrNull(row.nickname) });
  }
  return map;
}

export async function loadTopupList(params: AdminListParams, tab: TopupTab): Promise<TopupListResult> {
  const db = serviceRoleOrNull();
  if (!db) return { rows: [], totalCount: 0, error: SERVICE_ROLE_MISSING };
  const term = normalizeTopupSearchTerm(params.search);
  const userIds = term ? await searchRequesterIds(db, term) : [];
  const scope: Scope = { status: topupTabStatus(tab), term, userIds };
  const order = topupListOrder(tab);
  const { from, to } = rangeForPage(params);

  const res = await applyScope(db.from("paysync_invoices").select(INVOICE_COLUMNS, { count: "exact" }), scope)
    .order(order.column, { ascending: order.ascending, nullsFirst: order.nullsFirst })
    .order("issued_at", { ascending: false })
    .range(from, to);

  if (res.error) {
    if (isRangeNotSatisfiable(res.error)) {
      const head = await applyScope(db.from("paysync_invoices").select("id", { count: "exact", head: true }), scope);
      return { rows: [], totalCount: head.count ?? 0, error: head.error ? "충전 요청을 불러오지 못했습니다." : null };
    }
    console.error("[topupConsole] paysync_invoices 조회 실패:", res.error.message);
    return { rows: [], totalCount: 0, error: "충전 요청을 불러오지 못했습니다." };
  }

  const raw = (res.data as Row[] | null) ?? [];
  const requesters = await loadRequesters(
    db,
    raw.map((r) => str(r.user_id))
  );
  const rows = raw.map((r) => parseTopupRow(r, requesters.get(str(r.user_id)) ?? null)).filter((r): r is TopupListItem => r !== null);
  return { rows, totalCount: res.count ?? rows.length, error: null };
}

export async function countTopupTabs(): Promise<TopupTabCounts> {
  const counts = Object.fromEntries(TOPUP_TAB_VALUES.map((t) => [t, 0])) as TopupTabCounts;
  const db = serviceRoleOrNull();
  if (!db) return counts;
  const results = await Promise.all(
    TOPUP_TAB_VALUES.map(async (tab) => {
      const status = topupTabStatus(tab);
      let q = db.from("paysync_invoices").select("id", { count: "exact", head: true });
      if (status) q = q.eq("status", status);
      const { count, error } = await q;
      if (error) console.error(`[topupConsole] ${tab} 건수 조회 실패:`, error.message);
      return [tab, count ?? 0] as const;
    })
  );
  for (const [tab, n] of results) counts[tab] = n;
  return counts;
}
