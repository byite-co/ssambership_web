"use client";

/**
 * 분쟁 상세 — 예치금(에스크로) 자금 조치 3종(PR-6 §2-4): 학생 전액 환불 · 예치금 분할 · 멘토 지급. 전부 `critical`.
 *
 * - 세 조치는 **같은 서버 액션 한 경로**(`applyCustomOrderDisputeSplitAdminAction` → RPC `record_custom_order_dispute_split`)이고 금액만 다르다:
 *   전액 환불 = (멘토 0, 학생 예치금) · 멘토 지급 = (멘토 예치금, 학생 0) · 분할 = 관리자가 두 금액을 직접 입력.
 * - 확인 모달은 학생 몫·멘토 몫(gross)·수수료·멘토 실수령·예치금을 재표시한다. 분할은 세 숫자(학생 몫 + 멘토 실수령 + 수수료 = 학생 몫 + gross)가
 *   예치금과 같아야 확인이 열린다(`confirmBlockedMessage`). 분배 비율은 슬라이더가 아니라 **금액 직접 입력**이다.
 * - 미리보기 요율은 DB 정산 행(`form.feeRate`)만 쓴다(PR-1b V-4). 없으면 '요율 미설정' 을 보이고 실수령을 계산하지 않는다(RPC 가 DB 요율로 집행).
 * - 액션이 사유를 읽지 않으므로 사유 입력을 요구하지 않고(`reasonRequired={false}`) 그 사실을 summary 에 적는다 — 근거는 케이스 노트에.
 */
import { useMemo, useState } from "react";
import { ConfirmSubmitButton } from "@/components/admin/ConfirmSubmitButton";
import { applyCustomOrderDisputeSplitAdminAction } from "@/lib/admin/adminDisputeActions";
import type { AdminDisputeEscrowSplitFormProps, AdminDisputeEscrowSplitPanelState } from "@/lib/admin/adminDisputeEscrowSplitTypes";
import {
  DISPUTE_ACTIONS,
  DISPUTE_ID_FIELD,
  DISPUTE_NO_REASON_STORED_NOTE,
  DISPUTE_SPLIT_MENTOR_GROSS_FIELD,
  DISPUTE_SPLIT_ORDER_ID_FIELD,
  DISPUTE_SPLIT_STUDENT_REFUND_FIELD,
  buildDisputePayoutMentorSummary,
  buildDisputeRefundStudentSummary,
  buildDisputeSplitDetails,
  buildDisputeSplitPreview,
  buildDisputeSplitSummary,
  disputeSplitBlockedMessage,
} from "@/lib/admin/disputeConsole";
import { formatCashKrw } from "@/lib/utils/formatDisplay";
import { SETTLEMENT_FEE_RATE_UNSET_LABEL, settlementFeeRateLabel } from "@/lib/payout/settlementFeeRate";
import { cn } from "@/lib/utils/cn";

const BUTTON = "inline-flex h-10 items-center justify-center rounded-xl px-4 text-xs font-extrabold text-white transition disabled:cursor-not-allowed disabled:opacity-60";

type Names = { studentName: string; mentorName: string };

