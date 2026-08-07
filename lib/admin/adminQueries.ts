import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { toAdminDisplayError } from "@/lib/admin/adminDisplayError";
import { mentorProfilesAdminReadClient } from "@/lib/admin/mentorProfilesAdminRead";
import type { AdminReviewModerationPlan } from "@/lib/admin/reviewLabels";
import {
  loadSubscriptionSettlementRowsForAdmin,
  minorCentsToCash,
  subscriptionSettlementStatus,
} from "@/lib/mentor/subscriptionSettlementItems";

type Row = Record<string, unknown>;

function fmt(e: PostgrestError | null): string | null {
  return e ? e.message : null;
}

// W4(C10): firstReadableAdminTable(후보 테이블 순회 helper) 삭제 — 전 호출부(대시보드 감사
// 카운트·리뷰 조치/상세·환불 상세·분쟁 목록/상세) 정본 단일 조회로 전환 완료, 활성 호출자 0.

// W4(C10): selectWithOrder(order 컬럼 후보 재시도)·countEq·countQueuePending(컬럼·값 후보 프로빙 +
// 전체건수 대체 성공 처리) 삭제 — 각 호출부는 created_at 고정 정렬·고정 컬럼 count로 정본화(187 baseline 실측).

async function countAll(supabase: SupabaseClient, table: string): Promise<{ n: number | null; error: string | null }> {
  const { count, error } = await supabase.from(table).select("*", { count: "exact", head: true });
  if (error) return { n: null, error: error.message };
  return { n: count ?? 0, error: null };
}

// —— dashboard —— //

export type AdminQueueMetric = {
  label: string;
  nText: string;
  href: string;
  detail: string;
  state: "connected" | "empty" | "skeleton";
};

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

// W4(C10): 테이블 파라미터 제거 — refunds(status) 고정(187 baseline 실측).
async function dashboardRefundPendingCount(supabase: SupabaseClient): Promise<{ n: number | null; err?: string }> {
  const { count, error } = await supabase.from("refunds").select("*", { count: "exact", head: true }).eq("status", "pending");
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
  // W4(C10): 한쪽 소스만 실패해도 부분합을 성공으로 삼지 않는다 — 실패는 항상 err로 표면화.
  if (errs.length > 0) return { n: null, err: errs[0] };
  return { n: total };
}

/**
 * 관리자 대시보드용 집계(각 메뉴와 동일한 테이블·상태 기준을 최대한 맞춤).
 */
