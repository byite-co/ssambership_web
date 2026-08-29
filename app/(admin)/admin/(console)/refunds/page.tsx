import Link from "next/link";
import { PageScaffold } from "@/components/shell/PageScaffold";
import { AdminStatusBadge } from "@/components/admin/AdminStatusBadge";
import { AdminListToolbar } from "@/components/admin/AdminListToolbar";
import { AdminListPagination } from "@/components/admin/AdminListPagination";
import { createClient } from "@/lib/supabase/server";
import {
  countAdminRefundsByStatus,
  countAdminRefundsByRequestType,
  loadAdminDashboardSummary,
  loadAdminRefundsListPaged,
} from "@/lib/admin/adminQueries";
import { refundSlaInfo, REFUND_SLA_DAYS } from "@/lib/admin/refundSla";
import { approveAdminRefundAction, rejectAdminRefundAction } from "@/lib/admin/refundActions";
import { bulkProcessRefundsAction } from "@/lib/admin/bulkActions";
import { toAdminDisplayError } from "@/lib/admin/adminDisplayError";
import { parseAdminListParams } from "@/lib/admin/adminListParams";
import { formatKoDateTimeKst } from "@/lib/utils/kstTime";

type Row = Record<string, unknown>;

const ID_PREVIEW_LEN = 10;

function cell(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") {
    if (Array.isArray(v)) return v.length ? `${v.length}개 항목` : "—";
    return "[상세]";
  }
  return String(v);
}

/** UUID 등 긴 문자열: 화면은 짧게, 전체는 title */
function previewId(raw: unknown, maxLen = ID_PREVIEW_LEN): { display: string; title: string | undefined } {
  const s = raw == null ? "" : String(raw).trim();
  if (!s) return { display: "—", title: undefined };
  if (s.length <= maxLen) return { display: s, title: s };
  return { display: `${s.slice(0, maxLen)}…`, title: s };
}

function pickFirst(row: Row, keys: readonly string[]): unknown {
  for (const k of keys) {
    if (k in row) return row[k];
  }
  return undefined;
}

function pickStatus(row: Row): string {
  const v = pickFirst(row, ["status", "refund_status", "state"]);
  return typeof v === "string" ? v.trim().toLowerCase() : "";
}

function refundStatusLabel(s: string): string {
  switch (s) {
    case "pending":
      return "대기";
    case "succeeded":
      return "승인 완료";
    case "rejected":
      return "거절";
    case "canceled":
    case "cancelled":
      return "취소";
    default:
      if (!s) return "—";
      return `${s} (확인 필요)`;
  }
}

const statusBadgeClass = (s: string) => {
  switch (s) {
    case "pending":
      return "bg-amber-50 text-amber-700 border-amber-100";
    case "succeeded":
      return "bg-emerald-50 text-emerald-700 border-emerald-100";
    case "rejected":
      return "bg-red-50 text-red-700 border-red-100";
    default:
      return "bg-slate-50 text-slate-600 border-slate-100";
  }
};

function isPendingRefund(row: Row): boolean {
  return pickStatus(row) === "pending";
}

function firstString(row: Row, keys: readonly string[]): string | null {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

function formatWonAmount(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number" && Number.isFinite(v)) {
    return `${new Intl.NumberFormat("ko-KR").format(Math.round(v))}원`;
  }
  const s = String(v).replace(/,/g, "").trim();
  const n = Number(s);
  if (!Number.isFinite(n)) return "—";
  return `${new Intl.NumberFormat("ko-KR").format(Math.round(n))}원`;
}

function formatRequestedAt(v: unknown): string {
  const s = cell(v);
  if (s === "—") return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return formatKoDateTimeKst(s);
}

type PageProps = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

