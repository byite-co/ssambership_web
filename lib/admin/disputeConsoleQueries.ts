import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { mentorProfilesAdminReadClient } from "@/lib/admin/mentorProfilesAdminRead";
import { ADMIN_LIST_SEARCH_USER_ID_LIMIT, buildAdminUsersSearchOr, normalizeAdminListSearchTerm } from "@/lib/admin/adminDataTable";
import {
  DISPUTE_KIND_LABELS,
  DISPUTE_TAB_VALUES,
  buildDisputeSearchOr,
  disputeElapsed,
  disputeIsBulkEligible,
  disputeLedgerReasonLabel,
  disputeOrderEventLabel,
  disputeShortRef,
  disputeTabStatuses,
  formatDisputeLedgerDelta,
  resolveDisputeKind,
  type DisputeElapsed,
  type DisputeKind,
  type DisputeTab,
} from "@/lib/admin/disputeConsole";
import { formatKoDateTimeKst } from "@/lib/utils/kstTime";

/**
 * 분쟁 화면(PR-6 §2) 서버 조회.
 *
 * - 분쟁·당사자(users) 모두 관리자 읽기 클라이언트(`mentorProfilesAdminReadClient`: service_role 우선 · 세션 폴백)로 읽는다 —
 *   이관 전 목록 페이지가 `adminBypass ?? supabase` 로 하던 것과 같은 경계(이중 requireRole admin 가드 뒤). RLS 정책 추가는 DB 작업.
 * - 정렬은 모든 탭에서 `created_at asc` — 오래된 분쟁이 위. 페이징은 서버 `.range`, range 초과 시 head count 로 보정.
 * - 검색은 당사자 이름·닉네임·이메일(users 조인 → student_id/mentor_id in()) + 접수 내용·운영 메모 부분일치.
 * - 탭 건수는 head count 8회 병렬(제재 탭은 `.in` 3종). 실패한 탭은 0 으로 두고 로그를 남긴다.
 */

const DISPUTE_COLUMNS =
  "id, status, student_id, mentor_id, submitted_by, custom_request_order_id, payment_id, subscription_id, body, admin_note, created_at, updated_at, resolved_at, resolved_by";
const USER_COLUMNS = "id, full_name, nickname, email, role";

type Row = Record<string, unknown>;
type PgQuery = ReturnType<ReturnType<SupabaseClient["from"]>["select"]>;

export type DisputeParty = { id: string; name: string; role: string };

export type DisputeQueueItem = {
  id: string;
  status: string;
  kind: DisputeKind;
  kindLabel: string;
  orderId: string | null;
  /** `#ABC123` — 주문이 없으면 분쟁 id 의 짧은 참조 */
  orderRef: string;
  disputeRef: string;
  studentId: string | null;
  studentName: string;
  mentorId: string | null;
  mentorName: string;
  bodySummary: string;
  createdAt: string | null;
  /** KST 표시 문자열 — 서버에서 만들어 넘긴다(클라이언트 표에서 다시 포맷하지 않는다 → hydration 불일치 방지) */
  createdAtLabel: string;
  elapsed: DisputeElapsed;
  /** 일괄 상태 변경 게이트 안인가(체크박스 노출) */
  bulkEligible: boolean;
};

export type DisputeQueueResult = { rows: DisputeQueueItem[]; totalCount: number; error: string | null };
export type DisputeTabCounts = Record<DisputeTab, number>;

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function isRangeNotSatisfiable(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  return String(error.code ?? "") === "PGRST103" || /range not satisfiable|invalid range/i.test(String(error.message ?? ""));
}

function partyDisplayName(row: { full_name?: string | null; nickname?: string | null; email?: string | null; id?: string }): string {
  return str(row.full_name) || str(row.nickname) || str(row.email) || str(row.id).slice(0, 8);
}

async function searchPartyIds(readDb: SupabaseClient, term: string): Promise<string[]> {
  const { data, error } = await readDb.from("users").select("id").or(buildAdminUsersSearchOr(term)).limit(ADMIN_LIST_SEARCH_USER_ID_LIMIT);
  if (error) {
    console.error("[loadDisputeQueue] users 검색 실패:", error.message);
    return [];
  }
  return ((data as { id?: string }[] | null) ?? []).map((r) => str(r.id)).filter(Boolean);
}

