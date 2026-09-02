import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { splitPendingFirstRange } from "@/lib/admin/adminDataTable";
import {
  REFUND_KIND_LABELS,
  REFUND_TAB_VALUES,
  buildRefundSearchOr,
  buildRefundUserSearchOr,
  describeRefundBasis,
  isZeroBasisRefund,
  normalizeRefundSearchTerm,
  refundAmountWon,
  refundBasisMismatch,
  refundBasisShortLabel,
  refundModeForKind,
  refundTabStatus,
  resolveRefundKind,
  REFUND_SEARCH_USER_ID_LIMIT,
  type RefundBasis,
  type RefundKind,
  type RefundQueueItem,
  type RefundTab,
} from "@/lib/admin/refundConsole";
import { refundSlaInfo } from "@/lib/admin/refundSla";
import { computeProratedRefundEstimate } from "@/lib/subscribe/subscriptionRefundProration";
import { hasSubscriptionUsageStartedForPair } from "@/lib/subscribe/subscriptionUsageStarted";
import { getSubscribeCatalogPlan } from "@/lib/subscribe/subscribePlanCatalog";
import { isSubscribePlanTier } from "@/lib/subscribe/subscribePageQueries";
import { ledgerAmountLabel, ledgerAt, ledgerIsCredit, ledgerReasonLabel } from "@/lib/cash/ledgerRowDisplay";
import { formatKoDateTimeKst } from "@/lib/utils/kstTime";

/**
 * 관리자 · 환불 화면(PR-3) 서버 조회 정본.
 *
 * - 목록: 서버 검색(요청자 이름·이메일 → users → `user_id.in`, 사유 부분일치) + 서버 탭(`status` 하나) + 페이징.
 *   대기 탭·전체 탭 모두 **대기 건이 항상 위, 오래된 것부터**(전체 탭은 대기/나머지 두 range 를 이어 붙인다 — 공용 정본 `adminDataTable.ts` 의 `splitPendingFirstRange`).
 * - 금액은 `refunds.amount_cents` 저장값 하나만 쓴다(RPC 실지급액과 동일 출처).
 * - 환불 기준은 학생 화면 함수 `computeProratedRefundEstimate` 를 **요청 시점(`created_at`)** 을 now 로 넣어 그대로 호출한다.
 *   입력 우선순위(구독 current_period → 청구 이벤트 period, usageStarted 판정)도 학생 액션과 같다.
 * - `cash_ledger`·`payments`·`subscriptions`·`subscription_billing_events`·질문방은 RLS 가 본인/당사자 한정이라 서비스 롤로 읽는다.
 *   키가 없으면 세션 클라이언트로 폴백한다(`mentorProfilesAdminReadClient` 와 같은 규칙 — 이름이 mentor_profiles 에 묶여 있어 공용화는 후속 서버 헬퍼 PR).
 */

type Row = Record<string, unknown>;
type PgQuery = ReturnType<ReturnType<SupabaseClient["from"]>["select"]>;

const USER_DISPLAY_COLUMNS = "id, full_name, nickname, email";
const SUBSCRIPTION_COLUMNS =
  "id, student_id, mentor_id, plan_tier, status, payment_id, started_at, current_period_start, current_period_end, next_billing_at, cancel_at_period_end, canceled_at, expired_at";
const BILLING_EVENT_COLUMNS = "id, subscription_id, amount_cents, payment_id, period_start, period_end, billing_at, event_type, status";
const LEDGER_LIMIT = 10;
const PREVIOUS_REFUNDS_LIMIT = 5;

export type { RefundQueueItem };

export type RefundQueueResult = { rows: RefundQueueItem[]; totalCount: number; error: string | null };
export type RefundTabCounts = Record<RefundTab, number>;

export type RefundDetailSubscription = {
  id: string;
  status: string;
  planTier: string | null;
  planLabel: string | null;
  mentorId: string | null;
  mentorName: string | null;
  startedAt: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  nextBillingAt: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
};

export type RefundDetailLedgerRow = {
  id: string;
  at: string;
  label: string;
  amountLabel: string;
  credit: boolean;
  /** 이 환불이 가리키는 구독·결제와 연결된 행인가(강조 표시) */
  related: boolean;
};

export type RefundDetailDispute = { id: string; status: string; createdAt: string | null };