export async function loadAdminDashboardSummary(supabase: SupabaseClient): Promise<AdminDashboardSummary> {
  const errors: AdminDashboardSummaryErrors = {};

  // W4(C10): mentor_profiles.verification_status 고정 count — 후보 컬럼·값 프로빙(countQueuePending) 제거(187 baseline 실측).
  const mentorRead = mentorProfilesAdminReadClient(supabase);
  let mentorApprovalPendingCount: number | null = null;
  {
    const { count, error: mErr } = await mentorRead
      .from("mentor_profiles")
      .select("*", { count: "exact", head: true })
      .in("verification_status", ["pending", "submitted", "under_review"]);
    if (mErr) {
      errors.mentorApprovals = dashboardErrorMessage(mErr.message);
    } else {
      mentorApprovalPendingCount = count ?? 0;
    }
  }

  // W4(C10): content_reports.status 고정 — 존재 프로브·phantom 후보(reports/abuse_reports) 폴백 제거.
  let reportOpenCount: number | null = null;
  {
    const { count, error: crCountErr } = await supabase
      .from("content_reports")
      .select("*", { count: "exact", head: true })
      .in("status", ["pending", "reviewing"]);
    if (crCountErr) {
      errors.reports = dashboardErrorMessage(crCountErr.message);
    } else {
      reportOpenCount = count ?? 0;
    }
  }

  // W4(C10): disputes.status 고정 — phantom 후보(order/refund/user_disputes, support_tickets) 프로빙·근사치 폴백 제거.
  let disputeActiveCount: number | null = null;
  const disputeApproximate = false;
  {
    const { count, error: dErr } = await supabase
      .from("disputes")
      .select("*", { count: "exact", head: true })
      .in("status", ["open", "under_review", "escalated"]);
    if (dErr) {
      errors.disputes = dashboardErrorMessage(dErr.message);
    } else {
      disputeActiveCount = count ?? 0;
    }
  }

  // W4(C10): refunds 고정 — 단일 후보 존재 프로브 제거.
  let refundPendingCount: number | null = null;
  {
    const rp = await dashboardRefundPendingCount(supabase);
    if (rp.err) {
      errors.refunds = dashboardErrorMessage(rp.err);
    } else {
      refundPendingCount = rp.n;
    }
  }

  // W4(C10): reviews 고정 — phantom 후보(mentor_reviews/mentor_review) 프로빙 제거.
  let reviewTotalCount: number | null = null;
  {
    const t = await countAll(supabase, "reviews");
    if (t.n === null) {
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

  // W4(C10): 구 후보 순회([audit_logs, audit_events, verification_logs, admin_audit_logs])는
  // 앞 2개가 187 baseline 부재라 항상 verification_logs 로 결정론적으로 귀결됐다(실측).
  // 프로빙을 제거하고 현행 관측 지표(verification_logs 전체 건수)로 고정한다. 이 지표의 의미
  // 정본화(예: admin_action_logs 기반 감사 트레일 지표로 교체)는 오너 결정 사항 — W4 비범위.
  let auditLogCount: number | null = null;
  {
    const t = await countAll(supabase, "verification_logs");
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

// W4(C10): 미사용 export loadAdminDashboardMetrics(+summaryToQueueCards·AdminScaffold) 삭제 —
// 저장소 전체 호출부 0건 실측. 대시보드 정본 경로는 lib/admin/adminDashboardExtended.ts(loadAdminDashboardSummary 사용).

// —— sub-pages: list fetches (실데이터, 없으면 empty + error) —— //

export type AdminListResult = {
  table: string | null;
  sourceNote: string;
  rows: Row[];
  error: string | null;
  /** UI에서 '대상 유형' 등으로 쓰일 후보 컬럼명 */
  keyHints: { status?: string | null; targetType?: string | null; paymentRef?: string | null; disputeRef?: string | null };
};

// W4(C10): 미사용 export loadMentorApprovalsList 삭제 — 저장소 전체 호출부 0건 실측.
// 멘토 승인 목록의 정본 경로는 loadAdminMentorApprovalsListPaged(mentor_profiles.verification_status 고정).

/** 멘토 승인 목록의 user_id에 대응하는 users 표시용(서비스 롤 등 읽기 클라이언트 권장). */
export async function fetchAdminUsersDisplayByIds(
  supabase: SupabaseClient,
  ids: string[]
): Promise<Map<string, { nickname: string | null; full_name: string | null; email: string | null }>> {
  const map = new Map<string, { nickname: string | null; full_name: string | null; email: string | null }>();
  const unique = [...new Set(ids.filter((x) => typeof x === "string" && x.length > 0))] as string[];
  const slice = unique.slice(0, 80);
  if (!slice.length) return map;
  const { data, error } = await supabase.from("users").select("id, nickname, full_name, email").in("id", slice);
  if (error) {
    // W4(C10): 에러 무음 폐기 금지 — 표시 보조(이름 표기) 전용 경로라 빈 맵으로 열화하되(성공 아님) 반드시 로그를 남긴다.
    console.error("[fetchAdminUsersDisplayByIds] users 조회 실패:", error.message);
    return map;
  }
  const rows = (data ?? []) as { id?: string; nickname?: string | null; full_name?: string | null; email?: string | null }[];
  for (const r of rows) {
    const id = r.id != null ? String(r.id) : "";
    if (id) map.set(id, { nickname: r.nickname ?? null, full_name: r.full_name ?? null, email: r.email ?? null });
  }
  return map;
}

// W4(C10): 미사용 export loadAdminReportsList·loadAdminRefundsList 삭제 — 저장소 전체 호출부 0건 실측.
// 정본 경로는 loadAdminReportsListPaged(content_reports 고정)·loadAdminRefundsListPaged(refunds 고정).

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
  // W4(C10): refunds 고정 — 테이블 존재 프로브 제거(187 baseline 실측).
  const table = "refunds";
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

  // W4(C10): keyHints 고정 — refunds.status·payment_id 실존, dispute_id/case_id 부재(187 baseline 실측). 컬럼 프로빙 제거.
  return {
    table,
    sourceNote: "최근 요청 기준으로 표시합니다.",
    rows: paged.rows,
    error: paged.errorMsg,
    keyHints: { status: "status", paymentRef: "payment_id", disputeRef: null },
    totalCount: paged.count,
  };
}

/** W4(C10): head-count 에러 무음 폐기 금지 — 탭 배지 표시 전용 경로의 명시적 열화.
 *  실패 시 0을 표시하되(성공 처리 아님) 반드시 console.error 로 표면화한다. 빈 결과(0건)와 구분됨. */
function headCountOrLoggedZero(count: number | null, error: PostgrestError | null, ctx: string): number {
  if (error) {
    console.error(`[adminQueries] head-count 실패(${ctx}):`, error.message);
    return 0;
  }
  return count ?? 0;
}

/** 환불 상태별 카운트(탭 옆 표시용). 검색은 제외, 상태만. */
export async function countAdminRefundsByStatus(
  supabase: SupabaseClient
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const statuses = ["pending", "succeeded", "rejected", "canceled"];
  const all = await supabase
    .from("refunds")
    .select("*", { count: "exact", head: true });
  out.all = headCountOrLoggedZero(all.count, all.error, "refunds all");
  for (const s of statuses) {
    const r = await supabase
      .from("refunds")
      .select("*", { count: "exact", head: true })
      .eq("status", s);
    out[s] = headCountOrLoggedZero(r.count, r.error, `refunds.status=${s}`);
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
  const all = await supabase
    .from("refunds")
    .select("*", { count: "exact", head: true })
    .eq("status", "pending");
  out.all = headCountOrLoggedZero(all.count, all.error, "refunds pending all");
  for (const t of types) {
    const r = await supabase
      .from("refunds")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending")
      .eq("request_type", t);
    out[t] = headCountOrLoggedZero(r.count, r.error, `refunds.request_type=${t}`);
  }
  return out;
}

/** content_reports 페이지네이션 버전. */
export async function loadAdminReportsListPaged(
  supabase: SupabaseClient,
  args: { search: string; status: string; page: number; pageSize: number }
): Promise<AdminListPagedResult> {
  // W4(C10): content_reports 고정 — 사전 존재 프로브 제거(실 쿼리 에러는 아래 error 로 그대로 표면화).
  const TABLE = "content_reports";
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
  const all = await supabase
    .from("content_reports")
    .select("*", { count: "exact", head: true });
  out.all = headCountOrLoggedZero(all.count, all.error, "content_reports all");
  for (const s of statuses) {
    const r = await supabase
      .from("content_reports")
      .select("*", { count: "exact", head: true })
      .eq("status", s);
    out[s] = headCountOrLoggedZero(r.count, r.error, `content_reports.status=${s}`);
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
  const all = await supabase
    .from("custom_request_orders")
    .select("*", { count: "exact", head: true });
  out.all = headCountOrLoggedZero(all.count, all.error, "custom_request_orders all");
  for (const s of statuses) {
    const r = await supabase
      .from("custom_request_orders")
      .select("*", { count: "exact", head: true })
      .eq("status", s);
    out[s] = headCountOrLoggedZero(r.count, r.error, `custom_request_orders.status=${s}`);
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
  const all = await client.from("disputes").select("*", { count: "exact", head: true });
  out.all = headCountOrLoggedZero(all.count, all.error, "disputes all");
  for (const s of statuses) {
    const r = await client
      .from("disputes")
      .select("*", { count: "exact", head: true })
      .eq("status", s);
    out[s] = headCountOrLoggedZero(r.count, r.error, `disputes.status=${s}`);
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
  const all = await db.from("mentor_profiles").select("*", { count: "exact", head: true });
  out.all = headCountOrLoggedZero(all.count, all.error, "mentor_profiles all");
  for (const s of statuses) {
    const r = await db
      .from("mentor_profiles")
      .select("*", { count: "exact", head: true })
      .eq("verification_status", s);
    out[s] = headCountOrLoggedZero(r.count, r.error, `mentor_profiles.verification_status=${s}`);
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
  const all = await db
    .from("mentor_academic_record_change_requests")
    .select("*", { count: "exact", head: true });
  out.all = headCountOrLoggedZero(all.count, all.error, "mentor_academic_record_change_requests all");
  for (const s of statuses) {
    const r = await db
      .from("mentor_academic_record_change_requests")
      .select("*", { count: "exact", head: true })
      .eq("status", s);
    out[s] = headCountOrLoggedZero(r.count, r.error, `mentor_academic_record_change_requests.status=${s}`);
  }
  return out;
}

export async function loadAdminReviewsList(supabase: SupabaseClient, limit = 50): Promise<AdminListResult> {
  // W4(C10): reviews 고정(mentor_reviews/mentor_review 는 phantom) + created_at desc 고정 정렬 —
  // 테이블·정렬 컬럼 프로빙 제거(187 baseline 실측). 에러는 rows 빈 채로 error 에 그대로 표면화.
  const table = "reviews";
  const { data, error } = await supabase.from(table).select("*").order("created_at", { ascending: false }).limit(limit);
  return {
    table,
    sourceNote: "최근 생성된 항목부터 표시합니다.",
    rows: error ? [] : (((data as Row[] | null) ?? [])),
    error: fmt(error),
    keyHints: { status: "is_hidden" },
  };
}

/** 리뷰 관리 조치용 컬럼 매핑(액션·표시 공통)
 *  W4(C10): reviews.is_hidden·is_blinded·moderation_state 실존(187 baseline 실측) — 후보 컬럼 프로빙을
 *  상수 플랜으로 정본화. 외부 호출부(adminReviewActions) 시그니처 유지를 위해 async export 형태는 유지. */
export async function probeAdminReviewModerationPlan(
  _supabase: SupabaseClient,
  _table: string
): Promise<AdminReviewModerationPlan> {
  return {
    hide: { column: "is_hidden", mode: "boolean_true" },
    blind: { column: "is_blinded" },
    reviewDone: { column: "moderation_state", kind: "enum", enumValue: "reviewed" },
  };
}

/** 숨김·블라인드 외 운영 메타(moderation_state, moderated_at, moderated_by) 컬럼명 */
export type AdminReviewAuditColumnNames = {
  moderationState: string | null;
  moderatedAt: string | null;
  moderatedBy: string | null;
};

// W4(C10): reviews.moderation_state·moderated_at·moderated_by 실존(187 baseline 실측) — 상수로 정본화.
export async function probeAdminReviewAuditColumnNames(
  _supabase: SupabaseClient,
  _table: string
): Promise<AdminReviewAuditColumnNames> {
  return { moderationState: "moderation_state", moderatedAt: "moderated_at", moderatedBy: "moderated_by" };
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
  // W4(C10): reviews.author_id·rating·body·mentor_id 고정(123_reviews_converge 가 legacy 후보 컬럼 제거) — 컬럼 프로빙 삭제.
  const plan = await probeAdminReviewModerationPlan(supabase, table);
  return {
    list,
    meta: { table, authorColumn: "author_id", ratingColumn: "rating", bodyColumn: "body", mentorColumn: "mentor_id", plan },
  };
}

const COSI_TABLE = "custom_order_settlement_items" as const;

/** 맞춤의뢰 정산 항목 상태 → 운영자 표기 */
export function adminSettlementStatusLabel(status: string): string {
  const s = status.trim().toLowerCase();
  const map: Record<string, string> = {
    // 구독 정산 항목은 사이클이 끝나기 전까지 accruing(지급 불가)이다. 목록에 정상적으로
    // 섞여 들어오므로, 없으면 fallback 이 "accruing (확인 필요)"를 찍어 운영자가
    // 정상 행을 이상 징후로 오인한다(QA-A2).
    accruing: "적립중",
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
  /** 적립중(지급 불가) 멘토 정산금 합계 — pendingMentorAmountSum 과 겹치지 않는다. */
  accruingMentorAmountSum: number;
  pendingCount: number;
  accruingCount: number;
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
    accruingMentorAmountSum: 0,
    pendingCount: 0,
    accruingCount: 0,
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
    if (st === "accruing") {
      s.accruingMentorAmountSum += m;
    }
    if (st === "accruing") s.accruingCount += 1;
    else if (st === "pending") s.pendingCount += 1;
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

  // W4(C10): mentor_profiles.payout_bank_name·payout_account_number 고정(041 SQL, 187 baseline 실측) — 컬럼 프로빙 제거.
  const db = mentorProfilesAdminReadClient(supabase);
  for (const part of chunkIds(unique, 80)) {
    const { data, error } = await db
      .from("mentor_profiles")
      .select("user_id, payout_bank_name, payout_account_number")
      .in("user_id", part);
    if (error) {
      // W4(C10): 표시 보조(마스킹 계좌 표기) 전용 열화 — '미등록' 기본값 유지하되 실패는 반드시 로그로 표면화(성공 아님).
      console.error("[fetchMentorPayoutAccountDisplayMap] mentor_profiles 조회 실패:", error.message);
      continue;
    }
    for (const row of (data ?? []) as unknown as Row[]) {
      const mentorId = String(row.user_id ?? "");
      if (!mentorId) continue;
      out.set(mentorId, maskAdminPayoutAccount(row.payout_bank_name, row.payout_account_number));
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
    if (error) {
      // W4(C10): 표시 보조(주문 툴팁 한 줄) 전용 열화 — 정산 목록은 유지하되 실패는 반드시 로그로 표면화(성공 아님).
      console.error("[fetchCustomRequestOrdersMap] custom_request_orders 조회 실패:", error.message);
      continue;
    }
    for (const row of (data ?? []) as unknown as Row[]) {
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
