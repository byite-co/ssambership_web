"use client";

/**
 * 신고 상세 — 조치 버튼(PR-5 §1-2). 이관 전 `FormSubmitButton` 6개를 `ConfirmSubmitButton` 으로 바꾼 것. 레이아웃·서버 액션·필드명은 그대로다.
 *
 * | 조치        | 등급         | 확인                                           |
 * |-------------|--------------|------------------------------------------------|
 * | 검토 중     | stateChange  | 한 줄 확인                                      |
 * | 처리 완료   | stateChange  | 한 줄 확인                                      |
 * | 기각(종결)  | stateChange  | 한 줄 확인                                      |
 * | 콘텐츠 숨김 | stateChange  | "숨깁니다. 복구할 수 있습니다."                    |
 * | 콘텐츠 복구 | stateChange  | 한 줄 확인                                      |
 * | 콘텐츠 삭제 | destructive  | 대상 ID(앞 8자) 재입력 + 종류별 복구 가능 여부 명시   |
 *
 * 삭제 모달의 `숨김으로 대신하기`: 삭제 다이얼로그를 닫고(트리거 리마운트) 숨김 트리거를 click 해 **숨김 확인 모달만 연다** —
 * 실행은 그 모달의 확인 뒤 `requestSubmit(button)` 으로만 일어난다(단축키 A/R/D 와 같은 "다이얼로그만 열기" 패턴).
 * 이 화면에는 경고·계정 정지 액션이 없다(지시서 표의 두 행은 신고 상세에 연결된 서버 액션이 없어 이 PR 에서 만들지 않는다 — 보고).
 */
import { useState } from "react";
import { ConfirmSubmitButton } from "@/components/admin/ConfirmSubmitButton";
import { updateContentReportModerationAction, updateContentReportStatusAction } from "@/lib/admin/adminReportActions";
import {
  CONTENT_REPORT_ACTIONS,
  CONTENT_REPORT_ACTION_BUTTON_IDS,
  CONTENT_REPORT_HIDE_INSTEAD_LABEL,
  CONTENT_REPORT_INTENT_FIELD,
  CONTENT_REPORT_REPORT_ID_FIELD,
  CONTENT_REPORT_STATUS_FIELD,
  buildContentReportDeleteSummary,
  buildContentReportHideSummary,
  buildContentReportRestoreSummary,
  buildContentReportStatusSummary,
  contentReportDeleteConfirmText,
  contentReportDeleteEffect,
  type ContentReportTargetKind,
} from "@/lib/admin/contentReportConsole";

type Props = {
  reportId: string;
  /** 서버가 `normalizeModerationTargetType` 으로 판정한 대상 종류. null = 지원되지 않는 유형(콘텐츠 불변, 신고 상태만 변경) */
  targetKind: ContentReportTargetKind;
  targetId: string | null;
  /** 원시 target_type 의 표시 라벨 */
  targetLabel: string;
};

const BUTTON = "inline-flex h-9 items-center justify-center rounded-lg px-3 text-xs font-bold text-white transition disabled:cursor-not-allowed disabled:opacity-60";

const DELETE_EFFECT_LABEL = {
  soft_delete: "소프트 삭제(복구 가능)",
  hard_delete: "하드 삭제(복구 불가)",
  report_only: "콘텐츠 불변 · 신고 상태만 변경",
} as const;

