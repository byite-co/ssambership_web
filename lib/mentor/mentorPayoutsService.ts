import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadMentorSettlementItemsForPayouts } from "@/lib/mentor/mentorPayoutsQueries";
import {
  formatSubscriptionSettlementPeriod,
  loadSubscriptionSettlementRowsForMentor,
  minorCentsToCash,
  subscriptionSettlementStatus,
} from "@/lib/mentor/subscriptionSettlementItems";
import {
  calcPayoutWithholding,
  DEFAULT_MASKED_BANK_DISPLAY,
  MENTOR_CUSTOM_REQUEST_PLATFORM_SHARE,
  MENTOR_CUSTOM_REQUEST_SHARE,
  MENTOR_INDIVIDUAL_QUESTION_SHARE,
} from "@/lib/mentor/mentorPayoutsConstants";
import {
  buildPayoutScheduleInfo,
  detailLineToSettlementRow,
  withPayoutWithholding,
} from "@/lib/mentor/mentorPayoutsDisplay";
import type {
  MentorPayoutDetailLine,
  MentorPayoutDetailResult,
  MentorPayoutMonthlyCard,
  MentorPayoutPerformanceRow,
  MentorPayoutScheduleInfo,
  MentorPayoutSettlementTableRow,
  MentorPayoutSummary,
  MentorPayoutsPageData,
  PayoutLineType,
  PayoutUiStatus,
} from "@/lib/mentor/mentorPayoutsTypes";

export type {
  MentorPayoutDetailLine,
  MentorPayoutDetailResult,
  MentorPayoutMonthlyCard,
  MentorPayoutPerformanceRow,
  MentorPayoutScheduleInfo,
  MentorPayoutSettlementTableRow,
  MentorPayoutSummary,
  MentorPayoutsPageData,
  PayoutLineType,
  PayoutUiStatus,
};

export {
  buildPayoutScheduleInfo,
  detailLineToSettlementRow,
  formatChartMonthLabel,
  formatPayoutDateLabel,
  formatYearMonthLabel,
} from "@/lib/mentor/mentorPayoutsDisplay";

type Row = Record<string, unknown>;

function ymKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthStartEnd(ym: string): { start: string; end: string } {
  const [y, m] = ym.split("-").map(Number);
  const start = new Date(y, m - 1, 1);
  const end = new Date(y, m, 0, 23, 59, 59, 999);
  return { start: start.toISOString(), end: end.toISOString() };
}

function currentYm(): string {
  return ymKey(new Date());
}

function inYm(iso: string, ym: string): boolean {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return ymKey(d) === ym;
}

function pickTs(row: Row): string {
  for (const k of ["created_at", "paid_at", "updated_at", "completed_at"]) {
    const v = row[k];
    if (typeof v === "string" && v) return v;
  }
  return new Date().toISOString();
}

function intWon(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string") {
    const n = Number(v.replace(/,/g, ""));
    return Number.isFinite(n) ? Math.trunc(n) : 0;
  }
  return 0;
}

function orderGrossWon(order: Row | null): number {
  if (!order) return 0;
  for (const k of ["agreed_price", "final_price", "paid_amount", "amount", "price", "total_amount"]) {
    const n = intWon(order[k]);
    if (n > 0) return n;
  }
  return 0;
}

function maskBankDisplay(bank: string | null, account: string | null): string {
  const a = (account ?? "").replace(/\D/g, "");
  if (!a) return DEFAULT_MASKED_BANK_DISPLAY;
  const b = (bank ?? "은행").trim() || "은행";
  const tail = a.length >= 4 ? a.slice(-4) : a;
  return `${b} ****${tail}`;
}

async function readClient(supabase: SupabaseClient): Promise<SupabaseClient> {
  return supabase;
}

const SUBSCRIPTION_SETTLEMENT_LABEL = "\uAD6C\uB3C5 \uC815\uC0B0";
const SUBSCRIPTION_STUDENT_LABEL = "\uAD6C\uB3C5 \uD559\uC0DD";

