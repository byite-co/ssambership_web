"use client";

/**
 * 정원 조정(PR-7 §2-3) — 미도달 라우트 `/admin/mentor-approvals/[id]` 에 있던 `updateMentorCapLimitAction` 을 그대로 재사용한다(새 액션 없음).
 * stateChange + 사유. 현재 사용량보다 낮게 설정하려 하면 확인 모달 summary 에 경고가 붙는다(막지는 않는다 — 기존 구독은 유지된다).
 * 클라이언트 컴포넌트인 이유는 입력값이 summary 를 따라가야 해서다. 사용량·한도는 서버가 넘긴 RPC 값이다.
 */
import { useState } from "react";
import { ConfirmSubmitButton } from "@/components/admin/ConfirmSubmitButton";
import { updateMentorCapLimitAction } from "@/lib/admin/mentorCapAdminActions";
import {
  MENTOR_CAP_ADJUST_BLOCKED_MESSAGE,
  MENTOR_CAP_ADJUST_FIELDS,
  MENTOR_CAP_ADJUST_MAX,
  MENTOR_CAP_ADJUST_MIN,
  MENTOR_CAP_ADJUST_STEP,
  buildMentorCapAdjustSummary,
  capAdjustBelowUsageWarning,
  formatCapNumber,
  parseCapLimitInput,
} from "@/lib/admin/accountDetailConsole";

type Props = {
  mentorUserId: string;
  mentorName: string;
  capLimit: number | null;
  usedCap: number | null;
};

export function MentorCapAdjustForm({ mentorUserId, mentorName, capLimit, usedCap }: Props) {
  const [raw, setRaw] = useState(capLimit == null ? "" : formatCapNumber(capLimit));
  const next = parseCapLimitInput(raw);
  const warning = capAdjustBelowUsageWarning(next, usedCap);

  return (
    <form action={updateMentorCapLimitAction} className="flex flex-wrap items-end gap-2" data-mentor-cap-adjust={mentorUserId}>
      <input type="hidden" name={MENTOR_CAP_ADJUST_FIELDS.mentorUserId} value={mentorUserId} />
      <label className="text-xs font-bold text-slate-600">
        새 한도
        <input
          type="number"
          name={MENTOR_CAP_ADJUST_FIELDS.capLimit}
          step={MENTOR_CAP_ADJUST_STEP}
          min={MENTOR_CAP_ADJUST_MIN}
          max={MENTOR_CAP_ADJUST_MAX}
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          className="mt-1 block w-28 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-900"
          aria-describedby="mentor-cap-adjust-hint"
        />
      </label>
      <ConfirmSubmitButton
        level="stateChange"
        summary={buildMentorCapAdjustSummary({ name: mentorName, currentLimit: capLimit, nextLimit: next, usedCap })}
        details={[
          { label: "현재 한도", value: formatCapNumber(capLimit) },
          { label: "새 한도", value: next == null ? "—" : formatCapNumber(next) },
          { label: "현재 사용량", value: formatCapNumber(usedCap) },
        ]}
        confirmBlockedMessage={next == null ? MENTOR_CAP_ADJUST_BLOCKED_MESSAGE : null}
        dialogTitle="정원 조정"
        confirmLabel="한도 저장"
        pendingLabel="저장 중…"
        reasonRequired
        reasonFieldName={MENTOR_CAP_ADJUST_FIELDS.reason}
        reasonLabel="조정 사유"
        reasonPlaceholder="예: 신규 멘토 온보딩 기간 한도 축소"
        className="h-[38px] rounded-lg bg-slate-900 px-4 text-sm font-extrabold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        정원 조정
      </ConfirmSubmitButton>
      <p id="mentor-cap-adjust-hint" className={warning ? "w-full text-[11px] font-bold text-amber-800" : "w-full text-[11px] text-slate-500"} role={warning ? "status" : undefined}>
        {warning ?? `${MENTOR_CAP_ADJUST_MIN}~${MENTOR_CAP_ADJUST_MAX} · 소수 1자리. 저장 후 이 화면으로 돌아옵니다.`}
      </p>
    </form>
  );
}
