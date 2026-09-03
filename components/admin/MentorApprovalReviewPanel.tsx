/**
 * 멘토 승인 작업대 — 우측 심사 패널(PR-2 §4~§7). Server Component.
 *
 *   ① 신원  — 가입 이름 ↔ 본인인증 실명 대조(일치 / 불일치 / 진행 중 / 만료·실패 / 시도 없음)
 *   ② 자격  — 대학·학과 · 과목 · 고교 · 소개 · 정원(DB RPC 값 그대로) · 같은 학교 당일 가입 경고
 *   ③ 학교 등급 — 자동 판정(미확정) / 확정됨 배지 · 등급·계열 드롭다운(상태 사전 값) · 확정 / 등급 정정(기존 RPC 한 경로 · PR-W1)
 *   ④ 결정  — 하단 고정(MentorApprovalDecisionBar). 이미 처리된 건은 배너로 대체.
 *
 * PR-2b: 결정 바 위에 보류 한 줄(H) · 보류 건은 메모·보류한 관리자·시각 배너 + `보류 해제` · 승인 건은 `승인 취소`(critical · 활성 구독 시 잠금) ·
 *   반려 건은 `반려 되돌리기` · 대기 행의 `승인 취소됨` 배지 · 다른 관리자가 보고 있으면 상단 안내(Presence, 잠금 없음).
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { AdminStatusPill } from "@/components/admin/AdminStatusPill";
import { ConfirmSubmitButton } from "@/components/admin/ConfirmSubmitButton";
import { IdentityReviewBlock } from "@/components/admin/IdentityReviewBlock";
import { MentorApprovalDecisionBar } from "@/components/admin/MentorApprovalDecisionBar";
import { MentorApprovalHoldBar } from "@/components/admin/MentorApprovalHoldBar";
import { MentorApprovalPresenceNotice } from "@/components/admin/MentorApprovalPresenceNotice";
import { MentorApprovalRevokeButton, MentorHoldReleaseButton, MentorRejectionRevertButton } from "@/components/admin/MentorApprovalStatusControls";
import { StatusBadge } from "@/components/design-system/StatusBadge";
import { EmptyState } from "@/components/common/EmptyState";
import { accountDetailPath } from "@/lib/admin/accountDetailConsole";
import { adminStatusAllowedValues, resolveAdminStatus } from "@/lib/admin/adminStatusDictionary";
import {
  buildMentorApproveSummary,
  buildMentorRejectSummary,
  buildMentorResubmitSummary,
  formatCapValue,
  mentorDecisionResultLabel,
  sameSchoolTodayWarning,
} from "@/lib/admin/mentorApprovalDecision";
import {
  MENTOR_APPROVAL_REVOKED_BADGE,
  MENTOR_HOLD_BUTTON_IDS,
  buildMentorHoldReleaseSummary,
  buildMentorHoldSummary,
  buildMentorRejectRevertSummary,
  buildMentorRevokeSummary,
  revokeBlockedMessage,
} from "@/lib/admin/mentorApprovalHold";
import { identityReviewLabel, identityReviewTone } from "@/lib/admin/mentorIdentityReview";
import {
  SCHOOL_TIER_BADGE_AUTO,
  SCHOOL_TIER_BADGE_CONFIRMED_PREFIX,
  buildSchoolTierConfirmSummary,
  schoolTierConfirmBlockerMessage,
  schoolTierConfirmButtonLabel,
  schoolTierConfirmDialogTitle,
  schoolTierConfirmPendingLabel,
} from "@/lib/admin/mentorSchoolTierReview";
import { approveMentorSchoolVerificationAction } from "@/lib/admin/mentorSchoolVerificationReviewActions";
import type { MentorApprovalDetail } from "@/lib/admin/mentorApprovalWorkbenchQueries";
import { formatKoreanDate } from "@/lib/utils/formatDisplay";
import { formatKoDateTimeKst } from "@/lib/utils/kstTime";

type Props = {
  detail: MentorApprovalDetail | null;
  flashError: string | null;
  /** 대기 0건 빈 상태에 함께 보이는 오늘 처리 건수 */
  decisionsToday: number | null;
  pendingCount: number;
};

function Section(props: { index: string; title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="border-b border-slate-100 px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-black tracking-tight text-slate-900">
          <span className="mr-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-[10px] font-black text-white">{props.index}</span>
          {props.title}
        </h3>
        {props.aside}
      </div>
      <div className="mt-2">{props.children}</div>
    </section>
  );
}

