/**
 * 멘토 활동 — 행 조치 버튼(PR-11 §4-2). §0-C 실측대로 **기존 서버 액션 3종만** 쓴다(`mentorActivityAdminActions`):
 *   보류 확정(stateChange) · 구제/보류 해제(critical — 정산 항목이 지급 대기로 복원되는 자금 조치 · 사유 필수) · 유예 만료 정리(critical — 환불 생성 · 사유 필수).
 * 알림 보내기 · 활동 강제 정지 경로는 없어 그리지 않는다. 필드명(`eventId` · `mentorId`)은 그대로, `reason` 은 감사 로그 detail 에 실린다.
 * Server Component — 폼 + 클라이언트 확인 버튼.
 */
import { ConfirmSubmitButton } from "@/components/admin/ConfirmSubmitButton";
import {
  approveMentorAbandonmentHoldAction,
  finalizeMentorTerminationAdminAction,
  releaseMentorSettlementHoldAction,
} from "@/lib/admin/mentorActivityAdminActions";
import {
  MENTOR_ACTIVITY_ACTIONS,
  MENTOR_ACTIVITY_EVENT_ID_FIELD,
  MENTOR_ACTIVITY_MENTOR_ID_FIELD,
  MENTOR_ACTIVITY_REASON_FIELD,
  buildMentorHoldApproveSummary,
  buildMentorHoldReleaseSummary,
  buildMentorTerminationFinalizeSummary,
  mentorActivityAvailableActions,
  type MentorActivityListItem,
} from "@/lib/admin/mentorActivityConsole";
import { formatKoDateTimeKst } from "@/lib/utils/kstTime";

type Props = { item: MentorActivityListItem; now: number };

const BUTTON = "inline-flex h-8 items-center justify-center rounded-lg px-2.5 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-60";

export function MentorActivityActionButtons({ item, now }: Props) {
  const actions = mentorActivityAvailableActions(item, now);
  if (actions.length === 0) return <span className="text-xs text-slate-400">—</span>;
  const details = [{ label: "멘토", value: item.name }];
  return (
    <div className="flex flex-wrap gap-1.5" data-mentor-activity-actions={item.mentorId}>
      {actions.map((a) => {
        const def = MENTOR_ACTIVITY_ACTIONS[a.key];
        if (a.key === "hold_approve") {
          return (
            <form action={approveMentorAbandonmentHoldAction} className="inline" key={`${a.key}-${a.eventId}`}>
              <input type="hidden" name={MENTOR_ACTIVITY_EVENT_ID_FIELD} value={a.eventId ?? ""} />
              <ConfirmSubmitButton
                level="stateChange"
                summary={buildMentorHoldApproveSummary(item.name)}
                details={details}
                dialogTitle={def.dialogTitle}
                confirmLabel={def.confirmLabel}
                pendingLabel={def.pendingLabel}
                className={`${BUTTON} bg-red-600 text-white hover:bg-red-700`}
              >
                {def.label}
              </ConfirmSubmitButton>
            </form>
          );
        }
        if (a.key === "hold_release") {
          return (
            <form action={releaseMentorSettlementHoldAction} className="inline" key={`${a.key}-${a.eventId}`}>
              <input type="hidden" name={MENTOR_ACTIVITY_EVENT_ID_FIELD} value={a.eventId ?? ""} />
              <ConfirmSubmitButton
                level="critical"
                summary={buildMentorHoldReleaseSummary(item.name)}
                details={details}
                reasonFieldName={MENTOR_ACTIVITY_REASON_FIELD}
                reasonLabel="구제 사유"
                reasonPlaceholder="불가피한 사유(질병·사고 등)를 적어 주세요. 감사 로그에 남습니다."
                dialogTitle={def.dialogTitle}
                confirmLabel={def.confirmLabel}
                pendingLabel={def.pendingLabel}
                className={`${BUTTON} border border-emerald-300 bg-white text-emerald-700 hover:bg-emerald-50`}
              >
                {def.label}
              </ConfirmSubmitButton>
            </form>
          );
        }
        return (
          <form action={finalizeMentorTerminationAdminAction} className="inline" key={a.key}>
            <input type="hidden" name={MENTOR_ACTIVITY_MENTOR_ID_FIELD} value={item.mentorId} />
            <ConfirmSubmitButton
              level="critical"
              summary={buildMentorTerminationFinalizeSummary(item.name)}
              details={[...details, { label: "종료 예정", value: formatKoDateTimeKst(item.terminationEffectiveAt) }]}
              reasonFieldName={MENTOR_ACTIVITY_REASON_FIELD}
              reasonLabel="정리 사유"
              reasonPlaceholder="유예 만료 확인 내용을 적어 주세요. 감사 로그에 남습니다."
              dialogTitle={def.dialogTitle}
              confirmLabel={def.confirmLabel}
              pendingLabel={def.pendingLabel}
              className={`${BUTTON} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}
            >
              {def.label}
            </ConfirmSubmitButton>
          </form>
        );
      })}
    </div>
  );
}
