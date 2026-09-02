"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { applyCustomOrderDisputeSplitAdminAction } from "@/lib/admin/adminDisputeActions";
import type {
  AdminDisputeEscrowSplitFormProps,
  AdminDisputeEscrowSplitPanelState,
} from "@/lib/admin/adminDisputeEscrowSplitTypes";
import { formatCashKrw } from "@/lib/utils/formatDisplay";
import { SETTLEMENT_FEE_RATE_UNSET_LABEL, settlementFeeRateLabel } from "@/lib/payout/settlementFeeRate";

function clampWon(n: number, max: number): number {
  if (!Number.isFinite(n)) return 0;
  const v = Math.floor(n);
  if (v < 0) return 0;
  if (v > max) return max;
  return v;
}

/** 미리보기 산식은 RPC record_custom_order_dispute_split 과 동일(floor(gross×요율)) — 요율은 DB 정산 행 값만 쓴다. */
function mentorNetFromGrossWon(grossWon: number, feeRate: number): number {
  const g = Math.max(0, Math.floor(grossWon));
  const fee = Math.floor(g * feeRate);
  return g - fee;
}

function DisputeEscrowSplitForm(props: { form: AdminDisputeEscrowSplitFormProps }) {
  const hold = props.form.holdGrossWon;
  // PR-1b V-4: 요율은 DB 정산 행(form.feeRate)에서만 온다. 없으면 예상액을 계산하지 않고 '요율 미설정' 을 보인다.
  const feeRate = props.form.feeRate;
  const [mentorGross, setMentorGross] = useState(0);
  const [studentRefund, setStudentRefund] = useState(hold);
  const [lastEdited, setLastEdited] = useState<"mentor" | "student">("mentor");

  const mentorNet = useMemo(
    () => (feeRate == null ? null : mentorNetFromGrossWon(mentorGross, feeRate)),
    [mentorGross, feeRate]
  );
  const sumOk = mentorGross + studentRefund === hold;

  const onMentorChange = (raw: string) => {
    const parsed = raw.trim() === "" ? 0 : Number.parseInt(raw, 10);
    const next = clampWon(Number.isFinite(parsed) ? parsed : 0, hold);
    setMentorGross(next);
    setStudentRefund(hold - next);
    setLastEdited("mentor");
  };

  const onStudentChange = (raw: string) => {
    const parsed = raw.trim() === "" ? 0 : Number.parseInt(raw, 10);
    const next = clampWon(Number.isFinite(parsed) ? parsed : 0, hold);
    setStudentRefund(next);
    setMentorGross(hold - next);
    setLastEdited("student");
  };

  return (
    <form action={applyCustomOrderDisputeSplitAdminAction} className="mt-4 space-y-4 border-t border-amber-200/80 pt-4">
      <input type="hidden" name="disputeId" value={props.form.disputeId} />
      <input type="hidden" name="orderId" value={props.form.orderId} />
      <input type="hidden" name="mentorGrossWon" value={String(mentorGross)} />
      <input type="hidden" name="studentRefundWon" value={String(studentRefund)} />

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="dispute-split-mentor" className="block text-xs font-extrabold text-amber-950">
            멘토 배정 gross (원)
          </label>
          <p className="mt-0.5 text-[11px] text-amber-900/80">
            수수료 공제 전 멘토 몫. 입력 시 학생 환불이 자동 계산됩니다.
          </p>
          <input
            id="dispute-split-mentor"
            type="number"
            min={0}
            max={hold}
            step={1}
            inputMode="numeric"
            value={mentorGross}
            onChange={(e) => onMentorChange(e.target.value)}
            className="mt-1.5 w-full rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
          />
        </div>
        <div>
          <label htmlFor="dispute-split-student" className="block text-xs font-extrabold text-amber-950">
            학생 환불 (원)
          </label>
          <p className="mt-0.5 text-[11px] text-amber-900/80">
            수수료 없이 전액 반환. 입력 시 멘토 몫이 자동 계산됩니다.
          </p>
          <input
            id="dispute-split-student"
            type="number"
            min={0}
            max={hold}
            step={1}
            inputMode="numeric"
            value={studentRefund}
            onChange={(e) => onStudentChange(e.target.value)}
            className="mt-1.5 w-full rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
          />
        </div>
      </div>

      <div className="rounded-xl border border-amber-100 bg-white/80 p-3 text-xs text-amber-950">
        <p>
          <span className="font-extrabold">멘토 실수령 예상:</span>{" "}
          {mentorNet == null ? (
            <>
              <span className="font-bold text-red-700">{SETTLEMENT_FEE_RATE_UNSET_LABEL}</span> — 정산 행에 수수료율이 없어
              예상액을 계산하지 않습니다. 실제 분배는 RPC가 DB 요율로 집행합니다.
            </>
          ) : (
            <>
              {formatCashKrw(mentorNet, { unit: "원" })} (플랫폼 수수료 {settlementFeeRateLabel(feeRate)} 공제, gross{" "}
              {formatCashKrw(mentorGross, { unit: "원" })} 기준)
            </>
          )}
        </p>
        <p className="mt-1">
          <span className="font-extrabold">합계:</span> {formatCashKrw(mentorGross + studentRefund, { unit: "원" })} / 예치금{" "}
          {formatCashKrw(hold, { unit: "원" })}
          {sumOk ? (
            <span className="ml-1 font-bold text-emerald-700">일치</span>
          ) : (
            <span className="ml-1 font-bold text-red-700">불일치</span>
          )}
        </p>
        {lastEdited === "student" ? (
          <p className="mt-1 text-[11px] text-amber-800/90">마지막 입력: 학생 환불 → 멘토 몫 자동 보정</p>
        ) : (
          <p className="mt-1 text-[11px] text-amber-800/90">마지막 입력: 멘토 몫 → 학생 환불 자동 보정</p>
        )}
      </div>

      <button
        type="submit"
        disabled={!sumOk}
        className="rounded-lg bg-amber-800 px-4 py-2.5 text-xs font-extrabold text-white hover:bg-amber-900 disabled:cursor-not-allowed disabled:opacity-45"
      >
        예치 분배 실행
      </button>
      <p className="text-[11px] text-amber-900/85">
        제출 시 서버·RPC가 합계·상호 배타·권한을 다시 검증합니다. 실행 후 분쟁은 해결(resolved) 처리됩니다.
      </p>
    </form>
  );
}

