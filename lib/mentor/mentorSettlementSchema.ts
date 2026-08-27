/**
 * 멘토 정산 RPC 응답 스키마 — 파싱·검증 순수 모듈 (server-only import 금지 · node:test 검증 가능)
 *
 * 정본 데이터 소스는 DB RPC 2종이다 (migration 20260827100200 · 20260827100300):
 *   - public.mentor_settlement_summary(p_month date) → jsonb (상단 카드·우측 위젯)
 *   - public.mentor_settlement_lines(p_from, p_to)   → 정산 내역 행 (표·다운로드)
 *
 * 프론트는 여기서 검증된 값을 **그대로** 표시한다 — ×0.15/×0.05/×0.033 재계산 금지.
 * 금액은 전부 *_cents(minor, 원×100)이며 캐시 표시값은 cents/100 이다. cents 가 정수가
 * 아니거나 100의 배수가 아니면(=캐시가 소수) 데이터 불변식 위반이므로 **파싱을 실패**시켜
 * 화면이 오류 상태를 그리게 한다(0 렌더 금지 — fail-closed, PR #75 zero-row 무음 흡수 재발 방지).
 */

export type SettlementSourceType = "subscription" | "custom_request" | "individual_question";

/** RPC 가 정규화해 내려주는 5종 상태. 그 외 값은 UI 에서 오류 상태로 표시한다(무음 매핑 금지). */
export const SETTLEMENT_LINE_STATUSES = ["accruing", "pending", "hold", "paid", "canceled"] as const;
export type SettlementLineStatus = (typeof SETTLEMENT_LINE_STATUSES)[number];

export function isSettlementLineStatus(value: string): value is SettlementLineStatus {
  return (SETTLEMENT_LINE_STATUSES as readonly string[]).includes(value);
}

export type MentorSettlementLine = {
  sourceType: string;
  sourceId: string;
  occurredAt: string;
  periodStart: string | null;
  periodEnd: string | null;
  grossCents: number;
  platformFeeCents: number;
  mentorAmountCents: number;
  feeRate: number | null;
  withholdingCents: number;
  netCents: number;
  /** RPC 원문 상태 — 5종 외 값도 그대로 보존한다(표시 단계에서 오류 칩). */
  status: string;
  holdReason: string | null;
  completionTs: string | null;
  expectedRunDate: string | null;
  paidRunDate: string | null;
  paidAt: string | null;
};

export type MentorSettlementSummary = {
  /** 'YYYY-MM' */
  month: string;
  /** 'YYYY-MM-DD' — 해당 월 확정분의 지급(예정)일 */
  runDate: string;
  /** timestamptz — 지급 함수와 동일한 확정 cutoff (다음 달 1일 00:00 KST − 1초) */
  cutoff: string;
  /** false 면 지급 run 이 skip 하고 익월로 이월된다 */
  payoutAccountRegistered: boolean;
  confirmed: {
    count: number;
    grossCents: number;
    platformFeeCents: number;
    mentorAmountCents: number;
    withholdingCents: number;
    netCents: number;
  };
  accruing: {
    count: number;
    mentorAmountCents: number;
    withholdingCents: number;
    netCents: number;
    lastPeriodEnd: string | null;
    expectedRunDate: string | null;
  };
  held: { count: number; mentorAmountCents: number };
  paidTotal: { count: number; mentorAmountCents: number; netCents: number };
  bySourceThisMonth: Partial<Record<string, { mentorAmountCents: number; count: number }>>;
  withholdingRule: string;
};

/** RPC 응답이 계약과 다를 때 던진다 — 잡은 쪽은 반드시 오류 상태를 그린다(0 렌더 금지). */
export class MentorSettlementParseError extends Error {
  constructor(message: string) {
    super(`mentor settlement RPC 응답 스키마 위반: ${message}`);
    this.name = "MentorSettlementParseError";
  }
}

type Raw = Record<string, unknown>;

function asRecord(value: unknown, path: string): Raw {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new MentorSettlementParseError(`${path} 가 객체가 아니다`);
  }
  return value as Raw;
}

