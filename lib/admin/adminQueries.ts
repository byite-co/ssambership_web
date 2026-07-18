import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { toAdminDisplayError } from "@/lib/admin/adminDisplayError";
import { mentorProfilesAdminReadClient } from "@/lib/admin/mentorProfilesAdminRead";
import type { AdminReviewModerationPlan } from "@/lib/admin/reviewLabels";
import { pickExistingColumn } from "@/lib/qna/safeSelect";
import {
  loadSubscriptionSettlementRowsForAdmin,
  minorCentsToCash,
  subscriptionSettlementStatus,
} from "@/lib/mentor/subscriptionSettlementItems";

type Row = Record<string, unknown>;

function fmt(e: PostgrestError | null): string | null {
  return e ? e.message : null;
}

/** 테이블 후보 중 읽기 가능한 첫 테이블 */
export async function firstReadableAdminTable(
  supabase: SupabaseClient,
  candidates: readonly string[]
): Promise<{ table: string | null; error: string }> {
  let last = "no candidates";
  for (const table of candidates) {
    const { error } = await supabase.from(table).select("*").limit(1);
    if (!error) return { table, error: "" };
    last = error.message;
  }
  return { table: null, error: last };
}

async function selectWithOrder<T extends Row>(
  supabase: SupabaseClient,
  table: string,
  limit: number
): Promise<{ rows: T[]; error: string | null }> {
  const orderCols = ["created_at", "updated_at", "id", "submitted_at"] as const;
  for (const col of orderCols) {
    const { data, error } = await supabase.from(table).select("*").order(col, { ascending: false }).limit(limit);
    if (!error) return { rows: (data as T[] | null) ?? [], error: null };
    if (!/column|does not exist|schema cache/i.test(error.message)) {
      return { rows: [], error: error.message };
    }
  }
  const { data, error } = await supabase.from(table).select("*").limit(limit);
  return { rows: (data as T[] | null) ?? [], error: fmt(error) };
}

async function countAll(supabase: SupabaseClient, table: string): Promise<{ n: number | null; error: string | null }> {
  const { count, error } = await supabase.from(table).select("*", { count: "exact", head: true });
  if (error) return { n: null, error: error.message };
  return { n: count ?? 0, error: null };
}

async function countEq(
  supabase: SupabaseClient,
  table: string,
  col: string,
  val: string
): Promise<{ n: number | null; error: string | null }> {
  const { count, error } = await supabase.from(table).select("*", { count: "exact", head: true }).eq(col, val);
  if (error) return { n: null, error: error.message };
  return { n: count ?? 0, error: null };
}

/** pending류 큐: 컬럼·값 후보로 첫 성공 count */
async function countQueuePending(
  supabase: SupabaseClient,
  table: string,
  colCandidates: readonly string[],
  valueCandidates: readonly string[]
): Promise<{ n: number; detail: string; ok: boolean; usedTotalFallback?: boolean }> {
  for (const col of colCandidates) {
    const { column } = await pickExistingColumn(supabase, table, [col]);
    if (!column) continue;
    for (const val of valueCandidates) {
      const r = await countEq(supabase, table, column, val);
      if (r.n !== null && !r.error) {
        return { n: r.n, detail: `조건에 맞는 건 ${r.n}건`, ok: true };
      }
    }
  }
  const t = await countAll(supabase, table);
  if (t.n === null) return { n: 0, detail: t.error ?? "건수를 확인할 수 없습니다.", ok: false };
  return { n: t.n, detail: `전체 ${t.n}건`, ok: true, usedTotalFallback: true };
}

// —— dashboard —— //

export type AdminQueueMetric = {
  label: string;
  nText: string;
  href: string;
  detail: string;
  state: "connected" | "empty" | "skeleton";
};

export type AdminScaffold = { title: string; body: string; status: "connected" | "skeleton" };

function safeDashboardError(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  return toAdminDisplayError(raw, "default") ?? "목록을 불러올 수 없습니다.";
}

/** errors 객체에 넣을 때: 원문이 없어도 항상 비어 있지 않은 한 줄 안내 */
function dashboardErrorMessage(raw: string | undefined): string {
  return safeDashboardError(raw) ?? "목록을 불러올 수 없습니다.";
}

export type AdminDashboardSummaryErrors = Partial<{
  mentorApprovals: string;
  reports: string;
  disputes: string;
  refunds: string;
  reviews: string;
  settlements: string;
  auditLogs: string;
  notices: string;
}>;

export type AdminDashboardSummary = {
  mentorApprovalPendingCount: number | null;
  reportOpenCount: number | null;
  disputeActiveCount: number | null;
  refundPendingCount: number | null;
  /** 연결된 리뷰 테이블의 전체 행 수(숨김·블라인드 포함). RLS/관리자와 무관한 count 쿼리 기준. */
  reviewTotalCount: number | null;
  settlementPendingAmount: number | null;
  settlementPendingCount: number | null;
  auditLogCount: number | null;
  noticesActiveCount: number | null;
  /** 상태 컬럼 매칭 실패 시 전체 건수로 대체한 경우 */
  disputeApproximate: boolean;
  errors: AdminDashboardSummaryErrors;
};

function wonLabel(n: number): string {
  return `${new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 }).format(Math.round(n))}원`;
}

function metricState(n: number | null, okZero: boolean): AdminQueueMetric["state"] {
  if (n === null) return "skeleton";
  if (okZero && n === 0) return "empty";
  return "connected";
}

async function dashboardRefundPendingCount(
  supabase: SupabaseClient,
  table: string
): Promise<{ n: number | null; err?: string }> {
  const { count, error } = await supabase.from(table).select("*", { count: "exact", head: true }).eq("status", "pending");
  if (error) return { n: null, err: error.message };
  return { n: count ?? 0 };
}

async function dashboardSettlementPending(supabase: SupabaseClient): Promise<{
  count: number | null;
  amount: number | null;
  err?: string;
}> {
  const pageSize = 1000;
  let offset = 0;
  let amount = 0;
  let count = 0;
  for (;;) {
    const { data, error } = await supabase
      .from(COSI_TABLE)
      .select("mentor_amount, status")
      .in("status", ["pending", "on_hold", "payable"])
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) return { count: null, amount: null, err: error.message };
    const rows = (data ?? []) as { mentor_amount?: unknown; status?: unknown }[];
    if (!rows.length) break;
    count += rows.length;
    for (const r of rows) {
      amount += toMoneyInt(r.mentor_amount);
    }
    if (rows.length < pageSize) break;
    offset += pageSize;
  }
  return { count, amount, err: undefined };
}

async function dashboardNoticesActiveCount(supabase: SupabaseClient): Promise<{ n: number | null; err?: string }> {
  let total = 0;
  const errs: string[] = [];
  const a = await supabase.from("app_notices").select("*", { count: "exact", head: true }).eq("is_active", true);
  if (a.error) errs.push(a.error.message);
  else total += a.count ?? 0;
  const b = await supabase.from("promotion_campaigns").select("*", { count: "exact", head: true }).eq("is_active", true);
  if (b.error) errs.push(b.error.message);
  else total += b.count ?? 0;
  if (errs.length === 2) return { n: null, err: errs[0] };
  if (errs.length === 1 && total === 0) return { n: null, err: errs[0] };
  return { n: total };
}

