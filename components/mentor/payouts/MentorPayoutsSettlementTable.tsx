"use client";

import { CalendarX } from "lucide-react";
import { EmptyState } from "@/components/common/EmptyState";
import {
  PAYOUT_WITHHOLDING_LABEL,
  PAYOUT_WITHHOLDING_TOOLTIP,
} from "@/lib/mentor/mentorPayoutsConstants";
import type { MentorPayoutSettlementTableRow } from "@/lib/mentor/mentorPayoutsTypes";
import {
  formatCashKrw,
  formatPayoutTableDate,
  settlementStatusBadge,
  typeBadgeClass,
  typeBadgeLabel,
} from "./payoutUi";

export function MentorPayoutsSettlementTable(props: {
  rows: MentorPayoutSettlementTableRow[];
  /** detail 페이지: 결제금액·순수령액 라벨 */
  variant?: "summary" | "detail";
}) {
  const grossLabel = props.variant === "detail" ? "결제금액" : "총액";
  const netLabel = props.variant === "detail" ? "순수령액" : "정산액";
  const payoutLabel = "실지급 예정액";
  if (!props.rows.length) {
    return (
      <EmptyState
        compact
        iconTone="neutral"
        icon={<CalendarX className="h-5 w-5" strokeWidth={1.8} aria-hidden />}
        title="선택한 기간에 정산 내역이 없어요"
        description="해당 기간에 완료된 구독 또는 맞춤의뢰가 없습니다."
      />
    );
  }

  return (
    <>
    {/* 데스크탑(sm+): 기존 표 그대로 — lg+ 픽셀 동일 */}
    <div className="hidden overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm sm:block">
      <table className="w-full min-w-[1040px] text-left text-sm">
        <thead>
          <tr className="border-b border-slate-100 bg-slate-50/90 text-xs font-bold text-slate-500">
            <th className="px-4 py-3">일자</th>
            <th className="px-4 py-3">유형</th>
            <th className="px-4 py-3">내용</th>
            <th className="px-4 py-3 text-right">{grossLabel}</th>
            <th className="px-4 py-3 text-right">수수료</th>
            <th className="px-4 py-3 text-right">{netLabel}</th>
            {/* W-01: 원천징수 강조 열 — 굵게·색상 구분·툴팁 */}
            <th className="px-4 py-3 text-right font-extrabold text-rose-700" title={PAYOUT_WITHHOLDING_TOOLTIP}>
              {PAYOUT_WITHHOLDING_LABEL}
            </th>
            <th className="px-4 py-3 text-right">{payoutLabel}</th>
            <th className="px-4 py-3">상태</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {props.rows.map((row) => {
            const st = settlementStatusBadge(row.uiStatus);
            return (
              <tr key={row.id} className="hover:bg-slate-50/50">
                <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatPayoutTableDate(row.date)}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-extrabold ${typeBadgeClass(row.type)}`}>
                    {typeBadgeLabel(row.type)}
                  </span>
                </td>
                <td className="max-w-[220px] truncate px-4 py-3 font-medium text-slate-800" title={row.description}>
                  {row.description}
                </td>
                <td
                  className={`px-4 py-3 text-right tabular-nums font-semibold ${
                    row.isCancelled ? "text-red-600" : "text-slate-900"
                  }`}
                >
                  {row.isCancelled ? `-${formatCashKrw(Math.abs(row.grossAmount))}` : formatCashKrw(row.grossAmount)}
                </td>
                <td
                  className={`px-4 py-3 text-right tabular-nums font-semibold ${
                    row.isCancelled ? "text-emerald-600" : "text-slate-500"
                  }`}
                >
                  {row.isCancelled ? `+${formatCashKrw(row.feeAmount)}` : formatCashKrw(row.feeAmount)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums font-semibold text-slate-700">
                  {formatCashKrw(row.netAmount)}
                </td>
                {/* W-01: 원천징수 강조 셀 */}
                <td
                  className={`px-4 py-3 text-right tabular-nums font-extrabold ${
                    row.isCancelled ? "text-slate-400" : "text-rose-600"
                  }`}
                  title={PAYOUT_WITHHOLDING_TOOLTIP}
                >
                  {row.withholdingAmount > 0 ? `-${formatCashKrw(row.withholdingAmount)}` : "—"}
                </td>
                <td className="px-4 py-3 text-right tabular-nums font-black text-[#059669]">
                  {formatCashKrw(row.payoutAmount)}
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-extrabold ${st.className}`}>
                    {st.label}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>

    {/* 모바일(sm 미만): 행을 카드로 — 일자·유형 + 내용 + 총액·수수료·정산액(강조)·상태 */}
    <ul className="space-y-2.5 sm:hidden">
      {props.rows.map((row) => {
        const st = settlementStatusBadge(row.uiStatus);
        const grossText = row.isCancelled
          ? `-${formatCashKrw(Math.abs(row.grossAmount))}`
          : formatCashKrw(row.grossAmount);
        const feeText = row.isCancelled ? `+${formatCashKrw(row.feeAmount)}` : formatCashKrw(row.feeAmount);
        return (
          <li key={row.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-extrabold ${typeBadgeClass(row.type)}`}>
                {typeBadgeLabel(row.type)}
              </span>
              <span className="text-xs font-medium text-slate-500">{formatPayoutTableDate(row.date)}</span>
            </div>
            <p className="mt-2 break-keep text-sm font-semibold text-slate-800">{row.description}</p>
            <dl className="mt-3 space-y-1.5 border-t border-slate-100 pt-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="font-medium text-slate-500">{grossLabel}</dt>
                <dd className={`tabular-nums font-semibold ${row.isCancelled ? "text-red-600" : "text-slate-900"}`}>
                  {grossText}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="font-medium text-slate-500">수수료</dt>
                <dd className={`tabular-nums font-semibold ${row.isCancelled ? "text-emerald-600" : "text-slate-500"}`}>
                  {feeText}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="font-medium text-slate-500">{netLabel}</dt>
                <dd className="tabular-nums font-semibold text-slate-700">{formatCashKrw(row.netAmount)}</dd>
              </div>
              {/* W-01: 원천징수 강조 행 */}
              <div className="flex items-center justify-between gap-3">
                <dt className="font-extrabold text-rose-700" title={PAYOUT_WITHHOLDING_TOOLTIP}>
                  {PAYOUT_WITHHOLDING_LABEL}
                </dt>
                <dd className={`tabular-nums font-extrabold ${row.isCancelled ? "text-slate-400" : "text-rose-600"}`}>
                  {row.withholdingAmount > 0 ? `-${formatCashKrw(row.withholdingAmount)}` : "—"}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-1.5">
                <dt className="font-bold text-slate-700">{payoutLabel}</dt>
                <dd className="text-base font-black tabular-nums text-[#059669]">{formatCashKrw(row.payoutAmount)}</dd>
              </div>
            </dl>
            <div className="mt-3 flex justify-end">
              <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-extrabold ${st.className}`}>
                {st.label}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
    </>
  );
}
