/**
 * 관리자 · 정산 관리 화면(PR-9)의 순수 규칙 — 이번 달 정산(미리보기 → 실행) · 지급 이력 · 멘토별 탭이 함께 쓴다.
 *
 * §0 확인 결과(화면 설계의 근거 — 지시서 §11 보고):
 * - `run_scheduled_payout(p_run_date, p_force_dry_run)` 은 `payout_settings.scheduler_enabled`(오너 결정: 항상 false)를 읽어
 *   **꺼져 있으면 무조건 드라이런**으로 `pay_due_payouts_for_run(p_run_date, null, true)` 를 부른다. 따라서 이 함수는 화면의
 *   **미리보기(드라이런) 호출**이고, 실제 실행은 `pay_due_payouts_for_run(p_run_date, null, false)` 를 직접 부른다(둘을 순서대로 부르는 게 아니다).
 * - `pay_due_payouts_for_run` 은 `due_payouts` 중 `completion_ts <= cutoff`(= run_date 달 1일 00:00 KST − 1초 = 전월 말) 이고
 *   `payout_run_items` 에 없는 건을 멘토별로 돌며 캐시 원장(멘토 앞 +정산금 · −원천징수)·지갑·`payout_run_items` 스냅샷을 쓴다.
 *   **실제 송금은 하지 않는다.** 계좌 미등록 멘토 건은 `skipped_no_account` 로 세고 건너뛴다(다음 달 재포착). `payout_runs` 는
 *   `payout:YYYY-MM` 멱등키로 한 달에 한 행 — 이미 `completed` 면 그 결과를 돌려주고 아무것도 쓰지 않는다.
 * - `payout_reconciliation_report(p_run_date)` 는 `due_payouts` 건별로 `eligible`·`reason`(eligible / no_payout_account / not_due / already_paid)
 *   과 `withholding_cents`·`net_paid_cents` 를 돌려주는 **건별 대사표**다. 캐시 원장과의 비교는 아니다 — 이 화면의 대사는
 *   "대사표의 지급 대상 합계 == 드라이런(실행 함수와 같은 코드 경로)의 합계" 다. 둘이 다르면 실행을 잠근다.
 * - `calc_withholding_cents` 3.3%(캐시 단위 절사)는 두 RPC 안에서 계산된다 — 여기서 재계산하지 않는다. 금액은 전부 RPC·DB 값 그대로.
 * - `refresh_subscription_settlement_items` 는 성공 청구 이벤트 → 구독 정산 항목을 만든다(매시 정각 cron). 화면 진입 시 best-effort 로 한 번 더 부른다(구 화면과 동일).
 *
 * 멘토별 금액은 각 멘토 실제 단가(정산 항목의 gross_cents = 청구 금액)에서 온다 — 요금제별 고정 단가로 계산하지 않는다(PR-1b).
 *
 * node --test 계약 테스트가 직접 import 하므로 React·`@/` import 를 두지 않는다.
 */
import { ADMIN_CONFIRM_REASON_MIN_LENGTH } from "./adminConfirmPolicy.ts";
import { minorCentsToCash } from "../mentor/subscriptionSettlementItemsCore.ts";
import { parseSettlementFeeRate } from "../payout/settlementFeeRate.ts";
import { SUBSCRIBE_PLAN_CATALOG } from "../subscribe/subscribePlanCatalog.ts";

export const SETTLEMENT_BASE_PATH = "/admin/settlements";

// ── 탭 · 링크 ─────────────────────────────────────────────────────────────────

export const SETTLEMENT_TAB_PARAM = "tab";
export const SETTLEMENT_TAB_VALUES = ["current", "history", "mentor"] as const;
export type SettlementTab = (typeof SETTLEMENT_TAB_VALUES)[number];
export const SETTLEMENT_DEFAULT_TAB: SettlementTab = "current";
export const SETTLEMENT_TABS: readonly { value: SettlementTab; label: string }[] = [
  { value: "current", label: "이번 달 정산" },
  { value: "history", label: "지급 이력" },
  { value: "mentor", label: "멘토별" },
];
/** 지급 이력 탭에서 펼친 실행(payout_runs.id) */
export const SETTLEMENT_RUN_PARAM = "run";
/** 멘토별 탭에서 고른 멘토(users.id) */
export const SETTLEMENT_MENTOR_PARAM = "mentor";

export function resolveSettlementTab(raw: string | null | undefined): SettlementTab {
  const v = String(raw ?? "").trim();
  return (SETTLEMENT_TAB_VALUES as readonly string[]).includes(v) ? (v as SettlementTab) : SETTLEMENT_DEFAULT_TAB;
}

export function buildSettlementUrl(opts: { tab?: SettlementTab; run?: string | null; mentor?: string | null; q?: string | null } = {}): string {
  const usp = new URLSearchParams();
  const tab = opts.tab ?? SETTLEMENT_DEFAULT_TAB;
  if (tab !== SETTLEMENT_DEFAULT_TAB) usp.set(SETTLEMENT_TAB_PARAM, tab);
  if (opts.run) usp.set(SETTLEMENT_RUN_PARAM, opts.run);
  if (opts.mentor) usp.set(SETTLEMENT_MENTOR_PARAM, opts.mentor);
  if (opts.q) usp.set("q", opts.q);
  const qs = usp.toString();
  return qs ? `${SETTLEMENT_BASE_PATH}?${qs}` : SETTLEMENT_BASE_PATH;
}

