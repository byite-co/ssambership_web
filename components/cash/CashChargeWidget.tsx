"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { loadTossPayments } from "@tosspayments/tosspayments-sdk";
import { CASH_CHARGE_PACKAGES } from "@/lib/cash/chargePackages";

type PaymentMethod = "card" | "easy" | "bank";

// 결제 시각 기반 주문번호 — 이벤트 핸들러에서만 호출된다(렌더 비의존).
function buildChargeOrderId(userId: string): string {
  return `cash-${userId}-${Date.now()}`;
}

type Props = {
  userId: string;
  currentBalance: number;
  isAuthenticated?: boolean;
};

export function CashChargeWidget({ userId, currentBalance }: Props) {
  const [selectedPayKrw, setSelectedPayKrw] = useState<number>(CASH_CHARGE_PACKAGES[0].payKrw);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("card");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const selected = CASH_CHARGE_PACKAGES.find((p) => p.payKrw === selectedPayKrw) ?? CASH_CHARGE_PACKAGES[0];
  const projectedBalance = currentBalance + selected.cashKrw;

  async function handleCharge() {
    if (paymentMethod !== "card") {
      setError(null);
      setInfo("준비 중인 결제 수단입니다. 현재는 신용/체크카드만 이용할 수 있어요.");
      return;
    }

    const clientKey = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY;
    if (!clientKey) {
      setInfo(null);
      setError("결제 설정이 준비되지 않았습니다. 잠시 후 다시 시도해 주세요.");
      return;
    }

    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      const tossPayments = await loadTossPayments(clientKey);
      const payment = tossPayments.payment({ customerKey: userId });
      await payment.requestPayment({
        method: "CARD",
        amount: { currency: "KRW", value: selected.payKrw },
        orderId: buildChargeOrderId(userId),
        orderName: `쌤버십 캐시 ${selected.cashKrw.toLocaleString("ko-KR")}캐시 충전`,
        successUrl: `${window.location.origin}/wallet/charge/success`,
        failUrl: `${window.location.origin}/wallet/charge/fail`,
        card: {
          useEscrow: false,
          flowMode: "DEFAULT",
          useCardPoint: false,
          useAppCardOnly: false,
        },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/cancel|취소|USER_CANCEL/i.test(msg)) {
        setInfo(null);
        setError("결제창을 열지 못했습니다. 잠시 후 다시 시도해 주세요.");
      }
    } finally {
      setLoading(false);
    }
  }

  const payMethods: { id: PaymentMethod; label: string; ready: boolean }[] = [
    { id: "card", label: "신용/체크카드", ready: true },
    { id: "easy", label: "간편결제", ready: false },
    { id: "bank", label: "무통장입금", ready: false },
  ];

  function selectPaymentMethod(m: (typeof payMethods)[number]) {
    if (!m.ready) {
      setError(null);
      setInfo("준비 중인 결제 수단입니다. 현재는 신용/체크카드만 이용할 수 있어요.");
      return;
    }
    setPaymentMethod(m.id);
    setInfo(null);
    setError(null);
  }

  return (
    <section className="rounded-2xl border border-[#e2e8f2] bg-white p-5 sm:p-6">
      <div>
        <h2 className="flex items-center gap-2 text-base font-extrabold text-[#0f172a]">
          <span className="block h-4 w-[3px] shrink-0 rounded-sm bg-[#2563EB]" aria-hidden />
          충전 금액 선택
        </h2>
        <p className="mt-1 text-xs font-medium leading-relaxed text-[#8a96a8]">필요한 금액을 선택하면 보너스와 예상 잔액을 바로 확인할 수 있어요.</p>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {CASH_CHARGE_PACKAGES.map((pkg) => {
            const active = selectedPayKrw === pkg.payKrw;
            return (
              <li key={pkg.payKrw}>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => {
                    setSelectedPayKrw(pkg.payKrw);
                    setError(null);
                    setInfo(null);
                  }}
                  className={`relative flex min-h-[100px] w-full flex-col items-start rounded-2xl border p-4 text-left transition ${
                    active
                      ? "border-[#2563EB] bg-[#eef4ff]"
                      : "border-[#e2e8f2] bg-white hover:border-[#cbd5e1]"
                  }`}
                >
                  {active ? (
                    <span className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-[#2563EB] text-white">
                      <Check className="h-4 w-4" strokeWidth={3} aria-hidden />
                    </span>
                  ) : null}
                  <span className="text-base font-black text-slate-900">
                    {pkg.payKrw.toLocaleString("ko-KR")}원
                  </span>
                  <span className="mt-1 text-sm font-bold text-slate-700">
                    → {pkg.cashKrw.toLocaleString("ko-KR")}캐시
                  </span>
                  {pkg.bonusKrw > 0 ? (
                    <span className="mt-1 text-xs font-extrabold text-[#047857]">
                      보너스 +{pkg.bonusKrw.toLocaleString("ko-KR")}캐시
                      {pkg.bonusPercentLabel ? ` (${pkg.bonusPercentLabel})` : ""}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <hr className="my-5 border-0 border-t border-[#e2e8f2]" />

      <div>
        <h2 className="flex items-center gap-2 text-base font-extrabold text-[#0f172a]">
          <span className="block h-4 w-[3px] shrink-0 rounded-sm bg-[#2563EB]" aria-hidden />
          결제 수단
        </h2>
        <div className="mt-4 flex flex-wrap gap-2">
          {payMethods.filter((m) => m.ready).map((m) => {
            const active = paymentMethod === m.id;
            return (
              <button
                key={m.id}
                type="button"
                disabled={loading}
                aria-disabled={!m.ready}
                onClick={() => selectPaymentMethod(m)}
                className={[
                  "relative inline-flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-bold transition",
                  m.ready
                    ? active
                      ? "border-[#2563EB] bg-[#eef4ff] text-[#0f172a]"
                      : "border-[#e2e8f2] bg-white text-slate-700 hover:border-[#cbd5e1]"
                    : "cursor-not-allowed border-[#e2e8f2] bg-slate-50 text-slate-400 opacity-70",
                ].join(" ")}
              >
                <span>{m.label}</span>
                {!m.ready ? (
                  <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-slate-600">
                    준비 중
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      <hr className="my-5 border-0 border-t border-[#e2e8f2]" />

      <div>
        <h2 className="flex items-center gap-2 text-base font-extrabold text-[#0f172a]">
          <span className="block h-4 w-[3px] shrink-0 rounded-sm bg-[#2563EB]" aria-hidden />
          충전 후 예상 잔액
        </h2>
        <div className="mt-4">
          <p className="text-sm text-slate-600">
          {selected.payKrw.toLocaleString("ko-KR")}원 결제
          {selected.bonusKrw > 0 ? (
            <>
              {" "}
              + 보너스 <span className="font-bold">{selected.bonusKrw.toLocaleString("ko-KR")}캐시</span>
            </>
          ) : null}{" "}
          = 지급 <span className="font-bold">{selected.cashKrw.toLocaleString("ko-KR")}캐시</span>
          </p>
          <p className="mt-2 text-3xl font-black tabular-nums text-[#2563EB]">
          {projectedBalance.toLocaleString("ko-KR")}캐시
          </p>
        </div>
      </div>

      {info ? (
        <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700" role="status">
          {info}
        </p>
      ) : null}

      {error ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700" role="alert">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        disabled={loading || paymentMethod !== "card"}
        onClick={() => void handleCharge()}
        className="inline-flex min-h-[52px] w-full items-center justify-center rounded-xl bg-[#2563EB] px-5 py-3.5 text-base font-extrabold text-white transition hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? "결제창 여는 중…" : "캐시 충전하기"}
      </button>
    </section>
  );
}