function subscriptionSettlementDate(row: Row): string {
  for (const k of ["billing_at", "paid_at", "created_at", "updated_at"]) {
    const v = row[k];
    if (typeof v === "string" && v) return v;
  }
  return pickTs(row);
}

function subscriptionSettlementDescription(row: Row): string {
  const period = formatSubscriptionSettlementPeriod(row);
  const billingEventId = String(row.billing_event_id ?? "");
  const suffix = period || (billingEventId ? billingEventId.slice(0, 8) : "");
  return suffix ? `${SUBSCRIPTION_SETTLEMENT_LABEL} - ${suffix}` : SUBSCRIPTION_SETTLEMENT_LABEL;
}

function payoutLineStatusKind(status: string): "pending" | "paid" | "hold" | "canceled" {
  const raw = status.trim();
  const s = raw.toLowerCase();
  if (s === "canceled" || s === "cancelled" || raw.includes("\uCDE8\uC18C")) return "canceled";
  if (s === "paid" || raw.includes("\uC9C0\uAE09\uC644\uB8CC") || raw.includes("\uC815\uC0B0\uC644\uB8CC")) return "paid";
  if (s === "hold" || s === "on_hold" || raw.includes("\uBCF4\uB958")) return "hold";
  return "pending";
}

function isPaidPayoutLine(line: MentorPayoutDetailLine): boolean {
  return payoutLineStatusKind(line.status) === "paid";
}

function isPendingPayoutLine(line: MentorPayoutDetailLine): boolean {
  const kind = payoutLineStatusKind(line.status);
  return kind === "pending" || kind === "hold";
}

async function loadSubscriptionLines(client: SupabaseClient, mentorId: string): Promise<MentorPayoutDetailLine[]> {
  const rows = await loadSubscriptionSettlementRowsForMentor(client, mentorId, 300);
  return rows.map((r) => {
    const itemId = String(r.id ?? r.billing_event_id ?? r.subscription_id ?? "");
    return withPayoutWithholding({
      id: `sub-${itemId}`,
      type: "subscription" as const,
      date: subscriptionSettlementDate(r),
      description: subscriptionSettlementDescription(r),
      paymentAmount: minorCentsToCash(r.gross_cents),
      feeAmount: minorCentsToCash(r.platform_fee_cents),
      netAmount: minorCentsToCash(r.mentor_amount_cents),
      status: subscriptionSettlementStatus(r.status),
    });
  });
}
async function loadCustomRequestLines(client: SupabaseClient, mentorId: string): Promise<MentorPayoutDetailLine[]> {
  const settlement = await loadMentorSettlementItemsForPayouts(client, mentorId);
  const fromSettlement: MentorPayoutDetailLine[] = settlement.lines.map(({ settlement: s, order }) => {
    const gross = intWon(s.gross_amount) || orderGrossWon(order);
    const payment = gross > 0 ? gross : intWon(s.mentor_amount) + intWon(s.platform_fee_amount);
    const expectedFee = Math.floor(payment * MENTOR_CUSTOM_REQUEST_PLATFORM_SHARE);
    const feeRaw = intWon(s.platform_fee_amount);
    const fee =
      feeRaw > 0 && payment > 0 && feeRaw / payment < 0.15 ? expectedFee : feeRaw || expectedFee;
    const net = intWon(s.mentor_amount) || payment - fee;
    const st = String(s.status ?? "").toLowerCase();
    const status =
      st === "paid" ? "지급완료" : st === "on_hold" ? "보류" : st === "payable" ? "지급가능" : "정산예정";
    const oid = String(s.custom_request_order_id ?? "");
    return withPayoutWithholding({
      id: `cr-${String(s.id ?? oid)}`,
      type: "custom_request" as const,
      date: pickTs(s),
      description: oid ? `맞춤의뢰 주문 · ${oid.slice(0, 8)}` : "맞춤의뢰 주문",
      paymentAmount: payment,
      feeAmount: fee,
      netAmount: net,
      status,
    });
  });

  const seenOrder = new Set(
    settlement.lines
      .map(({ settlement: s }) => String(s.custom_request_order_id ?? ""))
      .filter(Boolean)
  );

  const { data: orders, error } = await client
    .from("custom_request_orders")
    .select("*")
    .eq("mentor_id", mentorId)
    .in("status", ["completed", "complete", "done", "accepted"])
    .order("created_at", { ascending: false })
    .limit(200);

  if (error || !orders) {
    // W4(C10): 오류를 무음으로 부분 목록으로 바꾸지 않는다 — console.error 로 기록한다.
    // 정산 항목(fromSettlement)까지는 반환하는 표시 전용 degrade(성공 아님) — 완료 주문
    // 보강 라인만 빠지며, 반환 타입(MentorPayoutDetailLine[]) 형상 제약으로 error 필드가 없다.
    if (error) console.error("[loadCustomRequestLines] custom_request_orders", error.message);
    return fromSettlement;
  }

  const extra: MentorPayoutDetailLine[] = [];
  for (const o of orders as Row[]) {
    const oid = String(o.id ?? "");
    if (!oid || seenOrder.has(oid)) continue;
    const payment = orderGrossWon(o);
    if (payment <= 0) continue;
    const net = Math.floor(payment * MENTOR_CUSTOM_REQUEST_SHARE);
    const fee = payment - net;
    extra.push(
      withPayoutWithholding({
        id: `cro-${oid}`,
        type: "custom_request",
        date: pickTs(o),
        description: `맞춤의뢰 완료 · ${oid.slice(0, 8)}`,
        paymentAmount: payment,
        feeAmount: fee,
        netAmount: net,
        status: "정산예정",
      })
    );
  }

  return [...fromSettlement, ...extra];
}