function parseWonInput(raw: string): number {
  const t = raw.trim();
  if (t === "") return 0;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

function DisputeEscrowSplitForm(props: { form: AdminDisputeEscrowSplitFormProps } & Names) {
  const hold = props.form.holdGrossWon;
  // PR-1b V-4: 요율은 DB 정산 행(form.feeRate)에서만 온다. 없으면 실수령을 계산하지 않고 '요율 미설정' 을 보인다.
  const feeRate = props.form.feeRate;
  const [studentRaw, setStudentRaw] = useState(String(hold));
  const [mentorRaw, setMentorRaw] = useState("0");

  const preview = useMemo(
    () => buildDisputeSplitPreview({ holdWon: hold, studentWon: parseWonInput(studentRaw), mentorGrossWon: parseWonInput(mentorRaw), feeRate }),
    [hold, studentRaw, mentorRaw, feeRate]
  );
  const refundPreview = useMemo(() => buildDisputeSplitPreview({ holdWon: hold, studentWon: hold, mentorGrossWon: 0, feeRate }), [hold, feeRate]);
  const payoutPreview = useMemo(() => buildDisputeSplitPreview({ holdWon: hold, studentWon: 0, mentorGrossWon: hold, feeRate }), [hold, feeRate]);
  const splitBlocked = disputeSplitBlockedMessage(preview);
  const noReason = `\n${DISPUTE_NO_REASON_STORED_NOTE}`;

  const hidden = (
    <>
      <input type="hidden" name={DISPUTE_ID_FIELD} value={props.form.disputeId} />
      <input type="hidden" name={DISPUTE_SPLIT_ORDER_ID_FIELD} value={props.form.orderId} />
    </>
  );

  return (
    <div className="space-y-4" data-dispute-funds>
      <dl className="grid gap-2 text-xs sm:grid-cols-3">
        <div className="rounded-lg border border-amber-100 bg-white/90 px-3 py-2">
          <dt className="font-bold text-slate-500">예치금(hold)</dt>
          <dd className="mt-0.5 text-base font-extrabold text-amber-950">{formatCashKrw(hold, { unit: "원" })}</dd>
        </div>
        <div className="rounded-lg border border-amber-100 bg-white/90 px-3 py-2">
          <dt className="font-bold text-slate-500">수수료율(정산 행)</dt>
          <dd className={cn("mt-0.5 font-bold", feeRate == null ? "text-red-700" : "text-slate-900")}>
            {feeRate == null ? SETTLEMENT_FEE_RATE_UNSET_LABEL : settlementFeeRateLabel(feeRate)}
          </dd>
        </div>
        <div className="rounded-lg border border-amber-100 bg-white/90 px-3 py-2">
          <dt className="font-bold text-slate-500">결제 · 정산 상태</dt>
          <dd className="mt-0.5 font-bold text-slate-900">
            {props.form.paymentStatus} · {props.form.settlementStatus ?? "—"}
          </dd>
        </div>
      </dl>

      <div className="flex flex-wrap gap-2">
        <form action={applyCustomOrderDisputeSplitAdminAction} data-dispute-fund-form="refund_student">
          {hidden}
          <input type="hidden" name={DISPUTE_SPLIT_MENTOR_GROSS_FIELD} value="0" />
          <input type="hidden" name={DISPUTE_SPLIT_STUDENT_REFUND_FIELD} value={String(hold)} />
          <ConfirmSubmitButton
            level="critical"
            reasonRequired={false}
            summary={buildDisputeRefundStudentSummary(refundPreview, props.studentName) + noReason}
            details={buildDisputeSplitDetails(refundPreview)}
            dialogTitle={DISPUTE_ACTIONS.refund_student.dialogTitle}
            confirmLabel={DISPUTE_ACTIONS.refund_student.confirmLabel}
            pendingLabel={DISPUTE_ACTIONS.refund_student.pendingLabel}
            className={`${BUTTON} bg-[#1A56DB] hover:bg-[#1747B8]`}
          >
            {DISPUTE_ACTIONS.refund_student.label}
          </ConfirmSubmitButton>
        </form>
        <form action={applyCustomOrderDisputeSplitAdminAction} data-dispute-fund-form="payout_mentor">
          {hidden}
          <input type="hidden" name={DISPUTE_SPLIT_MENTOR_GROSS_FIELD} value={String(hold)} />
          <input type="hidden" name={DISPUTE_SPLIT_STUDENT_REFUND_FIELD} value="0" />
          <ConfirmSubmitButton
            level="critical"
            reasonRequired={false}
            summary={buildDisputePayoutMentorSummary(payoutPreview, props.mentorName) + noReason}
            details={buildDisputeSplitDetails(payoutPreview)}
            dialogTitle={DISPUTE_ACTIONS.payout_mentor.dialogTitle}
            confirmLabel={DISPUTE_ACTIONS.payout_mentor.confirmLabel}
            pendingLabel={DISPUTE_ACTIONS.payout_mentor.pendingLabel}
            className={`${BUTTON} bg-emerald-700 hover:bg-emerald-800`}
          >
            {DISPUTE_ACTIONS.payout_mentor.label}
          </ConfirmSubmitButton>
        </form>
      </div>

      <form action={applyCustomOrderDisputeSplitAdminAction} className="space-y-3 rounded-xl border border-amber-200 bg-white/70 p-3" data-dispute-fund-form="split">
        {hidden}
        <input type="hidden" name={DISPUTE_SPLIT_MENTOR_GROSS_FIELD} value={String(preview.mentorGrossWon)} />
        <input type="hidden" name={DISPUTE_SPLIT_STUDENT_REFUND_FIELD} value={String(preview.studentWon)} />
        <p className="text-xs font-extrabold text-amber-950">{DISPUTE_ACTIONS.split.label} — 금액 직접 입력</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs font-bold text-slate-700">
            학생 몫(환불, 원)
            <input
              type="number"
              min={0}
              max={hold}
              step={1}
              inputMode="numeric"
              value={studentRaw}
              onChange={(e) => setStudentRaw(e.target.value)}
              aria-label="학생 환불 금액(원)"
              className="mt-1 w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
            />
          </label>
          <label className="block text-xs font-bold text-slate-700">
            멘토 몫(gross · 수수료 공제 전, 원)
            <input
              type="number"
              min={0}
              max={hold}
              step={1}
              inputMode="numeric"
              value={mentorRaw}
              onChange={(e) => setMentorRaw(e.target.value)}
              aria-label="멘토 배정 금액(원)"
              className="mt-1 w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
            />
          </label>
        </div>
        <dl className="grid gap-1 rounded-lg border border-amber-100 bg-amber-50/60 px-3 py-2 text-xs sm:grid-cols-4" aria-label="분할 미리보기">
          <div>
            <dt className="text-slate-500">학생 몫</dt>
            <dd className="font-extrabold tabular-nums text-slate-900">{formatCashKrw(preview.studentWon, { unit: "원" })}</dd>
          </div>
          <div>
            <dt className="text-slate-500">멘토 실수령</dt>
            <dd className="font-extrabold tabular-nums text-slate-900">{preview.mentorNetWon == null ? SETTLEMENT_FEE_RATE_UNSET_LABEL : formatCashKrw(preview.mentorNetWon, { unit: "원" })}</dd>
          </div>
          <div>
            <dt className="text-slate-500">수수료</dt>
            <dd className="font-extrabold tabular-nums text-slate-900">{preview.feeWon == null ? "—" : formatCashKrw(preview.feeWon, { unit: "원" })}</dd>
          </div>
          <div>
            <dt className="text-slate-500">합계 / 예치금</dt>
            <dd className={cn("font-extrabold tabular-nums", preview.sumOk ? "text-emerald-700" : "text-red-700")} data-dispute-split-sum={preview.sumOk ? "ok" : "mismatch"}>
              {formatCashKrw(preview.sumWon, { unit: "원" })} / {formatCashKrw(hold, { unit: "원" })} {preview.sumOk ? "일치" : "불일치"}
            </dd>
          </div>
        </dl>
        <ConfirmSubmitButton
          level="critical"
          reasonRequired={false}
          summary={buildDisputeSplitSummary(preview, { studentName: props.studentName, mentorName: props.mentorName }) + noReason}
          details={buildDisputeSplitDetails(preview)}
          confirmBlockedMessage={splitBlocked}
          dialogTitle={DISPUTE_ACTIONS.split.dialogTitle}
          confirmLabel={DISPUTE_ACTIONS.split.confirmLabel}
          pendingLabel={DISPUTE_ACTIONS.split.pendingLabel}
          className={`${BUTTON} bg-amber-800 hover:bg-amber-900`}
        >
          {DISPUTE_ACTIONS.split.label}
        </ConfirmSubmitButton>
      </form>
      <p className="text-[11px] text-amber-900/85">
        제출 시 서버·RPC 가 합계·상호 배타·권한을 다시 검증합니다. 실행 후 분쟁은 &lsquo;해결&rsquo;, 주문은 &lsquo;분쟁 해결&rsquo; 상태가 됩니다.
      </p>
    </div>
  );
}

export function DisputeEscrowSplitPanel(
  props: {
    panelState: AdminDisputeEscrowSplitPanelState;
    /** 현재 분쟁 상태가 RPC 의 분쟁 갱신 조건(open·검토 중·에스컬레이션) 안인가 */
    fundsAllowedByStatus: boolean;
    statusLabel: string;
  } & Names
) {
  const st = props.panelState;

  if (st.kind === "unavailable") {
    return <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">{st.message}</p>;
  }
  if (st.kind === "completed") {
    return (
      <p className="rounded-xl border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-xs font-semibold text-emerald-900">
        예치금 처리 완료 — {st.message}
        {st.paymentStatus ? ` (결제 상태 ${st.paymentStatus})` : null}
      </p>
    );
  }
  if (st.kind === "no_hold") {
    return <p className="rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs font-semibold text-amber-900">{st.message}</p>;
  }
  if (!props.fundsAllowedByStatus) {
    return (
      <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
        현재 &lsquo;{props.statusLabel}&rsquo; 상태에서는 예치금 조치를 할 수 없습니다 — 분배 RPC 는 접수·검토 중·에스컬레이션 상태의 분쟁만 해결로 바꿉니다.
      </p>
    );
  }
  return <DisputeEscrowSplitForm form={st.form} studentName={props.studentName} mentorName={props.mentorName} />;
}
