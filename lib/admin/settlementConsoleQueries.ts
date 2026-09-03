import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { buildAdminUsersSearchOr, normalizeAdminListSearchTerm } from "@/lib/admin/adminDataTable";
import { isUuidLike, maskAccountNumber } from "@/lib/admin/accountDetailConsole";
import { DISPUTE_FUNDS_FROM } from "@/lib/admin/disputeConsole";
import {
  PAYOUT_RUN_EXECUTE_ACTION_TYPE,
  PAYOUT_RUN_TARGET_TYPE,
  SETTLEMENT_MENTOR_SEARCH_LIMIT,
  buildSettlementPreview,
  currentPayoutRunDate,
  individualQuestionSettlementStatus,
  parsePayoutRunItemRow,
  parsePayoutRunResult,
  parsePayoutRunRow,
  parseReconciliationRow,
  payoutCutoffInstant,
  payoutRunIdempotencyKey,
  reconcilePreviewWithDryRun,
  settlementItemKey,
  settlementPlanTierLabel,
  toCentsInt,
  type MentorSettlementLine,
  type PayoutRunItemRow,
  type PayoutRunResult,
  type PayoutRunRow,
  type ReconciliationCheck,
  type ReconciliationRow,
  type SettlementItemExtra,
  type SettlementMentorInfo,
  type SettlementPreview,
} from "@/lib/admin/settlementConsole";
import { parseSettlementFeeRate } from "@/lib/payout/settlementFeeRate";
import { refreshSubscriptionSettlementItemsBestEffort } from "@/lib/mentor/subscriptionSettlementItems";
import { formatKoreanDate } from "@/lib/utils/formatDisplay";

/**
 * 관리자 · 정산 관리(PR-9) 서버 조회 정본 — **전부 service_role 읽기**.
 *
 * - 정산 RPC 3종(`payout_reconciliation_report` · `run_scheduled_payout` · `pay_due_payouts_for_run`)과 `due_payouts` 뷰 · `payout_runs` 는
 *   service_role 전용 grant 다(anon/authenticated 권한 없음). 세션 클라이언트 폴백은 두지 않는다 — 키가 없으면 화면이 "불러오지 못함" 으로 남는다.
 * - 이 모듈은 **읽기만** 한다. `payout_run_items` 는 UPDATE/DELETE 차단 트리거가 있는 불변 스냅샷이며 여기서 select 만 한다.
 *   실행(쓰기)은 `settlementActions.ts` 의 서버 액션 하나뿐이다.
 * - 미리보기 = 대사표(RPC 건별 행) + 보조 정보(due_payouts 의 gross/fee · 청구 이벤트의 plan_tier · 멘토 이름·계좌) 를 더한 것.
 *   드라이런(`run_scheduled_payout(p_force_dry_run=true)`)은 실행 함수와 같은 코드 경로의 합계다 — 둘을 대조해 실행 잠금을 결정한다.
 */

type Row = Record<string, unknown>;

const PAYOUT_RUN_COLUMNS = "id, run_date, cutoff_end, status, mentor_count, total_mentor_cents, executed_at, created_at, idempotency_key";
const PAYOUT_RUN_ITEM_COLUMNS =
  "id, payout_run_id, mentor_id, source_type, source_id, gross_cents, platform_fee_cents, mentor_amount_cents, fee_rate, ledger_id, created_at, withholding_cents, net_paid_cents";
const USER_NAME_COLUMNS = "id, full_name, nickname, email";
const HOLD_SCAN_LIMIT = 300;
const MENTOR_LINES_LIMIT = 300;

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v);
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

const SERVICE_ROLE_MISSING = "서버 설정(서비스 키)이 없어 정산 데이터를 읽을 수 없습니다.";