function readInt(obj: Raw, key: string, path: string): number {
  const v = obj[key];
  if (typeof v !== "number" || !Number.isSafeInteger(v)) {
    throw new MentorSettlementParseError(`${path}.${key} 가 정수가 아니다 (${String(v)})`);
  }
  return v;
}

/** *_cents 필드 — 정수이면서 100의 배수(=캐시 정수)여야 한다. 위반 시 파싱 실패. */
function readCents(obj: Raw, key: string, path: string): number {
  const v = readInt(obj, key, path);
  if (v % 100 !== 0) {
    throw new MentorSettlementParseError(`${path}.${key}=${v} — 캐시 단위(100 cents)가 아니다`);
  }
  return v;
}

function readString(obj: Raw, key: string, path: string): string {
  const v = obj[key];
  if (typeof v !== "string" || !v) {
    throw new MentorSettlementParseError(`${path}.${key} 가 비어 있다`);
  }
  return v;
}

function readStringOrNull(obj: Raw, key: string, path: string): string | null {
  const v = obj[key];
  if (v == null) return null;
  if (typeof v !== "string") {
    throw new MentorSettlementParseError(`${path}.${key} 가 문자열이 아니다`);
  }
  return v;
}

function readBoolean(obj: Raw, key: string, path: string): boolean {
  const v = obj[key];
  if (typeof v !== "boolean") {
    throw new MentorSettlementParseError(`${path}.${key} 가 boolean 이 아니다`);
  }
  return v;
}

export function parseMentorSettlementSummary(raw: unknown): MentorSettlementSummary {
  const root = asRecord(raw, "summary");
  const month = readString(root, "month", "summary");
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new MentorSettlementParseError(`summary.month 형식 위반 (${month})`);
  }
  const runDate = readString(root, "run_date", "summary");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(runDate)) {
    throw new MentorSettlementParseError(`summary.run_date 형식 위반 (${runDate})`);
  }

  const confirmed = asRecord(root.confirmed, "summary.confirmed");
  const accruing = asRecord(root.accruing, "summary.accruing");
  const held = asRecord(root.held, "summary.held");
  const paidTotal = asRecord(root.paid_total, "summary.paid_total");
  const bySource = asRecord(root.by_source_this_month, "summary.by_source_this_month");

  const bySourceThisMonth: MentorSettlementSummary["bySourceThisMonth"] = {};
  for (const [source, entry] of Object.entries(bySource)) {
    const rec = asRecord(entry, `summary.by_source_this_month.${source}`);
    bySourceThisMonth[source] = {
      mentorAmountCents: readCents(rec, "mentor_amount_cents", `summary.by_source_this_month.${source}`),
      count: readInt(rec, "count", `summary.by_source_this_month.${source}`),
    };
  }

  return {
    month,
    runDate,
    cutoff: readString(root, "cutoff", "summary"),
    payoutAccountRegistered: readBoolean(root, "payout_account_registered", "summary"),
    confirmed: {
      count: readInt(confirmed, "count", "summary.confirmed"),
      grossCents: readCents(confirmed, "gross_cents", "summary.confirmed"),
      platformFeeCents: readCents(confirmed, "platform_fee_cents", "summary.confirmed"),
      mentorAmountCents: readCents(confirmed, "mentor_amount_cents", "summary.confirmed"),
      withholdingCents: readCents(confirmed, "withholding_cents", "summary.confirmed"),
      netCents: readCents(confirmed, "net_cents", "summary.confirmed"),
    },
    accruing: {
      count: readInt(accruing, "count", "summary.accruing"),
      mentorAmountCents: readCents(accruing, "mentor_amount_cents", "summary.accruing"),
      withholdingCents: readCents(accruing, "withholding_cents", "summary.accruing"),
      netCents: readCents(accruing, "net_cents", "summary.accruing"),
      lastPeriodEnd: readStringOrNull(accruing, "last_period_end", "summary.accruing"),
      expectedRunDate: readStringOrNull(accruing, "expected_run_date", "summary.accruing"),
    },
    held: {
      count: readInt(held, "count", "summary.held"),
      mentorAmountCents: readCents(held, "mentor_amount_cents", "summary.held"),
    },
    paidTotal: {
      count: readInt(paidTotal, "count", "summary.paid_total"),
      mentorAmountCents: readCents(paidTotal, "mentor_amount_cents", "summary.paid_total"),
      netCents: readCents(paidTotal, "net_cents", "summary.paid_total"),
    },
    bySourceThisMonth,
    withholdingRule: readString(root, "withholding_rule", "summary"),
  };
}

