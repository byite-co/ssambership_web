"use client";

/**
 * 멘토 승인 작업대 — ④ 결정 영역(PR-2 §7). 우측 칸 하단 고정.
 *
 * - 세 버튼(승인 · 반려 · 재제출 요청)의 크기는 같다. 승인만 액션색 채움, 반려는 위험색 외곽선, 재제출은 중립 외곽선.
 * - 셋 모두 `ConfirmSubmitButton`(stateChange) 확인 절차를 거친다. 반려·재제출은 사유 프리셋 한 번 클릭으로 끝난다.
 * - 서버 액션은 기존 것 그대로(DB 쓰기 동일). 사유는 액션이 읽는 필드명으로 실려 감사 로그에 남는다.
 * - 단축키 A/R/D 는 이 버튼들을 id 로 click 해 **다이얼로그만 연다**(실행은 확인 뒤에만).
 * - PR-2b: 다른 관리자가 같은 지원자를 보고 있으면 확인 모달에 `동시 심사` 한 줄을 더한다(Presence 표시 전용 — 잠금 없음).
 */
import { ConfirmSubmitButton } from "@/components/admin/ConfirmSubmitButton";
import { usePresenceConfirmDetails } from "@/components/admin/MentorApprovalPresenceProvider";
import {
  approveMentorApplicationAction,
  rejectMentorApplicationAction,
  requestMentorDocumentsAction,
} from "@/lib/admin/mentorApprovalActions";
import {
  MENTOR_DECISION_BUTTON_IDS,
  MENTOR_DECISION_CUSTOM_REASON_LABEL,
  MENTOR_DECISION_DESCRIPTIONS,
  MENTOR_DECISION_LABELS,
  MENTOR_DECISION_REASON_FIELD,
  MENTOR_DECISION_REASON_PRESETS,
} from "@/lib/admin/mentorApprovalDecision";

type Props = {
  mentorUserId: string;
  approveSummary: string;
  rejectSummary: string;
  resubmitSummary: string;
  /** 직전 처리 실패 안내(URL `error`) — 무엇이 실패했고 다시 시도하면 되는지 */
  flashError: string | null;
};

const BUTTON_BASE = "inline-flex h-11 w-full items-center justify-center rounded-xl text-sm font-extrabold transition disabled:cursor-not-allowed disabled:opacity-60";

export function MentorApprovalDecisionBar(props: Props) {
  const { mentorUserId, approveSummary, rejectSummary, resubmitSummary, flashError } = props;
  const presenceDetails = usePresenceConfirmDetails(mentorUserId);

  return (
    <div className="space-y-2 border-t border-slate-200 bg-white p-3" data-decision-bar>
      {flashError ? (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-900">
          처리 실패 — {flashError} 같은 버튼으로 다시 시도할 수 있습니다.
        </p>
      ) : null}
      <div className="grid grid-cols-3 gap-2">
        <form action={approveMentorApplicationAction}>
          <input type="hidden" name="mentorUserId" value={mentorUserId} />
          <ConfirmSubmitButton
            id={MENTOR_DECISION_BUTTON_IDS.approve}
            level="stateChange"
            summary={approveSummary}
            details={presenceDetails}
            dialogTitle="멘토 승인"
            confirmLabel="승인"
            pendingLabel="승인 중…"
            className={`${BUTTON_BASE} bg-[#1A56DB] text-white hover:bg-[#1747B8]`}
          >
            {MENTOR_DECISION_LABELS.approve}
          </ConfirmSubmitButton>
        </form>
        <form action={rejectMentorApplicationAction}>
          <input type="hidden" name="mentorUserId" value={mentorUserId} />
          <ConfirmSubmitButton
            id={MENTOR_DECISION_BUTTON_IDS.reject}
            level="stateChange"
            summary={rejectSummary}
            details={presenceDetails}
            dialogTitle="반려 사유"
            confirmLabel="반려"
            pendingLabel="반려 중…"
            reasonRequired
            reasonFieldName={MENTOR_DECISION_REASON_FIELD.reject}
            reasonLabel="반려 사유"
            reasonPresets={MENTOR_DECISION_REASON_PRESETS}
            customReasonLabel={MENTOR_DECISION_CUSTOM_REASON_LABEL}
            className={`${BUTTON_BASE} border-2 border-red-500 bg-white text-red-700 hover:bg-red-50`}
          >
            {MENTOR_DECISION_LABELS.reject}
          </ConfirmSubmitButton>
        </form>
        <form action={requestMentorDocumentsAction}>
          <input type="hidden" name="mentorUserId" value={mentorUserId} />
          <ConfirmSubmitButton
            id={MENTOR_DECISION_BUTTON_IDS.resubmit}
            level="stateChange"
            summary={resubmitSummary}
            details={presenceDetails}
            dialogTitle="재제출 요청 사유"
            confirmLabel="재제출 요청"
            pendingLabel="요청 중…"
            reasonRequired
            reasonFieldName={MENTOR_DECISION_REASON_FIELD.resubmit}
            reasonLabel="재제출 요청 사유"
            reasonPresets={MENTOR_DECISION_REASON_PRESETS}
            customReasonLabel={MENTOR_DECISION_CUSTOM_REASON_LABEL}
            className={`${BUTTON_BASE} border-2 border-slate-300 bg-white text-slate-800 hover:bg-slate-50`}
          >
            {MENTOR_DECISION_LABELS.resubmit}
          </ConfirmSubmitButton>
        </form>
      </div>
      <dl className="grid grid-cols-3 gap-2 text-[11px] leading-4 text-slate-500">
        <div>
          <dt className="sr-only">승인</dt>
          <dd>확인 모달을 거쳐 승인합니다.</dd>
        </div>
        <div>
          <dt className="sr-only">반려</dt>
          <dd>{MENTOR_DECISION_DESCRIPTIONS.reject}</dd>
        </div>
        <div>
          <dt className="sr-only">재제출 요청</dt>
          <dd>{MENTOR_DECISION_DESCRIPTIONS.resubmit}</dd>
        </div>
      </dl>
    </div>
  );
}
