// 정산 행 기간 집계 순수 유틸 — Supabase/`@/` 의존 없음(node:test 로 직접 검증 가능).
//
// D-MT-3 회귀 방지: '이번 달 수익' KPI 는 당월 정산 행만 합산해야 한다. 공유 로더
// (mentorPayoutsQueries)의 settlementPayouts.totals 는 월 경계 없는 전 기간(최근 200행)
// 합계이므로, 대시보드 집계 지점에서 bundle 의 monthBounds(periodStart/periodEnd)를
// 그대로 받아 이 순수 함수로 재집계한다(공유 로더는 건드리지 않는다).

type Row = Record<string, unknown>;

/** 정산 예정(미지급) 상태 — mentorPayoutsQueries 의 SETTLEMENT_STATUS_EXPECTED 와 동일 집합(DB CHECK 정합) */
const SETTLEMENT_STATUS_EXPECTED = new Set(["pending", "on_hold", "payable"]);

// mentorPayoutsQueries.intAmount 와 동일 규칙(숫자·숫자문자열 절사, 그 외 0).
function intAmount(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : 0;
  }
  return 0;
}

export type SettlementPeriodTotals = {
  /** 기간 내 pending / on_hold / payable 멘토 정산액 합 */
  expectedMentorAmount: number;
  /** 기간 내 status === paid 멘토 정산액 합 */
  paidMentorAmount: number;
  /** 기간 내로 귀속된 정산 행 수(상태 무관) */
  count: number;
};

/**
 * 정산 행(custom_order_settlement_items)을 [periodStartIso, periodEndIso] 경계(양끝 포함)로
 * 걸러 멘토 정산액을 합산한다. 기준 시각은 로더 정렬 컬럼과 동일한 created_at 단일 기준.
 * created_at 이 없거나 파싱 불가한 행은 당월로 귀속할 수 없으므로 제외한다.
 * 경계 자체가 파싱 불가하면 0 합계(빈 결과)를 돌려준다.
 */
export function aggregateSettlementTotalsInPeriod(
  rows: readonly Row[],
  periodStartIso: string,
  periodEndIso: string
): SettlementPeriodTotals {
  const out: SettlementPeriodTotals = { expectedMentorAmount: 0, paidMentorAmount: 0, count: 0 };
  const startMs = Date.parse(periodStartIso);
  const endMs = Date.parse(periodEndIso);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return out;

  for (const r of rows) {
    const ts = Date.parse(String(r.created_at ?? ""));
    if (!Number.isFinite(ts) || ts < startMs || ts > endMs) continue;
    out.count += 1;
    const ma = intAmount(r.mentor_amount);
    const st = String(r.status ?? "").trim().toLowerCase();
    if (st === "paid") {
      out.paidMentorAmount += ma;
    } else if (SETTLEMENT_STATUS_EXPECTED.has(st)) {
      out.expectedMentorAmount += ma;
    }
  }
  return out;
}
