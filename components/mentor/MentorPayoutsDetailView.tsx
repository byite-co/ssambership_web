"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useMediaQuery } from "@/lib/hooks/useMediaQuery";
import type { MentorPayoutDetailLine, PayoutLineType } from "@/lib/mentor/mentorPayoutsTypes";
import { detailLineToSettlementRow, formatYearMonthLabel } from "@/lib/mentor/mentorPayoutsDisplay";
import { MentorPayoutsSettlementTable } from "@/components/mentor/payouts/MentorPayoutsSettlementTable";
import { Download } from "lucide-react";
import {
  formatCashKrw,
  formatPayoutTableDate,
  settlementStatusBadge,
  typeBadgeLabel,
} from "@/components/mentor/payouts/payoutUi";

type DetailTotals = {
  paymentAmount: number;
  feeAmount: number;
  netAmount: number;
  withholdingAmount: number;
  payoutAmount: number;
};

const EMPTY_TOTALS: DetailTotals = {
  paymentAmount: 0,
  feeAmount: 0,
  netAmount: 0,
  withholdingAmount: 0,
  payoutAmount: 0,
};

type DetailResponse = {
  ok: boolean;
  lines?: MentorPayoutDetailLine[];
  totals?: DetailTotals;
  error?: string;
};

function monthOptions(count = 12): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    out.push({ value: ym, label: formatYearMonthLabel(ym) });
  }
  return out;
}

export function MentorPayoutsDetailView() {
  const months = useMemo(() => monthOptions(), []);
  const [month, setMonth] = useState(months[0]?.value ?? "");
  const [type, setType] = useState<"all" | PayoutLineType>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<MentorPayoutDetailLine[]>([]);
  const [totals, setTotals] = useState<DetailTotals>(EMPTY_TOTALS);
  const [page, setPage] = useState(1);

  // 클라이언트 페이지네이션 — 데스크탑 10/page, 모바일(≤767px) 5/page.
  // SSR/hydration 일치를 위해 초기값=데스크탑(10), 마운트 후 모바일이면 5로 보정.
  const PAGE_SIZE_DESKTOP = 10;
  const PAGE_SIZE_MOBILE = 5;
  const pageSize = useMediaQuery("(max-width: 767px)") ? PAGE_SIZE_MOBILE : PAGE_SIZE_DESKTOP;

  // 필터(month/type) 변경 시 로딩 상태로 전환 — effect 의 동기 setState 대신 렌더 중 파생 리셋.
  // (초기 마운트는 useState 초기값 loading=true/error=null 이 이미 커버)
  const loadKey = `${month}|${type}`;
  const [prevLoadKey, setPrevLoadKey] = useState(loadKey);
  if (prevLoadKey !== loadKey) {
    setPrevLoadKey(loadKey);
    setLoading(true);
    setError(null);
  }

  const tableRows = useMemo(() => lines.map(detailLineToSettlementRow), [lines]);
  // 이미 로드된 내역을 pageSize개씩 slice(추가 fetch 없음). pageSize 전환 시 safePage 클램프.
  const totalPages = Math.max(1, Math.ceil(tableRows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedRows = useMemo(
    () => tableRows.slice((safePage - 1) * pageSize, safePage * pageSize),
    [tableRows, safePage, pageSize]
  );

  // month/type 별 상세 fetch — loading/error 초기화는 마운트 초기값·loadKey 파생 리셋이 담당,
  // setState 는 전부 await 이후 콜백 시점(effect 동기 setState 금지 규칙 준수). 언마운트/필터 변경 시 stale 응답 무시.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const params = new URLSearchParams();
      if (month) params.set("month", month);
      if (type !== "all") params.set("type", type);
      try {
        const res = await fetch(`/api/mentor/payouts/detail?${params.toString()}`);
        const json = (await res.json()) as DetailResponse;
        if (cancelled) return;
        if (!json.ok || !json.lines) {
          setError(json.error ?? "내역을 불러오지 못했습니다.");
          setLines([]);
          return;
        }
        setLines(json.lines);
        setTotals(json.totals ?? EMPTY_TOTALS);
      } catch {
        if (!cancelled) setError("내역을 불러오지 못했습니다.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [month, type]);

  async function exportExcel() {
    const XLSX = await import("xlsx");
    const rows = tableRows.map((r) => {
      const st = settlementStatusBadge(r.uiStatus);
      return {
        날짜: formatPayoutTableDate(r.date),
        유형: typeBadgeLabel(r.type),
        내용: r.description,
        결제금액: r.grossAmount,
        수수료: r.feeAmount,
        순수령액: r.netAmount,
        "원천징수 3.3%": r.withholdingAmount,
        "실지급 예정액": r.payoutAmount,
        상태: st.label,
      };
    });
    rows.push({
      날짜: "합계",
      유형: "",
      내용: "",
      결제금액: totals.paymentAmount,
      수수료: totals.feeAmount,
      순수령액: totals.netAmount,
      "원천징수 3.3%": totals.withholdingAmount,
      "실지급 예정액": totals.payoutAmount,
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
            <p className="mt-1 text-sm text-slate-600">기간·유형별 수익 내역과 합계를 확인합니다.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void exportExcel()}
          disabled={!lines.length}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
        >
          <Download className="h-4 w-4" />
          엑셀 다운로드
        </button>
      </div>

      {/* W-01 4단 구조: 총 수익 → 수수료 → 원천징수 3.3%(강조) → 실지급 예정액 */}
      {!loading && !error ? (
        <div className="mb-4 rounded-2xl border-[0.5px] border-emerald-200 bg-emerald-50/60 px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-bold text-slate-700">실지급 예정액 합계</span>
            <span className="text-2xl font-black tabular-nums text-[#059669]">{formatCashKrw(totals.payoutAmount)}</span>
          </div>
          <p className="mt-2 text-[12px] text-slate-500">
            총 수익 <span className="font-semibold tabular-nums text-slate-700">{formatCashKrw(totals.paymentAmount)}</span>
            {" − "}플랫폼 수수료 <span className="font-semibold tabular-nums text-slate-700">{formatCashKrw(totals.feeAmount)}</span>
            {" − "}
            <strong className="font-extrabold text-rose-600" title="프리랜서 사업소득 원천징수">
              원천징수 3.3% {formatCashKrw(totals.withholdingAmount)}
            </strong>
            {" = "}실지급 예정액 <span className="font-semibold tabular-nums text-slate-700">(매월 23일 지급)</span>
          </p>
        </div>
      ) : null}

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
              setType(e.target.value as "all" | PayoutLineType);
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
        <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-900">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="py-16 text-center text-sm text-slate-500">불러오는 중…</p>
      ) : (
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