/**
 * 관리자 대시보드용 집계(각 메뉴와 동일한 테이블·상태 기준을 최대한 맞춤).
 */
export async function loadAdminDashboardSummary(supabase: SupabaseClient): Promise<AdminDashboardSummary> {
  const errors: AdminDashboardSummaryErrors = {};

  const mentorRead = mentorProfilesAdminReadClient(supabase);
  const mTable = await firstReadableAdminTable(mentorRead, ["mentor_profiles"]);
  let mentorApprovalPendingCount: number | null = null;
  if (!mTable.table) {
    errors.mentorApprovals = dashboardErrorMessage(mTable.error);
  } else {
    const p = await countQueuePending(
      mentorRead,
      mTable.table,
      ["verification_status", "status", "approval_status", "review_state"],
      ["pending", "submitted", "under_review", "awaiting", "PENDING"]
    );
    if (!p.ok) {
      mentorApprovalPendingCount = null;
      errors.mentorApprovals = dashboardErrorMessage(p.detail);
    } else {
      mentorApprovalPendingCount = p.n;
    }
  }

  let reportOpenCount: number | null = null;
  const crProbe = await supabase.from("content_reports").select("id").limit(1);
  if (!crProbe.error) {
    const { count, error: crCountErr } = await supabase
      .from("content_reports")
      .select("*", { count: "exact", head: true })
      .in("status", ["pending", "reviewing"]);
    if (crCountErr) {
      reportOpenCount = null;
      errors.reports = dashboardErrorMessage(crCountErr.message);
    } else {
      reportOpenCount = count ?? 0;
    }
  } else {
    const rTable = await firstReadableAdminTable(supabase, ["reports", "abuse_reports", "content_reports"]);
    if (!rTable.table) {
      errors.reports = dashboardErrorMessage(rTable.error);
    } else {
      const p = await countQueuePending(
        supabase,
        rTable.table,
        ["status", "state", "report_status"],
        ["open", "pending", "new", "submitted", "PENDING", "OPEN"]
      );
      if (!p.ok) {
        reportOpenCount = null;
        errors.reports = dashboardErrorMessage(p.detail);
      } else {
        reportOpenCount = p.n;
      }
    }
  }

  const dTable = await firstReadableAdminTable(supabase, [
    "disputes",
    "order_disputes",
    "refund_disputes",
    "user_disputes",
    "support_tickets",
  ] as const);
  let disputeActiveCount: number | null = null;
  let disputeApproximate = false;
  if (!dTable.table) {
    errors.disputes = dashboardErrorMessage(dTable.error);
  } else if (dTable.table === "disputes") {
    const { count, error: dErr } = await supabase
      .from("disputes")
      .select("*", { count: "exact", head: true })
      .in("status", ["open", "under_review", "escalated"]);
    if (dErr) {
      disputeActiveCount = null;
      errors.disputes = dashboardErrorMessage(dErr.message);
    } else {
      disputeActiveCount = count ?? 0;
      disputeApproximate = false;
    }
  } else {
    const p = await countQueuePending(
      supabase,
      dTable.table,
      ["status", "state", "phase", "resolution", "outcome"],
      ["open", "pending", "new", "submitted", "PENDING", "OPEN", "review", "awaiting"]
    );
    if (!p.ok) {
      disputeActiveCount = null;
      errors.disputes = dashboardErrorMessage(p.detail);
    } else {
      disputeActiveCount = p.n;
      disputeApproximate = Boolean(p.usedTotalFallback);
    }
  }

  const fTable = await firstReadableAdminTable(supabase, ["refunds"]);
  let refundPendingCount: number | null = null;
  if (!fTable.table) {
    errors.refunds = dashboardErrorMessage(fTable.error);
  } else {
    const rp = await dashboardRefundPendingCount(supabase, fTable.table);
    if (rp.err) {
      refundPendingCount = null;
      errors.refunds = dashboardErrorMessage(rp.err);
    } else {
      refundPendingCount = rp.n;
    }
  }

  const wTable = await firstReadableAdminTable(supabase, ["reviews", "mentor_reviews", "mentor_review"] as const);
  let reviewTotalCount: number | null = null;
  if (!wTable.table) {
    errors.reviews = dashboardErrorMessage(wTable.error);
  } else {
    const t = await countAll(supabase, wTable.table);
    if (t.n === null) {
      reviewTotalCount = null;
      errors.reviews = dashboardErrorMessage(t.error ?? undefined);
    } else {
      reviewTotalCount = t.n;
    }
  }

  let settlementPendingAmount: number | null = null;
  let settlementPendingCount: number | null = null;
  const sp = await dashboardSettlementPending(supabase);
  if (sp.err) {
    errors.settlements = dashboardErrorMessage(sp.err);
  } else {
    settlementPendingAmount = sp.amount;
    settlementPendingCount = sp.count;
  }

  const aTable = await firstReadableAdminTable(supabase, ["audit_logs", "audit_events", "verification_logs", "admin_audit_logs"] as const);
  let auditLogCount: number | null = null;
  if (!aTable.table) {
    errors.auditLogs = dashboardErrorMessage(aTable.error);
  } else {
    const t = await countAll(supabase, aTable.table);
    if (t.n === null) {
      auditLogCount = null;
      errors.auditLogs = dashboardErrorMessage(t.error ?? undefined);
    } else {
      auditLogCount = t.n;
    }
  }

  let noticesActiveCount: number | null = null;
  const nc = await dashboardNoticesActiveCount(supabase);
  noticesActiveCount = nc.n;
  if (nc.n === null && nc.err) {
    errors.notices = dashboardErrorMessage(nc.err);
  }

  return {
    mentorApprovalPendingCount,
    reportOpenCount,
    disputeActiveCount,
    refundPendingCount,
    reviewTotalCount,
    settlementPendingAmount,
    settlementPendingCount,
    auditLogCount,
    noticesActiveCount,
    disputeApproximate,
    errors,
  };
}

