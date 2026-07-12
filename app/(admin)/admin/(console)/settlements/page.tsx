import { PageScaffold } from "@/components/shell/PageScaffold";
import { AdminStatusBadge } from "@/components/admin/AdminStatusBadge";
import { createClient } from "@/lib/supabase/server";
import {
  adminSettlementStatusLabel,
  loadAdminSettlementsList,
  type AdminListResult,
  type AdminSettlementListItem,
} from "@/lib/admin/adminQueries";
import { adminListErrorDescription } from "@/lib/admin/adminDisplayError";
import { refreshSubscriptionSettlementItemsBestEffort } from "@/lib/mentor/subscriptionSettlementItems";

const SETTLEMENTS_BADGE_RESULT: AdminListResult = {
  table: null,
  sourceNote: "",
  rows: [],
  error: null,
  keyHints: {},
};

function formatWon(n: number): string {
  return `${new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 }).format(Math.round(n))}원`;
}

function shortUuid(id: string): string {
  if (!id) return "—";
  return id.length > 10 ? `${id.slice(0, 10)}…` : id;
}

function formatDateKo(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(d);
}

const statusBadgeClass = (s: string) => {
  const u = s.toLowerCase();
  if (/pending|on_hold|hold/i.test(u)) return "bg-amber-50 text-amber-700 border-amber-100";
  if (/paid|success|done/i.test(u)) return "bg-emerald-50 text-emerald-700 border-emerald-100";
  return "bg-slate-50 text-slate-600 border-slate-100";
};