/**
 * W-04: 개별질문(IQ) 정산 라인 — individual_questions released 건 기반.
 * 산식은 SQL 096/107/109와 동일: 멘토 85% = floor(price_cents * 0.85).
 * 현행(즉시지급)은 release_ledger_id 설정 → "지급완료", 후불 분리(109) 전환 시
 * released & ledger null 건이 자연히 "정산예정"으로 표시된다.
 */
async function loadIndividualQuestionLines(
  client: SupabaseClient,
  mentorId: string
): Promise<MentorPayoutDetailLine[]> {
  const { data, error } = await client
    .from("individual_questions")
    .select("*")
    .or(`claimed_mentor_id.eq.${mentorId},designated_mentor_id.eq.${mentorId}`)
    .not("released_at", "is", null)
    .order("released_at", { ascending: false })
    .limit(300);
  if (error || !data) {
    // W4(C10): 오류 무음 삼킴 금지 — console.error 로 기록. 빈 배열 반환은 정산 페이지
    // 표시 전용 degrade(성공 아님) — 반환 타입 형상 제약으로 error 필드가 없다.
    if (error) console.error("[loadIndividualQuestionLines] individual_questions", error.message);
    return [];
  }

  const lines: MentorPayoutDetailLine[] = [];
  for (const q of data as Row[]) {
    // 담당 멘토 확정 — claimed 우선(107 뷰와 동일). 지정만 되고 타 멘토가 claim한 건 제외.
    const effectiveMentor = String(q.claimed_mentor_id ?? q.designated_mentor_id ?? "");
    if (effectiveMentor !== mentorId) continue;
    const st = String(q.status ?? "").toLowerCase();
    if (["refunded", "expired", "canceled", "cancelled"].includes(st)) continue;
    const priceCents = intWon(q.price_cents);
    if (priceCents <= 0) continue;
    const netCents = Math.floor(priceCents * MENTOR_INDIVIDUAL_QUESTION_SHARE);
    const qid = String(q.id ?? "");
    const date =
      [q.released_at, q.answered_at, q.created_at].find((v) => typeof v === "string" && v) as string | undefined;
    lines.push(
      withPayoutWithholding({
        id: `iq-${qid}`,
        type: "individual_question",
        date: date ?? new Date().toISOString(),
        description: qid ? `개별질문 · ${qid.slice(0, 8)}` : "개별질문",
        paymentAmount: minorCentsToCash(priceCents),
        feeAmount: minorCentsToCash(priceCents - netCents),
        netAmount: minorCentsToCash(netCents),
        status: q.release_ledger_id ? "지급완료" : "정산예정",
      })
    );
  }
  return lines;
}