export function ContentReportActionButtons({ reportId, targetKind, targetId, targetLabel }: Props) {
  // 삭제 다이얼로그를 닫는 유일한 수단 — 트리거를 리마운트한다(ConfirmSubmitButton 은 닫기 API 를 노출하지 않는다).
  const [deleteInstance, setDeleteInstance] = useState(0);
  const effect = contentReportDeleteEffect(targetKind);
  const confirmText = contentReportDeleteConfirmText(targetId, reportId);

  const hideInstead = () => {
    setDeleteInstance((n) => n + 1);
    document.getElementById(CONTENT_REPORT_ACTION_BUTTON_IDS.hidden)?.click();
  };

  const targetRow = { label: "대상", value: `${targetLabel} · ${targetId ?? "—"}` };

  return (
    <div className="flex flex-wrap gap-2" data-content-report-actions={reportId}>
      <form action={updateContentReportStatusAction} className="inline">
        <input type="hidden" name={CONTENT_REPORT_REPORT_ID_FIELD} value={reportId} />
        <input type="hidden" name={CONTENT_REPORT_STATUS_FIELD} value="reviewing" />
        <ConfirmSubmitButton
          id={CONTENT_REPORT_ACTION_BUTTON_IDS.reviewing}
          level="stateChange"
          summary={buildContentReportStatusSummary("reviewing")}
          dialogTitle={CONTENT_REPORT_ACTIONS.reviewing.dialogTitle}
          confirmLabel={CONTENT_REPORT_ACTIONS.reviewing.confirmLabel}
          pendingLabel={CONTENT_REPORT_ACTIONS.reviewing.pendingLabel}
          className={`${BUTTON} bg-amber-600 hover:bg-amber-700`}
        >
          {CONTENT_REPORT_ACTIONS.reviewing.label}
        </ConfirmSubmitButton>
      </form>
      <form action={updateContentReportStatusAction} className="inline">
        <input type="hidden" name={CONTENT_REPORT_REPORT_ID_FIELD} value={reportId} />
        <input type="hidden" name={CONTENT_REPORT_STATUS_FIELD} value="resolved" />
        <ConfirmSubmitButton
          id={CONTENT_REPORT_ACTION_BUTTON_IDS.resolved}
          level="stateChange"
          summary={buildContentReportStatusSummary("resolved")}
          dialogTitle={CONTENT_REPORT_ACTIONS.resolved.dialogTitle}
          confirmLabel={CONTENT_REPORT_ACTIONS.resolved.confirmLabel}
          pendingLabel={CONTENT_REPORT_ACTIONS.resolved.pendingLabel}
          className={`${BUTTON} bg-emerald-600 hover:bg-emerald-700`}
        >
          {CONTENT_REPORT_ACTIONS.resolved.label}
        </ConfirmSubmitButton>
      </form>
      <form action={updateContentReportStatusAction} className="inline">
        <input type="hidden" name={CONTENT_REPORT_REPORT_ID_FIELD} value={reportId} />
        <input type="hidden" name={CONTENT_REPORT_STATUS_FIELD} value="dismissed" />
        <ConfirmSubmitButton
          id={CONTENT_REPORT_ACTION_BUTTON_IDS.dismissed}
          level="stateChange"
          summary={buildContentReportStatusSummary("dismissed")}
          dialogTitle={CONTENT_REPORT_ACTIONS.dismissed.dialogTitle}
          confirmLabel={CONTENT_REPORT_ACTIONS.dismissed.confirmLabel}
          pendingLabel={CONTENT_REPORT_ACTIONS.dismissed.pendingLabel}
          className={`${BUTTON} bg-slate-600 hover:bg-slate-700`}
        >
          {CONTENT_REPORT_ACTIONS.dismissed.label}
        </ConfirmSubmitButton>
      </form>
      <form action={updateContentReportModerationAction} className="inline">
        <input type="hidden" name={CONTENT_REPORT_REPORT_ID_FIELD} value={reportId} />
        <input type="hidden" name={CONTENT_REPORT_INTENT_FIELD} value="hidden" />
        <ConfirmSubmitButton
          id={CONTENT_REPORT_ACTION_BUTTON_IDS.hidden}
          level="stateChange"
          summary={buildContentReportHideSummary(targetKind)}
          details={[targetRow]}
          dialogTitle={CONTENT_REPORT_ACTIONS.hidden.dialogTitle}
          confirmLabel={CONTENT_REPORT_ACTIONS.hidden.confirmLabel}
          pendingLabel={CONTENT_REPORT_ACTIONS.hidden.pendingLabel}
          className={`${BUTTON} bg-orange-700 hover:bg-orange-800`}
        >
          {CONTENT_REPORT_ACTIONS.hidden.label}
        </ConfirmSubmitButton>
      </form>
      <form action={updateContentReportModerationAction} className="inline">
        <input type="hidden" name={CONTENT_REPORT_REPORT_ID_FIELD} value={reportId} />
        <input type="hidden" name={CONTENT_REPORT_INTENT_FIELD} value="restored" />
        <ConfirmSubmitButton
          id={CONTENT_REPORT_ACTION_BUTTON_IDS.restored}
          level="stateChange"
          summary={buildContentReportRestoreSummary(targetKind)}
          details={[targetRow]}
          dialogTitle={CONTENT_REPORT_ACTIONS.restored.dialogTitle}
          confirmLabel={CONTENT_REPORT_ACTIONS.restored.confirmLabel}
          pendingLabel={CONTENT_REPORT_ACTIONS.restored.pendingLabel}
          className={`${BUTTON} bg-teal-700 hover:bg-teal-800`}
        >
          {CONTENT_REPORT_ACTIONS.restored.label}
        </ConfirmSubmitButton>
      </form>
      <form action={updateContentReportModerationAction} className="inline" key={`delete-${deleteInstance}`}>
        <input type="hidden" name={CONTENT_REPORT_REPORT_ID_FIELD} value={reportId} />
        <input type="hidden" name={CONTENT_REPORT_INTENT_FIELD} value="deleted" />
        <ConfirmSubmitButton
          id={CONTENT_REPORT_ACTION_BUTTON_IDS.deleted}
          level="destructive"
          summary={buildContentReportDeleteSummary(targetKind)}
          confirmText={confirmText}
          details={[targetRow, { label: "삭제 방식", value: DELETE_EFFECT_LABEL[effect] }]}
          body={
            effect === "report_only" ? null : (
              <button
                type="button"
                onClick={hideInstead}
                className="w-full rounded-xl border-2 border-amber-400 bg-amber-50 px-3 py-2 text-sm font-extrabold text-amber-900 transition hover:bg-amber-100"
                data-content-report-hide-instead
              >
                {CONTENT_REPORT_HIDE_INSTEAD_LABEL} — 복구할 수 있습니다
              </button>
            )
          }
          dialogTitle={CONTENT_REPORT_ACTIONS.deleted.dialogTitle}
          confirmLabel={CONTENT_REPORT_ACTIONS.deleted.confirmLabel}
          pendingLabel={CONTENT_REPORT_ACTIONS.deleted.pendingLabel}
          className={`${BUTTON} bg-red-700 hover:bg-red-800`}
        >
          {CONTENT_REPORT_ACTIONS.deleted.label}
        </ConfirmSubmitButton>
      </form>
    </div>
  );
}
