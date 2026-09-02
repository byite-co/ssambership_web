"use client";

/**
 * 분쟁 상세 — 다음 조치(PR-6 §2-3·§2-4). **현재 상태에서 가능한 전이만** 버튼으로 보인다.
 * 어떤 조치가 가능한지는 `disputeAllowedActions`(서버 액션 게이트를 옮긴 표)가 정하고, 이 부품은 그 목록대로 그린다.
 *
 * | 조치                 | 등급        | 서버 액션(기존)                                           |
 * |----------------------|-------------|-----------------------------------------------------------|
 * | 검토 시작            | stateChange | setDisputeUnderReviewAction                               |
 * | 보류                 | stateChange | applyDisputeSanctionAction(sanction=hold)                 |
 * | 기각                 | stateChange + 사유 프리셋 | dismissDisputeAction(`reason` → 감사 로그)              |
 * | 해결(종결)           | stateChange + 사유 프리셋 | resolveDisputeAction(`reason` → 감사 로그) · 보류 건은 applyDisputeSanctionAction(complete, `note`) |
 * | 환불 · 분할 · 지급   | critical    | applyCustomOrderDisputeSplitAdminAction(DisputeEscrowSplitPanel) |
 * | 제재(7일·30일·영구)  | critical    | applyDisputeSanctionAction(sanction=7d|30d|permanent, target, note) |
 *
 * 상위 이관(escalated)으로 바꾸는 쓰기 경로는 코드에 없어 버튼을 두지 않는다. 제재는 대상(학생·멘토)과 기간을 모달 안 라디오로 고르고,
 * 둘 다 고르기 전에는 확인이 잠긴다. 사유(`note`)는 계정 상태 사유·케이스 노트·감사 로그에 남는다(액션 동작).
 */
import { useState } from "react";
import { ConfirmSubmitButton } from "@/components/admin/ConfirmSubmitButton";
import { DisputeEscrowSplitPanel } from "@/components/disputes/DisputeEscrowSplitPanel";
import { dismissDisputeAction, resolveDisputeAction, setDisputeUnderReviewAction } from "@/lib/admin/adminDisputeActions";
import { applyDisputeSanctionAction } from "@/lib/admin/adminDisputeSanctionActions";
import type { AdminDisputeEscrowSplitPanelState } from "@/lib/admin/adminDisputeEscrowSplitTypes";
import {
  DISPUTE_ACTIONS,
  DISPUTE_COMPLETE_CODE,
  DISPUTE_CUSTOM_REASON_LABEL,
  DISPUTE_DISMISS_REASON_PRESETS,
  DISPUTE_FUND_ACTION_KEYS,
  DISPUTE_HOLD_CODE,
  DISPUTE_ID_FIELD,
  DISPUTE_REASON_FIELD,
  DISPUTE_RESOLVE_REASON_PRESETS,
  DISPUTE_SANCTION_BLOCKED_MESSAGE,
  DISPUTE_SANCTION_CODES,
  DISPUTE_SANCTION_CODE_LABELS,
  DISPUTE_SANCTION_FIELD,
  DISPUTE_SANCTION_NOTE_FIELD,
  DISPUTE_SANCTION_TARGET_FIELD,
  DISPUTE_SANCTION_TARGET_LABELS,
  buildDisputeSanctionSummary,
  buildDisputeStatusSummary,
  disputeSanctionStatus,
  disputeStatusLabel,
  type DisputeActionKey,
  type DisputeResolveRoute,
  type DisputeSanctionCode,
  type DisputeSanctionTarget,
} from "@/lib/admin/disputeConsole";
import { cn } from "@/lib/utils/cn";

export type DisputeParty = { id: string; name: string } | null;

type Props = {
  disputeId: string;
  status: string;
  allowed: DisputeActionKey[];
  resolveRoute: DisputeResolveRoute | null;
  student: DisputeParty;
  mentor: DisputeParty;
  /** 멘토 담당 학생 수(mentor_student_rooms) — 없으면 문장 생략 */
  mentorRoomCount: number | null;
  /** 7일·30일 정지 해제 예정일 표기(서버에서 계산) */
  untilLabels: Record<"7d" | "30d", string>;
  escrow: AdminDisputeEscrowSplitPanelState;
};