function sumNet(lines: MentorPayoutDetailLine[], ym?: string): number {
  return lines
    .filter((l) => (ym ? inYm(l.date, ym) : true))
    .reduce((a, l) => a + l.netAmount, 0);
}

function sumNetByType(lines: MentorPayoutDetailLine[], type: PayoutLineType, ym?: string): number {
  return lines
    .filter((l) => l.type === type && (ym ? inYm(l.date, ym) : true))
    .reduce((a, l) => a + l.netAmount, 0);
}

function sumNetByStatus(
  lines: MentorPayoutDetailLine[],
  ym: string | undefined,
  predicate: (line: MentorPayoutDetailLine) => boolean
): number {
  return lines
    .filter((l) => predicate(l) && (ym ? inYm(l.date, ym) : true))
    .reduce((a, l) => a + l.netAmount, 0);
}

/**
 * W2(C11): 계좌 원문은 서버 경계 밖(응답)으로 내보내지 않는다 — F13 계약(§7 F13)과
 * 동일하게 끝 4자리 외 마스킹 값만 반환한다(UI 는 마스킹 표시 전용, 수정은 새로 입력).
 */
function maskPayoutAccount(accountRaw: string | null): string | null {
  if (!accountRaw) return null;
  const digits = accountRaw.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length <= 4) return "*".repeat(digits.length);
  return "*".repeat(digits.length - 4) + digits.slice(-4);
}

/**
 * W4(C10): 계좌 컬럼 프로빙(pickExistingColumn) 제거 — 정본
 * public.mentor_profiles.payout_bank_name / payout_account_number 고정 컬럼(041 · 187 baseline 실측).
 * 쿼리 오류 시 console.error 후 기본 마스킹 표기 반환 — 계좌 표시는 마스킹 표시 전용
 * degrade(성공 아님 · 수정 플로우는 새로 입력이라 영향 없음).
 */
export async function loadMentorPayoutBankAccount(
  supabase: SupabaseClient,
  mentorId: string
): Promise<{ display: string; editable: boolean; bankName: string | null; accountMasked: string | null }> {
  const { data, error } = await supabase
    .from("mentor_profiles")
    .select("payout_bank_name, payout_account_number")
    .eq("user_id", mentorId)
    .maybeSingle();
  if (error) {
    console.error("[loadMentorPayoutBankAccount]", error.message);
    return { display: DEFAULT_MASKED_BANK_DISPLAY, editable: true, bankName: null, accountMasked: null };
  }
  const row = (data as Row | null) ?? {};
  const bankName = String(row.payout_bank_name ?? "").trim() || null;
  const accountRaw = String(row.payout_account_number ?? "").trim() || null;
  const accountMasked = maskPayoutAccount(accountRaw);
  return {
    display: maskBankDisplay(bankName, accountRaw),
    editable: true,
    bankName,
    accountMasked,
  };
}