function summaryToQueueCards(summary: AdminDashboardSummary): AdminQueueMetric[] {
  const fmt = (n: number | null) => (n === null ? "—" : String(n));

  const qMentor: AdminQueueMetric = {
    label: "멘토 승인 대기",
    nText: fmt(summary.mentorApprovalPendingCount),
    href: "/admin/mentor-approvals",
    detail:
      summary.mentorApprovalPendingCount === null
        ? "목록을 불러올 수 없습니다."
        : summary.mentorApprovalPendingCount === 0
          ? "표시할 대기 건이 없습니다(0건)."
          : "승인 대기·검토 중 멘토 신청 건수입니다.",
    state: metricState(summary.mentorApprovalPendingCount, true),
  };

  const qRep: AdminQueueMetric = {
    label: "신고 접수",
    nText: fmt(summary.reportOpenCount),
    href: "/admin/reports",
    detail:
      summary.reportOpenCount === null
        ? "목록을 불러올 수 없습니다."
        : summary.reportOpenCount === 0
          ? "표시할 접수 건이 없습니다(0건)."
          : "접수·진행 중 신고 건수입니다.",
    state: metricState(summary.reportOpenCount, true),
  };

  const qDis: AdminQueueMetric = {
    label: "분쟁 관리",
    nText: fmt(summary.disputeActiveCount),
    href: "/admin/disputes",
    detail:
      summary.disputeActiveCount === null
        ? "목록을 불러올 수 없습니다."
        : summary.disputeApproximate
          ? "진행 상태 필터가 맞지 않아 전체 건수로 표시합니다. 확인이 필요합니다."
          : "분쟁 기록 기준 접수·검토·에스컬레이션 상태 건수입니다.",
    state: metricState(summary.disputeActiveCount, true),
  };

  const qRef: AdminQueueMetric = {
    label: "환불 요청",
    nText: fmt(summary.refundPendingCount),
    href: "/admin/refunds",
    detail:
      summary.refundPendingCount === null
        ? "목록을 불러올 수 없습니다."
        : summary.refundPendingCount === 0
          ? "대기 중인 환불 요청이 없습니다(0건)."
          : "상태가 대기인 환불 요청 건수입니다.",
    state: metricState(summary.refundPendingCount, true),
  };

  const qRev: AdminQueueMetric = {
    label: "리뷰 관리",
    nText: fmt(summary.reviewTotalCount),
    href: "/admin/reviews",
    detail:
      summary.reviewTotalCount === null
        ? "목록을 불러올 수 없습니다."
        : summary.reviewTotalCount === 0
          ? "등록된 리뷰가 없거나 조회 결과가 0건입니다."
          : "전체 리뷰 건수입니다. 리뷰 관리 화면에서는 최근 50건만 표시됩니다.",
    state: metricState(summary.reviewTotalCount, true),
  };

  const amt = summary.settlementPendingAmount ?? 0;
  const qSet: AdminQueueMetric = {
    label: "정산 관리",
    nText:
      summary.settlementPendingCount === null
        ? "—"
        : `${summary.settlementPendingCount}건`,
    href: "/admin/settlements",
    detail:
      summary.settlementPendingAmount === null || summary.settlementPendingCount === null
        ? "목록을 불러올 수 없습니다."
        : `${wonLabel(amt)} 지급 대기(멘토 정산금)`,
    state:
      summary.settlementPendingCount === null && summary.settlementPendingAmount === null
        ? "skeleton"
        : summary.settlementPendingCount === 0
          ? "empty"
          : "connected",
  };

  const qAud: AdminQueueMetric = {
    label: "감사 로그",
    nText: fmt(summary.auditLogCount),
    href: "/admin/audit-logs",
    detail:
      summary.auditLogCount === null
        ? "목록을 불러올 수 없습니다."
        : summary.auditLogCount === 0
          ? "집계 대상 로그가 없거나 0건입니다."
          : "전용 로그 저장소 기준 건수입니다. 감사 로그 화면의 통합 목록과 다를 수 있습니다.",
    state: metricState(summary.auditLogCount, true),
  };

  const qNotices: AdminQueueMetric = {
    label: "공지·프로모션",
    nText: fmt(summary.noticesActiveCount),
    href: "/admin/notices",
    detail:
      summary.noticesActiveCount === null
        ? "목록을 불러올 수 없습니다."
        : summary.noticesActiveCount === 0
          ? "현재 활성화된 공지·프로모션이 없습니다(0건)."
          : "활성 공지·프로모션 합계입니다.",
    state: metricState(summary.noticesActiveCount, true),
  };

  return [qMentor, qRep, qDis, qRef, qRev, qSet, qAud, qNotices];
}

export async function loadAdminDashboardMetrics(
  supabase: SupabaseClient
): Promise<{ queueCards: AdminQueueMetric[]; scaffolds: AdminScaffold[]; globalError: string | null }> {
  const summary = await loadAdminDashboardSummary(supabase);
  const queueCards = summaryToQueueCards(summary);

  const hasErr = Object.keys(summary.errors).length > 0;
  const globalError = hasErr ? "일부 집계를 불러오지 못했습니다. 각 메뉴에서 상세를 확인해 주세요." : null;

  const scaffolds: AdminScaffold[] = [
    {
      title: "운영 상태",
      body: "주요 운영 메뉴와 최근 집계 상태를 확인할 수 있습니다.",
      status: hasErr ? "skeleton" : "connected",
    },
    {
      title: "권한 보호",
      body: "관리자 권한이 확인된 세션에서만 접근할 수 있습니다.",
      status: "connected",
    },
    {
      title: "다음 작업",
      body: "승인·신고·분쟁·환불 등 세부 처리는 각 관리 메뉴에서 진행합니다.",
      status: "connected",
    },
    {
      title: "운영 지표",
      body: "최근 운영 데이터를 기준으로 집계합니다.",
      status: "connected",
    },
    {
      title: "긴급 알림",
      body: "이 대시보드에서 푸시·외부 알림을 보내는 기능은 제공하지 않습니다.",
      status: "skeleton",
    },
  ];

  return { queueCards, scaffolds, globalError };
}

// —— sub-pages: list fetches (실데이터, 없으면 empty + error) —— //

export type AdminListResult = {
  table: string | null;
  sourceNote: string;
  rows: Row[];
  error: string | null;
  /** UI에서 '대상 유형' 등으로 쓰일 후보 컬럼명 */
  keyHints: { status?: string | null; targetType?: string | null; paymentRef?: string | null; disputeRef?: string | null };
};

export async function loadMentorApprovalsList(supabase: SupabaseClient, limit = 30): Promise<AdminListResult> {
  const db = mentorProfilesAdminReadClient(supabase);
  const { table, error: te } = await firstReadableAdminTable(db, ["mentor_profiles"]);
  if (!table) {
    return { table: null, sourceNote: "목록을 연결할 수 없습니다.", rows: [], error: te, keyHints: {} };
  }
  const statusCol = await pickExistingColumn(db, table, ["verification_status", "status", "approval_status", "review_state"]);
  const preferPending = ["pending", "submitted", "under_review", "awaiting", "PENDING"] as const;
  if (statusCol.column) {
    for (const v of preferPending) {
      const { data, error } = await db.from(table).select("*").eq(statusCol.column, v).limit(limit);
      if (!error && data?.length) {
        return {
          table,
          sourceNote: "승인 대기 상태를 우선 표시합니다.",
          rows: (data as Row[]) ?? [],
          error: null,
          keyHints: { status: statusCol.column, targetType: null, paymentRef: null },
        };
      }
    }
  }
  const { rows, error: oe } = await selectWithOrder<Row>(db, table, limit);
  return {
    table,
    sourceNote: "최근 생성된 항목부터 표시합니다.",
    rows: oe ? [] : rows,
    error: oe,
    keyHints: { status: statusCol.column, targetType: null, paymentRef: null },
  };
}

/** 멘토 승인 목록의 user_id에 대응하는 users 표시용(서비스 롤 등 읽기 클라이언트 권장). */
export async function fetchAdminUsersDisplayByIds(
  supabase: SupabaseClient,
  ids: string[]
): Promise<Map<string, { nickname: string | null; full_name: string | null; email: string | null }>> {
  const map = new Map<string, { nickname: string | null; full_name: string | null; email: string | null }>();
  const unique = [...new Set(ids.filter((x) => typeof x === "string" && x.length > 0))] as string[];
  const slice = unique.slice(0, 80);
  if (!slice.length) return map;
  const { data } = await supabase.from("users").select("id, nickname, full_name, email").in("id", slice);
  const rows = (data ?? []) as { id?: string; nickname?: string | null; full_name?: string | null; email?: string | null }[];
  for (const r of rows) {
    const id = r.id != null ? String(r.id) : "";
    if (id) map.set(id, { nickname: r.nickname ?? null, full_name: r.full_name ?? null, email: r.email ?? null });
  }
  return map;
}

