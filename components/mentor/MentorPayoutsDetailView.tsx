"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useMediaQuery } from "@/lib/hooks/useMediaQuery";
import {
  kstYearMonth,
  listRecentYearMonths,
  type MentorSettlementLine,
  type SettlementSourceType,
} from "@/lib/mentor/mentorSettlementSchema";
import {
  settlementLineToTableRow,
  type MentorSettlementTableRow,
} from "@/lib/mentor/mentorSettlementDisplay";
import { formatYearMonthLabel } from "@/lib/mentor/mentorPayoutsDisplay";
import { MentorPayoutsSettlementTable } from "@/components/mentor/payouts/MentorPayoutsSettlementTable";
import { Download } from "lucide-react";
import {
  formatPayoutTableDate,
  settlementLineStatusBadge,
  typeBadgeLabel,
} from "@/components/mentor/payouts/payoutUi";

type LinesResponse = {
  ok: boolean;
  lines?: MentorSettlementLine[];
  error?: string;
};

/**
 * 정산 상세 — 표·엑셀 다운로드 데이터는 mentor_settlement_lines RPC(월 = occurred_at KST 경계,
 * /api/mentor/payouts/detail)만 사용한다. 금액·상태 클라이언트 재계산 없음. 실패 시 fail-closed.
 */
export function MentorPayoutsDetailView() {
  const months = useMemo(() => {
    const currentYm = kstYearMonth(new Date());
    return listRecentYearMonths(currentYm, 12).map((ym) => ({
      value: ym,
      label: formatYearMonthLabel(ym),
    }));
  }, []);
  const [month, setMonth] = useState(months[0]?.value ?? "");
  const [type, setType] = useState<"all" | SettlementSourceType>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<MentorSettlementLine[]>([]);
  const [page, setPage] = useState(1);
  const [retryTick, setRetryTick] = useState(0);

  // 클라이언트 페이지네이션 — 데스크탑 10/page, 모바일(≤767px) 5/page.
  // SSR/hydration 일치를 위해 초기값=데스크탑(10), 마운트 후 모바일이면 5로 보정.
  const PAGE_SIZE_DESKTOP = 10;
  const PAGE_SIZE_MOBILE = 5;
  const pageSize = useMediaQuery("(max-width: 767px)") ? PAGE_SIZE_MOBILE : PAGE_SIZE_DESKTOP;

  // 필터(month/type) 변경 시 로딩 상태로 전환 — effect 의 동기 setState 대신 렌더 중 파생 리셋.
  const loadKey = `${month}|${type}|${retryTick}`;
  const [prevLoadKey, setPrevLoadKey] = useState(loadKey);
  if (prevLoadKey !== loadKey) {
    setPrevLoadKey(loadKey);
    setLoading(true);
    setError(null);
  }

  const tableRows: MentorSettlementTableRow[] = useMemo(
    () =>
      lines
        .map(settlementLineToTableRow)
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [lines]
  );
  const totalPages = Math.max(1, Math.ceil(tableRows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedRows = useMemo(
    () => tableRows.slice((safePage - 1) * pageSize, safePage * pageSize),
    [tableRows, safePage, pageSize]
  );

  // month/type 별 상세 fetch — 언마운트/필터 변경 시 stale 응답 무시.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const params = new URLSearchParams();
      if (month) params.set("month", month);
      if (type !== "all") params.set("type", type);
      try {
        const res = await fetch(`/api/mentor/payouts/detail?${params.toString()}`);
        const json = (await res.json()) as LinesResponse;
        if (cancelled) return;
        if (!json.ok || !Array.isArray(json.lines)) {
          setError(json.error ?? "정산 정보를 불러오지 못했습니다");
          setLines([]);
          return;
        }
        setLines(json.lines);
      } catch {
        if (!cancelled) {
          setError("정산 정보를 불러오지 못했습니다");
          setLines([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [month, type, retryTick]);

  async function exportExcel() {
    const XLSX = await import("xlsx");
    const rows = tableRows.map((r) => {
      const st = settlementLineStatusBadge(r.status, r.holdReason);
      return {
        날짜: formatPayoutTableDate(r.date),
        유형: typeBadgeLabel(r.type),
        내용: r.description,
        결제금액: r.grossCash,
        수수료: r.feeCash,
        순수령액: r.mentorCash,
        "원천징수 3.3%": r.withholdingCash,
        실지급: r.netCash,
        "지급(예정)일": r.payDate ?? "",
        상태: st.label,
      };
    });
    // 합계 행 — 표시된(필터된) 행의 RPC 값 단순 합 (모집단 재해석 없음)
    rows.push({
      날짜: "합계",
      유형: "",
      내용: "",
      결제금액: tableRows.reduce((a, r) => a + r.grossCash, 0),
      수수료: tableRows.reduce((a, r) => a + r.feeCash, 0),
      순수령액: tableRows.reduce((a, r) => a + r.mentorCash, 0),
      "원천징수 3.3%": tableRows.reduce((a, r) => a + r.withholdingCash, 0),
      실지급: tableRows.reduce((a, r) => a + r.netCash, 0),
      "지급(예정)일": "",
      상태: "",
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "정산상세");
    XLSX.writeFile(wb, `mentor-payouts-${month || "all"}.xlsx`);
  }

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 pt-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-2">
          <Link href="/mentor/payouts" className="inline-flex text-sm font-bold text-[#059669] hover:underline">
            ← 정산 요약으로
          </Link>
          <div>
            <h1 className="text-2xl font-black text-slate-900">정산 상세</h1>
            <p className="mt-1 text-sm text-slate-600">기간·유형별 수익 내역을 확인합니다.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void exportExcel()}
          disabled={loading || Boolean(error) || !lines.length}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
        >
          <Download className="h-4 w-4" />
          엑셀 다운로드
        </button>
      </div>

      <div className="mb-4 flex flex-wrap gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <label className="text-xs font-semibold text-slate-600">
          기간
          <select
            value={month}
            onChange={(e) => {
              setMonth(e.target.value);
              setPage(1);
            }}
            className="mt-1 block rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold"
          >
            {months.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold text-slate-600">
          유형
          <select
            value={type}
            onChange={(e) => {
              setType(e.target.value as "all" | SettlementSourceType);
              setPage(1);
            }}
            className="mt-1 block rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold"
          >
            <option value="all">전체</option>
            <option value="subscription">구독</option>
            <option value="custom_request">맞춤의뢰</option>
            <option value="individual_question">개별질문</option>
          </select>
        </label>
      </div>

      {error ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-sm font-semibold text-red-900">{error}</p>
          <button
            type="button"
            onClick={() => setRetryTick((t) => t + 1)}
            className="inline-flex items-center rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-bold text-red-800 hover:bg-red-50"
          >
            다시 시도
          </button>
        </div>
      ) : null}

      {loading ? (
        <p className="py-16 text-center text-sm text-slate-500">불러오는 중…</p>
      ) : error ? null : (
        <>
          <MentorPayoutsSettlementTable rows={pagedRows} variant="detail" />
          {totalPages > 1 ? (
            <nav className="mt-6 flex items-center justify-center gap-3" aria-label="페이지 이동">
              <button
                type="button"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                이전
              </button>
              <span className="text-sm font-bold tabular-nums text-slate-500">
                <span className="text-[#059669]">{safePage}</span> / {totalPages}
              </span>
              <button
                type="button"
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                다음
              </button>
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
}
