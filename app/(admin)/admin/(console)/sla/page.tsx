import Link from "next/link";
import { PageScaffold } from "@/components/shell/PageScaffold";
import { loadSlaDashboard } from "@/lib/admin/slaDashboard";

function fmtHours(h: number | null): string {
  if (h === null) return "—";
  if (h < 1) return `${Math.round(h * 60)}분`;
  if (h < 48) return `${h.toFixed(1)}시간`;
  return `${(h / 24).toFixed(1)}일`;
}

function fmt(v: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "short", timeStyle: "short" }).format(d);
}

export default async function AdminSlaPage() {
  const sla = await loadSlaDashboard(new Date());

  return (
    <PageScaffold
      eyebrow="관리자 / SLA"
      title="SLA 대시보드"
      description="신고 평균 응답시간, 환불 평균 처리시간, 멘토 중단 환불 5일 SLA 잔여를 한 화면에서 확인합니다. 기한 임박·초과 건은 강조됩니다."
      ctas={[
        { href: "/admin/refunds?type=subscription_mentor_suspended&sort=deadline", label: "멘토중단 환불", tone: "blue" },
        { href: "/admin/moderation", label: "콘텐츠 검수", tone: "slate" },
        { href: "/admin", label: "대시보드", tone: "slate" },
      ]}
      sections={[
        {
          title: "기준",
          body: `멘토 중단 환불은 요청일로부터 ${sla.slaDays}일 이내 처리가 목표입니다. 남은 일수 2일 이하는 임박, 0일 미만은 초과로 강조합니다.`,
          status: "connected",
        },
      ]}
      emptyState=""
      dataPoints={[]}
      hideFooterPlaceholderCards
    >
      <div className="mx-auto max-w-6xl space-y-6 pb-12">
        {sla.error ? (
          <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-900">{sla.error}</p>
        ) : null}

        {sla.partialErrors.length ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <p className="font-bold">일부 지표를 불러오지 못했습니다.</p>
            <ul className="mt-1 list-disc pl-5 text-xs text-amber-800">
              {sla.partialErrors.map((msg) => (
                <li key={msg}>{msg} (표시된 값이 실제 0이 아닐 수 있습니다.)</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-bold uppercase text-slate-500">신고 평균 응답시간</p>
            <p className="mt-2 text-2xl font-black text-slate-900">{sla.reportsOk ? fmtHours(sla.reports.avgResponseHours) : "—"}</p>
            <p className="mt-1 text-xs text-slate-500">
              {sla.reportsOk ? (
                <>
                  처리 {sla.reports.resolvedCount}건 · 미처리 <strong className="text-amber-600">{sla.reports.openCount}</strong>건
                </>
              ) : (
                <span className="text-amber-700">조회 실패 — 값 확인 불가</span>
              )}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-bold uppercase text-slate-500">환불 평균 처리시간</p>
            <p className="mt-2 text-2xl font-black text-slate-900">{sla.refundsOk ? fmtHours(sla.refunds.avgProcessHours) : "—"}</p>
            <p className="mt-1 text-xs text-slate-500">
              {sla.refundsOk ? (
                <>
                  처리 {sla.refunds.processedCount}건 · 대기 <strong className="text-amber-600">{sla.refunds.pendingCount}</strong>건
                </>
              ) : (
                <span className="text-amber-700">조회 실패 — 값 확인 불가</span>
              )}
            </p>
          </div>
          <div
            className={`rounded-2xl border p-5 shadow-sm ${
              !sla.mentorSuspendedOk
                ? "border-amber-200 bg-amber-50"
                : sla.mentorSuspended.over > 0
                  ? "border-red-200 bg-red-50"
                  : sla.mentorSuspended.soon > 0
                    ? "border-amber-200 bg-amber-50"
                    : "border-slate-200 bg-white"
            }`}
          >
            <p className="text-xs font-bold uppercase text-slate-500">멘토중단 5일 SLA</p>
            <p className="mt-2 text-2xl font-black text-slate-900">
              {sla.mentorSuspendedOk ? `${sla.mentorSuspended.pending}건 대기` : "—"}
            </p>
            <p className="mt-1 text-xs font-bold">
              {sla.mentorSuspendedOk ? (
                <>
                  <span className="text-amber-700">임박 {sla.mentorSuspended.soon}</span> ·{" "}
                  <span className="text-red-700">초과 {sla.mentorSuspended.over}</span>
                </>
              ) : (
                <span className="text-amber-700">조회 실패 — 값 확인 불가</span>
              )}
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-black text-slate-900">멘토 중단 환불 — 기한 임박순</h2>
            <Link
              href="/admin/refunds?type=subscription_mentor_suspended&sort=deadline"
              className="text-xs font-bold text-blue-600 hover:underline"
            >
              환불 화면에서 처리 →
            </Link>
          </div>
          {!sla.mentorSuspended.rows.length ? (
            <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/40 p-6 text-center text-sm text-slate-500">
              대기 중인 멘토 중단 환불이 없습니다.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px] text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/40">
                    <th className="px-4 py-2 text-xs font-bold text-slate-600">환불 ID</th>
                    <th className="px-4 py-2 text-xs font-bold text-slate-600">요청일</th>
                    <th className="px-4 py-2 text-xs font-bold text-slate-600">SLA</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sla.mentorSuspended.rows.map((r) => (
                    <tr key={r.id}>
                      <td className="px-4 py-2 font-mono text-xs text-slate-700">{r.id.slice(0, 12)}…</td>
                      <td className="px-4 py-2 text-xs text-slate-500">{fmt(r.createdAt)}</td>
                      <td className="px-4 py-2">
                        <span
                          className={`inline-block rounded-lg border px-2.5 py-1 text-xs font-bold ${
                            r.tone === "over"
                              ? "bg-red-50 text-red-700 border-red-200"
                              : r.tone === "soon"
                                ? "bg-amber-50 text-amber-700 border-amber-200"
                                : "bg-slate-50 text-slate-600 border-slate-200"
                          }`}
                        >
                          {r.label}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </PageScaffold>
  );
}