function parseLine(raw: unknown, index: number): MentorSettlementLine {
  const path = `lines[${index}]`;
  const row = asRecord(raw, path);
  const feeRateRaw = row.fee_rate;
  let feeRate: number | null = null;
  if (feeRateRaw != null) {
    const n = typeof feeRateRaw === "number" ? feeRateRaw : Number(feeRateRaw);
    if (!Number.isFinite(n)) {
      throw new MentorSettlementParseError(`${path}.fee_rate 가 숫자가 아니다`);
    }
    feeRate = n;
  }
  return {
    sourceType: readString(row, "source_type", path),
    sourceId: readString(row, "source_id", path),
    occurredAt: readString(row, "occurred_at", path),
    periodStart: readStringOrNull(row, "period_start", path),
    periodEnd: readStringOrNull(row, "period_end", path),
    grossCents: readCents(row, "gross_cents", path),
    platformFeeCents: readCents(row, "platform_fee_cents", path),
    mentorAmountCents: readCents(row, "mentor_amount_cents", path),
    feeRate,
    withholdingCents: readCents(row, "withholding_cents", path),
    netCents: readCents(row, "net_cents", path),
    status: readString(row, "status", path),
    holdReason: readStringOrNull(row, "hold_reason", path),
    completionTs: readStringOrNull(row, "completion_ts", path),
    expectedRunDate: readStringOrNull(row, "expected_run_date", path),
    paidRunDate: readStringOrNull(row, "paid_run_date", path),
    paidAt: readStringOrNull(row, "paid_at", path),
  };
}

export function parseMentorSettlementLines(raw: unknown): MentorSettlementLine[] {
  if (!Array.isArray(raw)) {
    throw new MentorSettlementParseError("lines 응답이 배열이 아니다");
  }
  return raw.map(parseLine);
}

/** 검증된 cents → 캐시 표시값. 파싱이 100의 배수를 보증하므로 항상 정수다. */
export function centsToCash(cents: number): number {
  return cents / 100;
}

// ---------------------------------------------------------------------------
// KST 월 경계 — RPC p_from/p_to·표시용. 고정 +9h 산술(실행 환경 시간대 무관).
// ---------------------------------------------------------------------------

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** KST 달력 날짜 'YYYY-MM-DD' */
export function kstDateString(at: Date): string {
  return new Date(at.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** KST 연월 'YYYY-MM' */
export function kstYearMonth(at: Date): string {
  return kstDateString(at).slice(0, 7);
}

export function nextYearMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

export function prevYearMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return `${py}-${String(pm).padStart(2, "0")}`;
}

/** fromYm 부터 과거로 count 개 (내림차순) — new Date() 없이 문자열 산술만. */
export function listRecentYearMonths(fromYm: string, count: number): string[] {
  const out: string[] = [];
  let ym = fromYm;
  for (let i = 0; i < count; i++) {
    out.push(ym);
    ym = prevYearMonth(ym);
  }
  return out;
}

/** 선택한 월의 KST 경계 — mentor_settlement_lines(p_from, p_to) 인자 (occurred_at 기준 반개구간). */
export function kstMonthBounds(ym: string): { fromIso: string; toIso: string } {
  return {
    fromIso: `${ym}-01T00:00:00+09:00`,
    toIso: `${nextYearMonth(ym)}-01T00:00:00+09:00`,
  };
}

/** timestamptz → KST 'M/D' (적립중 칩의 "{M}/{D} 확정" 표기) */
export function formatKstMonthDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const kst = new Date(d.getTime() + KST_OFFSET_MS);
  return `${kst.getUTCMonth() + 1}/${kst.getUTCDate()}`;
}
