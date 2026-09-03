/**
 * 멘토 승인 작업대 — "오늘 내가 처리한 건"(PR-2b §3-3). 승인 화면 상단의 접힌 블록. Server Component.
 *
 *   ▸ 오늘 내가 처리한 건 12 (승인 10 · 반려 1 · 보류 1)
 *
 * - 건수·목록은 `admin_action_logs`(admin_id = 나 · 오늘 KST) 집계 그대로(건수 = 감사 로그).
 * - 각 행의 `되돌리기` 는 그 처리가 만든 상태에 멘토가 **아직 있을 때만**: 승인 → 승인 취소(critical) · 반려 → 반려 되돌리기 · 보류 → 보류 해제.
 *   이미 다른 상태면 현재 상태 배지만 보인다(되돌릴 대상이 아니다).
 */
import Link from "next/link";
import { AdminStatusPill } from "@/components/admin/AdminStatusPill";
import { MentorApprovalRevokeButton, MentorHoldReleaseButton, MentorRejectionRevertButton } from "@/components/admin/MentorApprovalStatusControls";
import type { AdminListParams } from "@/lib/admin/adminListParams";
import {
  buildMentorHoldReleaseSummary,
  buildMentorRejectRevertSummary,
  buildMentorRevokeSummary,
  formatKstShortDateTime,
  formatMentorDecisionsTodayHeading,
  mentorApprovalHistoryLabel,
  revokeBlockedMessage,
} from "@/lib/admin/mentorApprovalHold";
import { MENTOR_APPROVAL_SELECTED_PARAM, buildMentorApprovalListUrl } from "@/lib/admin/mentorApprovalQueue";
import type { MentorDecisionsTodayResult } from "@/lib/admin/mentorApprovalWorkbenchQueries";

type Props = {
  data: MentorDecisionsTodayResult;
  /** `mentor` 키가 제거된 목록 파라미터 — 행 링크는 전체 탭에서 그 지원자를 선택한다 */
  listParams: AdminListParams;
};

export function MentorApprovalTodayPanel({ data, listParams }: Props) {
  const heading = formatMentorDecisionsTodayHeading(data.summary);
  const hrefFor = (id: string) =>
    buildMentorApprovalListUrl(listParams, { status: "all", search: "", page: 1, extra: { [MENTOR_APPROVAL_SELECTED_PARAM]: id } });

  return (
    <details className="rounded-2xl border border-slate-200 bg-white" data-today-panel>
      <summary className="cursor-pointer select-none px-4 py-3 text-sm font-black text-slate-900">{heading}</summary>
      <div className="border-t border-slate-100">
        {data.error ? (
          <p className="px-4 py-3 text-xs font-bold text-red-900">오늘 처리 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</p>
        ) : data.rows.length === 0 ? (
          <p className="px-4 py-3 text-xs text-slate-500">오늘 처리한 건이 없습니다.</p>
        ) : (
          <ol className="divide-y divide-slate-100" aria-label="오늘 내가 처리한 건">
            {data.rows.map((row) => (
              <li key={row.logId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-xs">
                <div className="min-w-0">
                  <Link href={hrefFor(row.mentorUserId)} className="font-extrabold text-slate-900 hover:underline" prefetch={false}>
                    {row.mentorName}
                  </Link>
                  <span className="text-slate-500">
                    {" "}
                    · {mentorApprovalHistoryLabel(row.actionType)} · <span className="tabular-nums">{formatKstShortDateTime(row.createdAt)}</span>
                  </span>
                  {row.reason ? <span className="text-slate-500"> — {row.reason}</span> : null}
                </div>
                <div className="flex items-center gap-2">
                  <AdminStatusPill table="mentor_profiles" column="verification_status" value={row.currentStatus} size="sm" />
                  {row.undo === "revoke" ? (
                    <MentorApprovalRevokeButton
                      size="sm"
                      mentorUserId={row.mentorUserId}
                      summary={buildMentorRevokeSummary(row.mentorName)}
                      blockedMessage={revokeBlockedMessage(row.activeSubscriptionCount)}
                    />
                  ) : row.undo === "revert" ? (
                    <MentorRejectionRevertButton size="sm" mentorUserId={row.mentorUserId} summary={buildMentorRejectRevertSummary(row.mentorName)} />
                  ) : row.undo === "release" ? (
                    <MentorHoldReleaseButton size="sm" mentorUserId={row.mentorUserId} summary={buildMentorHoldReleaseSummary(row.mentorName)} />
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </details>
  );
}
