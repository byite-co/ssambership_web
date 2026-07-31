"use client";

import { useMemo, useState, useTransition } from "react";
import { Landmark, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { updateMentorPayoutAccountAction } from "@/lib/mentor/mentorPayoutAccountActions";

const BANK_OPTIONS = [
  "KB국민은행",
  "신한은행",
  "우리은행",
  "하나은행",
  "NH농협은행",
  "IBK기업은행",
  "카카오뱅크",
  "토스뱅크",
  "케이뱅크",
  "SC제일은행",
  "씨티은행",
  "KDB산업은행",
  "수협은행",
  "신협",
  "새마을금고",
  "우체국",
] as const;

type Props = {
  bankName: string | null;
  accountNumber: string | null;
  editable: boolean;
};

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

export function MentorPayoutAccountPanel(props: Props) {
  const router = useRouter();
  const [bankName, setBankName] = useState(props.bankName ?? "");
  // W2(C11): props.accountNumber 는 마스킹 값(표시 전용) — 수정 입력은 빈칸에서 새로 입력한다.
  const [accountNumber, setAccountNumber] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [isPending, startTransition] = useTransition();

  const registered = Boolean(props.accountNumber && props.accountNumber.trim());
  const customBankOption = bankName && !BANK_OPTIONS.includes(bankName as (typeof BANK_OPTIONS)[number]) ? bankName : null;
  const displayLine = useMemo(() => {
    if (!registered) return "정산 계좌 미등록";
    const bank = (props.bankName ?? "은행").trim() || "은행";
    return `${bank} ${props.accountNumber}`;
  }, [props.accountNumber, props.bankName, registered]);

  function submit(formData: FormData) {
    setMessage(null);
    setIsError(false);
    startTransition(async () => {
      const result = await updateMentorPayoutAccountAction(formData);
      if (result.ok) {
        setMessage("정산 계좌를 저장했습니다.");
        router.refresh();
        return;
      }
      setIsError(true);
      setMessage(result.error);
    });
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#ECFDF5] text-[#059669]">
            <Landmark className="h-4 w-4" aria-hidden />
          </span>
          <div>
            <h2 className="text-sm font-extrabold text-slate-900">정산받을 계좌</h2>
            <p className="mt-1 text-sm font-bold text-slate-800">{displayLine}</p>
          </div>
        </div>
        <span
          className={[
            "rounded-lg border px-2 py-1 text-[11px] font-bold",
            registered ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-900",
          ].join(" ")}
        >
          {registered ? "등록됨" : "미등록"}
        </span>
      </div>

      <form action={submit} className="mt-4 grid gap-3 md:grid-cols-[180px_minmax(0,1fr)_auto] md:items-end">
        <label className="block text-xs font-bold text-slate-600">
          은행
          <select
            name="bankName"
            value={bankName}
            onChange={(e) => setBankName(e.target.value)}
            disabled={!props.editable || isPending}
            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 disabled:bg-slate-50 disabled:text-slate-400"
            required
          >
            <option value="">은행 선택</option>
            {customBankOption ? <option value={customBankOption}>{customBankOption}</option> : null}
            {BANK_OPTIONS.map((bank) => (
              <option key={bank} value={bank}>
                {bank}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-xs font-bold text-slate-600">
          계좌번호
          <input
            name="accountNumber"
            value={accountNumber}
            onChange={(e) => setAccountNumber(digitsOnly(e.target.value))}
            inputMode="numeric"
            autoComplete="off"
            disabled={!props.editable || isPending}
            placeholder="숫자만 입력"
            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 placeholder:text-slate-400 disabled:bg-slate-50 disabled:text-slate-400"
            required
          />
        </label>

        <button
          type="submit"
          disabled={!props.editable || isPending}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#059669] px-4 py-2 text-sm font-extrabold text-white hover:bg-[#047857] disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          <Save className="h-4 w-4" aria-hidden />
          {isPending ? "저장 중" : "계좌 변경"}
        </button>
      </form>

      {!props.editable ? (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs font-semibold text-amber-950">
          정산 계좌 저장 컬럼이 아직 적용되지 않았습니다.
        </p>
      ) : null}
      {message ? (
        <p className={[
          "mt-3 text-xs font-bold",
          isError ? "text-red-700" : "text-emerald-700",
        ].join(" ")}>{message}</p>
      ) : null}
    </section>
  );
}
