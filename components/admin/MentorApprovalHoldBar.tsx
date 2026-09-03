"use client";

/**
 * 멘토 승인 작업대 — 보류(PR-2b §1-2). 결정 바(승인·반려·재제출) 바로 위 한 줄.
 *
 * - `ConfirmSubmitButton` stateChange + **메모 필수**(프리셋 3종 · 직접 입력). 칩 클릭 = 그 메모로 즉시 제출. 메모 없이는 제출되지 않는다.
 * - 서버 액션 `holdMentorApplicationAction`(새 쓰기 경로 ①). 단축키 H 는 이 버튼을 id 로 click 해 **모달만 연다**.
 * - 다른 관리자가 보고 있으면 확인 모달에 `동시 심사` 한 줄 — 잠금은 없다.
 */
import { ConfirmSubmitButton } from "@/components/admin/ConfirmSubmitButton";
import { usePresenceConfirmDetails } from "@/components/admin/MentorApprovalPresenceProvider";
import { MENTOR_DECISION_CUSTOM_REASON_LABEL } from "@/lib/admin/mentorApprovalDecision";
import { MENTOR_HOLD_BUTTON_IDS, MENTOR_HOLD_LABELS, MENTOR_HOLD_REASON_FIELD, MENTOR_HOLD_REASON_PRESETS } from "@/lib/admin/mentorApprovalHold";
import { holdMentorApplicationAction } from "@/lib/admin/mentorApprovalHoldActions";

type Props = {
  mentorUserId: string;
  holdSummary: string;
};

export function MentorApprovalHoldBar({ mentorUserId, holdSummary }: Props) {
  const details = usePresenceConfirmDetails(mentorUserId);
  return (
    <form action={holdMentorApplicationAction} className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-3 py-2" data-hold-bar>
      <input type="hidden" name="mentorUserId" value={mentorUserId} />
      <p className="min-w-0 text-[11px] leading-4 text-slate-500">애매하면 보류 — 대기에서 빠지고 멘토에게는 알리지 않습니다. 메모는 감사 로그에 남습니다.</p>
      <ConfirmSubmitButton
        id={MENTOR_HOLD_BUTTON_IDS.hold}
        level="stateChange"
        summary={holdSummary}
        dialogTitle="보류 메모"
        confirmLabel={MENTOR_HOLD_LABELS.hold}
        pendingLabel="보류 중…"
        reasonRequired
        reasonFieldName={MENTOR_HOLD_REASON_FIELD}
        reasonLabel="보류 메모"
        reasonPresets={MENTOR_HOLD_REASON_PRESETS}
        customReasonLabel={MENTOR_DECISION_CUSTOM_REASON_LABEL}
        details={details}
        className="inline-flex h-9 shrink-0 items-center justify-center rounded-xl border-2 border-sky-300 bg-white px-4 text-xs font-extrabold text-sky-800 transition hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {MENTOR_HOLD_LABELS.hold}
      </ConfirmSubmitButton>
    </form>
  );
}
