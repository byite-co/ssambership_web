"use client";

/**
 * 계정 상세 조치 패널(PR-7 §2-2) — 우상단 고정. 세 조치 모두 계정 관리 화면의 기존 서버 액션을 그대로 쓴다(새 액션 없음).
 *
 * | 조치 | 등급                                   | 서버 액션                                                        |
 * |------|----------------------------------------|------------------------------------------------------------------|
 * | 경고 | stateChange + 사유 프리셋 필수          | issueUserWarningAction — `userId` · `warnReason` · `severity`     |
 * | 정지 | critical(7일·30일·영구 선택 + 사유 필수) | setUserStatusAction — `userId` · `nextStatus` · `durationDays` · `reason` |
 * | 차단 | destructive(대상 이름 재입력) + 사유 필수 | setUserStatusAction — `nextStatus=banned` · `reason`              |
 *
 * 세 폼 모두 `returnTo`(이 계정 상세)를 실어 처리 후 여기로 돌아온다 — 결과는 상세 상단 플래시.
 */
import { useState } from "react";
import { ConfirmSubmitButton } from "@/components/admin/ConfirmSubmitButton";
import { issueUserWarningAction, setUserStatusAction } from "@/lib/admin/accountStatusActions";
import {
  ACCOUNT_BAN_FIELDS,
  ACCOUNT_CUSTOM_REASON_LABEL,
  ACCOUNT_DETAIL_ACTIONS,
  ACCOUNT_DETAIL_RESULT_NOTE,
  ACCOUNT_RETURN_TO_FIELD,
  ACCOUNT_SUSPEND_BLOCKED_MESSAGE,
  ACCOUNT_SUSPEND_CODES,
  ACCOUNT_SUSPEND_CODE_LABELS,
  ACCOUNT_SUSPEND_DURATION_FIELD,
  ACCOUNT_SUSPEND_REASON_FIELD,
  ACCOUNT_SUSPEND_STATUS_FIELD,
  ACCOUNT_USER_ID_FIELD,
  ACCOUNT_WARNING_PRESETS,
  ACCOUNT_WARN_REASON_FIELD,
  ACCOUNT_WARN_SEVERITY_DEFAULT,
  ACCOUNT_WARN_SEVERITY_FIELD,
  accountBanConfirmText,
  accountDetailPath,
  accountSuspendFields,
  buildAccountDetailBanSummary,
  buildAccountDetailSuspendSummary,
  buildAccountDetailWarningSummary,
  type AccountDetailActionTarget,
  type AccountSuspendCode,
} from "@/lib/admin/accountDetailConsole";
import { cn } from "@/lib/utils/cn";

type Props = {
  target: AccountDetailActionTarget;
  /** 7일·30일 정지 해제 예정일 표기(서버에서 계산) */
  untilLabels: Record<"7d" | "30d", string>;
};

const BUTTON = "inline-flex h-9 items-center justify-center rounded-lg px-3 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-60";
const RADIO = "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm font-bold";