const CONTENT_REPORTS_TABLE = "content_reports" as const;

export async function loadAdminReportsList(supabase: SupabaseClient, limit = 50): Promise<AdminListResult> {
  const crProbe = await supabase.from(CONTENT_REPORTS_TABLE).select("id").limit(1);
  if (!crProbe.error) {
    const { data, error } = await supabase
      .from(CONTENT_REPORTS_TABLE)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    const tt = await pickExistingColumn(supabase, CONTENT_REPORTS_TABLE, [
      "target_type",
      "subject_type",
      "resource_type",
      "content_type",
      "category",
    ]);
    const st = await pickExistingColumn(supabase, CONTENT_REPORTS_TABLE, ["status", "state", "report_status"]);
    return {
      table: CONTENT_REPORTS_TABLE,
      sourceNote: "",
      rows: error ? [] : ((data as Row[]) ?? []),
      error: error ? error.message : null,
      keyHints: { status: st.column ?? "status", targetType: tt.column ?? "target_type" },
    };
  }

  const { table, error: te } = await firstReadableAdminTable(supabase, ["reports", "abuse_reports"]);
  if (!table) {
    return { table: null, sourceNote: "목록을 연결할 수 없습니다.", rows: [], error: te, keyHints: {} };
  }
  const { rows, error } = await selectWithOrder<Row>(supabase, table, limit);
  const tt = await pickExistingColumn(supabase, table, ["target_type", "subject_type", "resource_type", "content_type", "category"]);
  const st = await pickExistingColumn(supabase, table, ["status", "state", "report_status"]);
  return { table, sourceNote: "최근 생성된 항목부터 표시합니다.", rows: error ? [] : rows, error, keyHints: { status: st.column, targetType: tt.column } };
}

export async function loadAdminRefundsList(supabase: SupabaseClient, limit = 30): Promise<AdminListResult> {
  const { table, error: te } = await firstReadableAdminTable(supabase, ["refunds"]);
  if (!table) {
    return { table: null, sourceNote: "목록을 연결할 수 없습니다.", rows: [], error: te, keyHints: {} };
  }
  const { rows, error } = await selectWithOrder<Row>(supabase, table, limit);
  const pay = await pickExistingColumn(supabase, table, ["payment_id", "order_id", "pg_payment_id", "stripe_payment_intent", "imp_uid", "mcht_trd_no"] as const);
  const st = await pickExistingColumn(supabase, table, ["status", "refund_status", "state"]);
  const dCol = await pickExistingColumn(supabase, table, ["dispute_id", "case_id"]);
  return {
    table,
    sourceNote: "최근 요청 기준으로 표시합니다.",
    rows: error ? [] : rows,
    error,
    keyHints: { status: st.column, paymentRef: pay.column, disputeRef: dCol.column },
  };
}

export type AdminListPagedResult = AdminListResult & { totalCount: number };

/**
 * PostgREST가 range 초과 시 'Requested range not satisfiable' (PGRST103) 에러를 던지며
 * count=null 을 돌려준다. 그 경우 별도 head-count 쿼리로 진짜 total을 보정한다.
 */
function isRangeNotSatisfiableError(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  const m = String(error.message ?? "").toLowerCase();
  const c = String(error.code ?? "");
  return c === "PGRST103" || /range not satisfiable|invalid range/i.test(m);
}

/** 페이지네이션 쿼리 공통 처리: range 초과 시 head-count로 진짜 total 보정.
 *  `.eq/.or` 가 가능한 PostgrestFilterBuilder 체인을 다루기 위해 타입은 ReturnType of `.select()` 사용.
 */
// .select() 이후 반환되는 PostgrestFilterBuilder — `.eq/.or/.range/.order` 모두 가능
type PgRestQueryBuilder = ReturnType<ReturnType<SupabaseClient["from"]>["select"]>;
async function runPagedListQuery(args: {
  client: SupabaseClient;
  table: string;
  applyFilters: (q: PgRestQueryBuilder) => PgRestQueryBuilder;
  from: number;
  to: number;
  orderColumn?: string;
  ascending?: boolean;
}): Promise<{ rows: Row[]; count: number; errorMsg: string | null }> {
  const orderColumn = args.orderColumn ?? "created_at";
  const ascending = args.ascending ?? false;
  let q: PgRestQueryBuilder = args.client.from(args.table).select("*", { count: "exact" });
  q = args.applyFilters(q);
  const r1 = await q.order(orderColumn, { ascending }).range(args.from, args.to);
  if (!r1.error) {
    return { rows: ((r1.data as Row[] | null) ?? []), count: r1.count ?? 0, errorMsg: null };
  }
  if (isRangeNotSatisfiableError(r1.error)) {
    let head: PgRestQueryBuilder = args.client.from(args.table).select("*", { count: "exact", head: true });
    head = args.applyFilters(head);
    const r2 = await head;
    return { rows: [], count: r2.count ?? 0, errorMsg: null };
  }
  return { rows: [], count: 0, errorMsg: r1.error.message ?? null };
}

/**
 * refunds 목록 검색·필터·페이지네이션 버전.
 * - 검색: refund id / user_id / payment_id / subscription_id / custom_request_order_id / admin_note / reason 부분일치
 * - 상태: pending / succeeded / rejected / canceled / all
 * - 페이지네이션: PostgREST `.range()` 사용
 * - 처리 로직(승인/거절 RPC) 무수정 — 목록 조회만.
 */
export async function loadAdminRefundsListPaged(
  supabase: SupabaseClient,
  args: {
    search: string;
    status: string;
    page: number;
    pageSize: number;
    requestType?: string;
    /** "deadline" 이면 요청일 오름차순(기한 임박순). 그 외 최신순. */
    sort?: string;
  }
): Promise<AdminListPagedResult> {
  const { table, error: te } = await firstReadableAdminTable(supabase, ["refunds"]);
  if (!table) {
    return {
      table: null,
      sourceNote: "목록을 연결할 수 없습니다.",
      rows: [],
      error: te,
      keyHints: {},
      totalCount: 0,
    };
  }

  const from = Math.max(0, (args.page - 1) * args.pageSize);
  const to = from + args.pageSize - 1;
  const applyFilters = (q: PgRestQueryBuilder): PgRestQueryBuilder => {
    let r = q;
    if (args.status && args.status !== "all") r = r.eq("status", args.status);
    if (args.requestType && args.requestType !== "all") r = r.eq("request_type", args.requestType);
    if (args.search) {
      const s = args.search.replace(/[%_,]/g, " ").trim();
      if (s) {
        const looksLikeUuid = /^[0-9a-fA-F-]+$/.test(s);
        const orParts: string[] = [];
        if (looksLikeUuid) {
          orParts.push(`id.ilike.${s}%`);
          orParts.push(`user_id.ilike.${s}%`);
          orParts.push(`payment_id.ilike.${s}%`);
          orParts.push(`subscription_id.ilike.${s}%`);
          orParts.push(`custom_request_order_id.ilike.${s}%`);
        }
        orParts.push(`admin_note.ilike.%${s}%`);
        orParts.push(`reason.ilike.%${s}%`);
        orParts.push(`request_type.ilike.%${s}%`);
        r = r.or(orParts.join(","));
      }
    }
    return r;
  };
  const paged = await runPagedListQuery({
    client: supabase,
    table,
    applyFilters,
    from,
    to,
    ascending: args.sort === "deadline",
  });

  const pay = await pickExistingColumn(supabase, table, [
    "payment_id",
    "order_id",
    "pg_payment_id",
    "stripe_payment_intent",
    "imp_uid",
    "mcht_trd_no",
  ] as const);
  const st = await pickExistingColumn(supabase, table, ["status", "refund_status", "state"]);
  const dCol = await pickExistingColumn(supabase, table, ["dispute_id", "case_id"]);

  return {
    table,
    sourceNote: "최근 요청 기준으로 표시합니다.",
    rows: paged.rows,
    error: paged.errorMsg,
    keyHints: { status: st.column, paymentRef: pay.column, disputeRef: dCol.column },
    totalCount: paged.count,
  };
}