/** 계정 상세(PR-7) 멘토 탭 → 이 화면 멘토별 탭 링크 */
export function settlementMentorTabPath(mentorId: string): string {
  return buildSettlementUrl({ tab: "mentor", mentor: mentorId });
}

// ── 지급일 · cutoff — pay_due_payouts_for_run 의 p_run_date 규칙과 같다 ────────

/** 지급일 — 매월 23일(설명서 · mentor_settlement_lines 의 expected_run_date 식과 동일) */
export const PAYOUT_RUN_DAY_OF_MONTH = 23;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function kstParts(at: Date): { year: number; month: number; day: number } {
  const s = new Date(at.getTime() + KST_OFFSET_MS);
  return { year: s.getUTCFullYear(), month: s.getUTCMonth() + 1, day: s.getUTCDate() };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * 이번 달 지급일(KST 달력 기준 그 달의 23일) — 화면이 부르는 RPC 의 `p_run_date`.
 * 과거·미래 달을 고르는 입력은 두지 않는다: 멱등키가 `payout:YYYY-MM` 이라 다음 달 키를 미리 쓰면 그 달의 실제 실행이 무효(no-op)가 되고,
 * 첫 실행(payout_runs 0건)은 cutoff 이전 미지급 건 전부를 포착하므로 지난 달을 따로 돌릴 필요가 없다.
 */
export function currentPayoutRunDate(now: Date): string {
  const { year, month } = kstParts(now);
  return `${year}-${pad2(month)}-${pad2(PAYOUT_RUN_DAY_OF_MONTH)}`;
}

export function isPayoutRunDate(raw: string | null | undefined): boolean {
  return DATE_RE.test(String(raw ?? "").trim());
}

/** `payout:YYYY-MM` — RPC 본문 `'payout:' || to_char(p_run_date, 'YYYY-MM')` 과 같은 식 */
export function payoutRunIdempotencyKey(runDate: string): string {
  const m = DATE_RE.exec(runDate);
  if (!m) throw new Error(`payoutRunIdempotencyKey: invalid run date ${runDate}`);
  return `payout:${m[1]}-${m[2]}`;
}

/** cutoff instant = run_date 달 1일 00:00 KST − 1초 (RPC: `(date_trunc('month', p_run_date::timestamp) at time zone 'Asia/Seoul') - interval '1 second'`) */
export function payoutCutoffInstant(runDate: string): Date {
  const m = DATE_RE.exec(runDate);
  if (!m) throw new Error(`payoutCutoffInstant: invalid run date ${runDate}`);
  const monthStartKst = Date.UTC(Number(m[1]), Number(m[2]) - 1, 1) - KST_OFFSET_MS;
  return new Date(monthStartKst - 1000);
}

/** "2026년 9월 정산 · 지급 예정일 9월 23일" */
export function payoutRunTitle(runDate: string): string {
  const m = DATE_RE.exec(runDate);
  if (!m) return "이번 달 정산";
  const month = Number(m[2]);
  return `${m[1]}년 ${month}월 정산 · 지급 예정일 ${month}월 ${Number(m[3])}일`;
}

/** "8월 31일 23:59(KST)까지 완료된 건" */
export function payoutCutoffLabel(runDate: string): string {
  const cutoff = payoutCutoffInstant(runDate);
  const { month, day } = kstParts(cutoff);
  return `${month}월 ${day}일 23:59(KST)까지 완료된 건`;
}

// ── 대사표(payout_reconciliation_report) 행 ─────────────────────────────────

export const SETTLEMENT_SOURCE_TYPES = ["subscription", "individual_question", "custom_request"] as const;
export type SettlementSourceType = (typeof SETTLEMENT_SOURCE_TYPES)[number];
export const SETTLEMENT_SOURCE_LABELS: Readonly<Record<SettlementSourceType, string>> = {
  subscription: "구독",
  individual_question: "개별질문",
  custom_request: "맞춤의뢰",
};

export function isSettlementSourceType(v: unknown): v is SettlementSourceType {
  return typeof v === "string" && (SETTLEMENT_SOURCE_TYPES as readonly string[]).includes(v);
}

export function settlementSourceLabel(v: unknown): string {
  return isSettlementSourceType(v) ? SETTLEMENT_SOURCE_LABELS[v] : String(v ?? "—");
}

export const RECONCILIATION_REASONS = ["eligible", "no_payout_account", "not_due", "already_paid"] as const;
export type ReconciliationReason = (typeof RECONCILIATION_REASONS)[number];
export const RECONCILIATION_REASON_LABELS: Readonly<Record<ReconciliationReason, string>> = {
  eligible: "지급 대상",
  no_payout_account: "계좌 미등록",
  not_due: "미도래(다음 달)",
  already_paid: "지급 완료",
};

export function reconciliationReasonLabel(v: unknown): string {
  const s = String(v ?? "").trim();
  return (RECONCILIATION_REASONS as readonly string[]).includes(s) ? RECONCILIATION_REASON_LABELS[s as ReconciliationReason] : s || "—";
}

export type ReconciliationRow = {
  sourceType: SettlementSourceType;
  sourceId: string;
  mentorId: string;
  mentorAmountCents: number;
  withholdingCents: number;
  netPaidCents: number;
  eligible: boolean;
  reason: ReconciliationReason | string;
};

export function toCentsInt(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : 0;
  }
  return 0;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v);
}

