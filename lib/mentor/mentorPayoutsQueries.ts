import type { SupabaseClient } from "@supabase/supabase-js";
import {
  normalizedPrimaryOrderStatus,
  orderStatusLabelForUi,
  paymentStatusLabelForUi,
} from "@/lib/customRequest/orderLifecycleConstants";

type Row = Record<string, unknown>;

const SETTLEMENT_ITEMS_TABLE = "custom_order_settlement_items" as const;
const ORDERS_TABLE = "custom_request_orders" as const;

/** 정산 예정(미지급) — DB CHECK와 맞춤 */
const SETTLEMENT_STATUS_EXPECTED = new Set(["pending", "on_hold", "payable"]);

function intAmount(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : 0;
  }
  return 0;
}

export function formatKrwWon(n: number): string {
  return `${n.toLocaleString("ko-KR")}원`;
}

function pickOrderMentorIdFromRow(o: Row): string | null {
  for (const k of ["mentor_id", "selected_mentor_id", "assigned_mentor_id", "expert_id", "mentor_user_id"] as const) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function pickPaymentRawForOrder(o: Row): string {
  for (const k of ["payment_status", "payment_state", "pay_status"] as const) {
    const v = o[k];
    if (v == null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return "";
}

export type MentorPayoutsSettlementLine = {
  settlement: Row;
  order: Row | null;
  workroomHref: string;
  orderStatusLabel: string;
  orderPaymentLabel: string;
};

export type MentorSettlementPayoutsBlock = {
  lines: MentorPayoutsSettlementLine[];
  error: string | null;
  probe: string;
  /** W4(C10): service_role 무음 재시도 제거 — 이제 "session"(성공) 또는 "none"(오류)만 발생 */
  loadedVia: "session" | "service_role" | "none";
  totals: {
    /** pending / on_hold / payable 멘토 정산액 합 */
    expectedMentorAmount: number;
    /** status === paid 멘토 정산액 합 */
    paidMentorAmount: number;
    count: number;
  };
};

/**
 * 멘토 본인 `mentor_id` 행만 세션(RLS) 단일 경로로 조회한다.
 * W4(C10): (1) 스키마 부재 판정 regex(/relation|does not exist|schema cache/)로 오류를
 * "준비 중" 빈 성공으로 바꾸던 probe 분기 삭제 — custom_order_settlement_items 는 187
 * baseline 에 실존(013/014 · 실측)하므로 사문이었고 실오류를 숨겼다. (2) RLS 오류 메시지
 * 키잉 service_role 무음 재시도(dual-read) 삭제 — W1 §4 fallback·dual-read 금지와 동일
 * 원칙. 오류는 error 필드로 표면화한다.
 */
export async function loadMentorSettlementItemsForPayouts(
  supabase: SupabaseClient,
  mentorId: string
): Promise<MentorSettlementPayoutsBlock> {
  const u1 = await supabase
    .from(SETTLEMENT_ITEMS_TABLE)
    .select("*")
    .eq("mentor_id", mentorId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (u1.error) {
    return {
      lines: [],
      error: u1.error.message,
      probe: "",
      loadedVia: "none",
      totals: { expectedMentorAmount: 0, paidMentorAmount: 0, count: 0 },
    };
  }
  const raw: Row[] = (u1.data as Row[]) ?? [];
  const via: MentorSettlementPayoutsBlock["loadedVia"] = "session";

  let expectedMentorAmount = 0;
  let paidMentorAmount = 0;
  for (const r of raw) {
    const ma = intAmount(r.mentor_amount);
    const st = String(r.status ?? "").trim().toLowerCase();
    if (st === "paid") {
      paidMentorAmount += ma;
    } else if (SETTLEMENT_STATUS_EXPECTED.has(st)) {
      expectedMentorAmount += ma;
    }
  }

  const orderIds = [
    ...new Set(
      raw
        .map((r) => (typeof r.custom_request_order_id === "string" ? r.custom_request_order_id.trim() : ""))
        .filter(Boolean)
    ),
  ];

  const orderById = new Map<string, Row>();
  if (orderIds.length > 0) {
    // W4(C10): 사전 probe select 제거 — custom_request_orders 단일 고정 쿼리.
    // 오류 시 console.error 후 주문 라벨 보강만 생략(주문 상태 '—' 표기) — 표시 전용
    // degrade(성공 아님), 정산 금액 라인 자체는 위 정산 행으로 이미 확보됨.
    const oq = await supabase.from(ORDERS_TABLE).select("*").in("id", orderIds);
    if (oq.error) {
      console.error("[loadMentorSettlementItemsForPayouts] custom_request_orders", oq.error.message);
    } else if (oq.data) {
      for (const o of oq.data as Row[]) {
        const id = typeof o.id === "string" ? o.id : null;
        if (!id) continue;
        if (pickOrderMentorIdFromRow(o) !== mentorId) {
          continue;
        }
        orderById.set(id, o);
      }
    }
  }

  const lines: MentorPayoutsSettlementLine[] = raw.map((settlement) => {
    const oid =
      typeof settlement.custom_request_order_id === "string" ? settlement.custom_request_order_id.trim() : "";
    const order = oid ? orderById.get(oid) ?? null : null;
    const norm = order ? normalizedPrimaryOrderStatus(order) : "";
    const orderStatusLabel = norm ? orderStatusLabelForUi(norm) : "—";
    const payRaw = order ? pickPaymentRawForOrder(order) : "";
    const orderPaymentLabel = payRaw ? paymentStatusLabelForUi(payRaw) : "—";
    const workroomHref = oid ? `/custom-request/orders/${encodeURIComponent(oid)}` : "/custom-request/orders";
    return { settlement, order, workroomHref, orderStatusLabel, orderPaymentLabel };
  });

  const probe =
    lines.length > 0
      ? "완료된 맞춤의뢰 주문의 정산 예정 금액입니다. 완료된 주문은 정산 예정 금액에 반영됩니다."
      : "정산 데이터가 아직 없습니다.";

  return {
    lines,
    error: null,
    probe,
    loadedVia: via,
    totals: {
      expectedMentorAmount,
      paidMentorAmount,
      count: raw.length,
    },
  };
}

function monthBounds(): { start: string; end: string } {
  const d = new Date();
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
  return { start: start.toISOString(), end: end.toISOString() };
}

// W4(C10): firstPayoutsTable(payouts/mentor_payouts/payout_lines/payout_batch_items/
// mentor_ledger_lines 프로빙)·readRowsForMentor(FK 프로빙 + 무필터 50행 폴백 + order 재시도)
// 및 전용 헬퍼(num/pickAmount/inMonthRange) 삭제 — 후보 테이블 부재 실측(187 baseline 0,
// payout 스택은 clean-install 제외). 프로빙 제거, 현행 관측 동작(payoutTable null ·
// monthExpectedCents 0 · tableRows 빈 결과) 고정. 기능 정본화는 비범위.

/** 맞춤의뢰 쪽에서 읽어 온 정산·주문 후보 행(읽기 전용, 기존 custom 주문 조회와 동일 소스) */
export type CustomOrderSettlementsBlock = {
  rows: Row[];
  error: string | null;
  table: string | null;
};

export type MentorPayoutsBundle = {
  payoutTable: string | null;
  payoutError: string | null;
  /** 이번 달 예상(= payouts 행 합, 기간·컬럼은 추정) */
  monthExpectedCents: number;
  subSummary: { n: number; amountHint: string; error: string | null; table: string | null };
  customSummary: { n: number; amountHint: string; error: string | null; table: string | null };
  customOrderSettlements: CustomOrderSettlementsBlock;
  /** 맞춤의뢰 정산 예정·지급 완료 행 */
  settlementPayouts: MentorSettlementPayoutsBlock;
  tableRows: Row[];
  tableHint: string;
  periodStart: string;
  periodEnd: string;
};

export async function loadMentorPayoutsBundle(supabase: SupabaseClient, mentorId: string): Promise<MentorPayoutsBundle> {
  const { start, end } = monthBounds();
  const settlementPayouts = await loadMentorSettlementItemsForPayouts(supabase, mentorId);

  // W4(C10): 후보 테이블 부재 실측(187 baseline 0) — 프로빙 제거, 현행 관측 동작
  // (payoutTable null · monthExpectedCents 0 · tableRows 빈 결과) 고정. 기능 정본화는 비범위.
  const monthExpectedCents = 0;
  const tableRows: Row[] = [];
  const tableHint = "이번 달 기준으로 예상되는 지급·정산 금액이에요.";

  // W4(C10): subscription_revenue_ledger/mentor_subscriptions 프로빙 제거 — 정본
  // public.subscriptions.mentor_id 단일 카운트(187 baseline 실측 · XW-10). 오류는 subSummary.error 로 표면화.
  let subN = 0;
  let subHint = "—";
  let subErr: string | null = null;
  const subTable = "subscriptions";
  {
    const { count, error } = await supabase
      .from(subTable)
      .select("id", { count: "exact", head: true })
      .eq("mentor_id", mentorId);
    if (error) {
      subErr = "구독·수익 항목을 집계하는 중 문제가 있어요";
      console.error("[loadMentorPayoutsBundle] subscriptions", error.message);
    } else {
      subN = count ?? 0;
    }
    subHint = `구독·수익 관련 항목 ${subN}건이에요`;
  }

  // W4(C10): custom_order_payments 프로빙·FK 후보 탐색 제거 — 정본
  // public.custom_request_orders.mentor_id 단일 쿼리(187 baseline 실측). 오류는 customSummary.error 로 표면화.
  let cusN = 0;
  let cusHint = "—";
  let cusErr: string | null = null;
  const cusTable = "custom_request_orders";
  let customOrderSettlementRows: Row[] = [];
  {
    const { data, count, error } = await supabase
      .from(cusTable)
      .select("*", { count: "exact" })
      .eq("mentor_id", mentorId)
      .limit(20);
    if (error) {
      cusErr = "맞춤의뢰 주문을 집계하는 중 문제가 있어요";
      console.error("[loadMentorPayoutsBundle] custom_request_orders", error.message);
    } else {
      cusN = count ?? (data as Row[] | null)?.length ?? 0;
      customOrderSettlementRows = (data as Row[] | null) ?? [];
    }
    cusHint = `맞춤의뢰 주문 ${cusN}건이에요`;
  }

  return {
    payoutTable: null,
    payoutError: "정산 내역을 아직 찾을 수 없어요",
    monthExpectedCents,
    subSummary: { n: subN, amountHint: subHint, error: subErr, table: subTable },
    customSummary: { n: cusN, amountHint: cusHint, error: cusErr, table: cusTable },
    customOrderSettlements: { rows: customOrderSettlementRows, error: cusErr, table: cusTable },
    settlementPayouts,
    tableRows,
    tableHint,
    periodStart: start,
    periodEnd: end,
  };
}