/** 환불 상태별 카운트(탭 옆 표시용). 검색은 제외, 상태만. */
export async function countAdminRefundsByStatus(
  supabase: SupabaseClient
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const statuses = ["pending", "succeeded", "rejected", "canceled"];
  const { count: totalAll } = await supabase
    .from("refunds")
    .select("*", { count: "exact", head: true });
  out.all = totalAll ?? 0;
  for (const s of statuses) {
    const { count } = await supabase
      .from("refunds")
      .select("*", { count: "exact", head: true })
      .eq("status", s);
    out[s] = count ?? 0;
  }
  return out;
}

/** 환불 요청 유형별 카운트(유형 탭 표시용). status='pending' 만 — SLA 대상 강조. */
export async function countAdminRefundsByRequestType(
  supabase: SupabaseClient
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const types = [
    "subscription_prorated",
    "subscription_mentor_suspended",
    "iq",
    "order",
  ];
  const { count: allPending } = await supabase
    .from("refunds")
    .select("*", { count: "exact", head: true })
    .eq("status", "pending");
  out.all = allPending ?? 0;
  for (const t of types) {
    const { count } = await supabase
      .from("refunds")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending")
      .eq("request_type", t);
    out[t] = count ?? 0;
  }
  return out;
}

/** content_reports 페이지네이션 버전. */
export async function loadAdminReportsListPaged(
  supabase: SupabaseClient,
  args: { search: string; status: string; page: number; pageSize: number }
): Promise<AdminListPagedResult> {
  const TABLE = "content_reports";
  const { error: probe } = await supabase.from(TABLE).select("id").limit(1);
  if (probe) {
    return {
      table: null,
      sourceNote: "목록을 연결할 수 없습니다.",
      rows: [],
      error: probe.message,
      keyHints: {},
      totalCount: 0,
    };
  }

  const from = Math.max(0, (args.page - 1) * args.pageSize);
  const to = from + args.pageSize - 1;
  const applyFilters = (q: PgRestQueryBuilder): PgRestQueryBuilder => {
    let r = q;
    if (args.status && args.status !== "all") r = r.eq("status", args.status);
    if (args.search) {
      const s = args.search.replace(/[%_,]/g, " ").trim();
      if (s) {
        const looksLikeUuid = /^[0-9a-fA-F-]+$/.test(s);
        const orParts: string[] = [];
        if (looksLikeUuid) {
          orParts.push(`id.ilike.${s}%`);
          orParts.push(`target_id.ilike.${s}%`);
          orParts.push(`reporter_id.ilike.${s}%`);
          orParts.push(`resolved_by.ilike.${s}%`);
        }
        orParts.push(`reason.ilike.%${s}%`);
        orParts.push(`description.ilike.%${s}%`);
        orParts.push(`admin_note.ilike.%${s}%`);
        orParts.push(`target_type.ilike.%${s}%`);
        r = r.or(orParts.join(","));
      }
    }
    return r;
  };
  const paged = await runPagedListQuery({ client: supabase, table: TABLE, applyFilters, from, to });
  return {
    table: TABLE,
    sourceNote: "최근 신고 순.",
    rows: paged.rows,
    error: paged.errorMsg,
    keyHints: { status: "status", targetType: "target_type" },
    totalCount: paged.count,
  };
}

export async function countAdminReportsByStatus(
  supabase: SupabaseClient
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const statuses = ["pending", "reviewing", "resolved", "rejected", "dismissed", "hidden", "removed"];
  const { count: total } = await supabase
    .from("content_reports")
    .select("*", { count: "exact", head: true });
  out.all = total ?? 0;
  for (const s of statuses) {
    const { count } = await supabase
      .from("content_reports")
      .select("*", { count: "exact", head: true })
      .eq("status", s);
    out[s] = count ?? 0;
  }
  return out;
}

/** custom_request_orders 페이지네이션. */
export async function loadAdminCustomRequestOrdersListPaged(
  supabase: SupabaseClient,
  args: { search: string; status: string; page: number; pageSize: number }
): Promise<AdminListPagedResult> {
  const TABLE = "custom_request_orders";
  const from = Math.max(0, (args.page - 1) * args.pageSize);
  const to = from + args.pageSize - 1;
  const applyFilters = (q: PgRestQueryBuilder): PgRestQueryBuilder => {
    let r = q;
    if (args.status && args.status !== "all") r = r.eq("status", args.status);
    if (args.search) {
      const s = args.search.replace(/[%_,]/g, " ").trim();
      if (s) {
        const orParts: string[] = [
          `id.ilike.${s}%`,
          `post_id.ilike.${s}%`,
          `student_id.ilike.${s}%`,
          `mentor_id.ilike.${s}%`,
          `payment_status.ilike.%${s}%`,
          `status.ilike.%${s}%`,
        ];
        r = r.or(orParts.join(","));
      }
    }
    return r;
  };
  const paged = await runPagedListQuery({ client: supabase, table: TABLE, applyFilters, from, to });
  return {
    table: TABLE,
    sourceNote: "최근 주문 순.",
    rows: paged.rows,
    error: paged.errorMsg,
    keyHints: { status: "status" },
    totalCount: paged.count,
  };
}

export async function countAdminCustomRequestOrdersByStatus(
  supabase: SupabaseClient
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const statuses = [
    "pending",
    "open",
    "delivered",
    "revision_requested",
    "completed",
    "disputed",
    "cancelled",
    "refunded",
  ];
  const { count: total } = await supabase
    .from("custom_request_orders")
    .select("*", { count: "exact", head: true });
  out.all = total ?? 0;
  for (const s of statuses) {
    const { count } = await supabase
      .from("custom_request_orders")
      .select("*", { count: "exact", head: true })
      .eq("status", s);
    out[s] = count ?? 0;
  }
  return out;
}