/** 당사자 표시명·역할 — 목록 한 페이지·상세 한 건이 같은 조회를 쓴다. 실패는 빈 맵(이름은 id 앞 8자로 폴백). */
export async function loadDisputeParties(supabase: SupabaseClient, ids: readonly (string | null | undefined)[]): Promise<Map<string, DisputeParty>> {
  const readDb = mentorProfilesAdminReadClient(supabase);
  const map = new Map<string, DisputeParty>();
  const unique = [...new Set(ids.map((v) => str(v)).filter(Boolean))];
  if (!unique.length) return map;
  const { data, error } = await readDb.from("users").select(USER_COLUMNS).in("id", unique);
  if (error) {
    console.error("[loadDisputeParties] users 조회 실패:", error.message);
    return map;
  }
  for (const row of (data as { id?: string; full_name?: string | null; nickname?: string | null; email?: string | null; role?: string | null }[] | null) ?? []) {
    const id = str(row.id);
    if (!id) continue;
    map.set(id, { id, name: partyDisplayName(row), role: str(row.role) });
  }
  return map;
}

function applyScope(q: PgQuery, args: { statuses: readonly string[] | null; term: string; partyIds: readonly string[] }): PgQuery {
  let r = q;
  if (args.statuses) r = args.statuses.length === 1 ? r.eq("status", args.statuses[0]) : r.in("status", [...args.statuses]);
  if (args.term) r = r.or(buildDisputeSearchOr(args.term, args.partyIds));
  return r;
}