export type RefundDetailPrevious = {
  id: string;
  kindLabel: string;
  amountWon: number | null;
  status: string;
  createdAt: string | null;
  processedAt: string | null;
};

export type RefundDetail = RefundQueueItem & {
  subscription: RefundDetailSubscription | null;
  ledger: RefundDetailLedgerRow[];
  ledgerError: string | null;
  disputes: RefundDetailDispute[];
  disputesError: string | null;
  previousRefunds: RefundDetailPrevious[];
  zeroBasis: boolean;
  basisMismatch: boolean;
};

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
function strOrNull(v: unknown): string | null {
  const s = str(v);
  return s || null;
}
function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : null;
  }
  return null;
}
function bool(v: unknown): boolean {
  return v === true || v === "true" || v === 1 || v === "1";
}

/** 서비스 롤 우선, 없으면 세션(로컬·스테이징) — 읽기 전용 */
function adminReadClient(session: SupabaseClient): SupabaseClient {
  try {
    return createServiceRoleClient();
  } catch {
    return session;
  }
}

function isRangeNotSatisfiable(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  return String(error.code ?? "") === "PGRST103" || /range not satisfiable|invalid range/i.test(String(error.message ?? ""));
}

type UserLite = { id: string; full_name: string | null; nickname: string | null; email: string | null };

function displayNameOf(user: UserLite | null | undefined): string {
  return str(user?.full_name) || str(user?.nickname) || "이름 없음";
}

async function loadUsersByIds(db: SupabaseClient, ids: readonly string[]): Promise<Map<string, UserLite>> {
  const map = new Map<string, UserLite>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return map;
  const { data, error } = await db.from("users").select(USER_DISPLAY_COLUMNS).in("id", unique);
  if (error) {
    console.error("[refundConsole] users 조회 실패:", error.message);
    return map;
  }
  for (const row of (data as UserLite[] | null) ?? []) if (row.id) map.set(row.id, row);
  return map;
}

function planLabelOf(planTier: string | null): string | null {
  return planTier && isSubscribePlanTier(planTier) ? getSubscribeCatalogPlan(planTier).label : null;
}

// ── 목록 ────────────────────────────────────────────────────────────────────

async function searchRefundUserIds(db: SupabaseClient, term: string): Promise<string[]> {
  const { data, error } = await db.from("users").select("id").or(buildRefundUserSearchOr(term)).limit(REFUND_SEARCH_USER_ID_LIMIT);
  if (error) {
    console.error("[loadRefundQueue] users 검색 실패:", error.message);
    return [];
  }
  return ((data as { id?: string }[] | null) ?? []).map((r) => str(r.id)).filter(Boolean);
}

type Scope = {
  /** 포함 상태. null = 필터 없음 */
  status: string | null;
  /** true 면 status 를 제외(전체 탭의 "나머지") */
  negate: boolean;
  term: string;
  userIds: readonly string[];
};

function applyScope(q: PgQuery, scope: Scope): PgQuery {
  let r = q;
  if (scope.status) r = scope.negate ? r.neq("status", scope.status) : r.eq("status", scope.status);
  if (scope.term) r = r.or(buildRefundSearchOr(scope.term, scope.userIds));
  return r;
}

async function headCount(db: SupabaseClient, scope: Scope): Promise<{ count: number; error: string | null }> {
  const { count, error } = await applyScope(db.from("refunds").select("id", { count: "exact", head: true }), scope);
  if (error) return { count: 0, error: error.message };
  return { count: count ?? 0, error: null };
}

/** 대기 건은 오래된 것부터(요청일 오름차순), 처리된 건은 처리일 내림차순 */
function applyOrder(q: PgQuery, mode: "pending" | "processed"): PgQuery {
  if (mode === "pending") return q.order("created_at", { ascending: true });
  return q.order("processed_at", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false });
}

async function fetchRange(
  db: SupabaseClient,
  scope: Scope,
  order: "pending" | "processed",
  from: number,
  to: number
): Promise<{ rows: Row[]; count: number; error: string | null }> {
  const q = applyOrder(applyScope(db.from("refunds").select("*", { count: "exact" }), scope), order);
  const r = await q.range(from, to);
  if (!r.error) return { rows: ((r.data as Row[] | null) ?? []), count: r.count ?? 0, error: null };
  if (isRangeNotSatisfiable(r.error)) {
    const head = await headCount(db, scope);
    return { rows: [], count: head.count, error: head.error };
  }
  return { rows: [], count: 0, error: r.error.message };
}