/** disputes 페이지네이션. */
export async function loadAdminDisputesListPaged(
  supabase: SupabaseClient,
  args: { search: string; status: string; page: number; pageSize: number },
  opts?: { adminBypassClient?: SupabaseClient }
): Promise<AdminListPagedResult> {
  const TABLE = "disputes";
  // RLS 우회 — disputes 페이지는 service_role 클라이언트로 우선
  const client = opts?.adminBypassClient ?? supabase;
  const from = Math.max(0, (args.page - 1) * args.pageSize);
  const to = from + args.pageSize - 1;
  const applyFilters = (q: PgRestQueryBuilder): PgRestQueryBuilder => {
    let r = q;
    if (args.status && args.status !== "all") r = r.eq("status", args.status);
    if (args.search) {
      const s = args.search.replace(/[%_,]/g, " ").trim();
      if (s) {
        const orParts: string[] = [
          `id.ilike.${s}%`,
          `student_id.ilike.${s}%`,
          `mentor_id.ilike.${s}%`,
          `custom_request_order_id.ilike.${s}%`,
          `subscription_id.ilike.${s}%`,
          `body.ilike.%${s}%`,
          `admin_note.ilike.%${s}%`,
        ];
        r = r.or(orParts.join(","));
      }
    }
    return r;
  };
  const paged = await runPagedListQuery({ client, table: TABLE, applyFilters, from, to });
  return {
    table: TABLE,
    sourceNote: "최근 분쟁 순.",
    rows: paged.rows,
    error: paged.errorMsg,
    keyHints: { status: "status" },
    totalCount: paged.count,
  };
}

export async function countAdminDisputesByStatus(
  supabase: SupabaseClient,
  opts?: { adminBypassClient?: SupabaseClient }
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const client = opts?.adminBypassClient ?? supabase;
  const statuses = ["open", "under_review", "resolved", "dismissed", "escalated"];
  const { count: total } = await client.from("disputes").select("*", { count: "exact", head: true });
  out.all = total ?? 0;
  for (const s of statuses) {
    const { count } = await client
      .from("disputes")
      .select("*", { count: "exact", head: true })
      .eq("status", s);
    out[s] = count ?? 0;
  }
  return out;
}

/** mentor_profiles 페이지네이션 — 멘토 승인 화면. users join 검색을 위해 후처리(메모리). */
export async function loadAdminMentorApprovalsListPaged(
  supabase: SupabaseClient,
  args: { search: string; status: string; page: number; pageSize: number }
): Promise<AdminListPagedResult> {
  const db = mentorProfilesAdminReadClient(supabase);
  const TABLE = "mentor_profiles";
  const from = Math.max(0, (args.page - 1) * args.pageSize);
  const to = from + args.pageSize - 1;
  const applyFilters = (q: PgRestQueryBuilder): PgRestQueryBuilder => {
    let r = q;
    if (args.status && args.status !== "all") r = r.eq("verification_status", args.status);
    if (args.search) {
      const s = args.search.replace(/[%_,]/g, " ").trim();
      if (s) {
        const orParts: string[] = [
          `user_id.ilike.${s}%`,
          `university_name.ilike.%${s}%`,
          `department_name.ilike.%${s}%`,
          `high_school_name.ilike.%${s}%`,
          `intro_line.ilike.%${s}%`,
        ];
        r = r.or(orParts.join(","));
      }
    }
    return r;
  };
  const paged = await runPagedListQuery({ client: db, table: TABLE, applyFilters, from, to });
  return {
    table: TABLE,
    sourceNote: "최근 멘토 등록 순.",
    rows: paged.rows,
    error: paged.errorMsg,
    keyHints: { status: "verification_status" },
    totalCount: paged.count,
  };
}

export async function countAdminMentorApprovalsByStatus(
  supabase: SupabaseClient
): Promise<Record<string, number>> {
  const db = mentorProfilesAdminReadClient(supabase);
  const out: Record<string, number> = {};
  const statuses = ["pending", "submitted", "under_review", "approved", "rejected"];
  const { count: total } = await db.from("mentor_profiles").select("*", { count: "exact", head: true });
  out.all = total ?? 0;
  for (const s of statuses) {
    const { count } = await db
      .from("mentor_profiles")
      .select("*", { count: "exact", head: true })
      .eq("verification_status", s);
    out[s] = count ?? 0;
  }
  return out;
}

/** mentor_academic_record_change_requests 페이지네이션. */
export async function loadAdminAcademicRecordChangesListPaged(
  supabase: SupabaseClient,
  args: { search: string; status: string; page: number; pageSize: number }
): Promise<AdminListPagedResult> {
  const db = mentorProfilesAdminReadClient(supabase);
  const TABLE = "mentor_academic_record_change_requests";
  const from = Math.max(0, (args.page - 1) * args.pageSize);
  const to = from + args.pageSize - 1;
  const applyFilters = (q: PgRestQueryBuilder): PgRestQueryBuilder => {
    let r = q;
    if (args.status && args.status !== "all") r = r.eq("status", args.status);
    if (args.search) {
      const s = args.search.replace(/[%_,]/g, " ").trim();
      if (s) {
        const orParts: string[] = [
          `id.ilike.${s}%`,
          `mentor_id.ilike.${s}%`,
          `change_reason.ilike.%${s}%`,
          `requested_university_name.ilike.%${s}%`,
          `approved_university_name.ilike.%${s}%`,
          `reject_reason.ilike.%${s}%`,
        ];
        r = r.or(orParts.join(","));
      }
    }
    return r;
  };
  const paged = await runPagedListQuery({ client: db, table: TABLE, applyFilters, from, to });
  return {
    table: TABLE,
    sourceNote: "최근 학적변경 요청 순.",
    rows: paged.rows,
    error: paged.errorMsg,
    keyHints: { status: "status" },
    totalCount: paged.count,
  };
}

export async function countAdminAcademicRecordChangesByStatus(
  supabase: SupabaseClient
): Promise<Record<string, number>> {
  const db = mentorProfilesAdminReadClient(supabase);
  const out: Record<string, number> = {};
  const statuses = ["pending", "resubmit_required", "approved", "rejected"];
  const { count: total } = await db
    .from("mentor_academic_record_change_requests")
    .select("*", { count: "exact", head: true });
  out.all = total ?? 0;
  for (const s of statuses) {
    const { count } = await db
      .from("mentor_academic_record_change_requests")
      .select("*", { count: "exact", head: true })
      .eq("status", s);
    out[s] = count ?? 0;
  }
  return out;
}

export async function loadAdminReviewsList(supabase: SupabaseClient, limit = 50): Promise<AdminListResult> {
  const { table, error: te } = await firstReadableAdminTable(supabase, ["reviews", "mentor_reviews", "mentor_review"]);
  if (!table) {
    return { table: null, sourceNote: "목록을 연결할 수 없습니다.", rows: [], error: te, keyHints: {} };
  }
  const { rows, error } = await selectWithOrder<Row>(supabase, table, limit);
  const hidden = await pickExistingColumn(supabase, table, ["hidden", "is_hidden", "is_blind", "visible", "moderation_state"]);
  return { table, sourceNote: "최근 생성된 항목부터 표시합니다.", rows: error ? [] : rows, error, keyHints: { status: hidden.column } };
}