export function DisputeEscrowSplitPanel(props: { panelState: AdminDisputeEscrowSplitPanelState }) {
  const st = props.panelState;

  if (st.kind === "unavailable") {
    return (
      <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <h2 className="text-sm font-extrabold text-slate-800">예치 분배</h2>
        <p className="mt-2 text-sm text-slate-600">{st.message}</p>
      </section>
    );
  }

  if (st.kind === "completed") {
    return (
      <section className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4">
        <h2 className="text-sm font-extrabold text-emerald-950">예치 분배 · 처리 완료</h2>
        <p className="mt-2 text-sm text-emerald-900">{st.message}</p>
        {st.orderId ? (
          <p className="mt-2 text-xs text-emerald-800">
            주문{" "}
            <Link
              href={`/custom-request/orders/${encodeURIComponent(st.orderId)}`}
              className="font-extrabold underline"
              prefetch={false}
            >
              작업방 보기
            </Link>
            {st.paymentStatus ? ` · 결제 상태 ${st.paymentStatus}` : null}
          </p>
        ) : null}
      </section>
    );
  }

  if (st.kind === "no_hold") {
    return (
      <section className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4">
        <h2 className="text-sm font-extrabold text-amber-950">예치 분배</h2>
        <p className="mt-2 text-sm text-amber-900">{st.message}</p>
        {st.orderId ? (
          <p className="mt-2 text-xs text-amber-800">
            주문 ID <code className="text-[10px]">{st.orderId}</code>
            {st.paymentStatus ? ` · 결제 ${st.paymentStatus}` : null}
          </p>
        ) : null}
      </section>
    );
  }

  const f = st.form;
  return (
    <section className="rounded-2xl border border-amber-300/80 bg-amber-50/50 p-4">
      <h2 className="text-sm font-extrabold text-amber-950">예치 분배 (에스크로)</h2>
      <p className="mt-1 text-xs text-amber-900/90">
        예치금 범위 내에서 멘토 gross·학생 환불을 나눕니다. 한쪽만 입력하면 다른 쪽이 자동 계산됩니다.
      </p>

      <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
        <div className="rounded-lg border border-amber-100 bg-white/90 px-3 py-2">
          <dt className="font-bold text-slate-500">예치금 (hold gross)</dt>
          <dd className="mt-0.5 text-base font-extrabold text-amber-950">{formatCashKrw(f.holdGrossWon, { unit: "원" })}</dd>
        </div>
        <div className="rounded-lg border border-amber-100 bg-white/90 px-3 py-2">
          <dt className="font-bold text-slate-500">결제 상태</dt>
          <dd className="mt-0.5 font-bold text-slate-900">{f.paymentStatus}</dd>
        </div>
        <div className="rounded-lg border border-amber-100 bg-white/90 px-3 py-2">
          <dt className="font-bold text-slate-500">정산 상태</dt>
          <dd className="mt-0.5 font-bold text-slate-900">{f.settlementStatus ?? "—"}</dd>
        </div>
        <div className="rounded-lg border border-amber-100 bg-white/90 px-3 py-2">
          <dt className="font-bold text-slate-500">주문</dt>
          <dd className="mt-0.5">
            <Link
              href={`/custom-request/orders/${encodeURIComponent(f.orderId)}`}
              className="font-extrabold text-indigo-800 underline"
              prefetch={false}
            >
              작업방 열기
            </Link>
          </dd>
        </div>
      </dl>

      <DisputeEscrowSplitForm form={f} />
    </section>
  );
}
