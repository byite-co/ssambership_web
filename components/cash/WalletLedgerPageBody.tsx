"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ReceiptText } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { formatWalletRowDisplay } from "@/lib/cash/cashQueries";
import type { WalletLedgerPageData } from "@/lib/cash/walletRouteData";
import {
  ledgerAmountLabel,
  ledgerAt,
  ledgerBalanceAfter,
  ledgerIsCredit,
  ledgerReasonLabel,
  ledgerUiKind,
  type LedgerUiKind,
} from "@/lib/cash/ledgerRowDisplay";

const PAGE_SIZE = 15;
const PAGE_SIZE_MOBILE = 8;

type PeriodKey = "1m" | "3m" | "6m" | "custom";
type KindFilter = "all" | LedgerUiKind;

function periodStart(key: PeriodKey): Date | null {
  const now = new Date();
  if (key === "1m") return new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
  if (key === "3m") return new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
  if (key === "6m") return new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());
  return null;
}

function rowDate(row: Record<string, unknown>): Date | null {
  const raw = row.created_at ?? row.inserted_at;
  if (typeof raw !== "string") return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function detailLabel(row: Record<string, unknown>): string {
  const r = ledgerReasonLabel(row);
  if (r && r !== "—") return r;
  const k = ledgerUiKind(row);
  if (k === "charge") return "캐시 충전";
  if (k === "subscription") return "구독제 결제";
  if (k === "custom_request") return "맞춤의뢰 결제";
  return "기타";
}

function kindBadge(kind: LedgerUiKind): string {
  if (kind === "charge") return "충전";
  if (kind === "subscription") return "구독";
  if (kind === "custom_request") return "맞춤의뢰";
  return "기타";
}

export function WalletLedgerPageBody(props: { data: WalletLedgerPageData }) {
  const { data } = props;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [period, setPeriod] = useState<PeriodKey>(
    (searchParams.get("period") as PeriodKey) || "1m",
  );
  const [kind, setKind] = useState<KindFilter>(
    (searchParams.get("kind") as KindFilter) || "all",
  );
  const [page, setPage] = useState(1);
  const [customFrom, setCustomFrom] = useState(searchParams.get("from") ?? "");
  const [customTo, setCustomTo] = useState(searchParams.get("to") ?? "");

  // 모바일은 페이지당 8행, 데스크탑은 기존 15행. 초기값=데스크탑값(SSR/hydration 일치) → 마운트 후 보정.
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const apply = () => setPageSize(mq.matches ? PAGE_SIZE_MOBILE : PAGE_SIZE);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const balanceText = data.balance.error
    ? "—"
    : data.balance.row
      ? formatWalletRowDisplay(data.balance.row)
      : "0캐시";

  const ledgerRows = useMemo(() => (data.ledger.rows ?? []) as Record<string, unknown>[], [data.ledger.rows]);

  const filtered = useMemo(() => {
    let rows = ledgerRows;
    if (period !== "custom") {
      const start = periodStart(period);
      if (start) {
        rows = rows.filter((r) => {
          const d = rowDate(r);
          return d != null && d >= start;
        });
      }
    } else if (customFrom || customTo) {
      const fromD = customFrom ? new Date(customFrom) : null;
      const toD = customTo ? new Date(`${customTo}T23:59:59`) : null;
      rows = rows.filter((r) => {
        const d = rowDate(r);
        if (!d) return false;
        if (fromD && !Number.isNaN(fromD.getTime()) && d < fromD) return false;
        if (toD && !Number.isNaN(toD.getTime()) && d > toD) return false;
        return true;
      });
    }
    if (kind !== "all") {
      rows = rows.filter((r) => ledgerUiKind(r) === kind);
    }
    return rows;
  }, [ledgerRows, period, kind, customFrom, customTo]);

  // pageSize 전환(데스크탑↔모바일) 시 현재 페이지 클램프로 범위 초과 방지.
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  function applyCustomPeriod() {
    const p = new URLSearchParams();
    p.set("period", "custom");
    if (customFrom) p.set("from", customFrom);
    if (customTo) p.set("to", customTo);
    if (kind !== "all") p.set("kind", kind);
    router.push(`${pathname}?${p.toString()}`);
    setPeriod("custom");
    setPage(1);
  }

  const onLedgerTab = pathname?.startsWith("/wallet/ledger");

  return (
    <div className="space-y-6 text-slate-800">
      <nav className="flex gap-1 border-b border-slate-200">
        <Link
          href="/wallet/charge"
          className="rounded-t-lg px-4 py-2.5 text-sm font-extrabold text-slate-500 hover:text-slate-800"
        >
          충전하기
        </Link>
        <Link
          href="/wallet/ledger"
          className={[
            "rounded-t-lg px-4 py-2.5 text-sm font-extrabold",
            onLedgerTab
              ? "border border-b-0 border-slate-200 bg-white text-[#2563EB]"
              : "text-slate-500 hover:text-slate-800",
          ].join(" ")}
          aria-current={onLedgerTab ? "page" : undefined}
        >
          사용내역
        </Link>
      </nav>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-400">현재 잔액</p>
        <p className="mt-1 text-2xl font-black text-slate-900">{balanceText}</p>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <div>
          <span className="block text-xs font-bold text-slate-500">기간</span>
          {/* 모바일: 가로 스크롤 한 줄 · 데스크탑(md+): 기존 flex-wrap 그대로 */}
          <div className="wallet-filter-scroll -mx-1 mt-2 flex flex-nowrap gap-2 overflow-x-auto px-1 [-ms-overflow-style:none] [scrollbar-width:none] md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
            {(
              [
                ["1m", "1개월"],
                ["3m", "3개월"],
                ["6m", "6개월"],
                ["custom", "직접설정"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setPeriod(key);
                  setPage(1);
                }}
                className={[
                  "shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-bold",
                  period === key ? "bg-[#2563EB] text-white" : "border border-slate-200 bg-white text-slate-700",
                ].join(" ")}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {period === "custom" ? (
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs font-bold text-slate-600">
              시작
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="mt-1 block rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="text-xs font-bold text-slate-600">
              종료
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="mt-1 block rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
              />
            </label>
            <button
              type="button"
              onClick={applyCustomPeriod}
              className="rounded-lg bg-slate-800 px-3 py-2 text-xs font-bold text-white"
            >
              적용
            </button>
          </div>
        ) : null}

        <div className="border-t border-slate-100 pt-4">
          <span className="block text-xs font-bold text-slate-500">유형</span>
          {/* 모바일: 가로 스크롤 한 줄(5칩 → 마지막 칩 peek) · 데스크탑(md+): 기존 flex-wrap 그대로 */}
          <div className="wallet-filter-scroll -mx-1 mt-2 flex flex-nowrap gap-2 overflow-x-auto px-1 [-ms-overflow-style:none] [scrollbar-width:none] md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
            {(
              [
                ["all", "전체"],
                ["charge", "충전"],
                ["subscription", "구독"],
                ["custom_request", "맞춤의뢰"],
                ["other", "기타"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setKind(key);
                  setPage(1);
                }}
                className={[
                  "shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-bold",
                  kind === key ? "bg-[#2563EB] text-white" : "border border-slate-200 bg-white text-slate-700",
                ].join(" ")}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        {/* D-ST-13: 안전 상한 도달 시 조용히 자르지 않고 명시한다(과거 내역 유실 오인 방지). */}
        {data.filter.truncated ? (
          <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
            내역이 매우 많아 일부만 표시했습니다. 기간을 좁혀서 조회해 주세요.
          </p>
        ) : null}
        {data.ledger.error ? (
          <p className="text-sm text-red-700">사용 내역을 불러오지 못했습니다.</p>
        ) : ledgerRows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <ReceiptText className="h-12 w-12 text-slate-400" strokeWidth={1.5} aria-hidden />
            <h3 className="mt-4 text-lg font-black text-slate-900">아직 사용 내역이 없어요</h3>
            <p className="mt-2 max-w-sm text-sm font-medium text-slate-600">
              캐시를 충전하고 멘토 서비스를 이용해보세요.
            </p>
            <Link
              href="/wallet/charge"
              className="mt-6 inline-flex min-h-[44px] items-center justify-center rounded-xl bg-[#2563EB] px-5 text-sm font-extrabold text-white hover:bg-[#1D4ED8]"
            >
              캐시 충전하기
            </Link>
          </div>
        ) : filtered.length === 0 ? (
          <p className="py-12 text-center text-sm font-bold text-slate-500">선택한 조건에 맞는 내역이 없어요</p>
        ) : (
          <>
            {/* 데스크탑: 표 */}
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full min-w-[600px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-xs font-bold text-slate-400">
                    <th className="pb-2 pr-3 text-left">날짜</th>
                    <th className="pb-2 pr-3 text-left">구분</th>
                    <th className="pb-2 pr-3 text-left">내역</th>
                    <th className="pb-2 pr-3 text-right">금액</th>
                    <th className="pb-2 text-right">잔액</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {pageRows.map((row, i) => {
                    const k = ledgerUiKind(row);
                    const credit = ledgerIsCredit(row);
                    const amt = ledgerAmountLabel(row);
                    return (
                      <tr key={typeof row.id === "string" ? row.id : `p-${i}`}>
                        <td className="py-3 pr-3 text-xs text-slate-500 whitespace-nowrap">{ledgerAt(row)}</td>
                        <td className="py-3 pr-3">
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-700">
                            {kindBadge(k)}
                          </span>
                        </td>
                        <td className="py-3 pr-3 font-semibold text-slate-800">{detailLabel(row)}</td>
                        <td
                          className={`py-3 pr-3 text-right font-extrabold tabular-nums ${
                            credit ? "text-slate-900" : "text-red-600"
                          }`}
                        >
                          {credit && !amt.startsWith("+") && !amt.startsWith("-") ? `+${amt}` : amt}
                        </td>
                        <td className="py-3 text-right text-xs font-bold text-slate-500 tabular-nums">
                          {ledgerBalanceAfter(row)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* 모바일: 카드(가로 스크롤 제거) */}
            <ul className="space-y-2 sm:hidden">
              {pageRows.map((row, i) => {
                const k = ledgerUiKind(row);
                const credit = ledgerIsCredit(row);
                const amt = ledgerAmountLabel(row);
                const amtText = credit && !amt.startsWith("+") && !amt.startsWith("-") ? `+${amt}` : amt;
                return (
                  <li
                    key={typeof row.id === "string" ? row.id : `m-${i}`}
                    className="rounded-xl border border-slate-200 bg-white p-3.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-700">
                        {kindBadge(k)}
                      </span>
                      <span className="text-xs text-slate-500">{ledgerAt(row)}</span>
                    </div>
                    <div className="mt-2 flex items-end justify-between gap-3">
                      <span className="min-w-0 break-keep text-sm font-semibold text-slate-800">{detailLabel(row)}</span>
                      <span
                        className={`shrink-0 text-base font-extrabold tabular-nums ${
                          credit ? "text-slate-900" : "text-red-600"
                        }`}
                      >
                        {amtText}
                      </span>
                    </div>
                    <p className="mt-1 text-right text-xs font-bold text-slate-400 tabular-nums">
                      잔액 {ledgerBalanceAfter(row)}
                    </p>
                  </li>
                );
              })}
            </ul>

            {totalPages > 1 ? (
              <div className="mt-4 flex items-center justify-center gap-2">
                <button
                  type="button"
                  disabled={currentPage <= 1}
                  onClick={() => setPage(Math.max(1, currentPage - 1))}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold disabled:opacity-40"
                >
                  이전
                </button>
                <span className="text-xs font-bold text-slate-600">
                  {currentPage} / {totalPages}
                </span>
                <button
                  type="button"
                  disabled={currentPage >= totalPages}
                  onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold disabled:opacity-40"
                >
                  다음
                </button>
              </div>
            ) : null}
          </>
        )}
      </section>

      <Link href="/wallet/charge" className="inline-block text-sm font-bold text-blue-600 hover:underline">
        캐시 충전하러 가기 →
      </Link>

      {/* 모바일 가로 스크롤 필터의 스크롤바 숨김(webkit) — Firefox/IE는 위 arbitrary 클래스로 처리 */}
      <style jsx global>{`
        .wallet-filter-scroll::-webkit-scrollbar {
          display: none;
        }
      `}</style>
    </div>
  );
}
