"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, Copy } from "lucide-react";
import {
  cancelPaysyncChargeAction,
  refreshPaysyncChargeAction,
} from "@/lib/paysync/paysyncChargeActions";
import { formatKoreanDate } from "@/lib/utils/formatDisplay";

export type PendingInvoiceProps = {
  localId: string;
  payKrw: number;
  cashKrw: number;
  bonusKrw: number;
  depositorName: string;
  status: "pending" | "paid" | "expired" | "canceled";
  expiresAt: string | null;
  bankName: string;
  accountNumber: string;
  accountHolder: string;
  notice?: string | null;
  credited?: string | null;
  error?: string | null;
};

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          },
          () => setCopied(false),
        );
      }}
      aria-label={`${label} 복사`}
      className="inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-lg border border-[#e2e8f2] bg-white px-3 py-1.5 text-xs font-extrabold text-slate-700 transition hover:border-[#cbd5e1]"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-[#047857]" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
      {copied ? "복사됨" : "복사"}
    </button>
  );
}

function Row({ label, value, copyValue }: { label: string; value: string; copyValue?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[#eef2f7] py-3 last:border-b-0">
      <span className="text-xs font-bold text-[#64748B]">{label}</span>
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate text-sm font-extrabold tabular-nums text-[#0f172a]">{value}</span>
        {copyValue ? <CopyButton value={copyValue} label={label} /> : null}
      </span>
    </div>
  );
}

export function PaysyncPendingView(props: PendingInvoiceProps) {
  const router = useRouter();
  const {
    localId, payKrw, cashKrw, bonusKrw, depositorName, status, expiresAt,
    bankName, accountNumber, accountHolder, notice, credited, error,
  } = props;

  // 입금 확인 폴링 — 웹훅이 도착하면 status 가 paid 로 바뀐다. 서버 컴포넌트를 다시
  // 가져오는 방식이라 별도 API 가 필요 없다. paid/취소 상태면 폴링하지 않는다.
  useEffect(() => {
    if (status !== "pending") return;
    const timer = setInterval(() => router.refresh(), 8_000);
    return () => clearInterval(timer);
  }, [status, router]);

  if (status === "paid") {
    return (
      <section className="rounded-2xl border border-[#a7f3d0] bg-[#ECFDF5] p-6 text-center">
        <p className="text-sm font-extrabold text-[#047857]">입금이 확인되었습니다</p>
        <p className="mt-2 text-2xl font-black tabular-nums text-[#0f172a]">
          {cashKrw.toLocaleString("ko-KR")}캐시 충전 완료
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Link href="/wallet/ledger" className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-[#2563EB] px-5 py-2.5 text-sm font-extrabold text-white transition hover:bg-[#1d4ed8]">
            캐시 내역 보기
          </Link>
          <Link href="/wallet/charge" className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-[#e2e8f2] bg-white px-5 py-2.5 text-sm font-extrabold text-slate-700 transition hover:border-[#cbd5e1]">
            충전 화면으로
          </Link>
        </div>
      </section>
    );
  }

  if (status !== "pending") {
    return (
      <section className="rounded-2xl border border-[#e2e8f2] bg-white p-6 text-center">
        <p className="text-sm font-extrabold text-slate-700">
          {status === "canceled" ? "취소된 입금 주문입니다." : "만료된 입금 주문입니다."}
        </p>
        <Link href="/wallet/charge" className="mt-5 inline-flex min-h-[44px] items-center justify-center rounded-xl bg-[#2563EB] px-5 py-2.5 text-sm font-extrabold text-white transition hover:bg-[#1d4ed8]">
          다시 충전하기
        </Link>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-[#e2e8f2] bg-white p-5 sm:p-6">
      <h2 className="flex items-center gap-2 text-base font-extrabold text-[#0f172a]">
        <span className="block h-4 w-[3px] shrink-0 rounded-sm bg-[#2563EB]" aria-hidden />
        아래 계좌로 입금해 주세요
      </h2>
      <p className="mt-1 text-xs font-medium leading-relaxed text-[#8a96a8]">
        입금이 확인되면 자동으로 캐시가 충전됩니다. 이 화면은 자동으로 갱신돼요.
      </p>

      <div className="mt-4 rounded-xl border border-[#e2e8f2] bg-[#F9FAFB] px-4 py-1">
        <Row label="은행" value={bankName} />
        <Row label="계좌번호" value={accountNumber} copyValue={accountNumber} />
        <Row label="예금주" value={accountHolder} />
        <Row label="입금 금액" value={`${payKrw.toLocaleString("ko-KR")}원`} copyValue={String(payKrw)} />
        <Row label="입금자명" value={depositorName} copyValue={depositorName} />
      </div>

      <p className="mt-3 rounded-xl border border-[#fcd34d] bg-[#fffbeb] px-4 py-3 text-xs font-bold leading-relaxed text-[#92400e]">
        입금자명과 금액이 위와 <span className="underline">정확히 일치</span>해야 자동 확인됩니다.
        하나라도 다르면 매칭되지 않아요.
      </p>

      <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
        <div className="rounded-xl border border-[#e2e8f2] px-4 py-3">
          <dt className="text-[11px] font-bold text-[#64748B]">지급 캐시</dt>
          <dd className="mt-1 font-extrabold tabular-nums text-[#0f172a]">
            {cashKrw.toLocaleString("ko-KR")}캐시
            {bonusKrw > 0 ? <span className="ml-1 text-xs font-extrabold text-[#047857]">(보너스 +{bonusKrw.toLocaleString("ko-KR")})</span> : null}
          </dd>
        </div>
        <div className="rounded-xl border border-[#e2e8f2] px-4 py-3">
          <dt className="text-[11px] font-bold text-[#64748B]">입금 마감</dt>
          <dd className="mt-1 font-extrabold text-[#0f172a]">
            {expiresAt ? formatKoreanDate(expiresAt) : "제한 없음"}
          </dd>
        </div>
      </dl>

      {credited ? (
        <p className="mt-4 rounded-xl border border-[#a7f3d0] bg-[#ECFDF5] px-4 py-3 text-sm font-bold text-[#047857]" role="status">{credited}</p>
      ) : null}
      {notice ? (
        <p className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700" role="status">{notice}</p>
      ) : null}
      {error ? (
        <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700" role="alert">{error}</p>
      ) : null}

      <div className="mt-5 flex flex-col gap-2 sm:flex-row">
        <form action={refreshPaysyncChargeAction} className="sm:flex-1">
          <input type="hidden" name="localId" value={localId} />
          <button
            type="submit"
            className="inline-flex min-h-[48px] w-full items-center justify-center rounded-xl border border-[#2563EB] bg-white px-5 py-3 text-sm font-extrabold text-[#1E429F] transition hover:bg-[#eef4ff]"
          >
            입금했는데 확인이 안 돼요
          </button>
        </form>
        <form action={cancelPaysyncChargeAction} className="sm:flex-1">
          <input type="hidden" name="localId" value={localId} />
          <button
            type="submit"
            className="inline-flex min-h-[48px] w-full items-center justify-center rounded-xl border border-[#e2e8f2] bg-white px-5 py-3 text-sm font-extrabold text-slate-700 transition hover:border-[#cbd5e1]"
          >
            주문 취소
          </button>
        </form>
      </div>
    </section>
  );
}