function Row(props: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1 text-xs">
      <dt className="w-20 shrink-0 font-bold text-slate-500">{props.label}</dt>
      <dd className="min-w-0 flex-1 text-right font-semibold text-slate-900">{props.children}</dd>
    </div>
  );
}

const SCHOOL_TIER_OPTIONS = adminStatusAllowedValues("mentor_school_verifications", "school_tier");
const MAJOR_CATEGORY_OPTIONS = adminStatusAllowedValues("mentor_school_verifications", "verified_major_category");

export function MentorApprovalReviewPanel(props: Props) {
  const { detail, flashError, decisionsToday, pendingCount } = props;

  if (!detail) {
    return (
      <div className="flex h-full min-h-[320px] flex-col rounded-2xl border border-slate-200 bg-white p-4">
        {pendingCount === 0 ? (
          <EmptyState
            title="대기 건이 없습니다"
            description={decisionsToday === null ? "오늘 처리 건수를 집계하지 못했습니다." : `오늘 처리 ${decisionsToday}건`}
          />
        ) : (
          <EmptyState title="심사할 지원자를 선택하세요" description="좌측 목록에서 지원자를 누르면 서류와 심사 정보가 여기에 보입니다." />
        )}
      </div>
    );
  }

  const { profile, user, identity, identityError, schoolTier, cap } = detail;
  const tierLabel = schoolTier.row ? resolveAdminStatus("mentor_school_verifications", "school_tier", schoolTier.suggestedTier).label : "—";
  const categoryLabel = schoolTier.row
    ? resolveAdminStatus("mentor_school_verifications", "verified_major_category", schoolTier.suggestedCategory).label
    : "—";
  const identityKind = identity?.kind ?? "none";
  const sameSchoolWarning = sameSchoolTodayWarning(detail.sameSchoolTodayCount);
  const subjects = Array.isArray(profile.teaching_subjects) ? profile.teaching_subjects.filter(Boolean) : [];
  const approveSummary = buildMentorApproveSummary({
    name: detail.displayName,
    university: profile.university_name ?? "",
    department: profile.department_name ?? "",
    tierConfirmed: schoolTier.row ? schoolTier.mode === "confirmed" : null,
    tierLabel,
    identityKind,
  });

  return (
    <div className="flex h-full min-h-0 flex-col rounded-2xl border border-slate-200 bg-white">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* 헤더 */}
        <div className="border-b border-slate-100 px-4 py-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="truncate text-base font-black text-slate-900">
                <Link href={accountDetailPath(detail.mentorUserId)} className="hover:underline" prefetch={false} title="계정 상세">
                  {detail.displayName}
                </Link>
              </h2>
              <p className="truncate text-xs text-slate-500">{user?.email ?? "이메일 없음"}</p>
            </div>
            <span className="flex shrink-0 items-center gap-1">
              {detail.revoked ? <StatusBadge label={MENTOR_APPROVAL_REVOKED_BADGE} tone="danger" size="sm" /> : null}
              <AdminStatusPill table="mentor_profiles" column="verification_status" value={detail.status} size="sm" className="shrink-0" />
            </span>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            신청 {formatKoreanDate(profile.created_at)} · 가입 {formatKoreanDate(user?.created_at)} ·{" "}
            <Link href={`/mentors/${encodeURIComponent(detail.mentorUserId)}`} className="font-bold text-blue-700 hover:underline" prefetch={false}>
              공개 프로필
            </Link>
          </p>
          <MentorApprovalPresenceNotice mentorId={detail.mentorUserId} />
          {detail.hold ? (
            <div className="mt-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-950" data-hold-banner>
              <p className="font-black">보류 중 — {detail.hold.note || "메모 없음"}</p>
              <p className="mt-0.5 text-[11px] text-sky-800">
                {detail.hold.adminName ?? "관리자 미상"} · {detail.hold.createdAt ? formatKoDateTimeKst(detail.hold.createdAt) : "시각 미상"} · 멘토에게는 알리지 않았습니다
              </p>
            </div>
          ) : !detail.decidable ? (
            <p className="mt-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-800" data-already-processed>
              이미 처리됨 —{" "}
              {detail.lastDecision
                ? `${formatKoDateTimeKst(detail.lastDecision.createdAt)} · ${detail.lastDecision.adminName ?? "관리자 미상"} · ${mentorDecisionResultLabel(detail.lastDecision.actionType)}`
                : `처리 기록 없음 · 현재 상태 ${resolveAdminStatus("mentor_profiles", "verification_status", detail.status).label}`}
            </p>
          ) : null}
        </div>

        {/* ① 신원 */}
        <Section
          index="①"
          title="신원"
          aside={identity ? <StatusBadge label={identityReviewLabel(identity.kind)} tone={identityReviewTone(identity.kind)} size="sm" /> : null}
        >
          {/* PR-7: 신원 블록은 계정 상세 헤더와 같은 컴포넌트(IdentityReviewBlock) — 렌더 결과는 PR-2 와 같다 */}
          <IdentityReviewBlock identity={identity} identityError={identityError} />
        </Section>

        {/* ② 자격 */}
        <Section index="②" title="자격">
          <dl className="divide-y divide-slate-50">
            <Row label="대학 · 학과">{[profile.university_name, profile.department_name].filter(Boolean).join(" · ") || "—"}</Row>
            <Row label="출신 고교">{profile.high_school_name?.trim() || "—"}</Row>
            <Row label="정원">
              <span className="tabular-nums" data-cap-used={cap.usedCap ?? ""} data-cap-limit={cap.capLimit ?? ""}>
                {formatCapValue(cap.usedCap)} / {formatCapValue(cap.capLimit)}
              </span>
              {cap.indeterminate ? <span className="ml-1 text-[10px] font-bold text-amber-700">판정 불가</span> : null}
            </Row>
          </dl>
          {subjects.length ? (
            <div className="mt-2 flex flex-wrap gap-1" aria-label="담당 과목">
              {subjects.map((s) => (
                <span key={s} className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-bold text-slate-700">
                  {s}
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-[11px] text-slate-400">담당 과목 미입력</p>
          )}
          {profile.intro_line?.trim() ? <p className="mt-2 text-xs font-semibold leading-5 text-slate-800">{profile.intro_line.trim()}</p> : null}
          {profile.bio?.trim() ? (
            <details className="mt-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
              <summary className="cursor-pointer text-[11px] font-bold text-slate-600">상세 소개 펼치기</summary>
              <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-slate-800">{profile.bio.trim()}</p>
            </details>
          ) : null}
          {sameSchoolWarning ? (
            <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-900" role="status">
              {sameSchoolWarning}
            </p>
          ) : null}
        </Section>

        {/* ③ 학교 등급 확정 */}
        <Section
          index="③"
          title="학교 등급"
          aside={
            schoolTier.mode === "none" ? (
              <StatusBadge label="인증 행 없음" tone="neutral" size="sm" />
            ) : schoolTier.mode === "auto" ? (
              <StatusBadge label={SCHOOL_TIER_BADGE_AUTO} tone="warning" size="sm" />
            ) : (
              <StatusBadge
                label={`${SCHOOL_TIER_BADGE_CONFIRMED_PREFIX} · ${detail.schoolTierReviewerName ?? "관리자"} · ${formatKoreanDate(schoolTier.row?.reviewed_at)}`}
                tone="success"
                size="sm"
              />
            )
          }
        >
          {schoolTier.row ? (
            <>
              <dl className="divide-y divide-slate-50" data-school-tier-mode={schoolTier.mode}>
                <Row label="제안 등급">
                  {tierLabel} · {categoryLabel}
                </Row>
                <Row label="인증 상태">
                  <AdminStatusPill table="mentor_school_verifications" column="status" value={schoolTier.row.status} size="sm" />
                </Row>
                <Row label="인증 학교">
                  {[schoolTier.row.verified_university_name, schoolTier.row.verified_department_name].filter(Boolean).join(" · ") || "—"}
                </Row>
              </dl>
              <form action={approveMentorSchoolVerificationAction} className="mt-2 space-y-2">
                <input type="hidden" name="verificationId" value={schoolTier.row.id} />
                <input type="hidden" name="verifiedUniversityName" value={schoolTier.row.verified_university_name ?? profile.university_name ?? ""} />
                <input type="hidden" name="verifiedUniversityId" value={schoolTier.row.verified_university_id ?? ""} />
                <input type="hidden" name="verifiedDepartmentName" value={schoolTier.row.verified_department_name ?? profile.department_name ?? ""} />
                <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                  <label className="block text-[11px] font-bold text-slate-700">
                    등급
                    <select
                      name="schoolTier"
                      defaultValue={schoolTier.suggestedTier}
                      disabled={!schoolTier.confirmable}
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold text-slate-900 disabled:bg-slate-50 disabled:text-slate-500"
                    >
                      {SCHOOL_TIER_OPTIONS.map((code) => (
                        <option key={code} value={code}>
                          {resolveAdminStatus("mentor_school_verifications", "school_tier", code).label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-[11px] font-bold text-slate-700">
                    계열
                    <select
                      name="verifiedMajorCategory"
                      defaultValue={schoolTier.suggestedCategory}
                      disabled={!schoolTier.confirmable}
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold text-slate-900 disabled:bg-slate-50 disabled:text-slate-500"
                    >
                      {MAJOR_CATEGORY_OPTIONS.map((code) => (
                        <option key={code} value={code}>
                          {resolveAdminStatus("mentor_school_verifications", "verified_major_category", code).label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <ConfirmSubmitButton
                    level="stateChange"
                    summary={buildSchoolTierConfirmSummary(detail.displayName, schoolTier)}
                    dialogTitle={schoolTierConfirmDialogTitle(schoolTier)}
                    confirmLabel={schoolTierConfirmButtonLabel(schoolTier)}
                    pendingLabel={schoolTierConfirmPendingLabel(schoolTier)}
                    disabled={!schoolTier.confirmable}
                    title={schoolTier.confirmable ? undefined : "현재 행은 확정 RPC 가 받지 않습니다"}
                    className="h-[34px] rounded-lg bg-slate-900 px-3 text-xs font-extrabold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    {schoolTierConfirmButtonLabel(schoolTier)}
                  </ConfirmSubmitButton>
                </div>
              </form>
              {schoolTier.blockers.length ? (
                <ul className="mt-2 space-y-1" data-school-tier-blockers>
                  {schoolTier.blockers.map((b) => (
                    <li key={b} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-semibold leading-4 text-slate-600">
                      {schoolTierConfirmBlockerMessage(b, schoolTier.row?.status)}
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : (
            <p className="text-[11px] text-slate-500">학교 인증 행이 없습니다. 제안 등급을 표시할 데이터가 없습니다.</p>
          )}
        </Section>
      </div>

      {/* ④ 결정 — 하단 고정. 보류(H)는 결정 바 위 한 줄(PR-2b) */}
      {detail.decidable ? (
        <>
          <MentorApprovalHoldBar mentorUserId={detail.mentorUserId} holdSummary={buildMentorHoldSummary(detail.displayName)} />
          <MentorApprovalDecisionBar
            mentorUserId={detail.mentorUserId}
            approveSummary={approveSummary}
            rejectSummary={buildMentorRejectSummary(detail.displayName)}
            resubmitSummary={buildMentorResubmitSummary(detail.displayName)}
            flashError={flashError}
          />
        </>
      ) : null}
      {/* PR-2b: 보류 해제 · 승인 취소(critical · 활성 구독 시 잠금) · 반려 되돌리기 — 하단 고정 */}
      {detail.hold ? (
        <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-white p-3" data-hold-release-bar>
          <p className="min-w-0 text-[11px] leading-4 text-slate-500">해제하면 대기 상태로 돌아가고 이 지원자가 그대로 선택돼 바로 결정할 수 있습니다.</p>
          <MentorHoldReleaseButton id={MENTOR_HOLD_BUTTON_IDS.release} mentorUserId={detail.mentorUserId} summary={buildMentorHoldReleaseSummary(detail.displayName)} />
        </div>
      ) : detail.status === "approved" ? (
        <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-white p-3" data-revoke-bar>
          <p className="min-w-0 text-[11px] leading-4 text-slate-500">승인을 취소하면 멘토 목록에서 사라지고 대기로 돌아갑니다. 학교 등급 확정·요금제는 유지됩니다.</p>
          <MentorApprovalRevokeButton
            id={MENTOR_HOLD_BUTTON_IDS.revoke}
            mentorUserId={detail.mentorUserId}
            summary={buildMentorRevokeSummary(detail.displayName)}
            blockedMessage={revokeBlockedMessage(detail.activeSubscriptionCount)}
          />
        </div>
      ) : detail.status === "rejected" ? (
        <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-white p-3" data-revert-bar>
          <p className="min-w-0 text-[11px] leading-4 text-slate-500">잘못 누른 반려는 대기로 되돌릴 수 있습니다. 되돌린 뒤 다시 심사합니다.</p>
          <MentorRejectionRevertButton id={MENTOR_HOLD_BUTTON_IDS.revert} mentorUserId={detail.mentorUserId} summary={buildMentorRejectRevertSummary(detail.displayName)} />
        </div>
      ) : null}
    </div>
  );
}
