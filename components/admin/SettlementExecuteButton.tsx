"use client";

/**
 * 정산 실행 버튼(PR-9 §1-2) — `ConfirmSubmitButton level="critical"`.
 *
 * - summary: "멘토 N명에게 총 X원을 정산 확정합니다 / 계좌 미등록 M명은 제외 / 실제 이체는 별도" · details: 지급일·건수·정산금·원천징수·실지급 재표시
 * - 사유 필수(프리셋 2종 + 직접 입력). 사유는 `executePayoutRunAction` 이 감사 로그 `detail.reason` 에 남긴다.
 * - hidden 필드는 **같은 미리보기**에서 나온 값이다 — 서버 액션이 실행 직전 드라이런과 대조해 미리보기 이후 대상이 바뀌면 거부한다.
 * - `block` 이 있으면 버튼을 잠그고 다이얼로그에도 같은 사유를 전달한다(대사 불일치 · 이미 실행됨 · 대상 없음 · 미리보기 실패).
 */
import { ConfirmSubmitButton } from "@/components/admin/ConfirmSubmitButton";
import { executePayoutRunAction } from "@/lib/admin/settlementActions";
import {
  SETTLEMENT_EXECUTE_BLOCK_MESSAGES,
  SETTLEMENT_EXECUTE_REASON_FIELD,
  SETTLEMENT_EXECUTE_REASON_PRESETS,
  buildPayoutExecuteDetails,
  buildPayoutExecuteSummary,
  payoutExecuteHiddenFields,
  payoutExecuteSummaryInputFor,
  type SettlementExecuteBlock,
  type SettlementPreview,
} from "@/lib/admin/settlementConsole";

type Props = {
  preview: SettlementPreview;
  runDate: string;
  block: SettlementExecuteBlock | null;
};

export function SettlementExecuteButton({ preview, runDate, block }: Props) {
  const hidden = payoutExecuteHiddenFields(preview, runDate);
  const blockedMessage = block ? SETTLEMENT_EXECUTE_BLOCK_MESSAGES[block] : null;

  return (
    <form action={executePayoutRunAction} data-settlement-execute>
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <ConfirmSubmitButton
        level="critical"
        summary={buildPayoutExecuteSummary(payoutExecuteSummaryInputFor(preview))}
        details={buildPayoutExecuteDetails(preview, runDate)}
        dialogTitle="정산 실행 — 실행 전 확인"
        confirmLabel="정산 확정"
        pendingLabel="실행 중…"
        reasonFieldName={SETTLEMENT_EXECUTE_REASON_FIELD}
        reasonLabel="실행 사유"
        reasonPlaceholder="예: 9월 정산 정기 실행 — 대사표 확인 완료"
        reasonPresets={SETTLEMENT_EXECUTE_REASON_PRESETS}
        confirmBlockedMessage={blockedMessage}
        disabled={block !== null}
        title={blockedMessage ?? undefined}
        className="inline-flex h-11 items-center justify-center rounded-xl bg-[#1A56DB] px-5 text-sm font-extrabold text-white transition hover:bg-[#1747B8] disabled:cursor-not-allowed disabled:opacity-50"
      >
        정산 실행
      </ConfirmSubmitButton>
    </form>
  );
}