function summarizeBody(body: unknown, max = 80): string {
  const s = typeof body === "string" ? body.replace(/\s+/g, " ").trim() : "";
  if (!s) return "";
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export async function loadDisputeQueue(
  supabase: SupabaseClient,
  args: { tab: DisputeTab; search: string; page: number; pageSize: number }
): Promise<DisputeQueueResult> {
  const readDb = mentorProfilesAdminReadClient(supabase);
  const term = normalizeAdminListSearchTerm(args.search);
  const partyIds = term ? await searchPartyIds(readDb, term) : [];
  const from = Math.max(0, (args.page - 1) * args.pageSize);
  const to = from + args.pageSize - 1;
  const scope = { statuses: disputeTabStatuses(args.tab), term, partyIds };

  const r = await applyScope(readDb.from("disputes").select(DISPUTE_COLUMNS, { count: "exact" }), scope)
    .order("created_at", { ascending: true })
    .range(from, to);

  let rows: Row[] = [];
  let totalCount = 0;
  if (!r.error) {
    rows = (r.data as Row[] | null) ?? [];
    totalCount = r.count ?? 0;
  } else if (isRangeNotSatisfiable(r.error)) {
    const head = await applyScope(readDb.from("disputes").select("id", { count: "exact", head: true }), scope);
    if (head.error) return { rows: [], totalCount: 0, error: head.error.message };
    totalCount = head.count ?? 0;
  } else {
    return { rows: [], totalCount: 0, error: r.error.message };
  }

  const parties = await loadDisputeParties(
    supabase,
    rows.flatMap((row) => [str(row.student_id), str(row.mentor_id)])
  );
  const now = Date.now();

  return {
    rows: rows.map((row) => {
      const id = str(row.id);
      const status = str(row.status);
      const orderId = str(row.custom_request_order_id) || null;
      const studentId = str(row.student_id) || null;
      const mentorId = str(row.mentor_id) || null;
      const kind = resolveDisputeKind(row);
      const createdAt = typeof row.created_at === "string" ? row.created_at : null;
      return {
        id,
        status,
        kind,
        kindLabel: DISPUTE_KIND_LABELS[kind],
        orderId,
        orderRef: orderId ? disputeShortRef(orderId) : "",
        disputeRef: disputeShortRef(id),
        studentId,
        studentName: studentId ? (parties.get(studentId)?.name ?? studentId.slice(0, 8)) : "—",
        mentorId,
        mentorName: mentorId ? (parties.get(mentorId)?.name ?? mentorId.slice(0, 8)) : "—",
        bodySummary: summarizeBody(row.body),
        createdAt,
        createdAtLabel: formatKoDateTimeKst(createdAt),
        elapsed: disputeElapsed(createdAt, status, now),
        bulkEligible: disputeIsBulkEligible(status),
      };
    }),
    totalCount,
    error: null,
  };
}

/** 탭별 건수(head count 8회, 병렬). 제재 탭은 3종 `.in`. 실패한 탭은 0 으로 두고 로그를 남긴다. */
export async function countDisputeTabs(supabase: SupabaseClient): Promise<DisputeTabCounts> {
  const readDb = mentorProfilesAdminReadClient(supabase);
  const entries = await Promise.all(
    DISPUTE_TAB_VALUES.map(async (tab) => {
      const statuses = disputeTabStatuses(tab);
      let q = readDb.from("disputes").select("id", { count: "exact", head: true });
      if (statuses) q = statuses.length === 1 ? q.eq("status", statuses[0]) : q.in("status", [...statuses]);
      const { count, error } = await q;
      if (error) console.error(`[countDisputeTabs] ${tab}:`, error.message);
      return [tab, error ? 0 : (count ?? 0)] as const;
    })
  );
  return Object.fromEntries(entries) as DisputeTabCounts;
}

// ── 상세: 주문 맥락(제목 · 주문 이력 · 결제 이력) ─────────────────────────────

export type DisputeOrderEvent = { id: string; label: string; at: string | null; atLabel: string };
export type DisputeLedgerRow = {
  id: string;
  label: string;
  deltaLabel: string;
  credit: boolean;
  partyLabel: "학생" | "멘토" | "—";
  at: string | null;
  atLabel: string;
};
export type DisputeOrderContext = {
  orderId: string;
  /** 의뢰 글 제목(`custom_request_posts.title`) — 없으면 null */
  title: string | null;
  events: DisputeOrderEvent[];
  eventsError: string | null;
  ledger: DisputeLedgerRow[];
  ledgerError: string | null;
};

const ORDER_CONTEXT_LIMIT = 50;

/**
 * 분쟁에 연결된 맞춤의뢰 주문의 맥락 — 의뢰 글 제목 · `order_events`(주문방 액션이 남긴 이력, 오래된 순) ·
 * `cash_ledger`(ref_id = 주문, 예치·지급·환불·분쟁 분배, 오래된 순). 각 조회 실패는 따로 표시한다(빈 결과와 구분).
 */
export async function loadDisputeOrderContext(
  supabase: SupabaseClient,
  input: { orderId: string; postId: string | null; studentId: string | null; mentorId: string | null }
): Promise<DisputeOrderContext> {
  const readDb = mentorProfilesAdminReadClient(supabase);
  const orderId = str(input.orderId);
  const [titleRes, eventsRes, ledgerRes] = await Promise.all([
    input.postId ? readDb.from("custom_request_posts").select("title").eq("id", input.postId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    readDb.from("order_events").select("id, event, created_at").eq("custom_request_order_id", orderId).order("created_at", { ascending: true }).limit(ORDER_CONTEXT_LIMIT),
    readDb.from("cash_ledger").select("id, user_id, delta_cents, reason, created_at").eq("ref_id", orderId).order("created_at", { ascending: true }).limit(ORDER_CONTEXT_LIMIT),
  ]);

  const title = titleRes.error ? null : str((titleRes.data as Row | null)?.title) || null;

  const events: DisputeOrderEvent[] = eventsRes.error
    ? []
    : (((eventsRes.data as Row[] | null) ?? []).map((row, i) => {
        const at = typeof row.created_at === "string" ? row.created_at : null;
        return { id: str(row.id) || String(i), label: disputeOrderEventLabel(str(row.event)), at, atLabel: formatKoDateTimeKst(at) };
      }));

  const ledger: DisputeLedgerRow[] = ledgerRes.error
    ? []
    : (((ledgerRes.data as Row[] | null) ?? []).map((row, i) => {
        const at = typeof row.created_at === "string" ? row.created_at : null;
        const userId = str(row.user_id);
        const delta = typeof row.delta_cents === "number" ? row.delta_cents : Number(row.delta_cents);
        return {
          id: str(row.id) || String(i),
          label: disputeLedgerReasonLabel(str(row.reason)),
          deltaLabel: formatDisputeLedgerDelta(row.delta_cents),
          credit: Number.isFinite(delta) && delta > 0,
          partyLabel: userId && userId === str(input.studentId) ? "학생" : userId && userId === str(input.mentorId) ? "멘토" : "—",
          at,
          atLabel: formatKoDateTimeKst(at),
        };
      }));

  if (eventsRes.error) console.error("[loadDisputeOrderContext] order_events:", eventsRes.error.message);
  if (ledgerRes.error) console.error("[loadDisputeOrderContext] cash_ledger:", ledgerRes.error.message);

  return {
    orderId,
    title,
    events,
    eventsError: eventsRes.error ? eventsRes.error.message : null,
    ledger,
    ledgerError: ledgerRes.error ? ledgerRes.error.message : null,
  };
}