function chunk<T>(xs: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

function unique(ids: readonly string[]): string[] {
  return [...new Set(ids.filter(Boolean))];
}

type UserLite = { id: string; fullName: string | null; nickname: string | null; email: string | null };

async function loadUsersByIds(db: SupabaseClient, ids: readonly string[]): Promise<Map<string, UserLite>> {
  const map = new Map<string, UserLite>();
  const wanted = unique(ids);
  if (!wanted.length) return map;
  for (const part of chunk(wanted, 100)) {
    const { data, error } = await db.from("users").select(USER_NAME_COLUMNS).in("id", part);
    if (error) {
      console.error("[settlementConsole] users 조회 실패:", error.message);
      continue;
    }
    for (const row of (data as Row[] | null) ?? []) {
      const id = str(row.id);
      if (id) map.set(id, { id, fullName: strOrNull(row.full_name), nickname: strOrNull(row.nickname), email: strOrNull(row.email) });
    }
  }
  return map;
}

/** 닉네임 우선 → 실명 → id 앞 8자(관리자 화면 관례) */
function displayName(user: UserLite | undefined, id: string): string {
  return user?.nickname || user?.fullName || `${id.slice(0, 8)}…`;
}

// ── 이번 달 정산 미리보기 ─────────────────────────────────────────────────────

export type SettlementHeldItem = {
  sourceType: "subscription" | "custom_request";
  sourceId: string;
  mentorId: string;
  mentorName: string;
  mentorCents: number;
  reason: string;
};

export type SettlementPreviewLoad = {
  runDate: string;
  cutoffIso: string;
  /** 진입 시 구독 정산 항목 동기화(best-effort) 성공 여부 */
  refreshOk: boolean;
  /** 대사표·드라이런을 모두 읽었는가 — false 면 실행 잠금(preview_failed) */
  ok: boolean;
  error: string | null;
  preview: SettlementPreview;
  /** 대사표 원본 행(대사표 보기) */
  rows: ReconciliationRow[];
  mentorNames: Record<string, string>;
  dryRun: PayoutRunResult | null;
  reconciliation: ReconciliationCheck;
  /** 이번 달 멱등키로 이미 완료된 실행 */
  completedRun: PayoutRunRow | null;
  /** cutoff 이전 완료분인데 보류(환불·해지 보류 · 활성 분쟁)로 due_payouts 에서 빠진 건 */
  held: SettlementHeldItem[];
  schedulerEnabled: boolean | null;
};

function emptyPreview(): SettlementPreview {
  return buildSettlementPreview({ rows: [], extras: new Map(), mentors: new Map() });
}

async function loadDuePayoutExtras(db: SupabaseClient): Promise<Map<string, SettlementItemExtra>> {
  const map = new Map<string, SettlementItemExtra>();
  const { data, error } = await db.from("due_payouts").select("source_type, source_id, gross_cents, platform_fee_cents, fee_rate");
  if (error) {
    console.error("[settlementConsole] due_payouts 조회 실패:", error.message);
    return map;
  }
  for (const row of (data as Row[] | null) ?? []) {
    const key = settlementItemKey(str(row.source_type), str(row.source_id));
    map.set(key, {
      grossCents: toCentsInt(row.gross_cents),
      platformFeeCents: toCentsInt(row.platform_fee_cents),
      feeRate: parseSettlementFeeRate(row.fee_rate),
      planTier: null,
      studentId: null,
    });
  }
  return map;
}

/** 구독 항목 → (plan_tier, student_id). tier 는 청구 이벤트 스냅샷 우선, 없으면 구독 행 */
async function loadSubscriptionMeta(db: SupabaseClient, itemIds: readonly string[]): Promise<Map<string, { planTier: string | null; studentId: string | null }>> {
  const out = new Map<string, { planTier: string | null; studentId: string | null }>();
  const wanted = unique(itemIds);
  if (!wanted.length) return out;
  const items: { id: string; billingEventId: string; subscriptionId: string; studentId: string | null }[] = [];
  for (const part of chunk(wanted, 100)) {
    const { data, error } = await db.from("subscription_settlement_items").select("id, billing_event_id, subscription_id, student_id").in("id", part);
    if (error) {
      console.error("[settlementConsole] subscription_settlement_items 조회 실패:", error.message);
      continue;
    }
    for (const row of (data as Row[] | null) ?? []) {
      items.push({ id: str(row.id), billingEventId: str(row.billing_event_id), subscriptionId: str(row.subscription_id), studentId: strOrNull(row.student_id) });
    }
  }
  const tierByEvent = new Map<string, string | null>();
  for (const part of chunk(unique(items.map((i) => i.billingEventId)), 100)) {
    const { data, error } = await db.from("subscription_billing_events").select("id, plan_tier").in("id", part);
    if (error) {
      console.error("[settlementConsole] subscription_billing_events 조회 실패:", error.message);
      continue;
    }
    for (const row of (data as Row[] | null) ?? []) tierByEvent.set(str(row.id), strOrNull(row.plan_tier));
  }
  const missingSubs = unique(items.filter((i) => !tierByEvent.get(i.billingEventId)).map((i) => i.subscriptionId));
  const tierBySub = new Map<string, string | null>();
  for (const part of chunk(missingSubs, 100)) {
    const { data, error } = await db.from("subscriptions").select("id, plan_tier").in("id", part);
    if (error) {
      console.error("[settlementConsole] subscriptions 조회 실패:", error.message);
      continue;
    }
    for (const row of (data as Row[] | null) ?? []) tierBySub.set(str(row.id), strOrNull(row.plan_tier));
  }
  for (const it of items) {
    out.set(it.id, { planTier: tierByEvent.get(it.billingEventId) ?? tierBySub.get(it.subscriptionId) ?? null, studentId: it.studentId });
  }
  return out;
}

async function loadMentorInfos(db: SupabaseClient, mentorIds: readonly string[]): Promise<{ infos: Map<string, SettlementMentorInfo>; names: Record<string, string> }> {
  const infos = new Map<string, SettlementMentorInfo>();
  const names: Record<string, string> = {};
  const wanted = unique(mentorIds);
  if (!wanted.length) return { infos, names };
  const users = await loadUsersByIds(db, wanted);
  const accounts = new Map<string, { bank: string | null; number: string | null }>();
  for (const part of chunk(wanted, 100)) {
    const { data, error } = await db.from("mentor_profiles").select("user_id, payout_bank_name, payout_account_number").in("user_id", part);
    if (error) {
      console.error("[settlementConsole] mentor_profiles 조회 실패:", error.message);
      continue;
    }
    for (const row of (data as Row[] | null) ?? []) {
      accounts.set(str(row.user_id), { bank: strOrNull(row.payout_bank_name), number: strOrNull(row.payout_account_number) });
    }
  }
  for (const id of wanted) {
    const name = displayName(users.get(id), id);
    names[id] = name;
    const acct = accounts.get(id);
    // 등록 판정은 RPC 규칙과 같다 — `coalesce(nullif(trim(payout_account_number), ''), '') <> ''` (은행명은 보지 않는다).
    const registered = String(acct?.number ?? "").trim().length > 0;
    infos.set(id, {
      name,
      accountRegistered: registered,
      accountDisplay: registered ? `${acct?.bank ?? "은행"} ${maskAccountNumber(acct?.number ?? null) ?? ""}`.trim() : "미등록",
    });
  }
  return { infos, names };
}

/** cutoff 이전 완료분인데 보류로 제외되는 건 — 구독 hold 항목 · 활성 분쟁이 걸린 맞춤의뢰 항목 */
async function loadHeldItems(db: SupabaseClient, cutoffIso: string): Promise<SettlementHeldItem[]> {
  const out: SettlementHeldItem[] = [];
  const { data: subs, error: subErr } = await db
    .from("subscription_settlement_items")
    .select("id, mentor_id, mentor_amount_cents, hold_reason, period_end")
    .eq("status", "hold")
    .lte("period_end", cutoffIso)
    .order("period_end", { ascending: false })
    .limit(HOLD_SCAN_LIMIT);
  if (subErr) console.error("[settlementConsole] 구독 보류 조회 실패:", subErr.message);
  for (const row of (subs as Row[] | null) ?? []) {
    out.push({ sourceType: "subscription", sourceId: str(row.id), mentorId: str(row.mentor_id), mentorName: "", mentorCents: toCentsInt(row.mentor_amount_cents), reason: strOrNull(row.hold_reason) ?? "hold" });
  }

  const { data: cos, error: cosErr } = await db
    .from("custom_order_settlement_items")
    .select("id, mentor_id, mentor_amount, custom_request_order_id, status")
    .in("status", ["pending", "on_hold", "payable"])
    .order("created_at", { ascending: false })
    .limit(HOLD_SCAN_LIMIT);
  if (cosErr) console.error("[settlementConsole] 맞춤의뢰 정산 항목 조회 실패:", cosErr.message);
  const cosRows = (cos as Row[] | null) ?? [];
  const orderIds = unique(cosRows.map((r) => str(r.custom_request_order_id)));
  if (orderIds.length) {
    const acceptedAt = new Map<string, string | null>();
    const disputed = new Set<string>();
    for (const part of chunk(orderIds, 100)) {
      const [orders, disputes] = await Promise.all([
        db.from("custom_request_orders").select("id, accepted_at").in("id", part),
        db.from("disputes").select("custom_request_order_id").in("custom_request_order_id", part).in("status", [...DISPUTE_FUNDS_FROM]),
      ]);
      if (orders.error) console.error("[settlementConsole] custom_request_orders 조회 실패:", orders.error.message);
      for (const row of (orders.data as Row[] | null) ?? []) acceptedAt.set(str(row.id), strOrNull(row.accepted_at));
      if (disputes.error) console.error("[settlementConsole] disputes 조회 실패:", disputes.error.message);
      for (const row of (disputes.data as Row[] | null) ?? []) disputed.add(str(row.custom_request_order_id));
    }
    for (const row of cosRows) {
      const oid = str(row.custom_request_order_id);
      const accepted = acceptedAt.get(oid);
      if (!disputed.has(oid) || !accepted || accepted > cutoffIso) continue;
      out.push({ sourceType: "custom_request", sourceId: str(row.id), mentorId: str(row.mentor_id), mentorName: "", mentorCents: toCentsInt(row.mentor_amount) * 100, reason: "active_dispute" });
    }
  }
  return out;
}

export async function loadSettlementPreview(now: Date = new Date()): Promise<SettlementPreviewLoad> {
  const runDate = currentPayoutRunDate(now);
  const cutoffIso = payoutCutoffInstant(runDate).toISOString();
  // D-AD-9(구 화면 유지): 동기화 실패를 무음 처리하지 않는다 — 배너로 알린다.
  const refresh = await refreshSubscriptionSettlementItemsBestEffort();
  const base = {
    runDate,
    cutoffIso,
    refreshOk: refresh.ok,
    preview: emptyPreview(),
    rows: [] as ReconciliationRow[],
    mentorNames: {} as Record<string, string>,
    dryRun: null as PayoutRunResult | null,
    completedRun: null as PayoutRunRow | null,
    held: [] as SettlementHeldItem[],
    schedulerEnabled: null as boolean | null,
  };
  const db = serviceRoleOrNull();
  if (!db) {
    return { ...base, ok: false, error: SERVICE_ROLE_MISSING, reconciliation: { ok: false, diffs: [] } };
  }

  const [report, dry, run] = await Promise.all([
    db.rpc("payout_reconciliation_report", { p_run_date: runDate }),
    // scheduler_enabled 가 꺼져 있어 무조건 드라이런이지만, 켜져도 강제 드라이런이 되도록 p_force_dry_run 을 명시한다.
    db.rpc("run_scheduled_payout", { p_run_date: runDate, p_force_dry_run: true }),
    db.from("payout_runs").select(PAYOUT_RUN_COLUMNS).eq("idempotency_key", payoutRunIdempotencyKey(runDate)).maybeSingle(),
  ]);

  if (report.error) {
    console.error("[settlementConsole] payout_reconciliation_report 실패:", report.error.message);
    return { ...base, ok: false, error: "대사표(payout_reconciliation_report)를 불러오지 못했습니다.", reconciliation: { ok: false, diffs: [] } };
  }
  if (dry.error) console.error("[settlementConsole] run_scheduled_payout(dry run) 실패:", dry.error.message);
  if (run.error) console.error("[settlementConsole] payout_runs 조회 실패:", run.error.message);

  const rows = ((report.data as Row[] | null) ?? []).map(parseReconciliationRow).filter((r): r is ReconciliationRow => r !== null);
  const dryRun = dry.error ? null : parsePayoutRunResult(dry.data);
  const completedRaw = run.data ? parsePayoutRunRow(run.data as Row) : null;
  const completedRun = completedRaw && completedRaw.status === "completed" ? completedRaw : null;

  const [extras, subMeta, held] = await Promise.all([
    loadDuePayoutExtras(db),
    loadSubscriptionMeta(
      db,
      rows.filter((r) => r.sourceType === "subscription").map((r) => r.sourceId)
    ),
    loadHeldItems(db, cutoffIso),
  ]);
  for (const [itemId, meta] of subMeta) {
    const key = settlementItemKey("subscription", itemId);
    const cur = extras.get(key);
    if (cur) extras.set(key, { ...cur, planTier: meta.planTier, studentId: meta.studentId });
  }
  const { infos, names } = await loadMentorInfos(db, [...rows.map((r) => r.mentorId), ...held.map((h) => h.mentorId)]);
  for (const h of held) h.mentorName = names[h.mentorId] ?? `${h.mentorId.slice(0, 8)}…`;

  const preview = buildSettlementPreview({ rows, extras, mentors: infos });
  const reconciliation = reconcilePreviewWithDryRun(preview, dryRun);
  return {
    ...base,
    ok: dryRun !== null,
    error: dryRun === null ? "드라이런(run_scheduled_payout)을 불러오지 못했습니다." : null,
    preview,
    rows,
    mentorNames: names,
    dryRun,
    reconciliation,
    completedRun,
    held,
    schedulerEnabled: dryRun?.schedulerEnabled ?? null,
  };
}

// ── 지급 이력 ────────────────────────────────────────────────────────────────

export type PayoutRunListItem = PayoutRunRow & {
  /** 감사 로그(payout_run_execute)에서 되읽은 실행 관리자 — 없으면 null(스케줄러·수동 SQL 실행) */
  executorName: string | null;
  executorId: string | null;
};

export type PayoutRunListResult = { rows: PayoutRunListItem[]; error: string | null };

export async function loadPayoutRuns(limit = 60): Promise<PayoutRunListResult> {
  const db = serviceRoleOrNull();
  if (!db) return { rows: [], error: SERVICE_ROLE_MISSING };
  const { data, error } = await db.from("payout_runs").select(PAYOUT_RUN_COLUMNS).order("run_date", { ascending: false }).order("created_at", { ascending: false }).limit(limit);
  if (error) {
    console.error("[settlementConsole] payout_runs 목록 실패:", error.message);
    return { rows: [], error: "지급 이력을 불러오지 못했습니다." };
  }
  const runs = ((data as Row[] | null) ?? []).map(parsePayoutRunRow).filter((r): r is PayoutRunRow => r !== null);
  const executors = await loadRunExecutors(db, runs.map((r) => r.id));
  return {
    rows: runs.map((r) => ({ ...r, executorName: executors.get(r.id)?.name ?? null, executorId: executors.get(r.id)?.id ?? null })),
    error: null,
  };
}

async function loadRunExecutors(db: SupabaseClient, runIds: readonly string[]): Promise<Map<string, { id: string; name: string }>> {
  const out = new Map<string, { id: string; name: string }>();
  if (!runIds.length) return out;
  const { data, error } = await db
    .from("admin_action_logs")
    .select("admin_id, target_id, created_at")
    .eq("action_type", PAYOUT_RUN_EXECUTE_ACTION_TYPE)
    .eq("target_type", PAYOUT_RUN_TARGET_TYPE)
    .in("target_id", [...runIds])
    .order("created_at", { ascending: true });
  if (error) {
    console.error("[settlementConsole] admin_action_logs 조회 실패:", error.message);
    return out;
  }
  const rows = (data as Row[] | null) ?? [];
  const users = await loadUsersByIds(db, rows.map((r) => str(r.admin_id)));
  for (const row of rows) {
    const runId = str(row.target_id);
    const adminId = str(row.admin_id);
    if (!runId || !adminId || out.has(runId)) continue;
    out.set(runId, { id: adminId, name: users.get(adminId)?.fullName || users.get(adminId)?.nickname || `${adminId.slice(0, 8)}…` });
  }
  return out;
}

export type PayoutRunDetail = {
  run: PayoutRunListItem;
  items: (PayoutRunItemRow & { mentorName: string })[];
  error: string | null;
};

export async function loadPayoutRunDetail(runId: string): Promise<PayoutRunDetail | null> {
  const db = serviceRoleOrNull();
  if (!db || !isUuidLike(runId)) return null;
  const [runRes, itemsRes] = await Promise.all([
    db.from("payout_runs").select(PAYOUT_RUN_COLUMNS).eq("id", runId).maybeSingle(),
    db.from("payout_run_items").select(PAYOUT_RUN_ITEM_COLUMNS).eq("payout_run_id", runId).order("mentor_id", { ascending: true }).order("created_at", { ascending: true }),
  ]);
  if (runRes.error || !runRes.data) return null;
  const run = parsePayoutRunRow(runRes.data as Row);
  if (!run) return null;
  const items = ((itemsRes.data as Row[] | null) ?? []).map(parsePayoutRunItemRow).filter((r): r is PayoutRunItemRow => r !== null);
  const [executors, users] = await Promise.all([loadRunExecutors(db, [run.id]), loadUsersByIds(db, items.map((i) => i.mentorId))]);
  return {
    run: { ...run, executorName: executors.get(run.id)?.name ?? null, executorId: executors.get(run.id)?.id ?? null },
    items: items.map((i) => ({ ...i, mentorName: displayName(users.get(i.mentorId), i.mentorId) })),
    error: itemsRes.error ? "지급 항목을 불러오지 못했습니다." : null,
  };
}

// ── 멘토별 ───────────────────────────────────────────────────────────────────

export type SettlementMentorSearchHit = { id: string; name: string; nickname: string | null; email: string | null };

export async function searchSettlementMentors(rawTerm: string): Promise<{ hits: SettlementMentorSearchHit[]; error: string | null }> {
  const term = normalizeAdminListSearchTerm(rawTerm);
  if (!term) return { hits: [], error: null };
  const db = serviceRoleOrNull();
  if (!db) return { hits: [], error: SERVICE_ROLE_MISSING };
  let q = db.from("users").select(USER_NAME_COLUMNS).eq("role", "mentor").limit(SETTLEMENT_MENTOR_SEARCH_LIMIT);
  q = isUuidLike(term) ? q.eq("id", term) : q.or(buildAdminUsersSearchOr(term));
  const { data, error } = await q;
  if (error) {
    console.error("[settlementConsole] 멘토 검색 실패:", error.message);
    return { hits: [], error: "멘토를 검색하지 못했습니다." };
  }
  return {
    hits: ((data as Row[] | null) ?? []).map((row) => ({
      id: str(row.id),
      name: strOrNull(row.nickname) || strOrNull(row.full_name) || `${str(row.id).slice(0, 8)}…`,
      nickname: strOrNull(row.nickname),
      email: strOrNull(row.email),
    })),
    error: null,
  };
}

export type MentorSettlementLoad = {
  mentor: { id: string; name: string; email: string | null; accountRegistered: boolean; accountDisplay: string } | null;
  lines: MentorSettlementLine[];
  error: string | null;
};

/**
 * 한 멘토의 정산 항목 전체(구독 · 맞춤의뢰 · 개별질문). `mentor_settlement_lines` RPC 는 `auth.uid()` 고정(멘토 본인용)이라 관리자가
 * 남의 것을 부를 수 없다 → 같은 원천 테이블을 service_role 로 읽는다. 금액은 행 값이고, 개별질문의 멘토 몫은 `due_payouts`(미지급)·
 * `payout_run_items`(지급 완료) 의 DB 값에서 가져온다 — 85% 를 TS 로 계산하지 않는다.
 */
export async function loadMentorSettlementLines(mentorId: string): Promise<MentorSettlementLoad> {
  const db = serviceRoleOrNull();
  if (!db) return { mentor: null, lines: [], error: SERVICE_ROLE_MISSING };
  if (!isUuidLike(mentorId)) return { mentor: null, lines: [], error: null };

  const [users, infos, subs, cos, iqs, pri, due] = await Promise.all([
    loadUsersByIds(db, [mentorId]),
    loadMentorInfos(db, [mentorId]),
    db
      .from("subscription_settlement_items")
      .select("id, billing_event_id, billing_at, period_start, period_end, gross_cents, platform_fee_cents, mentor_amount_cents, fee_rate, status, hold_reason, paid_at")
      .eq("mentor_id", mentorId)
      .order("billing_at", { ascending: false })
      .limit(MENTOR_LINES_LIMIT),
    db
      .from("custom_order_settlement_items")
      .select("id, custom_request_order_id, gross_amount, platform_fee_amount, mentor_amount, fee_rate, status, reason, paid_at, created_at")
      .eq("mentor_id", mentorId)
      .order("created_at", { ascending: false })
      .limit(MENTOR_LINES_LIMIT),
    db
      .from("individual_questions")
      .select("id, title, price_cents, status, released_at, claimed_mentor_id, designated_mentor_id, release_ledger_id, refund_ledger_id")
      .not("released_at", "is", null)
      .or(`claimed_mentor_id.eq.${mentorId},designated_mentor_id.eq.${mentorId}`)
      .order("released_at", { ascending: false })
      .limit(MENTOR_LINES_LIMIT),
    db.from("payout_run_items").select(PAYOUT_RUN_ITEM_COLUMNS).eq("mentor_id", mentorId),
    db.from("due_payouts").select("source_type, source_id, gross_cents, platform_fee_cents, mentor_amount_cents, fee_rate").eq("mentor_id", mentorId),
  ]);

  const user = users.get(mentorId);
  const info = infos.infos.get(mentorId);
  const mentor = user
    ? { id: mentorId, name: displayName(user, mentorId), email: user.email, accountRegistered: info?.accountRegistered ?? false, accountDisplay: info?.accountDisplay ?? "미등록" }
    : null;
  if (!mentor) return { mentor: null, lines: [], error: null };

  const errors = [subs.error, cos.error, iqs.error, pri.error, due.error].filter(Boolean);
  for (const e of errors) console.error("[settlementConsole] 멘토별 정산 조회 실패:", e?.message);

  const paidItems = ((pri.data as Row[] | null) ?? []).map(parsePayoutRunItemRow).filter((r): r is PayoutRunItemRow => r !== null);
  const paidByKey = new Map(paidItems.map((i) => [settlementItemKey(i.sourceType, i.sourceId), i]));
  const runDates = new Map<string, string>();
  for (const part of chunk(unique(paidItems.map((i) => i.payoutRunId)), 100)) {
    const { data } = await db.from("payout_runs").select("id, run_date").in("id", part);
    for (const row of (data as Row[] | null) ?? []) runDates.set(str(row.id), str(row.run_date));
  }
  const dueByKey = new Map<string, Row>();
  for (const row of (due.data as Row[] | null) ?? []) dueByKey.set(settlementItemKey(str(row.source_type), str(row.source_id)), row);

  const subMeta = await loadSubscriptionMeta(
    db,
    ((subs.data as Row[] | null) ?? []).map((r) => str(r.id))
  );

  const lines: MentorSettlementLine[] = [];
  const paidInfo = (key: string) => {
    const p = paidByKey.get(key);
    return p ? { paidRunDate: runDates.get(p.payoutRunId) ?? null, paidAt: p.createdAt, item: p } : null;
  };

  for (const row of (subs.data as Row[] | null) ?? []) {
    const id = str(row.id);
    const key = settlementItemKey("subscription", id);
    const paid = paidInfo(key);
    const tier = subMeta.get(id)?.planTier ?? null;
    const period = [row.period_start, row.period_end].map((v) => (v ? formatKoreanDate(v) : "?")).join("~");
    lines.push({
      key,
      sourceType: "subscription",
      sourceId: id,
      occurredAt: strOrNull(row.billing_at),
      description: `구독 · ${settlementPlanTierLabel(tier)} · ${period}`,
      grossCents: toCentsInt(row.gross_cents),
      platformFeeCents: toCentsInt(row.platform_fee_cents),
      mentorCents: toCentsInt(row.mentor_amount_cents),
      feeRate: parseSettlementFeeRate(row.fee_rate),
      status: paid ? "paid" : str(row.status) || "pending",
      holdReason: strOrNull(row.hold_reason),
      paidRunDate: paid?.paidRunDate ?? null,
      paidAt: paid?.paidAt ?? strOrNull(row.paid_at),
    });
  }
  for (const row of (cos.data as Row[] | null) ?? []) {
    const id = str(row.id);
    const key = settlementItemKey("custom_request", id);
    const paid = paidInfo(key);
    const oid = str(row.custom_request_order_id);
    lines.push({
      key,
      sourceType: "custom_request",
      sourceId: id,
      occurredAt: strOrNull(row.created_at),
      description: `맞춤의뢰 · 주문 ${oid.slice(0, 8)}`,
      grossCents: toCentsInt(row.gross_amount) * 100,
      platformFeeCents: toCentsInt(row.platform_fee_amount) * 100,
      mentorCents: toCentsInt(row.mentor_amount) * 100,
      feeRate: parseSettlementFeeRate(row.fee_rate),
      status: paid ? "paid" : str(row.status) || "pending",
      holdReason: strOrNull(row.reason),
      paidRunDate: paid?.paidRunDate ?? null,
      paidAt: paid?.paidAt ?? strOrNull(row.paid_at),
    });
  }
  for (const row of (iqs.data as Row[] | null) ?? []) {
    const responsible = strOrNull(row.claimed_mentor_id) ?? strOrNull(row.designated_mentor_id);
    if (responsible !== mentorId) continue;
    const id = str(row.id);
    const key = settlementItemKey("individual_question", id);
    const paid = paidInfo(key);
    const dueRow = dueByKey.get(key);
    const status = paid ? "paid" : individualQuestionSettlementStatus(row);
    // 멘토 몫: 지급 완료면 스냅샷, 미지급이면 due_payouts 의 DB 계산값. 취소 건은 몫이 없다(0).
    const mentorCents = paid ? paid.item.mentorAmountCents : dueRow ? toCentsInt(dueRow.mentor_amount_cents) : 0;
    const platformFeeCents = paid ? paid.item.platformFeeCents : dueRow ? toCentsInt(dueRow.platform_fee_cents) : 0;
    lines.push({
      key,
      sourceType: "individual_question",
      sourceId: id,
      occurredAt: strOrNull(row.released_at),
      description: `개별질문 · ${strOrNull(row.title) ?? id.slice(0, 8)}`,
      grossCents: paid ? paid.item.grossCents : toCentsInt(row.price_cents),
      platformFeeCents,
      mentorCents,
      feeRate: paid ? paid.item.feeRate : dueRow ? parseSettlementFeeRate(dueRow.fee_rate) : null,
      status,
      holdReason: null,
      paidRunDate: paid?.paidRunDate ?? null,
      paidAt: paid?.paidAt ?? null,
    });
  }
  lines.sort((a, b) => String(b.occurredAt ?? "").localeCompare(String(a.occurredAt ?? "")));
  return { mentor, lines, error: errors.length ? "일부 정산 항목을 불러오지 못했습니다." : null };
}