export async function loadMentorPayoutSummary(supabase: SupabaseClient, mentorId: string): Promise<MentorPayoutSummary> {
  const client = await readClient(supabase);
  const ym = currentYm();
  const [subLines, crLines, iqLines, bank] = await Promise.all([
    loadSubscriptionLines(client, mentorId),
    loadCustomRequestLines(client, mentorId),
    loadIndividualQuestionLines(client, mentorId),
    loadMentorPayoutBankAccount(client, mentorId),
  ]);

  const all = [...subLines, ...crLines, ...iqLines];
  const thisMonthSubscription = sumNetByType(all, "subscription", ym);
  const thisMonthCustomRequest = sumNetByType(all, "custom_request", ym);
  const thisMonthIndividualQuestion = sumNetByType(all, "individual_question", ym);
  const thisMonthRevenue = thisMonthSubscription + thisMonthCustomRequest + thisMonthIndividualQuestion;

  const paidThisMonth = sumNetByStatus(all, ym, isPaidPayoutLine);
  const expectedThisMonth = sumNetByStatus(all, ym, isPendingPayoutLine);
  const thisMonthScheduledPayout =
    expectedThisMonth > 0 ? expectedThisMonth : Math.max(0, thisMonthRevenue - paidThisMonth);

  // W-01 4단 구조: 총 수익 → 플랫폼 수수료 → 원천징수 3.3% → 실지급 예정액(23일)
  const monthLines = all.filter((l) => inYm(l.date, ym));
  const thisMonthGross = monthLines.reduce((a, l) => a + l.paymentAmount, 0);
  const thisMonthFee = monthLines.reduce((a, l) => a + l.feeAmount, 0);
  const pendingWithholding = monthLines
    .filter(isPendingPayoutLine)
    .reduce((a, l) => a + l.withholdingAmount, 0);
  const thisMonthWithholding =
    expectedThisMonth > 0 ? pendingWithholding : calcPayoutWithholding(thisMonthScheduledPayout);
  const thisMonthNetScheduledPayout = Math.max(0, thisMonthScheduledPayout - thisMonthWithholding);

  return {
    thisMonthRevenue,
    thisMonthScheduledPayout,
    thisMonthSubscription,
    thisMonthCustomRequest,
    thisMonthIndividualQuestion,
    lifetimeSubscription: sumNetByType(all, "subscription"),
    lifetimeCustomRequest: sumNetByType(all, "custom_request"),
    lifetimeIndividualQuestion: sumNetByType(all, "individual_question"),
    thisMonthGross,
    thisMonthFee,
    thisMonthWithholding,
    thisMonthNetScheduledPayout,
    bankDisplay: bank.display,
    bankEditable: bank.editable,
    bankName: bank.bankName,
    bankAccountNumber: bank.accountMasked,
  };
}

export async function loadMentorPayoutMonthlyCards(
  supabase: SupabaseClient,
  mentorId: string,
  months = 6
): Promise<MentorPayoutMonthlyCard[]> {
  const client = await readClient(supabase);
  const [subLines, crLines, iqLines] = await Promise.all([
    loadSubscriptionLines(client, mentorId),
    loadCustomRequestLines(client, mentorId),
    loadIndividualQuestionLines(client, mentorId),
  ]);
  const all = [...subLines, ...crLines, ...iqLines];

  const cards: MentorPayoutMonthlyCard[] = [];
  const now = new Date();
  for (let i = 0; i < months; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const ym = ymKey(d);
    const revenue = sumNet(all, ym);
    const paidInMonth = sumNetByStatus(all, ym, isPaidPayoutLine);
    const pendingInMonth = sumNetByStatus(all, ym, isPendingPayoutLine);

    const scheduledPayout = pendingInMonth > 0 ? pendingInMonth : Math.max(0, revenue - paidInMonth);

    cards.push({
      yearMonth: ym,
      label: `${d.getFullYear()}년 ${d.getMonth() + 1}월`,
      revenue,
      scheduledPayout,
      status: paidInMonth > 0 && scheduledPayout <= 0 ? "paid" : "scheduled",
    });
  }
  return cards;
}

function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? 100 : current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function prevYm(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return ymKey(d);
}

