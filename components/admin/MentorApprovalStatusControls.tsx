"use client";

/**
 * 멘토 승인 작업대 — 보류 해제 · 승인 취소 · 반려 되돌리기 버튼(PR-2b §1-2 · §3). 심사 패널 하단과 "오늘 내가 처리한 건" 목록이 같이 쓴다.
 *
 * - 보류 해제: stateChange → `pending`. 처리 후 같은 지원자를 선택한 채 돌아온다.
 * - 승인 취소: **critical**(사유 필수) → `pending`. 활성 구독이 있으면 `disabled` + 이유 문구(`구독 중인 학생 N명 — …`). 서버도 다시 센다.
 * - 반려 되돌리기: stateChange + 사유 필수 → `pending`.
 * 셋 다 다른 관리자가 보고 있으면 확인 모달에 `동시 심사` 한 줄. 자체 모달 없음 — PR-1 부품(ConfirmSubmitButton)만 쓴다.
 */
import { ConfirmSubmitButton } from "@/components/admin/ConfirmSubmitButton";
import { usePresenceConfirmDetails } from "@/components/admin/MentorApprovalPresenceProvider";
import { MENTOR_HOLD_LABELS, MENTOR_HOLD_RELEASE_NOTE_FIELD, MENTOR_REVERT_REASON_FIELD, MENTOR_REVOKE_REASON_FIELD } from "@/lib/admin/mentorApprovalHold";
import { releaseMentorHoldAction } from "@/lib/admin/mentorApprovalHoldActions";
import { revertMentorRejectionAction, revokeMentorApprovalAction } from "@/lib/admin/mentorApprovalRevokeActions";
import { cn } from "@/lib/utils/cn";

type Size = "sm" | "md";

const SIZE_CLASS: Record<Size, string> = {
  sm: "h-8 px-3 text-[11px]",
  md: "h-10 px-4 text-xs",
};

const BUTTON_BASE = "inline-flex shrink-0 items-center justify-center rounded-xl font-extrabold transition disabled:cursor-not-allowed disabled:opacity-60";

type CommonProps = {
  mentorUserId: string;
  summary: string;
  size?: Size;
  /** 단축키·테스트용 id — 한 화면에 여러 개 그릴 때(오늘 처리 목록)는 넘기지 않는다 */
  id?: string;
};

export function MentorHoldReleaseButton({ mentorUserId, summary, size = "md", id }: CommonProps) {
  const details = usePresenceConfirmDetails(mentorUserId);
  return (
    <form action={releaseMentorHoldAction} className="inline-flex">
      <input type="hidden" name="mentorUserId" value={mentorUserId} />
      <input type="hidden" name={MENTOR_HOLD_RELEASE_NOTE_FIELD} value="" />
      <ConfirmSubmitButton
        id={id}
        level="stateChange"
        summary={summary}
        dialogTitle={MENTOR_HOLD_LABELS.release}
        confirmLabel={MENTOR_HOLD_LABELS.release}
        pendingLabel="해제 중…"
        details={details}
        className={cn(BUTTON_BASE, SIZE_CLASS[size], "bg-[#1A56DB] text-white hover:bg-[#1747B8]")}
      >
        {MENTOR_HOLD_LABELS.release}
      </ConfirmSubmitButton>
    </form>
  );
}

export function MentorApprovalRevokeButton({ mentorUserId, summary, size = "md", id, blockedMessage }: CommonProps & { blockedMessage: string | null }) {
  const details = usePresenceConfirmDetails(mentorUserId);
  const blocked = Boolean(blockedMessage);
  return (
    <form action={revokeMentorApprovalAction} className="inline-flex flex-col items-end gap-1" data-revoke-control>
      <input type="hidden" name="mentorUserId" value={mentorUserId} />
      <ConfirmSubmitButton
        id={id}
        level="critical"
        summary={summary}
        dialogTitle={MENTOR_HOLD_LABELS.revoke}
        confirmLabel={MENTOR_HOLD_LABELS.revoke}
        pendingLabel="취소 중…"
        reasonFieldName={MENTOR_REVOKE_REASON_FIELD}
        reasonLabel="승인 취소 사유"
        reasonPlaceholder="왜 취소하는지 — 감사 로그에 남습니다"
        details={details}
        disabled={blocked}
        title={blockedMessage ?? undefined}
        className={cn(BUTTON_BASE, SIZE_CLASS[size], "border-2 border-red-500 bg-white text-red-700 hover:bg-red-50")}
      >
        {MENTOR_HOLD_LABELS.revoke}
      </ConfirmSubmitButton>
      {blocked ? (
        <p className="max-w-[16rem] text-right text-[11px] font-semibold leading-4 text-slate-500" data-revoke-blocked>
          {blockedMessage}
        </p>
      ) : null}
    </form>
  );
}

export function MentorRejectionRevertButton({ mentorUserId, summary, size = "md", id }: CommonProps) {
  const details = usePresenceConfirmDetails(mentorUserId);
  return (
    <form action={revertMentorRejectionAction} className="inline-flex">
      <input type="hidden" name="mentorUserId" value={mentorUserId} />
      <ConfirmSubmitButton
        id={id}
        level="stateChange"
        summary={summary}
        dialogTitle={MENTOR_HOLD_LABELS.revert}
        confirmLabel={MENTOR_HOLD_LABELS.revert}
        pendingLabel="되돌리는 중…"
        reasonRequired
        reasonFieldName={MENTOR_REVERT_REASON_FIELD}
        reasonLabel="되돌리기 사유"
        reasonPlaceholder="왜 되돌리는지 — 감사 로그에 남습니다"
        details={details}
        className={cn(BUTTON_BASE, SIZE_CLASS[size], "border-2 border-slate-300 bg-white text-slate-800 hover:bg-slate-50")}
      >
        {MENTOR_HOLD_LABELS.revert}
      </ConfirmSubmitButton>
    </form>
  );
}