/** 리뷰 관리 조치용 컬럼 매핑(액션·표시 공통) */
export async function probeAdminReviewModerationPlan(
  supabase: SupabaseClient,
  table: string
): Promise<AdminReviewModerationPlan> {
  const hiddenPrefer = await pickExistingColumn(supabase, table, ["is_hidden", "hidden"]);
  const visiblePrefer = await pickExistingColumn(supabase, table, ["visible", "is_public", "is_visible"]);
  let hide: AdminReviewModerationPlan["hide"] = null;
  if (hiddenPrefer.column) {
    hide = { column: hiddenPrefer.column, mode: "boolean_true" };
  } else if (visiblePrefer.column) {
    hide = { column: visiblePrefer.column, mode: "boolean_false_for_visible" };
  }
  const blindPick = await pickExistingColumn(supabase, table, ["is_blinded", "is_blind"]);
  const blind = blindPick.column ? { column: blindPick.column } : null;
  const modState = await pickExistingColumn(supabase, table, ["moderation_state", "moderation_status", "review_status"]);
  const modAt = await pickExistingColumn(supabase, table, ["moderated_at", "reviewed_at", "admin_reviewed_at"]);
  let reviewDone: AdminReviewModerationPlan["reviewDone"] = null;
  if (modState.column) {
    reviewDone = { column: modState.column, kind: "enum", enumValue: "reviewed" };
  } else if (modAt.column) {
    reviewDone = { column: modAt.column, kind: "timestamp", enumValue: "" };
  }
  return { hide, blind, reviewDone };
}

/** 숨김·블라인드 외 운영 메타(moderation_state, moderated_at, moderated_by) 컬럼명 */
export type AdminReviewAuditColumnNames = {
  moderationState: string | null;
  moderatedAt: string | null;
  moderatedBy: string | null;
};

export async function probeAdminReviewAuditColumnNames(
  supabase: SupabaseClient,
  table: string
): Promise<AdminReviewAuditColumnNames> {
  const st = await pickExistingColumn(supabase, table, ["moderation_state", "moderation_status"]);
  const at = await pickExistingColumn(supabase, table, ["moderated_at"]);
  const by = await pickExistingColumn(supabase, table, ["moderated_by"]);
  return { moderationState: st.column, moderatedAt: at.column, moderatedBy: by.column };
}

export type AdminReviewsPageMeta = {
  table: string;
  authorColumn: string | null;
  ratingColumn: string | null;
  bodyColumn: string | null;
  mentorColumn: string | null;
  plan: AdminReviewModerationPlan;
};

export async function loadAdminReviewsPage(
  supabase: SupabaseClient,
  limit = 50
): Promise<{ list: AdminListResult; meta: AdminReviewsPageMeta | null }> {
  const list = await loadAdminReviewsList(supabase, limit);
  if (!list.table) {
    return { list, meta: null };
  }
  const table = list.table;
  const authorColumn = (await pickExistingColumn(supabase, table, ["author_id", "user_id", "reviewer_id", "student_id"])).column;
  const ratingColumn = (await pickExistingColumn(supabase, table, ["rating", "score", "stars"])).column;
  const bodyColumn = (await pickExistingColumn(supabase, table, ["body", "comment", "content", "text"])).column;
  const mentorColumn = (await pickExistingColumn(supabase, table, ["mentor_id", "mentor_user_id", "target_user_id", "to_user_id"])).column;
  const plan = await probeAdminReviewModerationPlan(supabase, table);
  return {
    list,
    meta: { table, authorColumn, ratingColumn, bodyColumn, mentorColumn, plan },
  };
}

const COSI_TABLE = "custom_order_settlement_items" as const;

/** 맞춤의뢰 정산 항목 상태 → 운영자 표기 */
export function adminSettlementStatusLabel(status: string): string {
  const s = status.trim().toLowerCase();
  const map: Record<string, string> = {
    pending: "지급 대기",
    on_hold: "보류",
    hold: "보류",
    payable: "지급 가능",
    paid: "지급 완료",
    cancelled: "취소",
    canceled: "취소",
  };
  return map[s] ?? `${status} (확인 필요)`;
}

function toMoneyInt(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v);
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n) : 0;
  }
  return 0;
}

export type AdminSettlementSummary = {
  totalRows: number;
  pendingMentorAmountSum: number;
  paidMentorAmountSum: number;
  pendingCount: number;
  onHoldCount: number;
  payableCount: number;
  paidCount: number;
  cancelledCount: number;
};

export type AdminSettlementListItem = {
  id: string;
  sourceType: "custom_request" | "subscription";
  customRequestOrderId: string;
  mentorId: string;
  payoutAccountDisplay: string;
  studentId: string | null;
  grossAmount: number;
  platformFeeAmount: number;
  mentorAmount: number;
  feeRate: number;
  status: string;
  reason: string | null;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** 주문 보조 조회 성공 시 툴팁용(한 줄) */
  orderMetaLine: string | null;
};

function emptySettlementSummary(): AdminSettlementSummary {
  return {
    totalRows: 0,
    pendingMentorAmountSum: 0,
    paidMentorAmountSum: 0,
    pendingCount: 0,
    onHoldCount: 0,
    payableCount: 0,
    paidCount: 0,
    cancelledCount: 0,
  };
}

function summarizeSettlementRows(rows: AdminSettlementListItem[]): AdminSettlementSummary {
  const s = emptySettlementSummary();
  s.totalRows = rows.length;
  for (const r of rows) {
    const st = r.status.trim().toLowerCase();
    const m = r.mentorAmount;
    if (st === "pending" || st === "on_hold" || st === "hold" || st === "payable") {
      s.pendingMentorAmountSum += m;
    }
    if (st === "paid") {
      s.paidMentorAmountSum += m;
    }
    if (st === "pending") s.pendingCount += 1;
    else if (st === "on_hold" || st === "hold") s.onHoldCount += 1;
    else if (st === "payable") s.payableCount += 1;
    else if (st === "paid") s.paidCount += 1;
    else if (st === "cancelled" || st === "canceled") s.cancelledCount += 1;
  }
  return s;
}

function parseCosItem(r: Row): AdminSettlementListItem | null {
  const id = r.id != null ? String(r.id) : "";
  if (!id) return null;
  const feeRaw = r.fee_rate;
  const feeNum = typeof feeRaw === "number" ? feeRaw : Number(feeRaw);
  return {
    id,
    sourceType: "custom_request",
    customRequestOrderId: String(r.custom_request_order_id ?? ""),
    mentorId: String(r.mentor_id ?? ""),
    payoutAccountDisplay: "미등록",
    studentId: r.student_id != null && String(r.student_id).length ? String(r.student_id) : null,
    grossAmount: toMoneyInt(r.gross_amount),
    platformFeeAmount: toMoneyInt(r.platform_fee_amount),
    mentorAmount: toMoneyInt(r.mentor_amount),
    feeRate: Number.isFinite(feeNum) ? feeNum : 0,
    status: String(r.status ?? "pending"),
    reason: r.reason != null && String(r.reason).length ? String(r.reason) : null,
    paidAt: r.paid_at != null ? String(r.paid_at) : null,
    createdAt: String(r.created_at ?? ""),
    updatedAt: String(r.updated_at ?? ""),
    orderMetaLine: null,
  };
}