export function AccountActionPanel({ target, untilLabels }: Props) {
  const [code, setCode] = useState<AccountSuspendCode | null>(null);
  const returnTo = accountDetailPath(target.id);
  const fields = code ? accountSuspendFields(code) : { nextStatus: "", durationDays: "" };
  const who = `${target.name} (${target.roleLabel})`;
  const suspendSummary = code
    ? `${buildAccountDetailSuspendSummary(target, code, code === "permanent" ? null : untilLabels[code])}\n${ACCOUNT_DETAIL_RESULT_NOTE}`
    : `정지 기간을 고르면 ${target.name} ${target.roleLabel} 계정에 미치는 실제 영향을 여기에 표시합니다.\n${ACCOUNT_DETAIL_RESULT_NOTE}`;
  const banConfirmText = accountBanConfirmText(target.name, target.id);

  return (
    <div className="flex flex-wrap items-center gap-2" data-account-actions={target.id}>
      <form action={issueUserWarningAction} className="inline" data-account-action-form="warn">
        <input type="hidden" name={ACCOUNT_USER_ID_FIELD} value={target.id} />
        <input type="hidden" name={ACCOUNT_WARN_SEVERITY_FIELD} value={ACCOUNT_WARN_SEVERITY_DEFAULT} />
        <input type="hidden" name={ACCOUNT_RETURN_TO_FIELD} value={returnTo} />
        <ConfirmSubmitButton
          level="stateChange"
          summary={`${buildAccountDetailWarningSummary(target)}\n${ACCOUNT_DETAIL_RESULT_NOTE}`}
          details={[
            { label: "대상", value: who },
            { label: "누적 경고", value: target.activeWarningCount == null ? "확인 불가" : `${target.activeWarningCount}회` },
          ]}
          dialogTitle={ACCOUNT_DETAIL_ACTIONS.warn.dialogTitle}
          confirmLabel={ACCOUNT_DETAIL_ACTIONS.warn.confirmLabel}
          pendingLabel={ACCOUNT_DETAIL_ACTIONS.warn.pendingLabel}
          reasonRequired
          reasonFieldName={ACCOUNT_WARN_REASON_FIELD}
          reasonLabel="경고 사유"
          reasonPresets={ACCOUNT_WARNING_PRESETS}
          customReasonLabel={ACCOUNT_CUSTOM_REASON_LABEL}
          className={`${BUTTON} border-2 border-amber-500 bg-white text-amber-800 hover:bg-amber-50`}
        >
          ⚠ {ACCOUNT_DETAIL_ACTIONS.warn.label}
        </ConfirmSubmitButton>
      </form>

      <form action={setUserStatusAction} className="inline" data-account-action-form="suspend">
        <input type="hidden" name={ACCOUNT_USER_ID_FIELD} value={target.id} />
        <input type="hidden" name={ACCOUNT_SUSPEND_STATUS_FIELD} value={fields.nextStatus} />
        <input type="hidden" name={ACCOUNT_SUSPEND_DURATION_FIELD} value={fields.durationDays} />
        <input type="hidden" name={ACCOUNT_RETURN_TO_FIELD} value={returnTo} />
        <ConfirmSubmitButton
          level="critical"
          summary={suspendSummary}
          details={[
            { label: "대상", value: who },
            { label: "기간", value: code ? ACCOUNT_SUSPEND_CODE_LABELS[code] : "미선택" },
            { label: "해제 예정", value: code ? (code === "permanent" ? "수동 해제 전까지" : untilLabels[code]) : "—" },
          ]}
          body={
            <div data-account-suspend-options>
              <p className="text-xs font-bold text-slate-700">정지 기간</p>
              <div className="mt-1.5 flex flex-wrap gap-2" role="radiogroup" aria-label="정지 기간">
                {ACCOUNT_SUSPEND_CODES.map((c) => {
                  const on = code === c;
                  return (
                    <label key={c} className={cn(RADIO, on ? "border-red-400 bg-red-50 text-red-900" : "border-slate-200 text-slate-700 hover:bg-slate-50")}>
                      <input type="radio" name="account-suspend-code" value={c} checked={on} onChange={() => setCode(c)} className="h-4 w-4" />
                      {ACCOUNT_SUSPEND_CODE_LABELS[c]}
                    </label>
                  );
                })}
              </div>
            </div>
          }
          confirmBlockedMessage={code ? null : ACCOUNT_SUSPEND_BLOCKED_MESSAGE}
          dialogTitle={ACCOUNT_DETAIL_ACTIONS.suspend.dialogTitle}
          confirmLabel={ACCOUNT_DETAIL_ACTIONS.suspend.confirmLabel}
          pendingLabel={ACCOUNT_DETAIL_ACTIONS.suspend.pendingLabel}
          reasonFieldName={ACCOUNT_SUSPEND_REASON_FIELD}
          reasonLabel="정지 사유"
          reasonPlaceholder="예: 외부 연락처 유도 3회 — 신고 #… 확인"
          className={`${BUTTON} bg-red-700 text-white hover:bg-red-800`}
        >
          {ACCOUNT_DETAIL_ACTIONS.suspend.label}
        </ConfirmSubmitButton>
      </form>

      <form action={setUserStatusAction} className="inline" data-account-action-form="ban">
        <input type="hidden" name={ACCOUNT_USER_ID_FIELD} value={target.id} />
        <input type="hidden" name={ACCOUNT_SUSPEND_STATUS_FIELD} value={ACCOUNT_BAN_FIELDS.nextStatus} />
        <input type="hidden" name={ACCOUNT_SUSPEND_DURATION_FIELD} value={ACCOUNT_BAN_FIELDS.durationDays} />
        <input type="hidden" name={ACCOUNT_RETURN_TO_FIELD} value={returnTo} />
        <ConfirmSubmitButton
          level="destructive"
          confirmText={banConfirmText}
          summary={`${buildAccountDetailBanSummary(target)}\n${ACCOUNT_DETAIL_RESULT_NOTE}`}
          details={[
            { label: "대상", value: who },
            { label: "재입력할 이름", value: banConfirmText },
          ]}
          reasonRequired
          dialogTitle={ACCOUNT_DETAIL_ACTIONS.ban.dialogTitle}
          confirmLabel={ACCOUNT_DETAIL_ACTIONS.ban.confirmLabel}
          pendingLabel={ACCOUNT_DETAIL_ACTIONS.ban.pendingLabel}
          reasonFieldName={ACCOUNT_SUSPEND_REASON_FIELD}
          reasonLabel="차단 사유"
          reasonPlaceholder="예: 반복 위반 — 분쟁 #… · 신고 #… 확인"
          className={`${BUTTON} bg-slate-900 text-white hover:bg-black`}
        >
          {ACCOUNT_DETAIL_ACTIONS.ban.label}
        </ConfirmSubmitButton>
      </form>
    </div>
  );
}