/**
 * W4(C10): payouts/mentor_payouts 프로빙 루프 제거 — 두 테이블 모두 187 baseline 부재
 * 실측(payout 스택은 clean-install 제외)으로 항상 실패하던 사문 프로빙. 정본 경로는
 * 기존 폴백이던 custom_order_settlement_items(paid) + api_web_v1.mentor_settlement_self(paid)
 * 합산 단일 경로다.
 */
async function loadLifetimePaidPayouts(client: SupabaseClient, mentorId: string): Promise<number> {
  const [settlement, subscriptionRows] = await Promise.all([
    loadMentorSettlementItemsForPayouts(client, mentorId),
    loadSubscriptionSettlementRowsForMentor(client, mentorId, 500),
  ]);
  const paidSubscriptions = subscriptionRows
    .filter((r) => subscriptionSettlementStatus(r.status) === "paid")
    .reduce((sum, r) => sum + minorCentsToCash(r.mentor_amount_cents), 0);
  return settlement.totals.paidMentorAmount + paidSubscriptions;
}

function orderTitle(o: Row): string {
  for (const k of ["title", "subject", "post_title", "request_title"]) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "맞춤의뢰 주문";
}

function orderStudentName(o: Row): string {
  for (const k of ["student_name", "student_nickname", "buyer_name"]) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "학생";
}

function orderPerfStatus(o: Row): MentorPayoutPerformanceRow["uiStatus"] {
  const st = String(o.status ?? "").toLowerCase();
  if (["cancelled", "canceled", "refunded", "dispute"].some((x) => st.includes(x))) return "cancelled";
  if (["completed", "complete", "done", "accepted", "delivered"].some((x) => st.includes(x))) return "done";
  return "in_progress";
}

async function loadPerformanceLines(
  client: SupabaseClient,
  mentorId: string
): Promise<MentorPayoutPerformanceRow[]> {
  const rows: MentorPayoutPerformanceRow[] = [];

  const { data: orders, error } = await client
    .from("custom_request_orders")
    .select("*")
    .eq("mentor_id", mentorId)
    .order("created_at", { ascending: false })
    .limit(80);

  if (!error && orders) {
    for (const o of orders as Row[]) {
      const gross = orderGrossWon(o);
      rows.push({
        id: `perf-cr-${String(o.id ?? "")}`,
        date: pickTs(o),
        type: "custom_request",
        title: orderTitle(o),
        studentName: orderStudentName(o),
        amount: gross > 0 ? Math.floor(gross * MENTOR_CUSTOM_REQUEST_SHARE) : 0,
        uiStatus: orderPerfStatus(o),
      });
    }
  }

  const subscriptionRows = await loadSubscriptionSettlementRowsForMentor(client, mentorId, 40);
  for (const r of subscriptionRows) {
    const status = subscriptionSettlementStatus(r.status);
    rows.push({
      id: `perf-sub-${String(r.id ?? r.billing_event_id ?? "")}`,
      date: subscriptionSettlementDate(r),
      type: "subscription",
      title: SUBSCRIPTION_SETTLEMENT_LABEL,
      studentName: SUBSCRIPTION_STUDENT_LABEL,
      amount: minorCentsToCash(r.mentor_amount_cents),
      uiStatus: status === "paid" ? "done" : status === "canceled" ? "cancelled" : "in_progress",
    });
  }

  rows.sort((a, b) => (a.date < b.date ? 1 : -1));
  return rows;
}