function parseSubscriptionSettlementItem(r: Row): AdminSettlementListItem | null {
  const id = r.id != null ? String(r.id) : "";
  if (!id) return null;
  const billingEventId = String(r.billing_event_id ?? "");
  const feeRaw = r.fee_rate;
  const feeNum = typeof feeRaw === "number" ? feeRaw : Number(feeRaw);
  const periodStart = typeof r.period_start === "string" && r.period_start ? r.period_start.slice(0, 10) : "";
  const periodEnd = typeof r.period_end === "string" && r.period_end ? r.period_end.slice(0, 10) : "";
  const meta = [
    "\uAD6C\uB3C5 \uC815\uC0B0",
    r.event_type != null ? String(r.event_type) : "",
    periodStart || periodEnd ? `${periodStart || "?"}~${periodEnd || "?"}` : "",
  ].filter(Boolean).join(" · ");
  return {
    id,
    sourceType: "subscription",
    customRequestOrderId: billingEventId || String(r.subscription_id ?? ""),
    mentorId: String(r.mentor_id ?? ""),
    payoutAccountDisplay: "미등록",
    studentId: r.student_id != null && String(r.student_id).length ? String(r.student_id) : null,
    grossAmount: minorCentsToCash(r.gross_cents),
    platformFeeAmount: minorCentsToCash(r.platform_fee_cents),
    mentorAmount: minorCentsToCash(r.mentor_amount_cents),
    feeRate: Number.isFinite(feeNum) ? feeNum : 0.3,
    status: subscriptionSettlementStatus(r.status),
    reason: r.hold_reason != null && String(r.hold_reason).length ? String(r.hold_reason) : null,
    paidAt: r.paid_at != null ? String(r.paid_at) : null,
    createdAt: String(r.billing_at ?? r.created_at ?? ""),
    updatedAt: String(r.updated_at ?? r.created_at ?? r.billing_at ?? ""),
    orderMetaLine: meta || null,
  };
}
function maskAdminPayoutAccount(bank: unknown, account: unknown): string {
  const digits = String(account ?? "").replace(/\D/g, "");
  if (!digits) return "미등록";
  const bankName = String(bank ?? "은행").trim() || "은행";
  const tail = digits.length >= 4 ? digits.slice(-4) : digits;
  return `${bankName} ****${tail}`;
}

async function fetchMentorPayoutAccountDisplayMap(
  supabase: SupabaseClient,
  mentorIds: string[]
): Promise<Map<string, string>> {
  const unique = [...new Set(mentorIds.map((id) => id.trim()).filter(Boolean))];
  const out = new Map<string, string>();
  for (const id of unique) out.set(id, "미등록");
  if (!unique.length) return out;

  const db = mentorProfilesAdminReadClient(supabase);
  const bankCol = await pickExistingColumn(db, "mentor_profiles", ["payout_bank_name", "bank_name"]);
  const acctCol = await pickExistingColumn(db, "mentor_profiles", [
    "payout_account_number",
    "bank_account_number",
    "account_number",
  ]);
  if (!acctCol.column) return out;

  const cols = ["user_id", bankCol.column, acctCol.column].filter(Boolean).join(", ");
  for (const part of chunkIds(unique, 80)) {
    const { data, error } = await db.from("mentor_profiles").select(cols).in("user_id", part);
    if (error || !data) continue;
    for (const row of data as unknown as Row[]) {
      const mentorId = String(row.user_id ?? "");
      if (!mentorId) continue;
      out.set(mentorId, maskAdminPayoutAccount(bankCol.column ? row[bankCol.column] : null, row[acctCol.column]));
    }
  }
  return out;
}
function chunkIds(ids: string[], size: number): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

/** 주문 보조 정보(실패해도 정산 목록은 유지) */
async function fetchCustomRequestOrdersMap(supabase: SupabaseClient, orderIds: string[]): Promise<Map<string, Row>> {
  const map = new Map<string, Row>();
  const unique = [...new Set(orderIds.filter(Boolean))];
  if (!unique.length) return map;
  for (const part of chunkIds(unique, 80)) {
    const { data, error } = await supabase
      .from("custom_request_orders")
      .select("id, payment_status, status, state, order_status, agreed_price, proposed_price, price, amount, completed_at")
      .in("id", part);
    if (error || !data) continue;
    for (const row of data as unknown as Row[]) {
      const oid = String(row.id ?? "");
      if (oid) map.set(oid, row);
    }
  }
  return map;
}

function buildOrderMetaLine(o: Row): string | null {
  const parts: string[] = [];
  const ps = o.payment_status;
  if (ps != null && String(ps).trim()) parts.push(`결제: ${String(ps)}`);
  const st = [o.status, o.state, o.order_status]
    .map((x) => (x != null ? String(x).trim() : ""))
    .filter(Boolean);
  if (st.length) parts.push(`주문: ${st.join("/")}`);
  const price =
    o.agreed_price ?? o.proposed_price ?? o.price ?? o.amount;
  if (price != null && String(price).trim() !== "") {
    try {
      parts.push(`금액: ${new Intl.NumberFormat("ko-KR").format(toMoneyInt(price))}원`);
    } catch {
      parts.push("금액: —");
    }
  }
  if (o.completed_at != null && String(o.completed_at).trim()) {
    parts.push(`완료: ${String(o.completed_at).slice(0, 19)}`);
  }
  return parts.length ? parts.join(" · ") : null;
}

export async function loadAdminSettlementsList(
  supabase: SupabaseClient,
  limit = 50
): Promise<{
  rows: AdminSettlementListItem[];
  summary: AdminSettlementSummary;
  queryOk: boolean;
  byMentorHint: string;
}> {
  const byMentorHint = "멘토별 요약 보기는 제공하지 않습니다. 아래 목록에서 건별로 확인해 주세요.";

  const { data, error } = await supabase
    .from(COSI_TABLE)
    .select(
      "id, custom_request_order_id, mentor_id, student_id, gross_amount, platform_fee_amount, mentor_amount, fee_rate, status, reason, paid_at, created_at, updated_at"
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return { rows: [], summary: emptySettlementSummary(), queryOk: false, byMentorHint };
  }

  const rawRows = (data ?? []) as Row[];
  const items: AdminSettlementListItem[] = [];
  for (const r of rawRows) {
    const it = parseCosItem(r);
    if (it) items.push(it);
  }

  const subscriptionResult = await loadSubscriptionSettlementRowsForAdmin(limit);
  for (const r of subscriptionResult.rows) {
    const it = parseSubscriptionSettlementItem(r);
    if (it) items.push(it);
  }
  if (subscriptionResult.error) {
    console.error("[loadAdminSettlementsList] subscription settlements", subscriptionResult.error);
  }

  const customItems = items.filter((i) => i.sourceType === "custom_request");
  const [orderMap, payoutAccountMap] = await Promise.all([
    fetchCustomRequestOrdersMap(
      supabase,
      customItems.map((i) => i.customRequestOrderId)
    ),
    fetchMentorPayoutAccountDisplayMap(
      supabase,
      items.map((i) => i.mentorId)
    ),
  ]);
  for (const it of items) {
    it.payoutAccountDisplay = payoutAccountMap.get(it.mentorId) ?? "미등록";
    if (it.sourceType === "custom_request") {
      const o = orderMap.get(it.customRequestOrderId);
      if (o) it.orderMetaLine = buildOrderMetaLine(o);
    }
  }

  const rows = items
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, limit);

  return {
    rows,
    summary: summarizeSettlementRows(rows),
    queryOk: !subscriptionResult.error,
    byMentorHint,
  };
}