type SubscriptionLite = {
  id: string;
  student_id: string | null;
  mentor_id: string | null;
  plan_tier: string | null;
  status: string | null;
  payment_id: string | null;
  started_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  next_billing_at: string | null;
  cancel_at_period_end: boolean | null;
  canceled_at: string | null;
  expired_at: string | null;
};

type BillingEventLite = {
  id: string;
  subscription_id: string | null;
  amount_cents: number | null;
  payment_id: string | null;
  period_start: string | null;
  period_end: string | null;
  billing_at: string | null;
  event_type: string | null;
  status: string | null;
};

async function loadSubscriptionsByIds(db: SupabaseClient, ids: readonly string[]): Promise<Map<string, SubscriptionLite>> {
  const map = new Map<string, SubscriptionLite>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return map;
  const { data, error } = await db.from("subscriptions").select(SUBSCRIPTION_COLUMNS).in("id", unique);
  if (error) {
    console.error("[refundConsole] subscriptions 조회 실패:", error.message);
    return map;
  }
  for (const row of (data as SubscriptionLite[] | null) ?? []) if (row.id) map.set(row.id, row);
  return map;
}

/** 구독별 성공 청구 이벤트(initial·renewal) — 최신순 */
async function loadBillingEventsBySubscription(db: SupabaseClient, subscriptionIds: readonly string[]): Promise<Map<string, BillingEventLite[]>> {
  const map = new Map<string, BillingEventLite[]>();
  const unique = [...new Set(subscriptionIds.filter(Boolean))];
  if (!unique.length) return map;
  const { data, error } = await db
    .from("subscription_billing_events")
    .select(BILLING_EVENT_COLUMNS)
    .in("subscription_id", unique)
    .eq("status", "succeeded")
    .in("event_type", ["initial", "renewal"])
    .order("billing_at", { ascending: false });
  if (error) {
    console.error("[refundConsole] subscription_billing_events 조회 실패:", error.message);
    return map;
  }
  for (const row of (data as BillingEventLite[] | null) ?? []) {
    const sid = str(row.subscription_id);
    if (!sid) continue;
    map.set(sid, [...(map.get(sid) ?? []), row]);
  }
  return map;
}

/**
 * 이 환불이 대응하는 청구 이벤트 — `refunds.billing_event_id` 가 가리키는 행이 우선, 없으면 요청 시점 이전의 최신 성공 청구, 그것도 없으면 최신.
 */
function pickBillingEvent(events: readonly BillingEventLite[] | undefined, billingEventId: string | null, requestedAt: string | null): BillingEventLite | null {
  if (!events?.length) return null;
  if (billingEventId) {
    const exact = events.find((e) => e.id === billingEventId);
    if (exact) return exact;
  }
  const requested = requestedAt ? new Date(requestedAt).getTime() : NaN;
  if (Number.isFinite(requested)) {
    const before = events.find((e) => e.billing_at && new Date(e.billing_at).getTime() <= requested);
    if (before) return before;
  }
  return events[0];
}

type BasisInputs = {
  refund: Row;
  kind: RefundKind;
  subscription: SubscriptionLite | null;
  billing: BillingEventLite | null;
};

/**
 * 학생 화면 계산 함수를 **요청 시점** 기준으로 그대로 호출한다.
 * 입력 우선순위는 `requestSubscriptionProratedRefundAction`(학생 액션)과 같다: 구독 current_period → 청구 이벤트 period.
 */
