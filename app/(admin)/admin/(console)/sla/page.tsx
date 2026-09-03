import Link from "next/link";
import { AdminPageLayout } from "@/components/admin/AdminPageLayout";
import { AdminStatusPill } from "@/components/admin/AdminStatusPill";
import { EmptyState } from "@/components/common/EmptyState";
import {
  SLA_EMPTY_STATE,
  SLA_ITEM_KIND_LABELS,
  SLA_ITEM_STATUS_TABLE,
  SLA_MENTOR_ACTIVITY_HREF,
  SLA_MODERATION_HREF,
  SLA_REFUND_QUEUE_HREF,
  formatSlaSummary,
  slaMentorActivityHref,
  slaToneClass,
} from "@/lib/admin/slaConsole";
import { loadSlaDashboard } from "@/lib/admin/slaDashboard";
import { formatKoDateTimeKst } from "@/lib/utils/kstTime";
import { cn } from "@/lib/utils/cn";

const ACTION_LINK = "rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-extrabold text-slate-700 hover:bg-slate-50";
const TH = "px-3 py-2 text-left text-[11px] font-black uppercase tracking-wide text-slate-500";
const TD = "px-3 py-2.5 align-top text-xs text-slate-800";

function fmtHours(h: number | null): string {
  if (h === null) return "—";
  if (h < 1) return `${Math.round(h * 60)}분`;
  if (h < 48) return `${h.toFixed(1)}시간`;
  return `${(h / 24).toFixed(1)}일`;
}

/**
 * 관리자 · SLA 대시보드(PR-12 §2) — KPI 3개 + **건별 기한** 임박순 표(개별질문 · 맞춤의뢰 주문 · 멘토 중단 환불 · 분쟁).
 * 행의 항목·`→` 는 해당 상세로, 멘토 이름은 멘토 활동(멘토별 집계)으로 간다 — 축이 다르므로 둘 다 둔다.
 * 환불 딥링크는 PR-3 키(`status=pending`). 정의 설명 문단은 두지 않는다(오너 지시). 조회 전용.
 * (admin)/layout.tsx + (console)/layout.tsx 의 이중 requireRole("admin") 가드 아래에 있다.
 */
export default async function AdminSlaPage() {
  const sla = await loadSlaDashboard(new Date());

  return (
    <AdminPageLayout
      title="SLA 대시보드"
      description="기한이 걸린 건을 남은 기간이 짧은 순으로 봅니다. 행을 누르면 해당 상세로, 멘토 이름을 누르면 멘토 활동으로 이동합니다."
      actions={
        <>
          <Link href={SLA_REFUND_QUEUE_HREF} className={ACTION_LINK} prefetch={false}>
            환불 관리(대기)
          </Link>
          <Link href={SLA_MENTOR_ACTIVITY_HREF} className={ACTION_LINK} prefetch={false}>
            멘토 활동
          </Link>
          <Link href={SLA_MODERATION_HREF} className={ACTION_LINK} prefetch={false}>
            콘텐츠 검수
          </Link>
        </>
      }
    >
      {sla.error ? (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-900">
          {sla.error}
        </p>
      ) : null}

      {sla.partialErrors.length ? (
        <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-bold">일부 지표를 불러오지 못했습니다.</p>
          <ul className="mt-1 list-disc pl-5 text-xs text-amber-800">
            {sla.partialErrors.map((msg) => (
              <li key={msg}>{msg} (표시된 값이 실제 0이 아닐 수 있습니다.)</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3" data-sla-kpis>
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
          className={cn(
            "rounded-2xl border p-5 shadow-sm",
            !sla.mentorSuspendedOk
              ? "border-amber-200 bg-amber-50"
              : sla.mentorSuspended.over > 0
                ? "border-red-200 bg-red-50"
                : sla.mentorSuspended.soon > 0
                  ? "border-amber-200 bg-amber-50"
                  : "border-slate-200 bg-white"
          )}
        >
          <p className="text-xs font-bold uppercase text-slate-500">멘토중단 {sla.slaDays}일 SLA</p>
          <p className="mt-2 text-2xl font-black text-slate-900">{sla.mentorSuspendedOk ? `${sla.mentorSuspended.pending}건 대기` : "—"}</p>
          <p className="mt-1 text-xs font-bold">
            {sla.mentorSuspendedOk ? (
              <>
                <span className="text-amber-700">임박 {sla.mentorSuspended.soon}</span> · <span className="text-red-700">초과 {sla.mentorSuspended.over}</span>
              </>
            ) : (
              <span className="text-amber-700">조회 실패 — 값 확인 불가</span>
            )}
          </p>
        </div>
      </div>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" data-sla-items>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
          <h2 className="text-sm font-black text-slate-900">기한 임박순</h2>
          <p className="text-xs font-bold text-slate-600" aria-live="polite">
            {formatSlaSummary(sla.items)}
          </p>
        </div>
        {sla.items.length === 0 ? (
          <div className="p-4">
            <EmptyState title={SLA_EMPTY_STATE.title} description={SLA_EMPTY_STATE.description} />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-sm">
              <thead className="bg-slate-50/40">
                <tr>
                  <th className={TH}>종류</th>
                  <th className={TH}>항목</th>
                  <th className={TH}>멘토</th>
                  <th className={TH}>기한</th>
                  <th className={TH}>남은 기간</th>
                  <th className={TH}>상태</th>
                  <th className={cn(TH, "text-right")} aria-label="상세로 이동" />
                </tr>
              </thead>
              <tbody>
                {sla.items.map((it) => (
                  <tr key={`${it.kind}:${it.id}`} className="border-t border-slate-100 hover:bg-slate-50/60" data-sla-row={it.id} data-sla-kind={it.kind} data-sla-tone={it.tone}>
                    <td className={cn(TD, "whitespace-nowrap font-bold text-slate-600")}>{SLA_ITEM_KIND_LABELS[it.kind]}</td>
                    <td className={cn(TD, "max-w-[320px]")}>
                      <Link href={it.href} className="line-clamp-2 font-extrabold text-slate-900 hover:underline" prefetch={false} title={it.id}>
                        {it.title}
                      </Link>
                    </td>
                    <td className={cn(TD, "whitespace-nowrap")}>
                      {it.mentorName ? (
                        <Link href={slaMentorActivityHref(it.mentorName)} className="font-bold text-slate-800 hover:underline" prefetch={false} title="멘토 활동에서 보기">
                          {it.mentorName}
                        </Link>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className={cn(TD, "whitespace-nowrap tabular-nums text-slate-500")}>{it.deadlineAt ? formatKoDateTimeKst(it.deadlineAt) : "—"}</td>
                    <td className={cn(TD, "whitespace-nowrap")}>
                      <span className={cn("inline-block rounded-lg border px-2.5 py-1 text-xs font-bold", slaToneClass(it.tone))}>{it.label}</span>
                    </td>
                    <td className={cn(TD, "whitespace-nowrap")}>
                      <AdminStatusPill table={SLA_ITEM_STATUS_TABLE[it.kind]} column="status" value={it.status} size="sm" />
                    </td>
                    <td className={cn(TD, "whitespace-nowrap text-right")}>
                      <Link href={it.href} className="font-extrabold text-blue-700 hover:underline" prefetch={false} aria-label="상세로 이동">
                        →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AdminPageLayout>
  );
}
