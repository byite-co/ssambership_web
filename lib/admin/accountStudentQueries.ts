import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CASH_LEDGER_KIND_LABELS,
  STUDENT_SUBSCRIPTION_VISIBLE_STATUSES,
  classifyCashLedgerEntry,
  planTierLabel,
  studentProfileWarnings,
  type CashLedgerKind,
} from "@/lib/admin/accountDetailConsole";
import { loadUserNamesByIds, type AccountUserRow } from "@/lib/admin/accountDetailQueries";
import { loadAuthorContentIds } from "@/lib/admin/contentReportTargetUserQueries";
import { ledgerReasonLabel } from "@/lib/cash/ledgerRowDisplay";
import { FREE_QUESTION_EXPIRY_DAYS, FREE_QUESTION_TOTAL_LIMIT } from "@/lib/mentor/freeQuestionPolicy";
import { PAYSYNC_INVOICE_COLUMNS, type PaysyncInvoiceRow } from "@/lib/paysync/paysyncInvoiceService";
import { countFreeQuestionsTotal, isFreeQuestionQuotaExpired } from "@/lib/qna/freeQuestionUsage";
import { fetchWeeklyQuestionUsagePairParty, type WeeklyQuestionUsage } from "@/lib/qna/weeklyQuestionUsage";
import { isSubscribePlanTier, type SubscribePlanTier } from "@/lib/subscribe/subscribePageQueries";

/**
 * 계정 상세 — 학생 탭(PR-7 §2-4) 조회. 전부 service_role 읽기(구독·원장·결제는 학생 RLS 가 본인 행만 열어 관리자 세션으로는 0행이다).
 *
 * - 구독 현황: `subscriptions`(활성·만료 예정·연체·해지·만료) + 멘토 이름(`users`) + 요금제(`plan_tier` → 없으면 `plan_id` 의 mentor_plans 행).
 * - 캐시: `cash_wallets.balance_cents` · `cash_ledger` 최근 20건(충전·차감·환불·보너스 분류는 `classifyCashLedgerEntry`) · `paysync_invoices` pending.
 * - 질문 사용량: 활성 구독 멘토마다 RPC `get_weekly_question_usage`(pair-party 레거시 경로 — service_role 통과) · 무료 질문권 잔여(`free_question_usage` + 가입 7일 만료).
 * - 신고·분쟁: 신고한 건(`content_reports.reporter_id`) · 신고당한 건(이 학생의 글·숏폼·댓글이 대상 — PR-6 과 같은 수집) · 분쟁 당사자(`disputes` 학생·멘토·제출자).
 * - 결제 이력: `payments` 최근 20건(`user_id`·`student_id`·`payer_id` 중 하나). 상태 라벨은 사전(`payments.status`)이 정규화한다.
 */

const SUBSCRIPTION_COLUMNS = "id, mentor_id, plan_tier, plan_id, status, current_period_end, next_billing_at, cancel_at_period_end, created_at, started_at";
const LEDGER_COLUMNS = "id, delta_cents, reason, ref_type, ref_id, created_at";
const PAYMENT_COLUMNS = "id, amount, currency, status, kind, pg_method, pg_paid_at, created_at";
const LEDGER_LIMIT = 20;
const PAYMENT_LIMIT = 20;
const RECENT_CASE_LIMIT = 3;
const SUBSCRIPTION_LIMIT = 50;

type Row = Record<string, unknown>;

export type StudentSubscriptionRow = {
  id: string;
  mentorId: string;
  mentorName: string;
  planTier: SubscribePlanTier | null;
  planLabel: string;
  status: string;
  /** 갱신일 — next_billing_at → 없으면 current_period_end */
  renewalAt: string | null;
  cancelAtPeriodEnd: boolean;
  createdAt: string | null;
};

export type StudentLedgerRow = {
  id: string;
  deltaCents: number;
  kind: CashLedgerKind;
  kindLabel: string;
  reasonLabel: string;
  createdAt: string | null;
};

export type StudentPendingInvoice = { id: string; payKrw: number; cashKrw: number; depositorName: string; issuedAt: string; expiresAt: string | null };

export type StudentUsageRow = { mentorId: string; mentorName: string; usage: WeeklyQuestionUsage | null; error: string | null };