const BUTTON = "inline-flex h-9 items-center justify-center rounded-lg px-3 text-xs font-bold text-white transition disabled:cursor-not-allowed disabled:opacity-60";
const RADIO = "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm font-bold";

export function DisputeNextActions(props: Props) {
  const { disputeId, status, allowed, resolveRoute, student, mentor } = props;
  const has = (key: DisputeActionKey) => allowed.includes(key);
  const fundsAllowed = DISPUTE_FUND_ACTION_KEYS.some((k) => allowed.includes(k));
  const statusLabel = disputeStatusLabel(status);

  const targets = ([student ? "student" : null, mentor ? "mentor" : null] as const).filter((t): t is DisputeSanctionTarget => Boolean(t));
  const [target, setTarget] = useState<DisputeSanctionTarget | null>(targets.length === 1 ? targets[0] : null);
  const [code, setCode] = useState<DisputeSanctionCode | null>(null);
  const targetParty = target === "student" ? student : target === "mentor" ? mentor : null;
  const sanctionReady = Boolean(target && code && targetParty);
  const sanctionSummary =
    target && code && targetParty
      ? buildDisputeSanctionSummary({
          targetName: targetParty.name,
          target,
          code,
          untilLabel: code === "permanent" ? null : props.untilLabels[code],
          mentorRoomCount: props.mentorRoomCount,
        })
      : "제재 대상과 기간을 고르면 실제 영향을 여기에 표시합니다.";

  const idInput = <input type="hidden" name={DISPUTE_ID_FIELD} value={disputeId} />;
  const statusOnly = allowed.filter((k) => k === "review" || k === "hold" || k === "dismiss" || k === "resolve");

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" aria-label="다음 조치" data-dispute-next-actions={status}>
      <h2 className="text-sm font-black tracking-tight text-slate-900">다음 조치</h2>
      <p className="mt-1 text-xs text-slate-600">
        현재 &lsquo;{statusLabel}&rsquo;에서 가능한 것만 표시합니다. 모든 조치는 확인 절차를 거칩니다.
      </p>

      {allowed.length === 0 ? (
        <p className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
          종결된 분쟁입니다. 더 바꿀 수 있는 상태가 없습니다.
        </p>
      ) : null}

      {statusOnly.length ? (
        <div className="mt-3">
          <p className="text-[11px] font-black uppercase tracking-wide text-slate-500">상태</p>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {has("review") ? (
              <form action={setDisputeUnderReviewAction} className="inline">
                {idInput}
                <ConfirmSubmitButton
                  level="stateChange"
                  summary={buildDisputeStatusSummary("review")}
                  dialogTitle={DISPUTE_ACTIONS.review.dialogTitle}
                  confirmLabel={DISPUTE_ACTIONS.review.confirmLabel}
                  pendingLabel={DISPUTE_ACTIONS.review.pendingLabel}
                  className={`${BUTTON} bg-indigo-600 hover:bg-indigo-700`}
                >
                  {DISPUTE_ACTIONS.review.label}
                </ConfirmSubmitButton>
              </form>
            ) : null}
            {has("hold") ? (
              <form action={applyDisputeSanctionAction} className="inline">
                {idInput}
                <input type="hidden" name={DISPUTE_SANCTION_FIELD} value={DISPUTE_HOLD_CODE} />
                <ConfirmSubmitButton
                  level="stateChange"
                  summary={buildDisputeStatusSummary("hold")}
                  dialogTitle={DISPUTE_ACTIONS.hold.dialogTitle}
                  confirmLabel={DISPUTE_ACTIONS.hold.confirmLabel}
                  pendingLabel={DISPUTE_ACTIONS.hold.pendingLabel}
                  className={`${BUTTON} bg-amber-600 hover:bg-amber-700`}
                >
                  {DISPUTE_ACTIONS.hold.label}
                </ConfirmSubmitButton>
              </form>
            ) : null}
            {has("dismiss") ? (
              <form action={dismissDisputeAction} className="inline">
                {idInput}
                <ConfirmSubmitButton
                  level="stateChange"
                  summary={buildDisputeStatusSummary("dismiss")}
                  dialogTitle={DISPUTE_ACTIONS.dismiss.dialogTitle}
                  confirmLabel={DISPUTE_ACTIONS.dismiss.confirmLabel}
                  pendingLabel={DISPUTE_ACTIONS.dismiss.pendingLabel}
                  reasonRequired
                  reasonFieldName={DISPUTE_REASON_FIELD}
                  reasonLabel="기각 사유"
                  reasonPresets={DISPUTE_DISMISS_REASON_PRESETS}
                  customReasonLabel={DISPUTE_CUSTOM_REASON_LABEL}
                  className={`${BUTTON} bg-slate-600 hover:bg-slate-700`}
                >
                  {DISPUTE_ACTIONS.dismiss.label}
                </ConfirmSubmitButton>
              </form>
            ) : null}
            {has("resolve") && resolveRoute === "resolve_action" ? (
              <form action={resolveDisputeAction} className="inline">
                {idInput}
                <ConfirmSubmitButton
                  level="stateChange"
                  summary={buildDisputeStatusSummary("resolve", resolveRoute)}
                  dialogTitle={DISPUTE_ACTIONS.resolve.dialogTitle}
                  confirmLabel={DISPUTE_ACTIONS.resolve.confirmLabel}
                  pendingLabel={DISPUTE_ACTIONS.resolve.pendingLabel}
                  reasonRequired
                  reasonFieldName={DISPUTE_REASON_FIELD}
                  reasonLabel="해결 사유"
                  reasonPresets={DISPUTE_RESOLVE_REASON_PRESETS}
                  customReasonLabel={DISPUTE_CUSTOM_REASON_LABEL}
                  className={`${BUTTON} bg-emerald-700 hover:bg-emerald-800`}
                >
                  {DISPUTE_ACTIONS.resolve.label}
                </ConfirmSubmitButton>
              </form>
            ) : null}
            {has("resolve") && resolveRoute === "sanction_complete" ? (
              <form action={applyDisputeSanctionAction} className="inline">
                {idInput}
                <input type="hidden" name={DISPUTE_SANCTION_FIELD} value={DISPUTE_COMPLETE_CODE} />
                <ConfirmSubmitButton
                  level="stateChange"
                  summary={buildDisputeStatusSummary("resolve", resolveRoute)}
                  dialogTitle={DISPUTE_ACTIONS.resolve.dialogTitle}
                  confirmLabel={DISPUTE_ACTIONS.resolve.confirmLabel}
                  pendingLabel={DISPUTE_ACTIONS.resolve.pendingLabel}
                  reasonRequired
                  reasonFieldName={DISPUTE_SANCTION_NOTE_FIELD}
                  reasonLabel="해결 사유"
                  reasonPresets={DISPUTE_RESOLVE_REASON_PRESETS}
                  customReasonLabel={DISPUTE_CUSTOM_REASON_LABEL}
                  className={`${BUTTON} bg-emerald-700 hover:bg-emerald-800`}
                >
                  {DISPUTE_ACTIONS.resolve.label}
                </ConfirmSubmitButton>
              </form>
            ) : null}
          </div>
        </div>
      ) : null}

      {fundsAllowed || props.escrow.kind === "completed" ? (
        <div className="mt-4 rounded-2xl border border-amber-300/80 bg-amber-50/50 p-3" data-dispute-funds-section>
          <p className="text-[11px] font-black uppercase tracking-wide text-amber-900">예치금 처리 — 환불 · 분할 · 지급</p>
          <div className="mt-2">
            <DisputeEscrowSplitPanel
              panelState={props.escrow}
              fundsAllowedByStatus={fundsAllowed}
              statusLabel={statusLabel}
              studentName={student?.name ?? "이름 없음"}
              mentorName={mentor?.name ?? "이름 없음"}
            />
          </div>
        </div>
      ) : null}

      {has("sanction") ? (
        <div className="mt-4">
          <p className="text-[11px] font-black uppercase tracking-wide text-slate-500">제재</p>
          {targets.length === 0 ? (
            <p className="mt-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
              제재 대상 계정(학생·멘토)이 분쟁에 연결되어 있지 않아 제재할 수 없습니다.
            </p>
          ) : (
            <form action={applyDisputeSanctionAction} className="mt-1.5 inline" data-dispute-sanction-form>
              {idInput}
              <input type="hidden" name={DISPUTE_SANCTION_FIELD} value={code ?? ""} />
              <input type="hidden" name={DISPUTE_SANCTION_TARGET_FIELD} value={target ?? ""} />
              <ConfirmSubmitButton
                level="critical"
                summary={sanctionSummary}
                details={[
                  { label: "대상", value: targetParty ? `${targetParty.name} (${DISPUTE_SANCTION_TARGET_LABELS[target!]})` : "미선택" },
                  { label: "기간", value: code ? DISPUTE_SANCTION_CODE_LABELS[code] : "미선택" },
                  { label: "해제 예정", value: code ? (code === "permanent" ? "수동 해제 전까지" : props.untilLabels[code]) : "—" },
                  { label: "분쟁 상태 →", value: code ? disputeStatusLabel(disputeSanctionStatus(code)) : "—" },
                ]}
                body={
                  <div className="space-y-3" data-dispute-sanction-options>
                    <div>
                      <p className="text-xs font-bold text-slate-700">제재 대상</p>
                      <div className="mt-1.5 flex flex-wrap gap-2" role="radiogroup" aria-label="제재 대상">
                        {targets.map((t) => {
                          const party = t === "student" ? student : mentor;
                          const on = target === t;
                          return (
                            <label key={t} className={cn(RADIO, on ? "border-red-400 bg-red-50 text-red-900" : "border-slate-200 text-slate-700 hover:bg-slate-50")}>
                              <input type="radio" name="dispute-sanction-target" value={t} checked={on} onChange={() => setTarget(t)} className="h-4 w-4" />
                              {DISPUTE_SANCTION_TARGET_LABELS[t]} · {party?.name ?? "—"}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs font-bold text-slate-700">기간</p>
                      <div className="mt-1.5 flex flex-wrap gap-2" role="radiogroup" aria-label="제재 기간">
                        {DISPUTE_SANCTION_CODES.map((c) => {
                          const on = code === c;
                          return (
                            <label key={c} className={cn(RADIO, on ? "border-red-400 bg-red-50 text-red-900" : "border-slate-200 text-slate-700 hover:bg-slate-50")}>
                              <input type="radio" name="dispute-sanction-code" value={c} checked={on} onChange={() => setCode(c)} className="h-4 w-4" />
                              {DISPUTE_SANCTION_CODE_LABELS[c]}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                }
                confirmBlockedMessage={sanctionReady ? null : DISPUTE_SANCTION_BLOCKED_MESSAGE}
                dialogTitle={DISPUTE_ACTIONS.sanction.dialogTitle}
                confirmLabel={DISPUTE_ACTIONS.sanction.confirmLabel}
                pendingLabel={DISPUTE_ACTIONS.sanction.pendingLabel}
                reasonFieldName={DISPUTE_SANCTION_NOTE_FIELD}
                reasonLabel="제재 사유"
                reasonPlaceholder="예: 외부 연락처 유도 — 대화 캡처 확인"
                className={`${BUTTON} bg-red-700 hover:bg-red-800`}
              >
                {DISPUTE_ACTIONS.sanction.label}
              </ConfirmSubmitButton>
            </form>
          )}
        </div>
      ) : null}

      <p className="mt-4 text-[11px] text-slate-500">
        상위 이관(에스컬레이션)으로 바꾸는 조치는 코드에 쓰기 경로가 없어 제공하지 않습니다. 보류·제재는 처리 후 분쟁 목록으로 돌아옵니다(기존 액션 동작).
      </p>
    </section>
  );
}
