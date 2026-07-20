"use client";

import Link from "next/link";
import { UserSearch } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { ActiveSubscriptionCard } from "@/lib/mypage/studentActiveSubscriptions";

type FetchState =
  | { phase: "loading" }
  | { phase: "ok"; items: ActiveSubscriptionCard[] }
  | { phase: "error"; message: string };

function SubscriptionCardSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-slate-100 bg-slate-50/80 p-4">
      <div className="flex gap-3">
        <div className="h-12 w-12 shrink-0 rounded-xl bg-slate-200" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="h-4 w-32 rounded bg-slate-200" />
          <div className="h-3 w-24 rounded bg-slate-200" />
          <div className="h-3 w-40 rounded bg-slate-200" />
        </div>
      </div>
    </div>
  );
}

function subscriptionStatusBadgeClass(tone: ActiveSubscriptionCard["statusTone"]): string {
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

/** 카드 hover 시 테두리 색 — 배지 색 매핑과 동일 계열로 통일(회색 배경 hover 대신). */
function subscriptionHoverBorderClass(tone: ActiveSubscriptionCard["statusTone"]): string {
  switch (tone) {
    case "active":
      return "hover:border-blue-400";
    case "scheduled":
    case "pastDue":
      return "hover:border-amber-400";
    case "expired":
    case "refunded":
    case "neutral":
    default:
      return "hover:border-slate-300";
  }
}

function SubscriptionRow({ item }: { item: ActiveSubscriptionCard }) {
  return (
    <article
      className={`rounded-2xl border border-[#e2e8f2] bg-white p-5 transition-[box-shadow,border-color] duration-150 ${subscriptionHoverBorderClass(
        item.statusTone,
      )} hover:shadow-[0_2px_8px_rgba(0,0,0,0.09)]`}
    >
      <div className="flex gap-4 sm:gap-5">
        <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl border border-white bg-white shadow-sm">
          {item.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.photoUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div
              className="flex h-full w-full items-center justify-center bg-blue-100 text-sm font-black text-blue-800"
              aria-hidden
            >
              {item.mentorInitial}
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-base font-extrabold text-slate-900">{item.mentorName}</h3>
            <span
              className={`rounded-full border px-2.5 py-1 text-[11px] font-extrabold ${subscriptionStatusBadgeClass(item.statusTone)}`}
            >
              {item.statusLabel}
            </span>
          </div>
          <p className="mt-1 text-sm font-bold text-[#2563EB]">{item.planLabel}</p>
          <dl className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
            <div>
              <dt className="font-semibold text-slate-500">현재 기간</dt>
              <dd className="mt-0.5 font-bold text-slate-900">{item.currentPeriodLabel}</dd>
            </div>
            <div>
              <dt className="font-semibold text-slate-500">다음 결제</dt>
              <dd className="mt-0.5 font-bold text-slate-900">{item.nextBillingDisplayLabel}</dd>
            </div>
            <div>
              <dt className="font-semibold text-slate-500">남은 질문</dt>
              <dd className="mt-0.5 font-bold text-slate-900">{item.questionsRemainingLabel}</dd>
            </div>
            <div>
              <dt className="font-semibold text-slate-500">질문 리셋</dt>
              <dd className="mt-0.5 font-bold text-slate-900">{item.weeklyResetLabel}</dd>
            </div>
          </dl>
        </div>
      </div>
      <Link
        href={`/question-room?mentorId=${encodeURIComponent(item.mentorId)}`}
        className="mt-4 inline-flex min-h-[40px] w-full items-center justify-center rounded-xl bg-[#2563EB] px-4 text-sm font-bold text-white transition hover:bg-[#1d4ed8] sm:w-auto"
      >
        질문하러 가기
      </Link>
    </article>
  );
}

function Toast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div
      role="alert"
      className="fixed bottom-6 right-6 z-50 flex max-w-sm items-start gap-3 rounded-xl border border-red-200 bg-red-950 px-4 py-3 text-sm font-semibold text-white shadow-lg"
    >
      <span className="flex-1">{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 rounded-lg px-2 py-0.5 text-xs font-bold text-red-200 hover:bg-red-900"
        aria-label="닫기"
      >
        닫기
      </button>
    </div>
  );
}

export function MypageSubscriptionsCard() {
  const [state, setState] = useState<FetchState>({ phase: "loading" });
  const [toast, setToast] = useState<string | null>(null);

  // 순수 fetch(설정 없음)와 결과 반영을 분리 — effect 본문에서 동기 setState 없이(await 이후에만) 반영.
  const fetchSnapshot = useCallback(async (): Promise<Exclude<FetchState, { phase: "loading" }>> => {
    try {
      const res = await fetch("/api/mypage/active-subscriptions", { cache: "no-store" });
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean;
        items?: ActiveSubscriptionCard[];
        error?: string;
      } | null;

      if (!res.ok || !body?.ok) {
        return {
          phase: "error",
          message: body?.error ?? "구독 현황을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
        };
      }
      return { phase: "ok", items: body.items ?? [] };
    } catch {
      return { phase: "error", message: "구독 현황을 불러오지 못했습니다. 네트워크 연결을 확인해 주세요." };
    }
  }, []);

  const applyResult = useCallback((result: Exclude<FetchState, { phase: "loading" }>) => {
    setState(result);
    if (result.phase === "error") setToast(result.message);
  }, []);

  // 재시도 버튼용(로딩 상태 동기 표시 포함). effect 본문에서는 직접 호출하지 않는다.
  const load = useCallback(async () => {
    setState({ phase: "loading" });
    applyResult(await fetchSnapshot());
  }, [applyResult, fetchSnapshot]);

  useEffect(() => {
    // 초기 로드 — state 초기값이 loading 이라 동기 setState 불필요, 반영은 await 이후.
    let cancelled = false;
    (async () => {
      const result = await fetchSnapshot();
      if (!cancelled) applyResult(result);
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchSnapshot, applyResult]);

  return (
    <section className="rounded-2xl border border-slate-300 bg-white p-5 sm:p-6 shadow-[0_1px_4px_rgba(0,0,0,0.05)]">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-base font-extrabold text-[#0f172a]">
            <span className="block h-4 w-[3px] shrink-0 rounded-sm bg-[#2563EB]" aria-hidden />
            구독 현황
          </h2>
          <p className="mt-1 text-xs font-medium leading-relaxed text-[#8a96a8]">활성 구독 중인 멘토와 질문 한도를 확인하세요.</p>
        </div>
        {state.phase === "error" ? (
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-lg border border-[#e2e8f2] px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
          >
            다시 시도
          </button>
        ) : null}
      </div>

      <div className="mt-4 space-y-3">
        {state.phase === "loading" ? (
          <>
            <SubscriptionCardSkeleton />
            <SubscriptionCardSkeleton />
          </>
        ) : state.phase === "error" ? (
          <p className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-800">
            {state.message}
          </p>
        ) : state.items.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[#e2e8f2] bg-white px-6 py-12 text-center">
            <UserSearch className="h-12 w-12 text-slate-400" strokeWidth={1.5} aria-hidden />
            <h3 className="mt-4 text-base font-black text-slate-900">아직 구독 중인 멘토가 없어요</h3>
            <p className="mt-2 text-sm font-medium text-slate-600">나에게 맞는 멘토를 찾아 구독해보세요.</p>
            <Link
              href="/mentors"
              className="mt-6 inline-flex min-h-[44px] items-center justify-center rounded-xl bg-[#2563EB] px-5 text-sm font-extrabold text-white hover:bg-[#1d4ed8]"
            >
              멘토 찾기
            </Link>
          </div>
        ) : (
          state.items.map((item) => <SubscriptionRow key={item.subscriptionId} item={item} />)
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href="/subscriptions"
          className="rounded-xl border border-[#e2e8f2] bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
        >
          구독 관리
        </Link>
        <Link
          href="/mentors"
          className="rounded-xl border border-[#e2e8f2] bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
        >
          멘토 찾기
        </Link>
      </div>

      {toast ? <Toast message={toast} onDismiss={() => setToast(null)} /> : null}
    </section>
  );
}
