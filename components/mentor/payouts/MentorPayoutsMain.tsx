"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  listRecentYearMonths,
  type MentorSettlementLine,
} from "@/lib/mentor/mentorSettlementSchema";
import {
  settlementLineToTableRow,
  type MentorSettlementTableRow,
} from "@/lib/mentor/mentorSettlementDisplay";
import { formatYearMonthLabel } from "@/lib/mentor/mentorPayoutsDisplay";
import type { MentorPayoutPerformanceRow } from "@/lib/mentor/mentorPayoutsTypes";
import { Download, RotateCcw } from "lucide-react";
import { MentorPayoutsPerformanceTable } from "./MentorPayoutsPerformanceTable";
import { MentorPayoutsSettlementTable } from "./MentorPayoutsSettlementTable";
import { formatPayoutTableDate, settlementLineStatusBadge, typeBadgeLabel } from "./payoutUi";

type TabId = "settlement" | "performance";

type LinesResponse = {
  ok: boolean;
  lines?: MentorSettlementLine[];
  error?: string;
};

/**
 * 정산 내역 탭 — 표·다운로드 데이터는 mentor_settlement_lines RPC(월 = occurred_at KST 경계)만
 * 사용한다. 월 전환 시 /api/mentor/payouts/detail 로 해당 월을 다시 조회한다(클라이언트 재집계 없음).
 * 실패 시 0/빈 표를 그리지 않고 오류 상태 + 재시도를 보여준다(fail-closed).
 */
export function MentorPayoutsMain(props: {
  defaultMonth: string;
  initialLines: MentorSettlementLine[];
  performanceLines: MentorPayoutPerformanceRow[];
}) {
  const [tab, setTab] = useState<TabId>("settlement");
  const [month, setMonth] = useState(props.defaultMonth);
  const [fetchedLines, setFetchedLines] = useState<MentorSettlementLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  // 기본 월(서버 프리로드) + 재시도 0회면 initialLines 그대로, 그 외에는 RPC 재조회
  const isDefaultMonthView = month === props.defaultMonth && retryTick === 0;

  const monthChoices = useMemo(
    () =>
      listRecentYearMonths(props.defaultMonth, 12).map((ym) => ({
        value: ym,
        label: formatYearMonthLabel(ym),
      })),
    [props.defaultMonth]
  );

  // 월/재시도/기본월(월 넘어감 후 refresh) 변경 시 로딩 전환 — effect 의 동기 setState 대신
  // 렌더 중 파생 리셋. defaultMonth 를 키에 넣지 않으면 defaultMonth 만 바뀌었을 때 리셋이
  // 건너뛰어져 빈 fetchedLines 가 로딩 표시 없이 "0건" 정상 표로 렌더된다(무음 0 렌더 금지).
  const loadKey = `${month}|${retryTick}|${props.defaultMonth}`;
  const [prevLoadKey, setPrevLoadKey] = useState(loadKey);
  if (prevLoadKey !== loadKey) {
    setPrevLoadKey(loadKey);
    setLoading(!isDefaultMonthView);
    setError(null);
  }

  useEffect(() => {
    if (isDefaultMonthView) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/mentor/payouts/detail?month=${encodeURIComponent(month)}`);
        const json = (await res.json()) as LinesResponse;
        if (cancelled) return;
        if (!json.ok || !Array.isArray(json.lines)) {
          setError(json.error ?? "정산 정보를 불러오지 못했습니다");
          setFetchedLines([]);
          return;
        }
        setFetchedLines(json.lines);
      } catch {
        if (!cancelled) {
          setError("정산 정보를 불러오지 못했습니다");
          setFetchedLines([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [month, retryTick, isDefaultMonthView]);

  const lines = isDefaultMonthView ? props.initialLines : fetchedLines;

  const rows: MentorSettlementTableRow[] = useMemo(
    () =>
      lines
        .map(settlementLineToTableRow)
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [lines]
  );

  // 목록엔 최신순 상위 6개만 표시(추가 fetch 없음). 나머지는 "정산 상세"(/mentor/payouts/detail)에서.
  const visibleRows = useMemo(() => rows.slice(0, 6), [rows]);

  const downloadSettlement = useCallback(async () => {
    const XLSX = await import("xlsx");
    const exportRows = rows.map((r) => {
      const st = settlementLineStatusBadge(r.status, r.holdReason);
      return {
        일자: formatPayoutTableDate(r.date),
        유형: typeBadgeLabel(r.type),
        내용: r.description,
        총액: r.grossCash,
        수수료: r.feeCash,
        정산액: r.mentorCash,
        "원천징수 3.3%": r.withholdingCash,
        실지급: r.netCash,
        "지급(예정)일": r.payDate ?? "",
        상태: st.label,
      };
    });
    const ws = XLSX.utils.json_to_sheet(exportRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "정산내역");
    XLSX.writeFile(wb, `mentor-settlement-${month}.xlsx`);
  }, [rows, month]);

  return (
    <div className="min-w-0 space-y-6">
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
              {/* 로딩 중에는 이전 월의 stale 건수를 새 월 라벨과 함께 보이지 않는다 */}
              {formatYearMonthLabel(month)} 기준 {loading || error ? "—" : `${rows.length}건`}
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
                disabled={loading || Boolean(error) || !rows.length}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
              >
                <Download className="h-4 w-4" />
                다운로드
              </button>
            </div>
          </div>

          {error ? (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-red-200 bg-red-50/60 px-4 py-10 text-center">
              <p className="text-sm font-bold text-red-900">{error}</p>
              <button
                type="button"
                onClick={() => setRetryTick((t) => t + 1)}
                className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-bold text-red-800 hover:bg-red-50"
              >
                <RotateCcw className="h-4 w-4" aria-hidden />
                다시 시도
              </button>
            </div>
          ) : loading ? (
            <p className="py-10 text-center text-sm text-slate-500">불러오는 중…</p>
          ) : (
            <MentorPayoutsSettlementTable rows={visibleRows} />
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs font-medium text-slate-500">최근 수행 {props.performanceLines.length}건</p>
          <MentorPayoutsPerformanceTable rows={props.performanceLines.slice(0, 30)} />
        </div>
      )}
    </div>
  );
}