async function computeBasis(usageDb: SupabaseClient, input: BasisInputs): Promise<RefundBasis | null> {
  const mode = refundModeForKind(input.kind);
  if (!mode) return null;
  const { refund, subscription, billing } = input;
  const periodStart = strOrNull(subscription?.current_period_start) ?? strOrNull(billing?.period_start);
  const periodEnd = strOrNull(subscription?.current_period_end) ?? strOrNull(billing?.period_end);
  const paidAmountCents = num(billing?.amount_cents);
  const requestedAtRaw = strOrNull(refund.created_at);
  const requestedAt = requestedAtRaw ? new Date(requestedAtRaw) : new Date();
  const studentId = str(refund.user_id);
  const mentorId = strOrNull(subscription?.mentor_id);

  let usageStarted: boolean | null = null;
  if (mode === "student_voluntary") {
    // 학생 액션과 같은 판정 — 멘토 미상(이상 데이터)은 보수적으로 true
    usageStarted = mentorId
      ? await hasSubscriptionUsageStartedForPair(usageDb, { studentId, mentorId, periodStartIso: periodStart })
      : true;
  }

  const estimate = computeProratedRefundEstimate({
    amountCents: paidAmountCents,
    periodStartIso: periodStart,
    periodEndIso: periodEnd,
    now: Number.isNaN(requestedAt.getTime()) ? new Date() : requestedAt,
    usageStarted: usageStarted ?? undefined,
    mode,
  });
  return describeRefundBasis(estimate, { periodStart, periodEnd, usageStarted, paidAmountCents });
}

type EnrichOptions = {
  /** 기준 재계산 대상 — 목록은 대기 건만, 상세는 항상 */
  basisFor: "pending" | "all";
};

async function enrichRefundRows(session: SupabaseClient, rows: Row[], opts: EnrichOptions): Promise<RefundQueueItem[]> {
  const db = adminReadClient(session);
  const now = new Date();
  const userIds = rows.flatMap((r) => [str(r.user_id), str(r.processed_by)]).filter(Boolean);
  const subIds = rows.map((r) => str(r.subscription_id)).filter(Boolean);
  const [users, subscriptions] = await Promise.all([loadUsersByIds(db, userIds), loadSubscriptionsByIds(db, subIds)]);
  const billing = await loadBillingEventsBySubscription(db, subIds);

  const items = await Promise.all(
    rows.map(async (row): Promise<RefundQueueItem> => {
      const id = str(row.id);
      const status = str(row.status).toLowerCase();
      const pending = status === "pending";
      const kind = resolveRefundKind(row);
      const requesterId = str(row.user_id);
      const processedById = strOrNull(row.processed_by);
      const subscriptionId = strOrNull(row.subscription_id);
      const subscription = subscriptionId ? subscriptions.get(subscriptionId) ?? null : null;
      const billingEvent = subscriptionId
        ? pickBillingEvent(billing.get(subscriptionId), strOrNull(row.billing_event_id), strOrNull(row.created_at))
        : null;
      const planTier = strOrNull(subscription?.plan_tier);
      const wantBasis = opts.basisFor === "all" || pending;
      const basis = wantBasis ? await computeBasis(db, { refund: row, kind, subscription, billing: billingEvent }) : null;
      const amountCents = num(row.amount_cents);
      const createdAt = strOrNull(row.created_at);
      const slaInfo = pending && kind === "subscription_mentor_suspended" ? refundSlaInfo(createdAt, status, now) : null;
      return {
        id,
        status,
        pending,
        kind,
        kindLabel: REFUND_KIND_LABELS[kind],
        requestType: strOrNull(row.request_type),
        requesterId,
        requesterName: displayNameOf(users.get(requesterId)),
        requesterEmail: users.get(requesterId)?.email ?? null,
        amountCents,
        amountWon: refundAmountWon(amountCents),
        reason: strOrNull(row.reason),
        adminNote: strOrNull(row.admin_note),
        createdAt,
        createdAtLabel: formatKoDateTimeKst(createdAt),
        processedAt: strOrNull(row.processed_at),
        processedAtLabel: formatKoDateTimeKst(strOrNull(row.processed_at)),
        processedById,
        processorName: processedById ? displayNameOf(users.get(processedById)) : null,
        subscriptionId,
        paymentId: strOrNull(row.payment_id),
        customRequestOrderId: strOrNull(row.custom_request_order_id),
        planTier,
        planLabel: planLabelOf(planTier),
        basis,
        basisLabel: refundBasisShortLabel(basis),
        sla: slaInfo && slaInfo.daysRemaining !== null ? { label: slaInfo.label, tone: slaInfo.tone } : null,
      };
    })
  );
  return items;
}

