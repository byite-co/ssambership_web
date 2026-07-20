"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  requestSubscriptionCancelAtPeriodEndAction,
  undoSubscriptionCancelAtPeriodEndAction,
} from "@/lib/subscribe/subscriptionCancelActions";
import { FormSubmitButton } from "@/components/common/FormSubmitButton";
import type { StudentSubscriptionManagementItem } from "@/lib/subscribe/studentSubscriptionManagement";

const PAGE_SIZE = 4;

// 상태 배지 색 — 기존 page.tsx 규약 그대로(active=파랑, scheduled/pastDue=앰버, 그 외=slate).
function statusBadgeClass(tone: string): string {
  switch (tone) {
    case "active":
      return "border-blue-100 bg-blue-50 text-blue-700";
    case "scheduled":
    case "pastDue":
      return "border-amber-100 bg-amber-50 text-amber-700";
    case "expired":
    case "refunded":
    case "neutral":
    default:
      return "border-slate-200 bg-slate-50 text-slate-600";
  }
}

// 좌측 3px 액센트 바 — 이용 중=파랑 / 만료 예정=주황 / 결제 실패=빨강 / 만료됨·종료=회색.
function accentBarClass(tone: string): string {
  if (tone === "active") return "bg-[#2563EB]";
  if (tone === "scheduled") return "bg-amber-500";
  if (tone === "pastDue") return "bg-red-500";
  return "bg-slate-300";
}

// "지난 구독" = 완전 만료/종료(expired·refunded·neutral). 그 외(active·scheduled·pastDue)는 현재 기간 살아있는 "이용 중".
function isPastTone(tone: string): boolean {
  return tone === "expired" || tone === "refunded" || tone === "neutral";
}

type Tab = "all" | "active" | "past";