export type StudentCaseRef = { id: string; status: string; createdAt: string | null; label: string };

export type StudentPaymentRow = {
  id: string;
  amount: number | null;
  currency: string | null;
  status: string;
  kind: string | null;
  method: string | null;
  createdAt: string | null;
};

export type StudentAccountSection = {
  profile: { nickname: string | null; gradeLevel: string | null; studentStatus: string | null; birthDate: string | null; warnings: string[] };
  subscriptions: { rows: StudentSubscriptionRow[]; error: string | null };
  cash: {
    balanceCashKrw: number | null;
    walletError: string | null;
    ledger: StudentLedgerRow[];
    ledgerError: string | null;
    pendingInvoices: StudentPendingInvoice[];
    invoicesError: string | null;
  };
  usage: {
    rows: StudentUsageRow[];
    free: { used: number | null; remaining: number | null; expired: boolean | null; total: number; expiryDays: number; error: string | null };
  };
  cases: {
    reportedBy: { count: number | null; recent: StudentCaseRef[] };
    reportedAgainst: { count: number | null; recent: StudentCaseRef[] };
    disputes: { count: number | null; recent: StudentCaseRef[] };
    error: string | null;
  };
  payments: { rows: StudentPaymentRow[]; error: string | null };
};

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}
function numOrNull(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

async function loadPlanTiersByIds(db: SupabaseClient, planIds: readonly string[]): Promise<Map<string, SubscribePlanTier>> {
  const map = new Map<string, SubscribePlanTier>();
  const unique = [...new Set(planIds.filter(Boolean))];
  if (!unique.length) return map;
  const { data, error } = await db.from("mentor_plans").select("id, plan_tier").in("id", unique);
  if (error) {
    console.error("[accountStudent] mentor_plans:", error.message);
    return map;
  }
  for (const r of (data as Row[] | null) ?? []) {
    const tier = str(r.plan_tier).toLowerCase();
    if (str(r.id) && isSubscribePlanTier(tier)) map.set(str(r.id), tier);
  }
  return map;
}

async function loadSubscriptions(db: SupabaseClient, studentId: string): Promise<StudentAccountSection["subscriptions"]> {
  const { data, error } = await db
    .from("subscriptions")
    .select(SUBSCRIPTION_COLUMNS)
    .eq("student_id", studentId)
    .in("status", [...STUDENT_SUBSCRIPTION_VISIBLE_STATUSES])
    .order("created_at", { ascending: false })
    .limit(SUBSCRIPTION_LIMIT);
  if (error) {
    console.error("[accountStudent] subscriptions:", error.message);
    return { rows: [], error: "구독 현황을 불러오지 못했습니다." };
  }
  const raw = (data as Row[] | null) ?? [];
  const [names, tiers] = await Promise.all([
    loadUserNamesByIds(db, raw.map((r) => str(r.mentor_id))),
    loadPlanTiersByIds(db, raw.filter((r) => !isSubscribePlanTier(str(r.plan_tier).toLowerCase())).map((r) => str(r.plan_id))),
  ]);
  return {
    rows: raw.map((r) => {
      const mentorId = str(r.mentor_id);
      const direct = str(r.plan_tier).toLowerCase();
      const tier: SubscribePlanTier | null = isSubscribePlanTier(direct) ? direct : (tiers.get(str(r.plan_id)) ?? null);
      return {
        id: str(r.id),
        mentorId,
        mentorName: names.get(mentorId) ?? (mentorId ? mentorId.slice(0, 8) : "—"),
        planTier: tier,
        planLabel: tier ? planTierLabel(tier) : "요금제 미상",
        status: str(r.status),
        renewalAt: strOrNull(r.next_billing_at) ?? strOrNull(r.current_period_end),
        cancelAtPeriodEnd: r.cancel_at_period_end === true,
        createdAt: strOrNull(r.created_at),
      };
    }),
    error: null,
  };
}

async function loadCash(db: SupabaseClient, userId: string): Promise<StudentAccountSection["cash"]> {
  const [wallet, ledger, invoices] = await Promise.all([
    db.from("cash_wallets").select("balance_cents").eq("user_id", userId).maybeSingle(),
    db.from("cash_ledger").select(LEDGER_COLUMNS).eq("user_id", userId).order("created_at", { ascending: false }).limit(LEDGER_LIMIT),
    db.from("paysync_invoices").select(PAYSYNC_INVOICE_COLUMNS).eq("user_id", userId).eq("status", "pending").order("issued_at", { ascending: false }),
  ]);
  if (wallet.error) console.error("[accountStudent] cash_wallets:", wallet.error.message);
  if (ledger.error) console.error("[accountStudent] cash_ledger:", ledger.error.message);
  if (invoices.error) console.error("[accountStudent] paysync_invoices:", invoices.error.message);
  const balanceCents = wallet.error ? null : numOrNull((wallet.data as Row | null)?.balance_cents);
  return {
    balanceCashKrw: wallet.error ? null : balanceCents == null ? 0 : Math.floor(balanceCents / 100),
    walletError: wallet.error ? "캐시 잔액을 불러오지 못했습니다." : null,
    ledger: ledger.error
      ? []
      : ((ledger.data as Row[] | null) ?? []).map((r) => {
          const deltaCents = numOrNull(r.delta_cents) ?? 0;
          const kind = classifyCashLedgerEntry({ deltaCents, reason: strOrNull(r.reason), refType: strOrNull(r.ref_type) });
          return { id: str(r.id), deltaCents, kind, kindLabel: CASH_LEDGER_KIND_LABELS[kind], reasonLabel: ledgerReasonLabel(r), createdAt: strOrNull(r.created_at) };
        }),
    ledgerError: ledger.error ? "캐시 원장을 불러오지 못했습니다." : null,
    pendingInvoices: invoices.error
      ? []
      : ((invoices.data as PaysyncInvoiceRow[] | null) ?? []).map((row) => ({
          id: row.id,
          payKrw: row.pay_krw,
          cashKrw: row.cash_krw,
          depositorName: row.depositor_name,
          issuedAt: row.issued_at,
          expiresAt: row.expires_at,
        })),
    invoicesError: invoices.error ? "무통장 대기 주문을 불러오지 못했습니다." : null,
  };
}

async function loadUsage(db: SupabaseClient, studentId: string, activeMentors: readonly { mentorId: string; mentorName: string }[]): Promise<StudentAccountSection["usage"]> {
  const [rows, freeCount, freeExpiry] = await Promise.all([
    Promise.all(
      activeMentors.map(async ({ mentorId, mentorName }) => {
        const r = await fetchWeeklyQuestionUsagePairParty(db, studentId, mentorId);
        if (r.error) console.error("[accountStudent] get_weekly_question_usage:", r.error);
        return { mentorId, mentorName, usage: r.error ? null : r.usage, error: r.error ? "사용량 RPC 실패" : null };
      })
    ),
    countFreeQuestionsTotal(db, studentId),
    isFreeQuestionQuotaExpired(db, studentId),
  ]);
  const error = freeCount.error ?? freeExpiry.error;
  if (error) console.error("[accountStudent] free_question_usage:", error);
  const used = error ? null : freeCount.count;
  const expired = error ? null : freeExpiry.expired;
  return {
    rows,
    free: {
      used,
      remaining: used == null || expired == null ? null : expired ? 0 : Math.max(0, FREE_QUESTION_TOTAL_LIMIT - used),
      expired,
      total: FREE_QUESTION_TOTAL_LIMIT,
      expiryDays: FREE_QUESTION_EXPIRY_DAYS,
      error: error ? "무료 질문권 사용량을 불러오지 못했습니다." : null,
    },
  };
}

type CountRecentResult = { data: unknown; error: { message: string } | null; count: number | null };

/** 건수(count exact) + 최근 N건 — 호출부가 `.order().limit()` 까지 붙인 쿼리를 넘긴다(PostgREST 제네릭을 좁히지 않기 위해 결과 형상만 받는다). */
async function countAndRecent(
  run: () => PromiseLike<CountRecentResult>,
  labelOf: (row: Row) => string,
  label: string
): Promise<{ count: number | null; recent: StudentCaseRef[]; error: string | null }> {
  const { data, error, count } = await run();
  if (error) {
    console.error(`[accountStudent] ${label}:`, error.message);
    return { count: null, recent: [], error: label };
  }
  return {
    count: count ?? 0,
    recent: ((data as Row[] | null) ?? []).map((r) => ({ id: str(r.id), status: str(r.status), createdAt: strOrNull(r.created_at), label: labelOf(r) })),
    error: null,
  };
}

async function loadCases(db: SupabaseClient, userId: string): Promise<StudentAccountSection["cases"]> {
  const contentIds = await loadAuthorContentIds(db, userId);
  const reportLabel = (r: Row) => `${str(r.target_type) || "신고"}${str(r.reason) ? ` · ${str(r.reason)}` : ""}`;
  const recentFirst = { ascending: false } as const;
  const [reportedBy, reportedAgainst, disputes] = await Promise.all([
    countAndRecent(
      () => db.from("content_reports").select("id, status, created_at, target_type, reason", { count: "exact" }).eq("reporter_id", userId).order("created_at", recentFirst).limit(RECENT_CASE_LIMIT),
      reportLabel,
      "content_reports(reporter)"
    ),
    contentIds.length
      ? countAndRecent(
          () => db.from("content_reports").select("id, status, created_at, target_type, reason", { count: "exact" }).in("target_id", contentIds).order("created_at", recentFirst).limit(RECENT_CASE_LIMIT),
          reportLabel,
          "content_reports(target)"
        )
      : Promise.resolve({ count: 0, recent: [], error: null }),
    countAndRecent(
      () =>
        db
          .from("disputes")
          .select("id, status, created_at, body", { count: "exact" })
          .or(`student_id.eq.${userId},mentor_id.eq.${userId},submitted_by.eq.${userId}`)
          .order("created_at", recentFirst)
          .limit(RECENT_CASE_LIMIT),
      (r) => (str(r.body) ? str(r.body).slice(0, 40) : "분쟁"),
      "disputes"
    ),
  ]);
  const error = reportedBy.error ?? reportedAgainst.error ?? disputes.error;
  return {
    reportedBy: { count: reportedBy.count, recent: reportedBy.recent },
    reportedAgainst: { count: reportedAgainst.count, recent: reportedAgainst.recent },
    disputes: { count: disputes.count, recent: disputes.recent },
    error: error ? "신고·분쟁 일부를 불러오지 못했습니다." : null,
  };
}

async function loadPayments(db: SupabaseClient, userId: string): Promise<StudentAccountSection["payments"]> {
  const { data, error } = await db
    .from("payments")
    .select(PAYMENT_COLUMNS)
    .or(`user_id.eq.${userId},student_id.eq.${userId},payer_id.eq.${userId}`)
    .order("created_at", { ascending: false })
    .limit(PAYMENT_LIMIT);
  if (error) {
    console.error("[accountStudent] payments:", error.message);
    return { rows: [], error: "결제 이력을 불러오지 못했습니다." };
  }
  return {
    rows: ((data as Row[] | null) ?? []).map((r) => ({
      id: str(r.id),
      amount: numOrNull(r.amount),
      currency: strOrNull(r.currency),
      status: str(r.status),
      kind: strOrNull(r.kind),
      method: strOrNull(r.pg_method),
      createdAt: strOrNull(r.pg_paid_at) ?? strOrNull(r.created_at),
    })),
    error: null,
  };
}

export async function loadStudentAccountSection(db: SupabaseClient, user: AccountUserRow): Promise<StudentAccountSection> {
  const id = user.id;
  const subscriptions = await loadSubscriptions(db, id);
  const activeMentors = subscriptions.rows.filter((s) => s.status === "active").map((s) => ({ mentorId: s.mentorId, mentorName: s.mentorName }));
  const [cash, usage, cases, payments] = await Promise.all([loadCash(db, id), loadUsage(db, id, activeMentors), loadCases(db, id), loadPayments(db, id)]);
  return {
    profile: {
      nickname: user.nickname,
      gradeLevel: user.grade_level,
      studentStatus: user.student_status,
      birthDate: user.birth_date,
      warnings: studentProfileWarnings({ birthDate: user.birth_date }),
    },
    subscriptions,
    cash,
    usage,
    cases,
    payments,
  };
}
