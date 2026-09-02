"use client";

/**
 * 신고 상세 — 신고당한 사용자에게 내리는 조치 2종(PR-6 §1-2). 기존 조치 6종(`ContentReportActionButtons`) 옆에 놓인다.
 *
 * | 조치      | 등급                         | 서버 액션(계정 관리 화면 것을 그대로 재사용)                       |
 * |-----------|------------------------------|-------------------------------------------------------------------|
 * | 경고      | stateChange + 사유 프리셋 필수 | issueUserWarningAction — `userId` · `warnReason` · `severity`       |
 * | 계정 정지 | critical(기간 선택 + 사유 필수) | setUserStatusAction — `userId` · `nextStatus` · `durationDays` · `reason` |
 *
 * 정지 기간(7일·30일·영구)은 모달 안 라디오로 고른다 — 고르기 전에는 확인이 잠기고, 고르면 hidden `nextStatus`·`durationDays` 가 따라간다.
 * 두 액션은 처리 후 `/admin/users` 로 이동한다(기존 동작) — summary 마지막 줄에 미리 알린다.
 */
import { useState } from "react";
import { ConfirmSubmitButton } from "@/components/admin/ConfirmSubmitButton";
import { issueUserWarningAction, setUserStatusAction } from "@/lib/admin/accountStatusActions";
import {
  CONTENT_REPORT_CUSTOM_REASON_LABEL,
  CONTENT_REPORT_SUSPEND_BLOCKED_MESSAGE,
  CONTENT_REPORT_SUSPEND_CODES,
  CONTENT_REPORT_SUSPEND_CODE_LABELS,
  CONTENT_REPORT_SUSPEND_DURATION_FIELD,
  CONTENT_REPORT_SUSPEND_REASON_FIELD,
  CONTENT_REPORT_SUSPEND_STATUS_FIELD,
  CONTENT_REPORT_USER_ACTIONS,
  CONTENT_REPORT_USER_ACTION_REDIRECT_NOTE,
  CONTENT_REPORT_USER_ID_FIELD,
  CONTENT_REPORT_WARNING_PRESETS,
  CONTENT_REPORT_WARN_REASON_FIELD,
  CONTENT_REPORT_WARN_SEVERITY_DEFAULT,
  CONTENT_REPORT_WARN_SEVERITY_FIELD,
  buildContentReportSuspendSummary,
  buildContentReportWarningSummary,
  contentReportSuspendFields,
  type ContentReportSuspendCode,
  type ContentReportTargetUser,
} from "@/lib/admin/contentReportSanctionConsole";
import { cn } from "@/lib/utils/cn";

type Props = {
  user: ContentReportTargetUser;
  /** 7일·30일 정지 해제 예정일 표기(서버에서 계산) */
  untilLabels: Record<"7d" | "30d", string>;
};

const BUTTON = "inline-flex h-9 items-center justify-center rounded-lg px-3 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-60";
const RADIO = "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm font-bold";