export function StudentSubscriptionsList({ items }: { items: StudentSubscriptionManagementItem[] }) {
  const [tab, setTab] = useState<Tab>("all");
  const [page, setPage] = useState(1);
  // 모바일은 페이지당 3개, 데스크탑은 기존 4개. 초기값=데스크탑값(SSR/hydration 일치) → 마운트 후 보정.
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const apply = () => setPageSize(mq.matches ? 3 : PAGE_SIZE);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const activeItems = items.filter((i) => !isPastTone(i.statusTone));
  const pastItems = items.filter((i) => isPastTone(i.statusTone));
  const filtered = tab === "active" ? activeItems : tab === "past" ? pastItems : items;

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "all", label: "전체", count: items.length },
    { id: "active", label: "이용 중", count: activeItems.length },
    { id: "past", label: "지난 구독", count: pastItems.length },
  ];

  return (
    <section className="space-y-4">
      <nav className="flex flex-wrap gap-2" aria-label="구독 필터">
        {tabs.map((t) => {
          const on = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setTab(t.id);
                setPage(1);
              }}
              className={[
                "inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold",
                on ? "bg-[#2563EB] text-white" : "border border-slate-200 bg-white text-slate-700",
              ].join(" ")}
            >
              {t.label}
              <span className={`tabular-nums ${on ? "text-white/80" : "text-slate-400"}`}>{t.count}</span>
            </button>
          );
        })}
      </nav>

      {filtered.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-200 py-12 text-center text-sm text-slate-500">
          해당하는 구독이 없습니다.
        </p>
      ) : (
        <div className="space-y-4">
          {visible.map((item) => {
            const past = isPastTone(item.statusTone);
            return (
              <article
                key={item.subscriptionId}
                className={`relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm ${
                  past ? "opacity-75" : ""
                }`}
              >
                <span className={`absolute inset-y-0 left-0 w-[3px] ${accentBarClass(item.statusTone)}`} aria-hidden />
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-black text-slate-900">{item.mentorName}</h2>
                      <span className="rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-xs font-extrabold text-blue-700">
                        {item.planLabel}
                      </span>
                      <span
                        className={`rounded-full border px-2.5 py-1 text-xs font-extrabold ${statusBadgeClass(item.statusTone)}`}
                      >
                        {item.statusLabel}
                      </span>
                    </div>
                    {/* 정보 4칸 — 서브박스 제거, 플랫 라벨-값 2열 그리드 */}
                    <dl className="grid gap-x-4 gap-y-3 break-keep pt-1 sm:grid-cols-2">
                      <div>
                        <dt className="text-[11px] font-bold text-slate-500">현재 기간</dt>
                        <dd className="mt-0.5 text-sm font-bold text-slate-900">{item.currentPeriodLabel}</dd>
                      </div>
                      <div>
                        <dt className="text-[11px] font-bold text-slate-500">다음 결제일</dt>
                        <dd className="mt-0.5 text-sm font-bold text-slate-900">{item.nextBillingDisplayLabel}</dd>
                      </div>
                      <div>
                        <dt className="text-[11px] font-bold text-slate-500">주간 질문 한도</dt>
                        <dd className="mt-0.5 text-sm font-bold text-slate-900">{item.weeklyQuestionLimitLabel}</dd>
                      </div>
                      <div>
                        <dt className="text-[11px] font-bold text-slate-500">질문 리셋</dt>
                        <dd className="mt-0.5 text-sm font-bold text-slate-900">{item.weeklyResetLabel}</dd>
                      </div>
                    </dl>
                    {/* 예상 환불액·학원법 안내는 기본 숨김(펼치면 표시) */}
                    <details className="group rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-2.5">
                      <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-bold text-slate-600 [&::-webkit-details-marker]:hidden">
                        예상 환불액 · 학원법 안내
                        <span className="text-slate-400 transition group-open:rotate-180">▾</span>
                      </summary>
                      <div className="mt-2">
                        <p className="font-extrabold text-slate-900">{item.refundEstimateLabel}</p>
                        <p className="mt-1 text-[11px] font-semibold text-slate-500">{item.refundEstimateBracketLabel}</p>
                        <p className="mt-1 text-[11px] leading-snug text-slate-400">
                          학원법 시행령 별표4 기준. 환불 금액은 신청 시점으로 고정되며 관리자 검토 후 승인됩니다.
                        </p>
                      </div>
                    </details>
                    {item.cancelAtPeriodEnd ? (
                      <p className="text-xs font-semibold text-amber-700">
                        현재 기간({item.currentPeriodEndLabel})까지 이용 가능하며 이후 자동 만료됩니다.
                      </p>
                    ) : null}
                    {item.pendingRefundId ? (
                      <p className="text-xs font-semibold text-blue-700">잔여기간 환불 신청이 관리자 검토 대기 중입니다.</p>
                    ) : null}
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap lg:justify-end">
                    {item.canCancel ? (
                      <form action={requestSubscriptionCancelAtPeriodEndAction}>
                        <input type="hidden" name="subscriptionId" value={item.subscriptionId} />
                        <FormSubmitButton
                          idleLabel="다음 결제 중단"
                          pendingLabel="저장 중..."
                          className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-extrabold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                        />
                      </form>
                    ) : null}
                    {item.canUndoCancel ? (
                      <form action={undoSubscriptionCancelAtPeriodEndAction}>
                        <input type="hidden" name="subscriptionId" value={item.subscriptionId} />
                        <FormSubmitButton
                          idleLabel="구독 계속하기"
                          pendingLabel="저장 중..."
                          className="w-full rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-extrabold text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
                        />
                      </form>
                    ) : null}
                    {item.statusTone === "expired" || item.statusTone === "refunded" ? (
                      <Link
                        href={item.resubscribeHref}
                        className="rounded-xl bg-blue-600 px-4 py-2 text-center text-sm font-extrabold text-white hover:bg-blue-700"
                      >
                        재구독
                      </Link>
                    ) : (
                      <Link
                        href={`/support/refunds?subscriptionId=${encodeURIComponent(item.subscriptionId)}`}
                        className={`rounded-xl px-4 py-2 text-center text-sm font-extrabold ${
                          item.canRequestRefund
                            ? "bg-blue-600 text-white hover:bg-blue-700"
                            : "bg-slate-100 text-slate-400 pointer-events-none"
                        }`}
                        aria-disabled={!item.canRequestRefund}
                      >
                        환불 신청
                      </Link>
                    )}
                  </div>
                </div>
              </article>
            );
          })}

          {totalPages > 1 ? (
            <div className="flex items-center justify-center gap-2" aria-label="페이지 이동">
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold disabled:opacity-40"
              >
                이전
              </button>
              <span className="text-xs font-bold" aria-live="polite">
                <span className="text-[#2563EB]">{currentPage}</span>
                <span className="text-slate-400"> · {totalPages}</span>
              </span>
              <button
                type="button"
                disabled={currentPage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold disabled:opacity-40"
              >
                다음
              </button>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