export default async function AdminRefundsPage(props: PageProps) {
  const sp = (await props.searchParams) ?? {};
  const r = sp.refundId;
  const focusRefundId =
    typeof r === "string" && r
      ? r
      : Array.isArray(r) && r[0] && typeof r[0] === "string"
        ? r[0]
        : null;

  const okParam = sp.ok;
  const errParam = sp.error;
  const flashOk = typeof okParam === "string" ? okParam : Array.isArray(okParam) ? okParam[0] : null;
  const flashErr = typeof errParam === "string" ? errParam : Array.isArray(errParam) ? errParam[0] : null;

  const supabase = await createClient();
  const params = parseAdminListParams(sp, { defaultPageSize: 25, defaultStatus: "pending" });
  const requestType = typeof sp.type === "string" ? sp.type : "all";
  const sort = typeof sp.sort === "string" ? sp.sort : "recent";
  const [list, summary, byStatus, byType] = await Promise.all([
    loadAdminRefundsListPaged(supabase, { ...params, requestType, sort }),
    loadAdminDashboardSummary(supabase),
    countAdminRefundsByStatus(supabase),
    countAdminRefundsByRequestType(supabase),
  ]);
  const now = new Date();

  // type/sort 를 보존하는 URL 빌더(상태·검색·페이지 유지)
  const refundFilterUrl = (overrides: { type?: string; sort?: string }) => {
    const usp = new URLSearchParams();
    if (params.search) usp.set("q", params.search);
    if (params.status && params.status !== "all") usp.set("status", params.status);
    const t = overrides.type ?? requestType;
    const s = overrides.sort ?? sort;
    if (t && t !== "all") usp.set("type", t);
    if (s && s !== "recent") usp.set("sort", s);
    const qs = usp.toString();
    return qs ? `/admin/refunds?${qs}` : "/admin/refunds";
  };

  const typeTabs = [
    { value: "all", label: "전체(대기)", count: byType.all ?? 0 },
    { value: "subscription_prorated", label: "구독 잔여(학생)", count: byType.subscription_prorated ?? 0 },
    { value: "subscription_mentor_suspended", label: "멘토중단 ⏱5일", count: byType.subscription_mentor_suspended ?? 0 },
  ];
  const rows = (list.rows as Row[]) ?? [];
  const REFUND_BASE_PATH = "/admin/refunds";
  const statusTabs = [
    { value: "pending", label: "대기", count: byStatus.pending ?? 0 },
    { value: "succeeded", label: "승인", count: byStatus.succeeded ?? 0 },
    { value: "rejected", label: "거절", count: byStatus.rejected ?? 0 },
    { value: "canceled", label: "취소", count: byStatus.canceled ?? 0 },
    { value: "all", label: "전체", count: byStatus.all ?? 0 },
  ];

  return (
    <PageScaffold
      eyebrow="관리자 / 환불"
      title="환불 관리"
      description="환불 요청을 검토하고 승인 또는 거절할 수 있습니다. 실제 PG·계좌 환불 반영은 결제 연동 상태에 따라 별도 확인이 필요할 수 있습니다."
      ctas={[
        { href: "/admin/disputes", label: "분쟁 관리", tone: "blue" },
        { href: "/admin/settlements", label: "정산 관리", tone: "slate" },
        { href: "/admin/audit-logs", label: "감사 로그", tone: "slate" },
        { href: "/admin", label: "대시보드", tone: "slate" },
      ]}
      sections={[
        {
          title: "처리 방식",
          body: "승인·거절은 이 화면에서 기록합니다. 정산·주문 상태와 맞는지 필요 시 정산·분쟁 메뉴에서 함께 확인해 주세요.",
          status: "connected",
        },
      ]}
      emptyState=""
      dataPoints={[]}
      hideFooterPlaceholderCards
    >
      <div className="max-w-6xl mx-auto space-y-6 pb-12">
        {flashOk ? (
          <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-900 animate-pulse">
            {flashOk}
          </p>
        ) : null}
        {flashErr ? (
          <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-900">
            {toAdminDisplayError(flashErr, "default") ?? "처리에 실패했습니다. 잠시 후 다시 시도해 주세요."}
          </p>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-bold uppercase text-slate-500">환불 대기</p>
            <p className="mt-2 text-2xl font-black text-slate-900">{summary.refundPendingCount ?? "—"}건</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-bold uppercase text-slate-500">정산 예정 건수</p>
            <p className="mt-2 text-2xl font-black text-slate-900">{summary.settlementPendingCount ?? "—"}건</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-bold uppercase text-slate-500">정산 예정 금액</p>
            <p className="mt-2 text-2xl font-black text-[#2563EB]">
              {summary.settlementPendingAmount != null
                ? `${new Intl.NumberFormat("ko-KR").format(summary.settlementPendingAmount)}원`
                : "—"}
            </p>
          </div>
        </div>

        {focusRefundId ? (
          <p className="rounded-xl border border-blue-200 bg-blue-50/50 p-4 text-sm text-blue-900 font-medium">
            연결된 환불 ID <code className="font-mono bg-white px-1.5 py-0.5 rounded border border-blue-200 text-blue-900">{focusRefundId}</code>와 아래 목록의 환불 ID가 같은지 확인해 주세요.
          </p>
        ) : null}

        <AdminListToolbar
          basePath={REFUND_BASE_PATH}
          params={params}
          searchPlaceholder="환불/사용자/결제/구독 ID, 사유, 메모로 검색"
          statusTabs={statusTabs}
        />

        {/* 요청 유형 필터 + 기한 임박순 정렬 (SLA) */}
        <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <nav className="flex flex-wrap gap-1.5" aria-label="요청 유형">
              {typeTabs.map((tab) => {
                const isActive = requestType === tab.value;
                return (
                  <Link
                    key={tab.value}
                    href={refundFilterUrl({ type: tab.value })}
                    className={[
                      "rounded-xl border px-3 py-1.5 text-xs font-extrabold transition",
                      isActive
                        ? "border-blue-600 bg-blue-600 text-white"
                        : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                    ].join(" ")}
                  >
                    {tab.label}
                    <span className={["ml-1.5 text-[10px]", isActive ? "text-blue-100" : "text-slate-500"].join(" ")}>
                      {tab.count}
                    </span>
                  </Link>
                );
              })}
            </nav>
            <Link
              href={refundFilterUrl({ sort: sort === "deadline" ? "recent" : "deadline" })}
              className={[
                "rounded-xl border px-3 py-1.5 text-xs font-extrabold transition",
                sort === "deadline"
                  ? "border-amber-500 bg-amber-500 text-white"
                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
              ].join(" ")}
            >
              {sort === "deadline" ? "✓ 기한 임박순" : "기한 임박순 정렬"}
            </Link>
          </div>
          <p className="text-[11px] font-medium text-slate-400">
            멘토 중단 환불은 요청일로부터 {REFUND_SLA_DAYS}일 이내 처리가 목표입니다. 남은 일수는 아래 표
            &lsquo;SLA&rsquo; 열에서 확인하세요.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-bold text-slate-800">환불 요청 목록</h2>
            <AdminStatusBadge result={list} hint={`현재 ${list.totalCount.toLocaleString("ko-KR")}건 매칭`} />
          </div>
          <p className="text-xs font-medium text-slate-400">환불 요청의 결제 정보와 처리 상태를 확인할 수 있습니다.</p>
        </div>

        {list.error && !rows.length ? (
          <div className="rounded-2xl border border-red-200 bg-red-50/60 p-5 text-sm text-red-950">
            <p className="font-bold">목록을 불러오지 못했습니다.</p>
            <p className="mt-1 text-xs text-red-900/90">
              {toAdminDisplayError(list.error, "default") ?? "잠시 후 다시 시도하거나 담당자에게 문의해 주세요."}
            </p>
          </div>
        ) : null}

        {!list.table ? (
          <p className="rounded-2xl border border-slate-200 bg-slate-50/60 p-6 text-sm text-slate-500 text-center font-semibold">
            환불 목록을 불러올 수 없습니다. 연결과 권한을 확인해 주세요.
          </p>
        ) : !rows.length ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/40 p-8 text-center text-sm text-slate-500">
            <p className="font-bold text-slate-700">현재 대기 중인 환불 요청이 없습니다.</p>
            <p className="mt-1 text-xs text-slate-500">환불 요청이 생성되면 이곳에서 승인 또는 거절할 수 있습니다.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 bg-slate-50/60 px-5 py-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-xs font-bold text-slate-700 uppercase tracking-wider">환불 데이터</h2>
              {/* P1 ③ 일괄 처리 — 체크박스는 form 속성으로 이 폼에 연결 */}
              <form id="refundBulkForm" className="flex items-center gap-2">
                <span className="text-[11px] font-bold text-slate-500">선택 항목 일괄</span>
                <button
                  type="submit"
                  name="bulkDecision"
                  value="approve"
                  formAction={bulkProcessRefundsAction}
                  className="rounded-lg bg-blue-600 px-3 py-1 text-xs font-bold text-white hover:bg-blue-500"
                >
                  일괄 승인
                </button>
                <button
                  type="submit"
                  name="bulkDecision"
                  value="reject"
                  formAction={bulkProcessRefundsAction}
                  className="rounded-lg bg-red-600 px-3 py-1 text-xs font-bold text-white hover:bg-red-500"
                >
                  일괄 거절
                </button>
                <span className="text-xs bg-blue-50 text-blue-600 font-semibold px-2.5 py-1 rounded">{rows.length}건</span>
              </form>
            </div>
            <table className="w-full min-w-[1120px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/40">
                  <th className="px-3 py-3 text-xs font-bold text-slate-600">선택</th>
                  <th className="px-5 py-3 text-xs font-bold text-slate-600">환불 ID</th>
                  <th className="px-5 py-3 text-xs font-bold text-slate-600">사용자</th>
                  <th className="px-5 py-3 text-xs font-bold text-slate-600">환불 금액</th>
                  <th className="px-5 py-3 text-xs font-bold text-slate-600">상태</th>
                  <th className="px-5 py-3 text-xs font-bold text-slate-600">SLA</th>
                  <th className="px-5 py-3 text-xs font-bold text-slate-600">사유</th>
                  <th className="px-5 py-3 text-xs font-bold text-slate-600">결제 ID</th>
                  <th className="px-5 py-3 text-xs font-bold text-slate-600">맞춤의뢰 ID</th>
                  <th className="px-5 py-3 text-xs font-bold text-slate-600">요청일</th>
                  <th className="px-5 py-3 text-xs font-bold text-slate-600">처리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row, i) => {
                  const refundIdValue =
                    typeof row.id === "string" ? row.id : row.id != null ? String(row.id) : "";
                  const rowKey = refundIdValue || `row-${i}`;
                  const disputeHref = firstString(row, ["dispute_id", "case_id"]);
                  const pending = isPendingRefund(row);
                  const st = pickStatus(row);
                  const idPv = previewId(row.id);
                  const userPv = previewId(pickFirst(row, ["user_id"]));
                  const payPv = previewId(pickFirst(row, ["payment_id"]));
                  const orderPv = previewId(pickFirst(row, ["custom_request_order_id"]));
                  return (
                    <tr key={rowKey} className="hover:bg-slate-50/30 transition-colors">
                      <td className="px-3 py-4">
                        {pending && refundIdValue ? (
                          <input
                            type="checkbox"
                            name="ids"
                            value={refundIdValue}
                            form="refundBulkForm"
                            aria-label="환불 선택"
                            className="h-4 w-4 rounded border-slate-300"
                          />
                        ) : null}
                      </td>
                      <td className="max-w-[120px] truncate px-5 py-4 font-mono text-xs font-medium text-slate-800" title={idPv.title}>
                        {idPv.display}
                      </td>
                      <td className="max-w-[120px] truncate px-5 py-4 font-mono text-xs font-medium text-slate-600" title={userPv.title}>
                        {userPv.display}
                      </td>
                      <td className="px-5 py-4 text-xs font-black text-slate-900 tabular-nums">
                        {formatWonAmount(pickFirst(row, ["amount_cents", "amount"]))}
                      </td>
                      <td className="px-5 py-4 whitespace-nowrap">
                        <span className={`inline-block border rounded-lg px-2.5 py-1 text-xs font-bold ${statusBadgeClass(st)}`}>
                          {refundStatusLabel(st)}
                        </span>
                      </td>
                      <td className="px-5 py-4 whitespace-nowrap">
                        {(() => {
                          const sla = refundSlaInfo(
                            cell(pickFirst(row, ["created_at"])) === "—" ? null : String(pickFirst(row, ["created_at"])),
                            st,
                            now
                          );
                          const isMentor = firstString(row, ["request_type"]) === "subscription_mentor_suspended";
                          if (sla.daysRemaining === null) {
                            return <span className="text-xs text-slate-400">{sla.label}</span>;
                          }
                          const cls =
                            sla.tone === "over"
                              ? "bg-red-50 text-red-700 border-red-200"
                              : sla.tone === "soon"
                                ? "bg-amber-50 text-amber-700 border-amber-200"
                                : "bg-slate-50 text-slate-600 border-slate-200";
                          return (
                            <span
                              className={`inline-block rounded-lg border px-2.5 py-1 text-xs font-bold ${cls}`}
                              title={isMentor ? "멘토 중단 환불 — 5일 SLA" : "처리 경과(5일 기준)"}
                            >
                              {sla.label}
                              {isMentor ? " ⏱" : ""}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="max-w-[240px] px-5 py-4 text-xs text-slate-700">
                        {(() => {
                          const reason = firstString(row, ["reason"]);
                          const reqType = firstString(row, ["request_type"]);
                          const adminNote = firstString(row, ["admin_note"]);
                          if (!reason && !reqType && !adminNote) return <span className="text-slate-400">—</span>;
                          return (
                            <div className="space-y-0.5 leading-snug">
                              {reqType ? (
                                <p className="text-[11px] font-extrabold uppercase text-blue-700">{reqType}</p>
                              ) : null}
                              {reason ? (
                                <p className="break-words text-slate-800" title={reason}>
                                  {reason}
                                </p>
                              ) : null}
                              {adminNote ? (
                                <p className="text-[11px] font-semibold text-slate-500" title={adminNote}>
                                  메모: {adminNote}
                                </p>
                              ) : null}
                            </div>
                          );
                        })()}
                      </td>
                      <td className="max-w-[120px] truncate px-5 py-4 font-mono text-xs font-medium text-slate-600" title={payPv.title}>
                        {payPv.display}
                      </td>
                      <td className="max-w-[120px] truncate px-5 py-4 font-mono text-xs font-medium text-slate-600" title={orderPv.title}>
                        {orderPv.display}
                      </td>
                      <td className="whitespace-nowrap px-5 py-4 text-xs font-medium text-slate-500 leading-relaxed">
                        {formatRequestedAt(pickFirst(row, ["created_at"]))}
                      </td>
                      <td className="px-5 py-4 align-top">
                        {pending && refundIdValue ? (
                          <form className="flex min-w-[280px] flex-col gap-2">
                            <input type="hidden" name="refundId" value={refundIdValue} />
                            <input
                              type="text"
                              name="adminNote"
                              placeholder="메모(선택)"
                              className="w-full rounded-xl border border-slate-200 px-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 transition-all"
                              autoComplete="off"
                            />
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="submit"
                                formAction={approveAdminRefundAction}
                                className="flex-1 rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-blue-500 transition-colors shadow-sm whitespace-nowrap"
                              >
                                환불 승인
                              </button>
                              <button
                                type="submit"
                                formAction={rejectAdminRefundAction}
                                className="flex-1 rounded-xl bg-red-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-red-500 transition-colors shadow-sm whitespace-nowrap"
                              >
                                환불 거절
                              </button>
                            </div>
                          </form>
                        ) : (
                          <span className="text-xs font-medium text-slate-400">—</span>
                        )}
                        {disputeHref ? (
                          <p className="mt-2 text-xs leading-relaxed">
                            <Link
                              className="font-bold text-blue-600 hover:underline"
                              href={`/admin/disputes/${encodeURIComponent(disputeHref)}`}
                              prefetch={false}
                            >
                              분쟁 관리에서 보기
                            </Link>
                          </p>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <AdminListPagination
              basePath={REFUND_BASE_PATH}
              params={params}
              totalCount={list.totalCount}
              rowsOnPage={rows.length}
            />
          </div>
        )}
      </div>
    </PageScaffold>
  );
}