export async function loadRefundQueue(
  session: SupabaseClient,
  args: { tab: RefundTab; search: string; page: number; pageSize: number }
): Promise<RefundQueueResult> {
  const db = adminReadClient(session);
  const term = normalizeRefundSearchTerm(args.search);
  const userIds = term ? await searchRefundUserIds(db, term) : [];
  const from = Math.max(0, (args.page - 1) * args.pageSize);
  const to = from + args.pageSize - 1;

  let rows: Row[] = [];
  let totalCount = 0;
  let error: string | null = null;

  if (args.tab !== "all") {
    const status = refundTabStatus(args.tab);
    const scope: Scope = { status, negate: false, term, userIds };
    const r = await fetchRange(db, scope, args.tab === "pending" ? "pending" : "processed", from, to);
    rows = r.rows;
    totalCount = r.count;
    error = r.error;
  } else {
    // 전체 탭: 대기 건이 항상 위(오래된 것부터) — 대기/나머지 두 range 를 서버에서 이어 붙인다.
    const pendingScope: Scope = { status: "pending", negate: false, term, userIds };
    const restScope: Scope = { status: "pending", negate: true, term, userIds };
    const allScope: Scope = { status: null, negate: false, term, userIds };
    const [pendingHead, allHead] = await Promise.all([headCount(db, pendingScope), headCount(db, allScope)]);
    totalCount = allHead.count;
    error = pendingHead.error ?? allHead.error;
    if (!error) {
      const split = splitPendingFirstRange(pendingHead.count, from, to);
      const [p, rest] = await Promise.all([
        split.pending ? fetchRange(db, pendingScope, "pending", split.pending.from, split.pending.to) : Promise.resolve(null),
        split.rest ? fetchRange(db, restScope, "processed", split.rest.from, split.rest.to) : Promise.resolve(null),
      ]);
      rows = [...(p?.rows ?? []), ...(rest?.rows ?? [])];
      error = p?.error ?? rest?.error ?? null;
    }
  }

  const items = await enrichRefundRows(session, rows, { basisFor: "pending" });
  return { rows: items, totalCount, error };
}

/** 탭별 건수(head count 5회, 병렬). 실패한 탭은 0 으로 두고 로그를 남긴다. */
export async function countRefundTabs(session: SupabaseClient): Promise<RefundTabCounts> {
  const db = adminReadClient(session);
  const entries = await Promise.all(
    REFUND_TAB_VALUES.map(async (tab) => {
      const r = await headCount(db, { status: refundTabStatus(tab), negate: false, term: "", userIds: [] });
      if (r.error) console.error(`[countRefundTabs] ${tab}:`, r.error);
      return [tab, r.count] as const;
    })
  );
  return Object.fromEntries(entries) as RefundTabCounts;
}

// ── 상세 ────────────────────────────────────────────────────────────────────

