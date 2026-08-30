"use client";

import { useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { loadTossPayments } from "@tosspayments/tosspayments-sdk";
import { CASH_CHARGE_PACKAGES } from "@/lib/cash/chargePackages";
import { requestPaysyncChargeAction } from "@/lib/paysync/paysyncChargeActions";
// 순수 모듈(env 미접근) — 클라·서버가 같은 입금자명 규칙을 쓴다.
import { DEPOSITOR_NAME_ERROR, isValidDepositorName } from "@/lib/paysync/depositorName";
import { CASH_RECEIPT_PHONE_ERROR, isValidReceiptPhone } from "@/lib/paysync/cashReceipt";
// 순수 모듈(env 미접근) — 게이트 고정 문구는 서버 코어와 단일 소스를 공유한다.
import { CONFIRM_ERROR_MESSAGES } from "@/lib/toss/tossTopupCore";

type PaymentMethod = "card" | "easy" | "bank";

// 결제 시각 기반 주문번호 — 이벤트 핸들러에서만 호출된다(렌더 비의존).
function buildChargeOrderId(userId: string): string {
  return `cash-${userId}-${Date.now()}`;
}

type Props = {
  userId: string;
  currentBalance: number;
  isAuthenticated?: boolean;
  /** 토스 심사 게이트 — 서버에서 판정한 값. false 면 카드 수단을 아예 렌더하지 않는다. */
  tossEnabled: boolean;
  /** 본인인증 실명 기반 기본 입금자명. 규칙(1~5자·공백 불가)에 맞지 않으면 빈 문자열. */
  defaultDepositorName?: string;
  /** 진행 중인 무통장 주문의 로컬 id. 있으면 새 주문 대신 그 안내로 보낸다. */
  pendingInvoiceId?: string | null;
};

export function CashChargeWidget({
  userId,
  currentBalance,
  tossEnabled,
  defaultDepositorName = "",
  pendingInvoiceId = null,
}: Props) {
  const [selectedPayKrw, setSelectedPayKrw] = useState<number>(CASH_CHARGE_PACKAGES[0].payKrw);
  // 일반 계정의 기본 수단은 무통장입금이다(§5). 심사 allowlist 계정만 카드가 기본.
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(tossEnabled ? "card" : "bank");
  const [depositorName, setDepositorName] = useState<string>(defaultDepositorName);
  const [depositorTouched, setDepositorTouched] = useState(false);
  const [receiptRequested, setReceiptRequested] = useState(false);
  const [receiptPhone, setReceiptPhone] = useState("");
  const [receiptTouched, setReceiptTouched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const selected = CASH_CHARGE_PACKAGES.find((p) => p.payKrw === selectedPayKrw) ?? CASH_CHARGE_PACKAGES[0];
  const projectedBalance = currentBalance + selected.cashKrw;

  async function handleCharge() {
    // 서버 게이트(confirm)와 동일 판정 — 비허용 계정은 결제창 자체를 열지 않는다.
    if (!tossEnabled) {
      setInfo(null);
      setError(CONFIRM_ERROR_MESSAGES.toss_not_allowed);
      return;
    }
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
    // 토스 심사 게이트: 비허용 계정에는 카드 수단을 아예 렌더하지 않는다(숨김 아님, 미렌더).
    ...(tossEnabled ? [{ id: "card" as const, label: "신용/체크카드", ready: true }] : []),
    { id: "bank", label: "무통장입금", ready: true },
    { id: "easy", label: "간편결제", ready: false },
  ];
  const renderedMethods = payMethods.filter((m) => m.ready);

  const bankSelected = paymentMethod === "bank";
  const depositorInvalid = bankSelected && depositorTouched && !isValidDepositorName(depositorName);
  const receiptInvalid = receiptRequested && receiptTouched && !isValidReceiptPhone(receiptPhone);
  // 현금영수증을 신청했는데 번호가 유효하지 않으면 발급을 막는다 — 그대로 보내면
  // 주문 발급 자체가 422 로 실패해 충전이 통째로 막힌다.
  const bankSubmitBlocked =
    !isValidDepositorName(depositorName) ||
    (receiptRequested && !isValidReceiptPhone(receiptPhone)) ||
    Boolean(pendingInvoiceId);

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
        {/* 토스 게이트 안내 — 비허용 계정에는 카드가 왜 없는지 항상 알린다.
            무통장입금이 열려도 이 문구는 유지된다(문구 단일 소스: CONFIRM_ERROR_MESSAGES). */}
        {!tossEnabled ? (
          <p className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700" role="status">
            {CONFIRM_ERROR_MESSAGES.toss_not_allowed}
          </p>
        ) : null}
        {renderedMethods.length === 0 ? null : (
        <div className="mt-4 flex flex-wrap gap-2">
          {renderedMethods.map((m) => {
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
        )}
      </div>

      {bankSelected ? (
        <>
          <hr className="my-5 border-0 border-t border-[#e2e8f2]" />
          <div>
            <h2 className="flex items-center gap-2 text-base font-extrabold text-[#0f172a]">
              <span className="block h-4 w-[3px] shrink-0 rounded-sm bg-[#2563EB]" aria-hidden />
              입금자명
            </h2>
            <p className="mt-1 text-xs font-medium leading-relaxed text-[#8a96a8]">
              실제로 이체할 때 찍히는 이름과 똑같이 입력해 주세요.
            </p>

            <label htmlFor="paysync-depositor-name" className="sr-only">
              입금자명
            </label>
            <input
              id="paysync-depositor-name"
              type="text"
              inputMode="text"
              autoComplete="name"
              maxLength={5}
              value={depositorName}
              onChange={(e) => {
                setDepositorName(e.target.value);
                setError(null);
              }}
              onBlur={() => setDepositorTouched(true)}
              aria-invalid={depositorInvalid}
              aria-describedby="paysync-depositor-help"
              placeholder="예: 홍길동"
              className={[
                "mt-3 block w-full rounded-xl border px-4 py-3 text-sm font-bold text-[#0f172a] transition",
                "focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30",
                depositorInvalid ? "border-[#DC2626] bg-[#fef2f2]" : "border-[#e2e8f2] bg-white",
              ].join(" ")}
            />

            <p id="paysync-depositor-help" className="mt-2 text-xs font-bold leading-relaxed text-[#D97706]">
              입금자명이 다르면 자동 확인이 되지 않아요. 금액도 안내와 정확히 일치해야 합니다.
            </p>
            {depositorInvalid ? (
              <p className="mt-1 text-xs font-bold text-[#DC2626]" role="alert">
                {DEPOSITOR_NAME_ERROR}
              </p>
            ) : null}

            {/* 현금영수증(소득공제) — 선택 사항. 발행 결과는 별도 이벤트로 오지 않아
                우리가 상태를 추적하지 않는다(페이싱크 대시보드에서 확인). */}
            <div className="mt-4 rounded-xl border border-[#e2e8f2] bg-[#F9FAFB] p-4">
              <label className="flex items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={receiptRequested}
                  onChange={(e) => {
                    setReceiptRequested(e.target.checked);
                    setError(null);
                  }}
                  className="h-4 w-4 shrink-0 rounded border-[#cbd5e1] text-[#2563EB] focus:ring-[#2563EB]/30"
                />
                <span className="text-sm font-bold text-[#0f172a]">현금영수증 신청 (소득공제용)</span>
              </label>

              {receiptRequested ? (
                <>
                  <label htmlFor="paysync-receipt-phone" className="sr-only">
                    현금영수증 휴대폰 번호
                  </label>
                  <input
                    id="paysync-receipt-phone"
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel"
                    value={receiptPhone}
                    onChange={(e) => {
                      setReceiptPhone(e.target.value);
                      setError(null);
                    }}
                    onBlur={() => setReceiptTouched(true)}
                    aria-invalid={receiptInvalid}
                    placeholder="휴대폰 번호 (하이픈 없이)"
                    className={[
                      "mt-3 block w-full rounded-xl border px-4 py-3 text-sm font-bold tabular-nums text-[#0f172a] transition",
                      "focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30",
                      receiptInvalid ? "border-[#DC2626] bg-[#fef2f2]" : "border-[#e2e8f2] bg-white",
                    ].join(" ")}
                  />
                  {receiptInvalid ? (
                    <p className="mt-1 text-xs font-bold text-[#DC2626]" role="alert">
                      {CASH_RECEIPT_PHONE_ERROR}
                    </p>
                  ) : null}
                </>
              ) : null}
            </div>
          </div>
        </>
      ) : null}

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

      {/* 진행 중 주문이 있으면 새로 만들지 않는다 — 같은 사람 앞 미결제 주문이 여러 개면
          어느 것에 매칭될지 모호해진다(§5 본인 pending 재사용). */}
      {bankSelected && pendingInvoiceId ? (
        <div className="rounded-xl border border-[#fcd34d] bg-[#fffbeb] px-4 py-3">
          <p className="text-sm font-bold text-[#92400e]">진행 중인 입금 주문이 있어요.</p>
          <p className="mt-1 text-xs font-medium leading-relaxed text-[#a16207]">
            새 주문을 만들지 않고 기존 안내로 이동합니다. 취소한 뒤 다시 요청할 수 있어요.
          </p>
          <Link
            href={`/wallet/charge/pending?id=${encodeURIComponent(pendingInvoiceId)}`}
            className="mt-3 inline-flex min-h-[44px] items-center justify-center rounded-xl border border-[#2563EB] bg-white px-4 py-2.5 text-sm font-extrabold text-[#1E429F] transition hover:bg-[#eef4ff]"
          >
            입금 안내 보기
          </Link>
        </div>
      ) : null}

      {bankSelected ? (
        // 무통장입금 — 서버 액션이 주문을 발급하고 입금 안내 화면으로 보낸다.
        <form action={requestPaysyncChargeAction}>
          <input type="hidden" name="payKrw" value={selected.payKrw} />
          <input type="hidden" name="depositorName" value={depositorName} />
          <input type="hidden" name="cashReceiptRequested" value={receiptRequested ? "1" : "0"} />
          <input type="hidden" name="cashReceiptPhone" value={receiptRequested ? receiptPhone : ""} />
          <button
            type="submit"
            disabled={loading || bankSubmitBlocked}
            className="inline-flex min-h-[52px] w-full items-center justify-center rounded-xl bg-[#2563EB] px-5 py-3.5 text-base font-extrabold text-white transition hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-50"
          >
            캐시 충전하기
          </button>
        </form>
      ) : (
        <button
          type="button"
          disabled={loading || !tossEnabled || paymentMethod !== "card"}
          onClick={() => void handleCharge()}
          className="inline-flex min-h-[52px] w-full items-center justify-center rounded-xl bg-[#2563EB] px-5 py-3.5 text-base font-extrabold text-white transition hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "결제창 여는 중…" : "캐시 충전하기"}
        </button>
      )}
    </section>
  );
}