/** RPC 행 → 대사표 행. 채널·id·멘토가 없으면 null(집계에서 제외 — 조용히 0 으로 접지 않는다). */
export function parseReconciliationRow(row: Record<string, unknown>): ReconciliationRow | null {
  const sourceType = str(row.source_type);
  const sourceId = str(row.source_id);
  const mentorId = str(row.mentor_id);
  if (!isSettlementSourceType(sourceType) || !sourceId || !mentorId) return null;
  return {
    sourceType,
    sourceId,
    mentorId,
    mentorAmountCents: toCentsInt(row.mentor_amount_cents),
    withholdingCents: toCentsInt(row.withholding_cents),
    netPaidCents: toCentsInt(row.net_paid_cents),
    eligible: row.eligible === true || row.eligible === "true",
    reason: str(row.reason) || (row.eligible === true ? "eligible" : ""),
  };
}

// ── 드라이런 / 실행 결과(run_scheduled_payout jsonb · pay_due_payouts_for_run 행) ─

export type PayoutRunResult = {
  runId: string | null;
  dryRun: boolean;
  paidCount: number;
  skippedNoAccount: number;
  totalMentorCents: number;
  totalWithholdingCents: number;
  totalNetCents: number;
  /** run_scheduled_payout 만 돌려준다 — pay_due_payouts_for_run 행이면 null */
  schedulerEnabled: boolean | null;
};

/** jsonb(객체) 또는 returns table 의 1행(배열의 첫 요소)을 같은 형상으로. 비어 있거나 형상이 아니면 null. */
export function parsePayoutRunResult(payload: unknown): PayoutRunResult | null {
  const raw = Array.isArray(payload) ? payload[0] : payload;
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!("paid_count" in r) || !("total_mentor_cents" in r)) return null;
  return {
    runId: str(r.run_id) || null,
    dryRun: r.dry_run === true || r.dry_run === "true",
    paidCount: toCentsInt(r.paid_count),
    skippedNoAccount: toCentsInt(r.skipped_no_account),
    totalMentorCents: toCentsInt(r.total_mentor_cents),
    totalWithholdingCents: toCentsInt(r.total_withholding_cents),
    totalNetCents: toCentsInt(r.total_net_cents),
    schedulerEnabled: typeof r.scheduler_enabled === "boolean" ? r.scheduler_enabled : null,
  };
}

// ── 미리보기 집계 ────────────────────────────────────────────────────────────

/** 대사표 행의 보조 정보 키 — `${source_type}:${source_id}` */
export function settlementItemKey(sourceType: string, sourceId: string): string {
  return `${sourceType}:${sourceId}`;
}

export type SettlementItemExtra = {
  /** due_payouts 의 gross_cents · platform_fee_cents(DB 값 그대로) */
  grossCents: number;
  platformFeeCents: number;
  feeRate: number | null;
  /** 구독 항목만 — 청구 이벤트의 plan_tier(limited/standard/premium). 모르면 null */
  planTier: string | null;
  /** 구독 항목만 — 요금제별 "N명" 을 세기 위한 학생 id */
  studentId: string | null;
};

export type SettlementMentorInfo = {
  /** 닉네임 우선, 없으면 실명, 없으면 id 앞 8자 */
  name: string;
  accountRegistered: boolean;
  /** 마스킹 계좌 표기(예: "국민 ****1234") · 미등록이면 "미등록" */
  accountDisplay: string;
};

export type SettlementPreviewInput = {
  rows: readonly ReconciliationRow[];
  extras: ReadonlyMap<string, SettlementItemExtra>;
  mentors: ReadonlyMap<string, SettlementMentorInfo>;
};

export type SettlementTierBreakdown = {
  /** 정산 항목(청구 사이클) 건수 */
  count: number;
  /** 서로 다른 학생 수 — 화면의 "라이트 N명". 학생 id 를 모르는 항목은 건수로 센다 */
  studentCount: number;
  grossCents: number;
  mentorCents: number;
};

export type SettlementSourceBreakdown = { count: number; grossCents: number; mentorCents: number };

export type SettlementMentorPreview = {
  mentorId: string;
  name: string;
  accountRegistered: boolean;
  accountDisplay: string;
  /** 이번 실행에서 지급되는 멘토인가(= 대사표 eligible 행이 1건 이상) */
  eligible: boolean;
  itemCount: number;
  grossCents: number;
  platformFeeCents: number;
  mentorCents: number;
  withholdingCents: number;
  netCents: number;
  subscription: SettlementSourceBreakdown & { byTier: Readonly<Record<string, SettlementTierBreakdown>> };
  individual: SettlementSourceBreakdown;
  custom: SettlementSourceBreakdown;
};

export type SettlementPreviewTotals = {
  mentorCount: number;
  itemCount: number;
  grossCents: number;
  platformFeeCents: number;
  mentorCents: number;
  withholdingCents: number;
  netCents: number;
  bySource: Readonly<Record<SettlementSourceType, SettlementSourceBreakdown>>;
};