async function loadLedgerForUser(
  db: SupabaseClient,
  userId: string,
  related: { subscriptionId: string | null; paymentId: string | null; refundId: string }
): Promise<{ rows: RefundDetailLedgerRow[]; error: string | null }> {
  const { data, error } = await db
    .from("cash_ledger")
    .select("id, user_id, delta_cents, reason, ref_type, ref_id, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(LEDGER_LIMIT);
  if (error) {
    console.error("[loadRefundDetail] cash_ledger 조회 실패:", error.message);
    return { rows: [], error: error.message };
  }
  const relatedIds = new Set([related.subscriptionId, related.paymentId, related.refundId].filter(Boolean) as string[]);
  const rows = ((data as Row[] | null) ?? []).map((row) => ({
    id: str(row.id),
    at: ledgerAt(row),
    label: ledgerReasonLabel(row),
    amountLabel: ledgerAmountLabel(row),
    credit: ledgerIsCredit(row),
    related: relatedIds.has(str(row.ref_id)),
  }));
  return { rows, error: null };
}

async function loadLinkedDisputes(
  db: SupabaseClient,
  keys: { customRequestOrderId: string | null; paymentId: string | null; subscriptionId: string | null }
): Promise<{ rows: RefundDetailDispute[]; error: string | null }> {
  const parts: string[] = [];
  if (keys.customRequestOrderId) parts.push(`custom_request_order_id.eq.${keys.customRequestOrderId}`);
  if (keys.paymentId) parts.push(`payment_id.eq.${keys.paymentId}`);
  if (keys.subscriptionId) parts.push(`subscription_id.eq.${keys.subscriptionId}`);
  if (!parts.length) return { rows: [], error: null };
  const { data, error } = await db.from("disputes").select("id, status, created_at").or(parts.join(",")).order("created_at", { ascending: false }).limit(5);
  if (error) {
    console.error("[loadRefundDetail] disputes 조회 실패:", error.message);
    return { rows: [], error: error.message };
  }
  return {
    rows: ((data as Row[] | null) ?? []).map((r) => ({ id: str(r.id), status: str(r.status), createdAt: strOrNull(r.created_at) })),
    error: null,
  };
}

async function loadPreviousRefunds(db: SupabaseClient, userId: string, excludeId: string): Promise<RefundDetailPrevious[]> {
  const { data, error } = await db
    .from("refunds")
    .select("id, status, amount_cents, request_type, custom_request_order_id, subscription_id, created_at, processed_at")
    .eq("user_id", userId)
    .neq("id", excludeId)
    .order("created_at", { ascending: false })
    .limit(PREVIOUS_REFUNDS_LIMIT);
  if (error) {
    console.error("[loadRefundDetail] 이전 환불 조회 실패:", error.message);
    return [];
  }
  return ((data as Row[] | null) ?? []).map((r) => ({
    id: str(r.id),
    kindLabel: REFUND_KIND_LABELS[resolveRefundKind(r)],
    amountWon: refundAmountWon(num(r.amount_cents)),
    status: str(r.status).toLowerCase(),
    createdAt: strOrNull(r.created_at),
    processedAt: strOrNull(r.processed_at),
  }));
}

export async function loadRefundDetail(session: SupabaseClient, refundId: string): Promise<{ detail: RefundDetail | null; error: string | null }> {
  const id = str(refundId);
  if (!id) return { detail: null, error: null };
  // refunds 는 admin 정책(is_admin)이 있어 세션으로 읽는다 — 오류는 그대로 표면화(빈 결과로 은폐하지 않음).
  const { data, error } = await session.from("refunds").select("*").eq("id", id).maybeSingle();
  if (error) return { detail: null, error: error.message };
  const row = (data as Row | null) ?? null;
  if (!row) return { detail: null, error: null };

  const [item] = await enrichRefundRows(session, [row], { basisFor: "all" });
  const db = adminReadClient(session);
  const subscriptionRow = item.subscriptionId ? (await loadSubscriptionsByIds(db, [item.subscriptionId])).get(item.subscriptionId) ?? null : null;
  const mentorId = strOrNull(subscriptionRow?.mentor_id);
  const [mentorUsers, ledger, disputes, previousRefunds] = await Promise.all([
    loadUsersByIds(db, mentorId ? [mentorId] : []),
    loadLedgerForUser(db, item.requesterId, { subscriptionId: item.subscriptionId, paymentId: item.paymentId, refundId: item.id }),
    loadLinkedDisputes(db, { customRequestOrderId: item.customRequestOrderId, paymentId: item.paymentId, subscriptionId: item.subscriptionId }),
    loadPreviousRefunds(db, item.requesterId, item.id),
  ]);

  const subscription: RefundDetailSubscription | null = subscriptionRow
    ? {
        id: subscriptionRow.id,
        status: str(subscriptionRow.status).toLowerCase(),
        planTier: strOrNull(subscriptionRow.plan_tier),
        planLabel: planLabelOf(strOrNull(subscriptionRow.plan_tier)),
        mentorId,
        mentorName: mentorId ? displayNameOf(mentorUsers.get(mentorId)) : null,
        startedAt: strOrNull(subscriptionRow.started_at),
        currentPeriodStart: strOrNull(subscriptionRow.current_period_start),
        currentPeriodEnd: strOrNull(subscriptionRow.current_period_end),
        nextBillingAt: strOrNull(subscriptionRow.next_billing_at),
        cancelAtPeriodEnd: bool(subscriptionRow.cancel_at_period_end),
        canceledAt: strOrNull(subscriptionRow.canceled_at),
      }
    : null;

  return {
    detail: {
      ...item,
      subscription,
      ledger: ledger.rows,
      ledgerError: ledger.error,
      disputes: disputes.rows,
      disputesError: disputes.error,
      previousRefunds,
      zeroBasis: isZeroBasisRefund(item.basis),
      basisMismatch: refundBasisMismatch(item.basis, item.amountCents),
    },
    error: null,
  };
}
