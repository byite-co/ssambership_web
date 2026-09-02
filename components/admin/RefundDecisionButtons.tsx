"use client";

/**
 * 환불 승인·반려 버튼(PR-3 §2·§4) — 목록 행과 상세 우상단이 같은 부품을 쓴다.
 *
 * - 승인: `ConfirmSubmitButton level="critical"` — summary 는 방향을 문장으로(누구에게 얼마를 캐시로), details 에 실지급 금액(저장값) 재표시,
 *   사유 입력 필수(critical 기본). 기준상 환불액이 0원이면 summary 에 경고 문장이 붙는다.
 * - 반려: `level="stateChange"` + 사유 프리셋(칩 클릭 = 확인). "직접 입력" 만 텍스트 필드.
 * - 서버 액션은 기존 것(`approveAdminRefundAction` / `rejectAdminRefundAction`) 그대로 — RPC 호출·DB 쓰기 불변. 사유는 액션이 읽는
 *   필드명(`adminNote`)으로 실려 RPC `p_admin_note` 와 감사 로그에 남는다. `returnTo` 로 실패 시 같은 화면에 돌아와 재시도한다.
 */
import { ConfirmSubmitButton } from "@/components/admin/ConfirmSubmitButton";
import { approveAdminRefundAction, rejectAdminRefundAction } from "@/lib/admin/refundActions";
import {
  REFUND_CUSTOM_REASON_LABEL,
  REFUND_REASON_FIELD,
  REFUND_REJECT_REASON_PRESETS,
  REFUND_RETURN_TO_FIELD,
  approveSummaryInputFor,
  buildRefundApproveDetails,
  buildRefundApproveSummary,
  buildRefundRejectSummary,
  type RefundDecisionTarget,
} from "@/lib/admin/refundConsole";

type Props = {
  target: RefundDecisionTarget;
  /** 액션이 돌아갈 경로(목록 또는 상세) */
  returnTo: string;
  size?: "sm" | "md";
};

const SIZE_CLASS: Record<NonNullable<Props["size"]>, string> = {
  sm: "inline-flex h-8 items-center justify-center rounded-lg px-3 text-xs font-extrabold transition disabled:cursor-not-allowed disabled:opacity-60",
  md: "inline-flex h-11 items-center justify-center rounded-xl px-5 text-sm font-extrabold transition disabled:cursor-not-allowed disabled:opacity-60",
};

export function RefundDecisionButtons({ target, returnTo, size = "sm" }: Props) {
  const input = approveSummaryInputFor(target);
  const approveSummary = buildRefundApproveSummary(input);
  const approveDetails = buildRefundApproveDetails(input);
  const base = SIZE_CLASS[size];

  return (
    <div className="flex flex-wrap items-center gap-2" data-refund-decision={target.id}>
      <form action={approveAdminRefundAction}>
        <input type="hidden" name="refundId" value={target.id} />
        <input type="hidden" name={REFUND_RETURN_TO_FIELD} value={returnTo} />
        <ConfirmSubmitButton
          level="critical"
          summary={approveSummary}
          details={approveDetails}
          dialogTitle="환불 승인 — 실행 전 확인"
          confirmLabel="환불 승인"
          pendingLabel="승인 중…"
          reasonFieldName={REFUND_REASON_FIELD}
          reasonLabel="승인 사유"
          reasonPlaceholder="예: 학원법 기준 확인 — 이용 개시 전 전액 환불"
          className={`${base} bg-[#1A56DB] text-white hover:bg-[#1747B8]`}
        >
          승인
        </ConfirmSubmitButton>
      </form>
      <form action={rejectAdminRefundAction}>
        <input type="hidden" name="refundId" value={target.id} />
        <input type="hidden" name={REFUND_RETURN_TO_FIELD} value={returnTo} />
        <ConfirmSubmitButton
          level="stateChange"
          summary={buildRefundRejectSummary(target.requesterName, target.amountWon)}
          dialogTitle="반려 사유"
          confirmLabel="반려"
          pendingLabel="반려 중…"
          reasonRequired
          reasonFieldName={REFUND_REASON_FIELD}
          reasonLabel="반려 사유"
          reasonPresets={REFUND_REJECT_REASON_PRESETS}
          customReasonLabel={REFUND_CUSTOM_REASON_LABEL}
          className={`${base} border-2 border-red-500 bg-white text-red-700 hover:bg-red-50`}
        >
          반려
        </ConfirmSubmitButton>
      </form>
    </div>
  );
}
