"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { SubscribePlanCatalogItem } from "@/lib/subscribe/subscribePlanCatalog";
import type { SubscribePlanTier } from "@/lib/subscribe/subscribePageQueries";

export type SubscribePlanOption = SubscribePlanCatalogItem & {
  planId: string | null;
  /** 웹 PR-2 §4: 전체 멘토 평균가 안내("전체 멘토 평균 N원 / 월" · 표본 부족 "최저 N원부터") — 결제 금액 아님. null = 표시 안 함 */
  priceGuideLabel?: string | null;
};

type Props = {
  mentorId: string;
  plans: SubscribePlanOption[];
  currentBalanceCash: number;
  /** cap 마감으로 구독 불가한 tier 목록 (수치는 학생에 노출 안 함) */
  closedTiers?: SubscribePlanTier[];
};

function fmtCash(n: number): string {
  return `${n.toLocaleString("ko-KR")}캐시`;
}

export function SubscribeCheckoutClient(props: Props) {
  const { mentorId, plans, currentBalanceCash } = props;
  const closedTiers = useMemo(() => new Set(props.closedTiers ?? []), [props.closedTiers]);
  const allClosed = plans.length > 0 && plans.every((p) => closedTiers.has(p.tier));
  const router = useRouter();
  const defaultTier =
    plans.find((p) => !closedTiers.has(p.tier) && p.recommend)?.tier ??
    plans.find((p) => !closedTiers.has(p.tier))?.tier ??
    plans.find((p) => p.recommend)?.tier ??
    plans[0]?.tier ??
    "standard";
  const [selectedTier, setSelectedTier] = useState<SubscribePlanTier>(defaultTier);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(
    () => plans.find((p) => p.tier === selectedTier) ?? plans[0],
    [plans, selectedTier],
  );

  if (!selected) {
    return (
      <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        이 멘토의 구독 플랜을 불러오지 못했습니다.
      </p>
    );
  }

  const selectedClosed = closedTiers.has(selected.tier);
  const insufficient = currentBalanceCash < selected.cashKrw;
  const amountCents = selected.cashKrw * 100;

  async function handleSubscribe() {
    if (closedTiers.has(selected.tier)) {
      setError("이 멘토는 현재 구독이 마감되었습니다. 다른 멘토를 찾아보거나 잠시 후 다시 시도해 주세요.");
      return;
    }
    if (currentBalanceCash < selected.cashKrw) {
      setError("캐시가 부족합니다. 충전하러 가기");
      return;
    }

    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/subscribe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mentorId,
          planId: selected.planId,
          planTier: selected.tier,
          amountCents,
        }),
      });

      const body = (await res.json().catch(() => null)) as {
        ok?: boolean;
        message?: string;
        error?: string;
      } | null;

      if (!res.ok) {
        const msg = body?.message ?? "구독 처리에 실패했습니다. 잠시 후 다시 시도해 주세요.";
        setError(msg);
        return;
      }

      const q = new URLSearchParams({
        mentorId,
        planTier: selected.tier,
      });
      router.push(`/subscribe/success?${q.toString()}`);
    } catch {
      setError("구독 처리에 실패했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-black text-slate-900">플랜 선택</h2>
        <p className="mt-1 text-sm text-slate-500">플랜을 고른 뒤 구독하기를 누르면 캐시가 차감됩니다.</p>
      </div>

      {allClosed ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          <p className="font-bold">이 멘토는 현재 구독이 마감되었습니다.</p>
          <p className="mt-1">프로필 열람과 찜하기는 계속 가능해요. 다른 멘토를 찾아보세요.</p>
          <Link href="/mentors" className="mt-2 inline-block font-bold text-blue-700 hover:underline">
            멘토 찾기 &rarr;
          </Link>
        </div>
      ) : null}

      <ul className="grid gap-4 md:grid-cols-3">
        {plans.map((plan) => {
          const active = selectedTier === plan.tier;
          const planClosed = closedTiers.has(plan.tier);
          return (
            <li key={plan.tier}>
              <button
                type="button"
                disabled={loading || planClosed}
                onClick={() => {
                  if (planClosed) return;
                  setSelectedTier(plan.tier);
                  setError(null);
                }}
                className={`relative flex h-full w-full flex-col rounded-2xl border p-5 text-left transition-colors ${
                  planClosed
                    ? "cursor-not-allowed border-slate-200 bg-slate-50 opacity-60"
                    : active
                      ? "border-blue-600 bg-blue-50/80 ring-2 ring-blue-600"
                      : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                {plan.recommend && !planClosed ? (
                  <span className="absolute -top-2.5 right-3 rounded-full bg-blue-600 px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-white">
                    추천
                  </span>
                ) : null}
                {planClosed ? (
                  <span className="absolute -top-2.5 right-3 rounded-full bg-slate-400 px-2.5 py-0.5 text-[10px] font-extrabold tracking-wide text-white">
                    구독 마감
                  </span>
                ) : null}
                <p className="text-sm font-extrabold uppercase tracking-wide text-slate-500">{plan.label}</p>
                <p className="mt-2 text-2xl font-black tabular-nums text-slate-900">{fmtCash(plan.cashKrw)}</p>
                <p className="mt-1 text-xs text-slate-500">/ 월</p>
                {plan.priceGuideLabel ? (
                  <p className="mt-1 text-[11px] font-semibold text-slate-400">{plan.priceGuideLabel}</p>
                ) : null}
                <p className="mt-3 text-sm font-semibold text-slate-700">{plan.weeklyLabel}</p>
              </button>
            </li>
          );
        })}
      </ul>

      {insufficient ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <p className="font-bold">캐시가 부족합니다.</p>
          <p className="mt-1">
            선택한 플랜은 {fmtCash(selected.cashKrw)}가 필요합니다. 현재 잔액 {fmtCash(currentBalanceCash)}.
          </p>
          <Link href="/wallet/charge" className="mt-2 inline-block font-bold text-blue-700 hover:underline">
            충전하러 가기 &rarr;
          </Link>
        </div>
      ) : null}

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-800" role="alert">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        disabled={loading || insufficient || selectedClosed}
        onClick={() => void handleSubscribe()}
        className="min-h-[52px] w-full max-w-md rounded-xl bg-blue-600 px-6 py-3 text-base font-bold text-white shadow-sm hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? "구독 처리 중..." : selectedClosed ? "구독 마감" : `${selected.label} 구독하기`}
      </button>
      <p className="text-xs text-slate-500">구독하기를 누르면 캐시 잔액에서 즉시 차감됩니다.</p>
    </div>
  );
}
