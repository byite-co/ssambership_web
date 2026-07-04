"use client";

import { useMemo, useState } from "react";
import type { MentorPayoutsPageData } from "@/lib/mentor/mentorPayoutsTypes";
import { formatYearMonthLabel } from "@/lib/mentor/mentorPayoutsDisplay";
import { Download } from "lucide-react";
import { MentorPayoutsPerformanceTable } from "./MentorPayoutsPerformanceTable";
import { MentorPayoutsSettlementTable } from "./MentorPayoutsSettlementTable";
import { formatPayoutTableDate, settlementStatusBadge, typeBadgeLabel } from "./payoutUi";

type TabId = "settlement" | "performance";

function monthOptions(defaultMonth: string, count = 12): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    out.push({ value: ym, label: formatYearMonthLabel(ym) });
  }
  if (!out.some((o) => o.value === defaultMonth)) {
    out.unshift({ value: defaultMonth, label: formatYearMonthLabel(defaultMonth) });
  }
  return out;
}

function inMonth(iso: string, ym: string): boolean {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  return key === ym;
}

export function MentorPayoutsMain(props: { data: MentorPayoutsPageData; hideHero?: boolean }) {
  const [tab, setTab] = useState<TabId>("settlement");
  const [month, setMonth] = useState(props.data.defaultMonth);

  const monthChoices = useMemo(() => monthOptions(props.data.defaultMonth), [props.data.defaultMonth]);

  const filteredSettlement = useMemo(
    () => props.data.settlementLines.filter((r) => inMonth(r.date, month)),
    [props.data.settlementLines, month]
  );

  // 목록엔 최신순 상위 6개만 표시(클라이언트 정렬·slice, 새 fetch/limit 없음).
  // 나머지는 좌측 사이드바의 "정산 상세"(/mentor/payouts/detail) 진입으로 확인. 합계·금액 계산은 그대로.
  const visibleSettlement = useMemo(
    () =>
      [...filteredSettlement]
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .slice(0, 6),
    [filteredSettlement]
  );

  async function downloadSettlement() {
    const XLSX = await import("xlsx");
    const rows = filteredSettlement.map((r) => {
      const st = settlementStatusBadge(r.uiStatus);
      return {
        일자: formatPayoutTableDate(r.date),
        유형: typeBadgeLabel(r.type),
        내용: r.description,
        총액: r.grossAmount,
        수수료: r.feeAmount,
        정산액: r.netAmount,
        "원천징수 3.3%": r.withholdingAmount,
        "실지급 예정액": r.payoutAmount,
        상태: st.label,
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "정산내역");
    XLSX.writeFile(wb, `mentor-settlement-${month}.xlsx`);
  }

  return (
    <div className="min-w-0 space-y-6">
      {!props.hideHero ? (
        <header>
          <h1 className="text-2xl font-black text-slate-900">멘토 정산</h1>
          <p className="mt-1 text-sm text-slate-600">예상 정산 금액과 서비스 수익을 확인하세요.</p>
        </header>
      ) : null}

      <div className="border-b border-slate-200">
        <nav className="flex gap-1">
          {(
            [
              ["settlement", "정산 내역"],
              ["performance", "수행 내역"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={[
                "rounded-t-lg px-4 py-2.5 text-sm font-extrabold transition",
                tab === id
                  ? "border border-b-0 border-slate-200 bg-white text-[#059669]"
                  : "text-slate-500 hover:text-slate-800",
              ].join(" ")}
            >
              {label}
            </button>
          ))}
        </nav>
      </div>

      {tab === "settlement" ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs font-medium text-slate-500">
              {formatYearMonthLabel(month)} 기준 {filteredSettlement.length}건
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800"
              >
                {monthChoices.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void downloadSettlement()}
                disabled={!filteredSettlement.length}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
              >
                <Download className="h-4 w-4" />
                다운로드
              </button>
            </div>
          </div>

          <MentorPayoutsSettlementTable rows={visibleSettlement} />
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs font-medium text-slate-500">최근 수행 {props.data.performanceLines.length}건</p>
          <MentorPayoutsPerformanceTable rows={props.data.performanceLines.slice(0, 30)} />
        </div>
      )}
    </div>
  );
}