export type SettlementPreview = {
  /** 지급 대상(eligible) 합계 — 맨 위에 보이는 숫자 */
  totals: SettlementPreviewTotals;
  /** 지급 대상 멘토(실지급액 큰 순) */
  mentors: SettlementMentorPreview[];
  /** 계좌 미등록으로 이번 실행에서 제외되는 멘토·금액 */
  noAccount: { mentors: SettlementMentorPreview[]; mentorCount: number; itemCount: number; mentorCents: number; netCents: number };
  /** cutoff 이후 완료 — 다음 달 대상 */
  notDue: { count: number; mentorCents: number };
  /** payout_run_items 에 이미 있는 건(정상이라면 0) */
  alreadyPaid: { count: number; mentorCents: number };
};

function emptySource(): SettlementSourceBreakdown {
  return { count: 0, grossCents: 0, mentorCents: 0 };
}

function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

type MentorAcc = {
  row: SettlementMentorPreview;
  tierStudents: Map<string, Set<string>>;
};

function newMentorAcc(mentorId: string, info: SettlementMentorInfo | undefined): MentorAcc {
  return {
    row: {
      mentorId,
      name: info?.name || shortId(mentorId),
      accountRegistered: info?.accountRegistered ?? false,
      accountDisplay: info?.accountDisplay ?? "미등록",
      eligible: false,
      itemCount: 0,
      grossCents: 0,
      platformFeeCents: 0,
      mentorCents: 0,
      withholdingCents: 0,
      netCents: 0,
      subscription: { ...emptySource(), byTier: {} },
      individual: emptySource(),
      custom: emptySource(),
    },
    tierStudents: new Map(),
  };
}

const PLAN_TIER_ORDER: readonly string[] = SUBSCRIBE_PLAN_CATALOG.map((p) => p.tier);
const UNKNOWN_TIER = "unknown";

/** 요금제 표기 — 카탈로그 라벨(라이트/스탠다드/프리미엄). 모르는 tier 는 "요금제 미상" */
export function settlementPlanTierLabel(tier: string | null | undefined): string {
  const t = String(tier ?? "").trim();
  const found = SUBSCRIBE_PLAN_CATALOG.find((p) => p.tier === t);
  return found ? found.label : "요금제 미상";
}