export async function loadMentorPayoutsPageData(
  supabase: SupabaseClient,
  mentorId: string
): Promise<MentorPayoutsPageData> {
  const client = await readClient(supabase);
  const ym = currentYm();
  const prev = prevYm(ym);

  const [summary, months, subLines, crLines, iqLines, lifetimePaid, performanceLines] =
    await Promise.all([
      loadMentorPayoutSummary(supabase, mentorId),
      loadMentorPayoutMonthlyCards(supabase, mentorId, 6),
      loadSubscriptionLines(client, mentorId),
      loadCustomRequestLines(client, mentorId),
      loadIndividualQuestionLines(client, mentorId),
      loadLifetimePaidPayouts(client, mentorId),
      loadPerformanceLines(client, mentorId),
    ]);

  const all = [...subLines, ...crLines, ...iqLines];
  const settlementLines = all.map(detailLineToSettlementRow).sort((a, b) => (a.date < b.date ? 1 : -1));

  const thisSub = sumNetByType(all, "subscription", ym);
  const thisCr = sumNetByType(all, "custom_request", ym);
  const thisIq = sumNetByType(all, "individual_question", ym);
  const prevSub = sumNetByType(all, "subscription", prev);
  const prevCr = sumNetByType(all, "custom_request", prev);
  const prevIq = sumNetByType(all, "individual_question", prev);
  const thisTotal = thisSub + thisCr + thisIq;
  const prevTotal = prevSub + prevCr + prevIq;

  const shareTotal = thisTotal > 0 ? thisTotal : 1;
  const revenueShare = {
    subscription: thisSub,
    customRequest: thisCr,
    individualQuestion: thisIq,
    total: thisTotal,
    subscriptionPct: Math.round((thisSub / shareTotal) * 100),
    customRequestPct: Math.round((thisCr / shareTotal) * 100),
    individualQuestionPct: Math.round((thisIq / shareTotal) * 100),
  };

  const paidThisMonth = sumNetByStatus(all, ym, isPaidPayoutLine);

  // W-01: 지급 예정액은 원천징수 3.3% 공제 후 실지급 기준
  const schedule = buildPayoutScheduleInfo(
    summary.thisMonthNetScheduledPayout,
    paidThisMonth > 0 ? paidThisMonth : lifetimePaid
  );

  return {
    summary,
    months,
    schedule,
    revenueShare,
    kpis: {
      subscription: { amount: thisSub, momPct: pctChange(thisSub, prevSub) },
      customRequest: { amount: thisCr, momPct: pctChange(thisCr, prevCr) },
      individualQuestion: { amount: thisIq, momPct: pctChange(thisIq, prevIq) },
      total: { amount: thisTotal, momPct: pctChange(thisTotal, prevTotal) },
      lifetimePaid,
    },
    settlementLines,
    performanceLines,
    defaultMonth: ym,
  };
}

export async function loadMentorPayoutDetail(
  supabase: SupabaseClient,
  mentorId: string,
  opts: { month?: string | null; type?: PayoutLineType | "all" | null }
): Promise<MentorPayoutDetailResult> {
  const client = await readClient(supabase);
  const [subLines, crLines, iqLines] = await Promise.all([
    loadSubscriptionLines(client, mentorId),
    loadCustomRequestLines(client, mentorId),
    loadIndividualQuestionLines(client, mentorId),
  ]);

  let lines = [...subLines, ...crLines, ...iqLines];
  if (opts.type && opts.type !== "all") {
    lines = lines.filter((l) => l.type === opts.type);
  }
  if (opts.month) {
    const { start, end } = monthStartEnd(opts.month);
    lines = lines.filter((l) => l.date >= start.slice(0, 10) && l.date <= end);
  }
  lines.sort((a, b) => (a.date < b.date ? 1 : -1));

  const totals = lines.reduce(
    (acc, l) => ({
      paymentAmount: acc.paymentAmount + l.paymentAmount,
      feeAmount: acc.feeAmount + l.feeAmount,
      netAmount: acc.netAmount + l.netAmount,
      withholdingAmount: acc.withholdingAmount + l.withholdingAmount,
      payoutAmount: acc.payoutAmount + l.payoutAmount,
    }),
    { paymentAmount: 0, feeAmount: 0, netAmount: 0, withholdingAmount: 0, payoutAmount: 0 }
  );

  return { lines, totals };
}