function SettlementTable({ rows }: { rows: AdminSettlementListItem[] }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 bg-slate-50/60 px-5 py-3.5 flex items-center justify-between">
        <h2 className="text-xs font-bold text-slate-700 uppercase tracking-wider">정산 내역 상세</h2>
        <span className="text-xs bg-blue-50 text-blue-600 font-semibold px-2.5 py-1 rounded">
          {rows.length}건
        </span>
      </div>
      <table className="w-full min-w-[1040px] text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200/60 bg-slate-50/40">
            <th className="px-5 py-3 text-xs font-bold text-slate-600">정산 ID</th>
            <th className="px-5 py-3 text-xs font-bold text-slate-600">유형</th>
            <th className="px-5 py-3 text-xs font-bold text-slate-600">주문/이벤트 ID</th>
            <th className="px-5 py-3 text-xs font-bold text-slate-600">멘토</th>
            <th className="px-5 py-3 text-xs font-bold text-slate-600">정산 계좌</th>
            <th className="px-5 py-3 text-xs font-bold text-slate-600">학생</th>
            <th className="px-5 py-3 text-xs font-bold text-slate-600">총 결제금액</th>
            <th className="px-5 py-3 text-xs font-bold text-slate-600">플랫폼 수수료</th>
            <th className="px-5 py-3 text-xs font-bold text-slate-600">멘토 정산금</th>
            <th className="px-5 py-3 text-xs font-bold text-slate-600">상태</th>
            <th className="px-5 py-3 text-xs font-bold text-slate-600">지급일</th>
            <th className="px-5 py-3 text-xs font-bold text-slate-600">생성일</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-slate-50/30 transition-colors">
              <td className="max-w-[120px] truncate px-5 py-4 font-mono text-xs font-medium text-slate-800" title={r.id}>
                {shortUuid(r.id)}
              </td>
              <td className="whitespace-nowrap px-5 py-4 text-xs font-bold text-slate-700">
                {r.sourceType === "subscription" ? "구독" : "맞춤의뢰"}
              </td>
              <td
                className="max-w-[120px] truncate px-5 py-4 font-mono text-xs font-medium text-slate-800"
                title={r.orderMetaLine ? `${r.customRequestOrderId}\n${r.orderMetaLine}` : r.customRequestOrderId}
              >
                {shortUuid(r.customRequestOrderId)}
              </td>
              <td className="max-w-[100px] truncate px-5 py-4 font-mono text-xs font-medium text-slate-600" title={r.mentorId}>
                {shortUuid(r.mentorId)}
              </td>
              <td className="max-w-[150px] truncate px-5 py-4 text-xs font-bold text-slate-700" title={r.payoutAccountDisplay}>
                {r.payoutAccountDisplay}
              </td>
              <td className="max-w-[100px] truncate px-5 py-4 font-mono text-xs font-medium text-slate-600" title={r.studentId ?? ""}>
                {r.studentId ? shortUuid(r.studentId) : "—"}
              </td>
              <td className="whitespace-nowrap px-5 py-4 text-xs font-medium text-slate-600 tabular-nums">{formatWon(r.grossAmount)}</td>
              <td className="whitespace-nowrap px-5 py-4 text-xs font-medium text-slate-600 tabular-nums">{formatWon(r.platformFeeAmount)}</td>
              <td className="whitespace-nowrap px-5 py-4 text-xs font-black text-slate-900 tabular-nums">{formatWon(r.mentorAmount)}</td>
              <td className="px-5 py-4 whitespace-nowrap">
                <span className={`inline-block border rounded-lg px-2.5 py-1 text-xs font-bold ${statusBadgeClass(r.status)}`}>
                  {adminSettlementStatusLabel(r.status)}
                </span>
              </td>
              <td className="whitespace-nowrap px-5 py-4 text-xs font-medium text-slate-500 whitespace-nowrap">{formatDateKo(r.paidAt)}</td>
              <td className="whitespace-nowrap px-5 py-4 text-xs font-medium text-slate-500 whitespace-nowrap">{formatDateKo(r.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function AdminSettlementsPage() {
  const supabase = await createClient();
  await refreshSubscriptionSettlementItemsBestEffort();
  const { rows, summary, queryOk, byMentorHint } = await loadAdminSettlementsList(supabase, 50);

  const summaryBody = queryOk
    ? [
        `전체 ${summary.totalRows}건`,
        `지급 대기·보류·지급 가능(멘토 정산금 합계) ${formatWon(summary.pendingMentorAmountSum)}`,
        `지급 완료(멘토 정산금 합계) ${formatWon(summary.paidMentorAmountSum)}`,
        `보류 ${summary.onHoldCount}건 · 취소 ${summary.cancelledCount}건`,
      ].join(" · ")
    : "정산 요약을 불러오지 못했습니다.";

  return (
    <PageScaffold
      eyebrow="관리자 / 정산"
      title="정산 관리"
      description="멘토 정산 대상과 지급 상태를 확인합니다. 지급 실행·재시도는 이 화면에서 자동으로 이루어지지 않으며, 필요 시 외부 정산 절차와 맞춰 수동 처리합니다."
      ctas={[
        { href: "/admin/refunds", label: "환불 관리", tone: "slate" },
        { href: "/admin/disputes", label: "분쟁 관리", tone: "slate" },
        { href: "/admin/audit-logs", label: "감사 로그", tone: "blue" },
        { href: "/admin", label: "대시보드", tone: "slate" },
      ]}
      sections={[
        { title: "정산 요약", body: summaryBody, status: queryOk ? "connected" : "skeleton" },
        {
          title: "오류 재처리",
          body: "지급 실패 건의 자동 재시도는 이 화면에서 제공하지 않습니다. 원장·결제 상태를 확인한 뒤 필요 시 수동으로 후속 처리해 주세요.",
          status: "skeleton",
        },
        { title: "멘토별 보기", body: byMentorHint, status: "skeleton" },
      ]}
      hideFooterPlaceholderCards
      dataPoints={[
        "이 화면은 지급 예정·상태 확인용이며, 실제 지급 실행은 별도 운영 절차에서 처리합니다.",
        "각 운영 메뉴는 왼쪽 사이드바에서 이동할 수 있습니다. 금전·정산·주문은 관련 상세 메뉴에서 확인 후 처리하세요.",
      ]}
    >
      <div className="max-w-6xl mx-auto space-y-6 pb-12">
        {!queryOk ? (
          <div className="rounded-xl border border-red-200 bg-red-50/60 p-5 text-sm text-red-950">
            <p className="font-bold">목록을 불러오지 못했습니다.</p>
            <p className="mt-1 text-xs text-red-900/95">{adminListErrorDescription("settlements")}</p>
          </div>
        ) : null}

        {queryOk ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
              <div className="flex items-center gap-3">
                <span className="text-sm font-bold text-slate-800">지급 예정 및 지급 내역</span>
                <AdminStatusBadge result={SETTLEMENTS_BADGE_RESULT} hint="최근 정산부터 최대 50건" />
              </div>
              <p className="text-xs font-medium text-slate-400">정산 대상 내역을 확인해 주세요.</p>
            </div>
            {rows.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/40 p-8 text-center text-sm text-slate-500 font-semibold">
                정산 대상 내역이 없습니다.
              </p>
            ) : (
              <SettlementTable rows={rows} />
            )}
          </div>
        ) : null}
      </div>
    </PageScaffold>
  );
}