export function ContentReportUserActionButtons({ user, untilLabels }: Props) {
  const [code, setCode] = useState<ContentReportSuspendCode | null>(null);
  const fields = code ? contentReportSuspendFields(code) : { nextStatus: "", durationDays: "" };
  const suspendSummary = code
    ? `${buildContentReportSuspendSummary(user, code, code === "permanent" ? null : untilLabels[code])}\n${CONTENT_REPORT_USER_ACTION_REDIRECT_NOTE}`
    : `정지 기간을 고르면 ${user.name} ${user.roleLabel} 계정에 미치는 실제 영향을 여기에 표시합니다.\n${CONTENT_REPORT_USER_ACTION_REDIRECT_NOTE}`;

  return (
    <div className="flex flex-wrap gap-2" data-content-report-user-actions={user.id}>
      <form action={issueUserWarningAction} className="inline" data-content-report-user-form="warn">
        <input type="hidden" name={CONTENT_REPORT_USER_ID_FIELD} value={user.id} />
        <input type="hidden" name={CONTENT_REPORT_WARN_SEVERITY_FIELD} value={CONTENT_REPORT_WARN_SEVERITY_DEFAULT} />
        <ConfirmSubmitButton
          level="stateChange"
          summary={`${buildContentReportWarningSummary(user)}\n${CONTENT_REPORT_USER_ACTION_REDIRECT_NOTE}`}
          details={[
            { label: "대상", value: `${user.name} (${user.roleLabel})` },
            { label: "누적 경고", value: user.activeWarningCount == null ? "확인 불가" : `${user.activeWarningCount}회` },
          ]}
          dialogTitle={CONTENT_REPORT_USER_ACTIONS.warn.dialogTitle}
          confirmLabel={CONTENT_REPORT_USER_ACTIONS.warn.confirmLabel}
          pendingLabel={CONTENT_REPORT_USER_ACTIONS.warn.pendingLabel}
          reasonRequired
          reasonFieldName={CONTENT_REPORT_WARN_REASON_FIELD}
          reasonLabel="경고 사유"
          reasonPresets={CONTENT_REPORT_WARNING_PRESETS}
          customReasonLabel={CONTENT_REPORT_CUSTOM_REASON_LABEL}
          className={`${BUTTON} border-2 border-amber-500 bg-white text-amber-800 hover:bg-amber-50`}
        >
          ⚠ {CONTENT_REPORT_USER_ACTIONS.warn.label}
        </ConfirmSubmitButton>
      </form>
      <form action={setUserStatusAction} className="inline" data-content-report-user-form="suspend">
        <input type="hidden" name={CONTENT_REPORT_USER_ID_FIELD} value={user.id} />
        <input type="hidden" name={CONTENT_REPORT_SUSPEND_STATUS_FIELD} value={fields.nextStatus} />
        <input type="hidden" name={CONTENT_REPORT_SUSPEND_DURATION_FIELD} value={fields.durationDays} />
        <ConfirmSubmitButton
          level="critical"
          summary={suspendSummary}
          details={[
            { label: "대상", value: `${user.name} (${user.roleLabel})` },
            { label: "기간", value: code ? CONTENT_REPORT_SUSPEND_CODE_LABELS[code] : "미선택" },
            { label: "해제 예정", value: code ? (code === "permanent" ? "수동 해제 전까지" : untilLabels[code]) : "—" },
          ]}
          body={
            <div data-content-report-suspend-options>
              <p className="text-xs font-bold text-slate-700">정지 기간</p>
              <div className="mt-1.5 flex flex-wrap gap-2" role="radiogroup" aria-label="정지 기간">
                {CONTENT_REPORT_SUSPEND_CODES.map((c) => {
                  const on = code === c;
                  return (
                    <label key={c} className={cn(RADIO, on ? "border-red-400 bg-red-50 text-red-900" : "border-slate-200 text-slate-700 hover:bg-slate-50")}>
                      <input type="radio" name="content-report-suspend-code" value={c} checked={on} onChange={() => setCode(c)} className="h-4 w-4" />
                      {CONTENT_REPORT_SUSPEND_CODE_LABELS[c]}
                    </label>
                  );
                })}
              </div>
            </div>
          }
          confirmBlockedMessage={code ? null : CONTENT_REPORT_SUSPEND_BLOCKED_MESSAGE}
          dialogTitle={CONTENT_REPORT_USER_ACTIONS.suspend.dialogTitle}
          confirmLabel={CONTENT_REPORT_USER_ACTIONS.suspend.confirmLabel}
          pendingLabel={CONTENT_REPORT_USER_ACTIONS.suspend.pendingLabel}
          reasonFieldName={CONTENT_REPORT_SUSPEND_REASON_FIELD}
          reasonLabel="정지 사유"
          reasonPlaceholder="예: 외부 연락처 유도 3회 — 신고 #… 확인"
          className={`${BUTTON} bg-red-700 text-white hover:bg-red-800`}
        >
          {CONTENT_REPORT_USER_ACTIONS.suspend.label}
        </ConfirmSubmitButton>
      </form>
    </div>
  );
}