/** 요금제별 내역을 카탈로그 순(라이트 → 스탠다드 → 프리미엄 → 미상)으로 */
export function orderedTierBreakdown(byTier: Readonly<Record<string, SettlementTierBreakdown>>): { tier: string; label: string; breakdown: SettlementTierBreakdown }[] {
  const keys = Object.keys(byTier).sort((a, b) => {
    const ia = PLAN_TIER_ORDER.indexOf(a);
    const ib = PLAN_TIER_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  return keys.map((tier) => ({ tier, label: settlementPlanTierLabel(tier), breakdown: byTier[tier] }));
}

function addSource(target: SettlementSourceBreakdown, grossCents: number, mentorCents: number): void {
  target.count += 1;
  target.grossCents += grossCents;
  target.mentorCents += mentorCents;
}

function sortMentors(rows: SettlementMentorPreview[]): SettlementMentorPreview[] {
  return rows.sort((a, b) => b.netCents - a.netCents || a.name.localeCompare(b.name, "ko"));
}

/**
 * 대사표 행 + 보조 정보 → 미리보기. 금액은 행(RPC)·보조 정보(DB) 값을 **더하기만** 한다.
 * 지급 대상(eligible) 행만 합계·멘토별 표에 들어가고, 계좌 미등록 행은 별도 묶음(경고), not_due·already_paid 는 건수·금액만 센다.
 */
export function buildSettlementPreview(input: SettlementPreviewInput): SettlementPreview {
  const eligible = new Map<string, MentorAcc>();
  const noAccount = new Map<string, MentorAcc>();
  const bySource: Record<SettlementSourceType, SettlementSourceBreakdown> = {
    subscription: emptySource(),
    individual_question: emptySource(),
    custom_request: emptySource(),
  };
  const totals = { itemCount: 0, grossCents: 0, platformFeeCents: 0, mentorCents: 0, withholdingCents: 0, netCents: 0 };
  const notDue = { count: 0, mentorCents: 0 };
  const alreadyPaid = { count: 0, mentorCents: 0 };

  for (const r of input.rows) {
    if (!r.eligible) {
      if (r.reason === "not_due") {
        notDue.count += 1;
        notDue.mentorCents += r.mentorAmountCents;
        continue;
      }
      if (r.reason === "already_paid") {
        alreadyPaid.count += 1;
        alreadyPaid.mentorCents += r.mentorAmountCents;
        continue;
      }
      if (r.reason !== "no_payout_account") continue;
    }
    const bucket = r.eligible ? eligible : noAccount;
    let acc = bucket.get(r.mentorId);
    if (!acc) {
      acc = newMentorAcc(r.mentorId, input.mentors.get(r.mentorId));
      bucket.set(r.mentorId, acc);
    }
    const extra = input.extras.get(settlementItemKey(r.sourceType, r.sourceId));
    const grossCents = extra?.grossCents ?? 0;
    const platformFeeCents = extra?.platformFeeCents ?? 0;
    const row = acc.row;
    row.eligible = row.eligible || r.eligible;
    row.itemCount += 1;
    row.grossCents += grossCents;
    row.platformFeeCents += platformFeeCents;
    row.mentorCents += r.mentorAmountCents;
    row.withholdingCents += r.withholdingCents;
    row.netCents += r.netPaidCents;

    if (r.sourceType === "subscription") {
      addSource(row.subscription, grossCents, r.mentorAmountCents);
      const tier = extra?.planTier && PLAN_TIER_ORDER.includes(extra.planTier) ? extra.planTier : UNKNOWN_TIER;
      const byTier = row.subscription.byTier as Record<string, SettlementTierBreakdown>;
      const tb = byTier[tier] ?? (byTier[tier] = { count: 0, studentCount: 0, grossCents: 0, mentorCents: 0 });
      tb.count += 1;
      tb.grossCents += grossCents;
      tb.mentorCents += r.mentorAmountCents;
      const students = acc.tierStudents.get(tier) ?? new Set<string>();
      students.add(extra?.studentId || `item:${r.sourceId}`);
      acc.tierStudents.set(tier, students);
      tb.studentCount = students.size;
    } else if (r.sourceType === "individual_question") {
      addSource(row.individual, grossCents, r.mentorAmountCents);
    } else {
      addSource(row.custom, grossCents, r.mentorAmountCents);
    }

    if (r.eligible) {
      totals.itemCount += 1;
      totals.grossCents += grossCents;
      totals.platformFeeCents += platformFeeCents;
      totals.mentorCents += r.mentorAmountCents;
      totals.withholdingCents += r.withholdingCents;
      totals.netCents += r.netPaidCents;
      addSource(bySource[r.sourceType], grossCents, r.mentorAmountCents);
    }
  }

  const mentors = sortMentors([...eligible.values()].map((a) => a.row));
  const noAccountRows = sortMentors([...noAccount.values()].map((a) => a.row));
  return {
    totals: { mentorCount: mentors.length, ...totals, bySource },
    mentors,
    noAccount: {
      mentors: noAccountRows,
      mentorCount: noAccountRows.length,
      itemCount: noAccountRows.reduce((s, m) => s + m.itemCount, 0),
      mentorCents: noAccountRows.reduce((s, m) => s + m.mentorCents, 0),
      netCents: noAccountRows.reduce((s, m) => s + m.netCents, 0),
    },
    notDue,
    alreadyPaid,
  };
}

/** 미리보기 합계 == 멘토별 합 — 화면 렌더 전 자기 검증(계약 테스트 §4 "합계 = 멘토별 합") */
export function previewTotalsMatchMentors(preview: SettlementPreview): boolean {
  const sum = (k: "mentorCents" | "withholdingCents" | "netCents" | "itemCount") => preview.mentors.reduce((s, m) => s + m[k], 0);
  return (
    sum("mentorCents") === preview.totals.mentorCents &&
    sum("withholdingCents") === preview.totals.withholdingCents &&
    sum("netCents") === preview.totals.netCents &&
    sum("itemCount") === preview.totals.itemCount
  );
}

// ── 대사: 대사표(eligible 합계) vs 드라이런(실행 함수와 같은 코드 경로) ─────────

export type ReconciliationDiff = { label: string; report: number; dryRun: number; unit: "건" | "원" };
export type ReconciliationCheck = { ok: boolean; diffs: ReconciliationDiff[] };

export function reconcilePreviewWithDryRun(preview: SettlementPreview, dryRun: PayoutRunResult | null): ReconciliationCheck {
  if (!dryRun) return { ok: false, diffs: [{ label: "드라이런 결과 없음", report: preview.totals.itemCount, dryRun: 0, unit: "건" }] };
  const diffs: ReconciliationDiff[] = [];
  const check = (label: string, report: number, dry: number, unit: "건" | "원") => {
    if (report !== dry) diffs.push({ label, report, dryRun: dry, unit });
  };
  check("지급 대상 건수", preview.totals.itemCount, dryRun.paidCount, "건");
  check("계좌 미등록 건수", preview.noAccount.itemCount, dryRun.skippedNoAccount, "건");
  check("멘토 정산금 합계", preview.totals.mentorCents, dryRun.totalMentorCents, "원");
  check("원천징수 합계", preview.totals.withholdingCents, dryRun.totalWithholdingCents, "원");
  check("실지급 합계", preview.totals.netCents, dryRun.totalNetCents, "원");
  return { ok: diffs.length === 0, diffs };
}

// ── 실행(critical) ────────────────────────────────────────────────────────────

export const SETTLEMENT_EXECUTE_REASON_FIELD = "reason";
export const SETTLEMENT_EXECUTE_FIELDS = {
  runDate: "runDate",
  expectedCount: "expectedCount",
  expectedSkipped: "expectedSkipped",
  expectedMentorCents: "expectedMentorCents",
  expectedWithholdingCents: "expectedWithholdingCents",
  expectedNetCents: "expectedNetCents",
} as const;

export const SETTLEMENT_EXECUTE_REASON_REQUIRED_MESSAGE = "정산 실행 사유를 입력해 주세요.";
export const SETTLEMENT_EXECUTE_REASON_PRESETS: readonly string[] = ["월 정산 정기 실행", "대사표 확인 완료 · 지급 확정"];

export function isSettlementReasonValid(reason: string | null | undefined): boolean {
  return String(reason ?? "").trim().length >= ADMIN_CONFIRM_REASON_MIN_LENGTH;
}

export type SettlementExecuteBlock = "preview_failed" | "reconciliation_mismatch" | "already_completed" | "nothing_eligible";

export const SETTLEMENT_EXECUTE_BLOCK_MESSAGES: Readonly<Record<SettlementExecuteBlock, string>> = {
  preview_failed: "미리보기를 불러오지 못해 실행할 수 없습니다. 새로고침 후 다시 확인해 주세요.",
  reconciliation_mismatch: "대사표와 드라이런 합계가 다릅니다. 실행이 잠겼습니다 — 차이를 확인한 뒤 담당자에게 문의해 주세요.",
  already_completed: "이번 달 정산은 이미 실행되었습니다. 남은 건은 다음 달 실행에서 지급됩니다.",
  nothing_eligible: "이번 실행에서 지급할 건이 없습니다.",
};

/** 실행 버튼을 잠그는 이유(우선순위 순). null 이면 실행 가능. */
export function settlementExecuteBlock(input: {
  previewOk: boolean;
  reconciled: boolean;
  alreadyCompleted: boolean;
  eligibleCount: number;
}): SettlementExecuteBlock | null {
  if (!input.previewOk) return "preview_failed";
  if (input.alreadyCompleted) return "already_completed";
  if (!input.reconciled) return "reconciliation_mismatch";
  if (input.eligibleCount <= 0) return "nothing_eligible";
  return null;
}

/** cents → "1,234,500원" (캐시 단위 절사 — minorCentsToCash 와 같은 규칙) */
export function formatSettlementWon(cents: number): string {
  return `${minorCentsToCash(cents).toLocaleString("ko-KR")}원`;
}

export type PayoutExecuteSummaryInput = {
  mentorCount: number;
  netCents: number;
  noAccountMentorCount: number;
  noAccountNetCents: number;
};

/** critical summary — "멘토 12명에게 총 1,234,500원을 정산 확정합니다. 계좌 미등록 8명(456,000원)은 제외됩니다. 실제 이체는 별도로 진행합니다." */
export function buildPayoutExecuteSummary(input: PayoutExecuteSummaryInput): string {
  const lines = [`멘토 ${input.mentorCount}명에게 총 ${formatSettlementWon(input.netCents)}을 정산 확정합니다.`];
  if (input.noAccountMentorCount > 0) {
    lines.push(`계좌 미등록 ${input.noAccountMentorCount}명(${formatSettlementWon(input.noAccountNetCents)})은 제외됩니다.`);
  }
  lines.push("실제 이체는 별도로 진행합니다.");
  return lines.join("\n");
}

export function payoutExecuteSummaryInputFor(preview: SettlementPreview): PayoutExecuteSummaryInput {
  return {
    mentorCount: preview.totals.mentorCount,
    netCents: preview.totals.netCents,
    noAccountMentorCount: preview.noAccount.mentorCount,
    noAccountNetCents: preview.noAccount.netCents,
  };
}

export function buildPayoutExecuteDetails(preview: SettlementPreview, runDate: string): { label: string; value: string }[] {
  return [
    { label: "지급일", value: runDate },
    { label: "지급 대상", value: `멘토 ${preview.totals.mentorCount}명 · ${preview.totals.itemCount}건` },
    { label: "멘토 정산금 합계", value: formatSettlementWon(preview.totals.mentorCents) },
    { label: "원천징수 합계(3.3%)", value: formatSettlementWon(preview.totals.withholdingCents) },
    { label: "실지급 합계", value: formatSettlementWon(preview.totals.netCents) },
  ];
}

/** 실행 폼 hidden 값 — 서버 액션이 드라이런을 다시 돌려 이 값과 대조한다(미리보기 이후 대상이 바뀌면 실행 거부). */
export function payoutExecuteHiddenFields(preview: SettlementPreview, runDate: string): Record<(typeof SETTLEMENT_EXECUTE_FIELDS)[keyof typeof SETTLEMENT_EXECUTE_FIELDS], string> {
  return {
    [SETTLEMENT_EXECUTE_FIELDS.runDate]: runDate,
    [SETTLEMENT_EXECUTE_FIELDS.expectedCount]: String(preview.totals.itemCount),
    [SETTLEMENT_EXECUTE_FIELDS.expectedSkipped]: String(preview.noAccount.itemCount),
    [SETTLEMENT_EXECUTE_FIELDS.expectedMentorCents]: String(preview.totals.mentorCents),
    [SETTLEMENT_EXECUTE_FIELDS.expectedWithholdingCents]: String(preview.totals.withholdingCents),
    [SETTLEMENT_EXECUTE_FIELDS.expectedNetCents]: String(preview.totals.netCents),
  };
}

export type PayoutExecuteExpected = {
  count: number;
  skipped: number;
  mentorCents: number;
  withholdingCents: number;
  netCents: number;
};

/** 폼 값 파싱 — 하나라도 정수가 아니면 null(액션이 거부) */
export function parsePayoutExecuteExpected(get: (field: string) => string | null | undefined): PayoutExecuteExpected | null {
  const int = (field: string): number | null => {
    const s = String(get(field) ?? "").trim();
    if (!/^-?\d+$/.test(s)) return null;
    return Number(s);
  };
  const count = int(SETTLEMENT_EXECUTE_FIELDS.expectedCount);
  const skipped = int(SETTLEMENT_EXECUTE_FIELDS.expectedSkipped);
  const mentorCents = int(SETTLEMENT_EXECUTE_FIELDS.expectedMentorCents);
  const withholdingCents = int(SETTLEMENT_EXECUTE_FIELDS.expectedWithholdingCents);
  const netCents = int(SETTLEMENT_EXECUTE_FIELDS.expectedNetCents);
  if (count == null || skipped == null || mentorCents == null || withholdingCents == null || netCents == null) return null;
  return { count, skipped, mentorCents, withholdingCents, netCents };
}

/** 미리보기가 보여준 값 == 실행 직전 드라이런 값 */
export function expectedMatchesDryRun(expected: PayoutExecuteExpected, dryRun: PayoutRunResult): boolean {
  return (
    expected.count === dryRun.paidCount &&
    expected.skipped === dryRun.skippedNoAccount &&
    expected.mentorCents === dryRun.totalMentorCents &&
    expected.withholdingCents === dryRun.totalWithholdingCents &&
    expected.netCents === dryRun.totalNetCents
  );
}

export const SETTLEMENT_EXECUTE_MESSAGES = {
  stale: "미리보기 이후 정산 대상이 바뀌었습니다. 새로고침 후 다시 확인해 주세요.",
  runDateMismatch: "지급일이 이번 달과 다릅니다. 화면을 새로고침해 주세요.",
  alreadyCompleted: SETTLEMENT_EXECUTE_BLOCK_MESSAGES.already_completed,
  generic: "정산 실행 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
} as const;

/** 실행 결과 플래시 — "정산 실행 완료 — 멘토 12명 · 34건 · 실지급 1,234,500원 (계좌 미등록 8건 제외)" */
export function buildPayoutExecuteOkMessage(result: PayoutRunResult, mentorCount: number | null): string {
  const parts = [
    mentorCount != null ? `멘토 ${mentorCount}명` : null,
    `${result.paidCount}건`,
    `실지급 ${formatSettlementWon(result.totalNetCents)}`,
  ].filter((s): s is string => Boolean(s));
  const skipped = result.skippedNoAccount > 0 ? ` (계좌 미등록 ${result.skippedNoAccount}건 제외)` : "";
  return `정산 실행 완료 — ${parts.join(" · ")}${skipped}`;
}

// ── 지급 이력(payout_runs · payout_run_items — 읽기 전용, UPDATE/DELETE 차단 트리거) ──

export type PayoutRunRow = {
  id: string;
  runDate: string;
  cutoffEnd: string | null;
  status: string;
  mentorCount: number;
  totalMentorCents: number;
  executedAt: string | null;
  createdAt: string | null;
  idempotencyKey: string;
};

export function parsePayoutRunRow(row: Record<string, unknown>): PayoutRunRow | null {
  const id = str(row.id);
  if (!id) return null;
  return {
    id,
    runDate: str(row.run_date),
    cutoffEnd: str(row.cutoff_end) || null,
    status: str(row.status) || "executing",
    mentorCount: toCentsInt(row.mentor_count),
    totalMentorCents: toCentsInt(row.total_mentor_cents),
    executedAt: str(row.executed_at) || null,
    createdAt: str(row.created_at) || null,
    idempotencyKey: str(row.idempotency_key),
  };
}

export type PayoutRunItemRow = {
  id: string;
  payoutRunId: string;
  mentorId: string;
  sourceType: SettlementSourceType | string;
  sourceId: string;
  grossCents: number;
  platformFeeCents: number;
  mentorAmountCents: number;
  feeRate: number | null;
  withholdingCents: number;
  netPaidCents: number;
  ledgerId: string | null;
  createdAt: string | null;
};

export function parsePayoutRunItemRow(row: Record<string, unknown>): PayoutRunItemRow | null {
  const id = str(row.id);
  if (!id) return null;
  const mentorAmountCents = toCentsInt(row.mentor_amount_cents);
  const withholdingCents = toCentsInt(row.withholding_cents);
  return {
    id,
    payoutRunId: str(row.payout_run_id),
    mentorId: str(row.mentor_id),
    sourceType: str(row.source_type),
    sourceId: str(row.source_id),
    grossCents: toCentsInt(row.gross_cents),
    platformFeeCents: toCentsInt(row.platform_fee_cents),
    mentorAmountCents,
    feeRate: parseSettlementFeeRate(row.fee_rate),
    withholdingCents,
    // 153 이전 행은 net_paid_cents 가 null 일 수 있다 — 스냅샷 값이 있으면 그대로, 없으면 정산금 − 원천징수(둘 다 행 값)
    netPaidCents: row.net_paid_cents == null ? mentorAmountCents - withholdingCents : toCentsInt(row.net_paid_cents),
    ledgerId: str(row.ledger_id) || null,
    createdAt: str(row.created_at) || null,
  };
}

/** 실행 행 항목 합계 — 스냅샷 값 그대로 더한다 */
export function summarizePayoutRunItems(items: readonly PayoutRunItemRow[]): {
  count: number;
  mentorCount: number;
  mentorCents: number;
  withholdingCents: number;
  netCents: number;
} {
  const mentors = new Set<string>();
  let mentorCents = 0;
  let withholdingCents = 0;
  let netCents = 0;
  for (const it of items) {
    mentors.add(it.mentorId);
    mentorCents += it.mentorAmountCents;
    withholdingCents += it.withholdingCents;
    netCents += it.netPaidCents;
  }
  return { count: items.length, mentorCount: mentors.size, mentorCents, withholdingCents, netCents };
}

/** 감사 로그 action_type — 실행 액션이 남기고 지급 이력 탭이 "실행자" 로 되읽는다 */
export const PAYOUT_RUN_EXECUTE_ACTION_TYPE = "payout_run_execute";
export const PAYOUT_RUN_TARGET_TYPE = "payout_run";

// ── 멘토별 정산 항목 ─────────────────────────────────────────────────────────

export type MentorSettlementLine = {
  key: string;
  sourceType: SettlementSourceType;
  sourceId: string;
  /** 발생 시각 — 구독 billing_at · 맞춤의뢰 created_at · 개별질문 released_at */
  occurredAt: string | null;
  description: string;
  grossCents: number;
  platformFeeCents: number;
  mentorCents: number;
  feeRate: number | null;
  /** DB 원시 상태(구독 accruing/pending/hold/canceled · 맞춤의뢰 pending/on_hold/payable/paid/cancelled · 개별질문 파생) */
  status: string;
  holdReason: string | null;
  /** payout_run_items 에 있으면 그 실행의 지급일 */
  paidRunDate: string | null;
  paidAt: string | null;
};

/** 멘토별 탭 상태 표기 — 구독·맞춤의뢰·개별질문 공통 */
export function mentorLineStatusLabel(status: unknown): string {
  const s = String(status ?? "").trim().toLowerCase();
  switch (s) {
    case "accruing":
      return "적립중";
    case "pending":
      return "지급 대기";
    case "hold":
    case "on_hold":
      return "보류";
    case "payable":
      return "지급 가능";
    case "paid":
      return "지급 완료";
    case "canceled":
    case "cancelled":
      return "취소";
    default:
      return s || "—";
  }
}

export function mentorLineStatusTone(status: unknown): "neutral" | "info" | "success" | "warning" | "danger" {
  const s = String(status ?? "").trim().toLowerCase();
  if (s === "paid") return "success";
  if (s === "accruing") return "info";
  if (s === "pending" || s === "payable") return "warning";
  if (s === "hold" || s === "on_hold") return "danger";
  return "neutral";
}

/**
 * 개별질문 정산 상태 — `mentor_settlement_lines` RPC(20260827100300)의 individual_question 분기와 같은 규칙:
 * release_ledger_id 있음 → paid · refund_ledger_id 있음 또는 status ∈ {refunded, expired, canceled} → canceled · 그 외 → pending.
 * (RPC 는 auth.uid() 로 멘토 본인만 조회하므로 관리자 화면이 같은 규칙으로 읽는다 — 금액은 행 값이다.)
 */
export function individualQuestionSettlementStatus(row: { release_ledger_id?: unknown; refund_ledger_id?: unknown; status?: unknown }): "paid" | "canceled" | "pending" {
  if (row.release_ledger_id) return "paid";
  const s = String(row.status ?? "").trim().toLowerCase();
  if (row.refund_ledger_id || s === "refunded" || s === "expired" || s === "canceled") return "canceled";
  return "pending";
}

export type MentorSettlementSummary = {
  pendingCents: number;
  pendingCount: number;
  accruingCents: number;
  accruingCount: number;
  heldCents: number;
  heldCount: number;
  paidCents: number;
  paidCount: number;
  canceledCount: number;
};

export function summarizeMentorLines(lines: readonly MentorSettlementLine[]): MentorSettlementSummary {
  const s: MentorSettlementSummary = {
    pendingCents: 0,
    pendingCount: 0,
    accruingCents: 0,
    accruingCount: 0,
    heldCents: 0,
    heldCount: 0,
    paidCents: 0,
    paidCount: 0,
    canceledCount: 0,
  };
  for (const l of lines) {
    const st = l.status.trim().toLowerCase();
    if (st === "paid") {
      s.paidCents += l.mentorCents;
      s.paidCount += 1;
    } else if (st === "accruing") {
      s.accruingCents += l.mentorCents;
      s.accruingCount += 1;
    } else if (st === "hold" || st === "on_hold") {
      s.heldCents += l.mentorCents;
      s.heldCount += 1;
    } else if (st === "canceled" || st === "cancelled") {
      s.canceledCount += 1;
    } else {
      s.pendingCents += l.mentorCents;
      s.pendingCount += 1;
    }
  }
  return s;
}

export const SETTLEMENT_MENTOR_SEARCH_LIMIT = 20;

// ── 문구 ─────────────────────────────────────────────────────────────────────

export const SETTLEMENT_NOTICE = "정산 실행은 시스템상 지급 확정입니다. 실제 계좌 이체는 별도로 진행합니다.";

export const SETTLEMENT_EMPTY_STATE = {
  title: "이번 달 정산 대상이 없습니다",
  description: "구독·개별질문·맞춤의뢰가 발생하면 정산 항목이 쌓입니다. 지급일은 매월 23일입니다.",
} as const;

export const PAYOUT_HISTORY_EMPTY_STATE = {
  title: "아직 실행된 정산이 없습니다",
  description: "이번 달 정산 탭에서 미리보기를 확인하고 실행하면 여기에 지급 이력이 쌓입니다.",
} as const;
