/**
 * 계정 상세 — 멘토 탭(PR-7 §2-3). 섹션은 순서대로 접히고(`<details>`), 첫 화면에는 제목 + 요약 한 줄만 보인다. 경고는 요약 줄에 그대로 나온다.
 *
 *   프로필 · 학교 인증(`인증: …` 라벨 · 서류 뷰어 · 등급 확정) · 요금제(★ mentor_plans) · 정원(★ RPC + 요금제별 내역 · 정원 조정) ·
 *   활동 상태(`활동: …` 라벨 · 조치 버튼 없음) · 정산 계좌(미등록 경고) · 받은 리뷰(RPC 통계 · 최근 5건) · 처리 이력
 *
 * Server Component — 데이터는 `loadMentorAccountSection` 이 만든다. 정원·요금제 값을 여기서 계산하지 않는다.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { AccountActionLogList } from "@/components/admin/AccountActionLogList";
import { AdminStatusPill } from "@/components/admin/AdminStatusPill";
import { ConfirmSubmitButton } from "@/components/admin/ConfirmSubmitButton";
import { DocumentViewer } from "@/components/admin/DocumentViewer";
import { MentorCapAdjustForm } from "@/components/admin/MentorCapAdjustForm";
import { StatusBadge } from "@/components/design-system/StatusBadge";
import {
  MENTOR_PAYOUT_MISSING_WARNING,
  MENTOR_PLAN_MISSING_WARNING,
  capBreakdownMatchesUsed,
  capRemainingSeats,
  formatCapBreakdownLine,
  formatCapNumber,
  formatPlanCash,
  mentorActivitySectionLabel,
  mentorPlanSectionSummary,
  planTierLabel,
  schoolVerificationSectionLabel,
} from "@/lib/admin/accountDetailConsole";
import type { AccountActionLogs } from "@/lib/admin/accountDetailQueries";
import type { MentorAccountSection } from "@/lib/admin/accountMentorQueries";
import { adminStatusAllowedValues, resolveAdminStatus } from "@/lib/admin/adminStatusDictionary";
import { DOCUMENT_EMPTY_LABEL } from "@/lib/admin/documentViewerModel";
import { SCHOOL_TIER_BADGE_AUTO, SCHOOL_TIER_BADGE_CONFIRMED_PREFIX, schoolTierConfirmBlockerMessage } from "@/lib/admin/mentorSchoolTierReview";
import { approveMentorSchoolVerificationAction } from "@/lib/admin/mentorSchoolVerificationReviewActions";
import { formatCashKrw, formatKoreanDate } from "@/lib/utils/formatDisplay";
import { formatKoDateTimeKst } from "@/lib/utils/kstTime";
import { cn } from "@/lib/utils/cn";
import { settlementMentorTabPath } from "@/lib/admin/settlementConsole";

type Props = {
  userId: string;
  displayName: string;
  /** null = 역할은 멘토인데 `mentor_profiles` 행이 없다 */
  section: MentorAccountSection | null;
  logs: AccountActionLogs;
  logsMoreHref: string | null;
};

const SCHOOL_TIER_OPTIONS = adminStatusAllowedValues("mentor_school_verifications", "school_tier");
const MAJOR_CATEGORY_OPTIONS = adminStatusAllowedValues("mentor_school_verifications", "verified_major_category");

function Section(props: { id: string; title: string; label?: ReactNode; summary: ReactNode; tone?: "default" | "warning" | "danger"; children: ReactNode }) {
  const tone = props.tone ?? "default";
  return (
    <details className={cn("group rounded-2xl border bg-white shadow-sm", tone === "danger" ? "border-red-300" : tone === "warning" ? "border-amber-300" : "border-slate-200")} data-account-section={props.id}>
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-sm font-black tracking-tight text-slate-900">{props.title}</span>
          {props.label}
        </span>
        <span className={cn("min-w-0 truncate text-xs font-semibold", tone === "danger" ? "text-red-700" : tone === "warning" ? "text-amber-800" : "text-slate-600")} data-section-summary>
          {props.summary}
          <span className="ml-2 text-[10px] font-bold text-slate-400 group-open:hidden">펼치기</span>
        </span>
      </summary>
      <div className="border-t border-slate-100 px-4 py-4 text-sm text-slate-800">{props.children}</div>
    </details>
  );
}

function Row(props: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 py-1.5 text-xs last:border-b-0">
      <dt className="shrink-0 font-bold text-slate-500">{props.label}</dt>
      <dd className="min-w-0 text-right font-semibold text-slate-900">{props.children}</dd>
    </div>
  );
}

function DocumentBlock(props: { title: string; source: MentorAccountSection["studentIdDocument"]; alt: string; emptyHint: string }) {
  return (
    <div className="flex min-h-[320px] flex-col">
      <p className="mb-1 text-[11px] font-black text-slate-500">{props.title}</p>
      {props.source ? (
        <DocumentViewer key={props.source.storedRef} storagePath={props.source.storedRef} fileSizeBytes={props.source.sizeBytes} initialSource={props.source} alt={props.alt} className="min-h-[320px]" />
      ) : (
        <div className="flex min-h-[320px] flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
          <p className="text-sm font-extrabold text-slate-700">{DOCUMENT_EMPTY_LABEL}</p>
          <p className="mt-1 text-xs text-slate-500">{props.emptyHint}</p>
        </div>
      )}
    </div>
  );
}

export function AccountMentorTab({ userId, displayName, section, logs, logsMoreHref }: Props) {
  if (!section) {
    return (
      <div className="space-y-3">
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900">
          역할은 멘토이지만 멘토 프로필(mentor_profiles) 행이 없습니다. 온보딩이 끝나지 않은 계정입니다.
        </p>
        <Section id="logs" title="처리 이력" summary={`${logs.rows.length}건`}>
          <AccountActionLogList logs={logs} mode="target" moreHref={logsMoreHref} />
        </Section>
      </div>
    );
  }

  const { profile, schoolTier, plans, cap, activity, payout, reviews } = section;
  const tierLabel = schoolTier.row ? resolveAdminStatus("mentor_school_verifications", "school_tier", schoolTier.suggestedTier).label : "—";
  const categoryLabel = schoolTier.row ? resolveAdminStatus("mentor_school_verifications", "verified_major_category", schoolTier.suggestedCategory).label : "—";
  const breakdown = section.capBreakdown;
  const breakdownMatches = breakdown ? capBreakdownMatchesUsed(breakdown.total, cap.usedCap) : null;
  const premiumSeats = capRemainingSeats(cap.capLimit, cap.usedCap, cap.capWeightByTier?.premium ?? null);
  const plansMissing = section.plansMissing;

  return (
    <div className="space-y-3" data-account-mentor-tab={userId}>
      {/* 프로필 */}
      <Section
        id="profile"
        title="프로필"
        summary={[profile.university, profile.department].filter(Boolean).join(" · ") || "학교 미입력"}
      >
        <div className="grid gap-4 md:grid-cols-[96px_1fr]">
          {profile.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- 외부 스토리지 프로필 사진(관리자 참고용)
            <img src={profile.photoUrl} alt={`${displayName} 프로필 사진`} className="h-24 w-24 rounded-2xl border border-slate-200 object-cover" />
          ) : (
            <div className="flex h-24 w-24 items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 text-xs font-bold text-slate-400">사진 없음</div>
          )}
          <dl>
            <Row label="대학 · 학과">{[profile.university, profile.department].filter(Boolean).join(" · ") || "—"}</Row>
            <Row label="출신 고교">{profile.highSchool ?? "—"}</Row>
            <Row label="담당 과목">{profile.subjects.length ? profile.subjects.join(", ") : "미입력"}</Row>
            <Row label="구독 오픈">{profile.isOpenForSubscriptions == null ? "—" : profile.isOpenForSubscriptions ? "받는 중" : "닫힘"}</Row>
            <Row label="프로필 생성">{formatKoreanDate(profile.createdAt)}</Row>
            <Row label="공개 프로필">
              <Link href={`/mentors/${encodeURIComponent(userId)}`} className="font-bold text-blue-700 hover:underline" prefetch={false}>
                열기
              </Link>
            </Row>
          </dl>
        </div>
        {profile.introLine ? <p className="mt-3 text-xs font-semibold leading-5 text-slate-800">{profile.introLine}</p> : null}
        {profile.bio ? <p className="mt-2 whitespace-pre-wrap rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-800">{profile.bio}</p> : null}
      </Section>

      {/* 학교 인증 */}
      <Section
        id="school"
        title="학교 인증"
        label={
          schoolTier.mode === "none" ? (
            <StatusBadge label={schoolVerificationSectionLabel("none")} tone="neutral" size="sm" />
          ) : schoolTier.mode === "auto" ? (
            <StatusBadge label={schoolVerificationSectionLabel("auto")} tone="warning" size="sm" />
          ) : (
            <StatusBadge label={schoolVerificationSectionLabel("confirmed")} tone="success" size="sm" />
          )
        }
        summary={schoolTier.row ? `${tierLabel} · ${categoryLabel} · ${[schoolTier.row.verified_university_name, schoolTier.row.verified_department_name].filter(Boolean).join(" ") || "인증 학교 미입력"}` : "학교 인증 행 없음"}
      >
        {schoolTier.row ? (
          <>
            <dl data-school-tier-mode={schoolTier.mode}>
              <Row label="인증 학교">{[schoolTier.row.verified_university_name, schoolTier.row.verified_department_name].filter(Boolean).join(" · ") || "—"}</Row>
              <Row label="등급 · 계열">
                {tierLabel} · {categoryLabel}
              </Row>
              <Row label="인증 상태">
                <AdminStatusPill table="mentor_school_verifications" column="status" value={schoolTier.row.status} size="sm" />
              </Row>
              <Row label="판정">
                {schoolTier.mode === "auto" ? (
                  <StatusBadge label={SCHOOL_TIER_BADGE_AUTO} tone="warning" size="sm" />
                ) : (
                  <StatusBadge label={`${SCHOOL_TIER_BADGE_CONFIRMED_PREFIX} · ${section.schoolTierReviewerName ?? "관리자"} · ${formatKoreanDate(schoolTier.row.reviewed_at)}`} tone="success" size="sm" />
                )}
              </Row>
            </dl>
            <form action={approveMentorSchoolVerificationAction} className="mt-3 space-y-2" data-school-tier-confirm>
              <input type="hidden" name="verificationId" value={schoolTier.row.id} />
              <input type="hidden" name="verifiedUniversityName" value={schoolTier.row.verified_university_name ?? profile.university ?? ""} />
              <input type="hidden" name="verifiedUniversityId" value={schoolTier.row.verified_university_id ?? ""} />
              <input type="hidden" name="verifiedDepartmentName" value={schoolTier.row.verified_department_name ?? profile.department ?? ""} />
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
                  summary={`${displayName} 멘토의 학교 등급을 확정합니다. 확정하면 reviewed_by 에 처리한 관리자가 기록되고, 멘토 승인 화면으로 이동합니다.`}
                  dialogTitle="학교 등급 확정"
                  confirmLabel="확정"
                  pendingLabel="확정 중…"
                  disabled={!schoolTier.confirmable}
                  title={schoolTier.confirmable ? undefined : "현재 행은 확정 RPC 가 받지 않습니다"}
                  className="h-[34px] rounded-lg bg-slate-900 px-3 text-xs font-extrabold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  확정
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
          <p className="text-xs text-slate-500">학교 인증 행이 없습니다. 제안 등급을 표시할 데이터가 없습니다.</p>
        )}
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <DocumentBlock title="학생증 · 재학증명" source={section.studentIdDocument} alt={`${displayName} 학생증`} emptyHint="학생증이 제출되지 않았습니다." />
          <DocumentBlock title="학교 인증 서류" source={section.schoolDocument} alt={`${displayName} 학교 인증 서류`} emptyHint="학교 인증 서류가 제출되지 않았습니다." />
        </div>
      </Section>

      {/* 요금제 ★ */}
      <Section id="plans" title="요금제" summary={section.plansError ?? mentorPlanSectionSummary(plans)} tone={section.plansError || plansMissing ? "danger" : "default"}>
        {plansMissing ? (
          <p role="alert" className="mb-3 rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-xs font-bold text-red-900" data-plan-missing-warning>
            {MENTOR_PLAN_MISSING_WARNING}
          </p>
        ) : null}
        {section.plansError ? (
          <p className="text-xs font-bold text-amber-900">{section.plansError}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] font-bold text-slate-500">
                  <th className="py-2 pr-3">요금제</th>
                  <th className="py-2 pr-3">현재가</th>
                  <th className="py-2 pr-3">허용 범위</th>
                  <th className="py-2 pr-3">최종 변경일</th>
                  <th className="py-2">활성</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {plans.map((p) => (
                  <tr key={p.tier} data-plan-tier={p.tier} data-plan-present={p.present}>
                    <td className="py-2 pr-3 font-extrabold text-slate-900">{p.label}</td>
                    <td className="py-2 pr-3 tabular-nums">
                      {p.present ? formatPlanCash(p.cashKrw) : <span className="text-red-700">미설정</span>}
                      {p.fallbackToRecommended ? <span className="ml-1 text-[10px] font-bold text-amber-700">권장가 폴백</span> : null}
                    </td>
                    <td className="py-2 pr-3 tabular-nums text-slate-600">
                      {formatPlanCash(p.band.minCashKrw)} ~ {formatPlanCash(p.band.maxCashKrw)}
                    </td>
                    <td className="py-2 pr-3 tabular-nums text-slate-600">{formatKoreanDate(p.priceUpdatedAt)}</td>
                    <td className="py-2">{p.isActive == null ? "—" : p.isActive ? <StatusBadge label="활성" tone="success" size="sm" /> : <StatusBadge label="비활성" tone="neutral" size="sm" />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <dl className="mt-3">
          <Row label="개별질문 답변 단가">
            {section.individualQuestion.error
              ? section.individualQuestion.error
              : section.individualQuestion.cashKrw == null
                ? "미설정"
                : `${formatCashKrw(section.individualQuestion.cashKrw)} · ${formatKoreanDate(section.individualQuestion.updatedAt)}`}
          </Row>
        </dl>
      </Section>

      {/* 정원 ★ */}
      <Section
        id="cap"
        title="정원"
        summary={cap.indeterminate ? "판정 불가(RPC)" : `${formatCapNumber(cap.usedCap)} / ${formatCapNumber(cap.capLimit)}${cap.isFull ? " · 마감" : ""}`}
        tone={cap.indeterminate ? "warning" : "default"}
      >
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-2xl font-black tabular-nums text-slate-900" data-cap-used={cap.usedCap ?? ""} data-cap-limit={cap.capLimit ?? ""}>
              {formatCapNumber(cap.usedCap)} <span className="text-base font-bold text-slate-400">/ {formatCapNumber(cap.capLimit)}</span>
              {cap.indeterminate ? <span className="ml-2 text-xs font-bold text-amber-700">판정 불가</span> : null}
              {cap.isFull ? <span className="ml-2 text-xs font-bold text-[#e08a2f]">구독 마감</span> : null}
            </p>
            {breakdown ? (
              <p className="mt-1 text-xs text-slate-700" data-cap-breakdown data-cap-breakdown-total={breakdown.total} data-cap-breakdown-matches={breakdownMatches}>
                {formatCapBreakdownLine(breakdown.rows)}
                {breakdownMatches === false ? <span className="ml-2 font-bold text-amber-700">내역 합 {formatCapNumber(breakdown.total)} ≠ 사용량</span> : null}
              </p>
            ) : (
              <p className="mt-1 text-xs font-bold text-amber-800">{section.capBreakdownError ?? "요금제별 내역을 표시할 수 없습니다."}</p>
            )}
            <p className="mt-1 text-xs text-slate-500">
              {premiumSeats == null ? "추가 수용 인원 판정 불가" : `${planTierLabel("premium")} 기준 ${premiumSeats}명 더 수용 가능`}
              {cap.activeCount != null ? ` · 활성 구독 ${cap.activeCount}명` : ""}
            </p>
          </div>
          <MentorCapAdjustForm mentorUserId={userId} mentorName={displayName} capLimit={cap.capLimit} usedCap={cap.usedCap} />
        </div>
      </Section>

      {/* 활동 상태 */}
      <Section
        id="activity"
        title="활동 상태"
        label={<StatusBadge label={mentorActivitySectionLabel(activity.state)} tone={activity.state === "active" ? "success" : activity.state === "paused" ? "warning" : "danger"} size="sm" />}
        summary={
          activity.state === "paused"
            ? `복귀 예정 ${formatKoreanDate(activity.pauseUntil)}`
            : activity.state === "terminating"
              ? `종료 예정 ${formatKoreanDate(activity.terminationEffectiveAt)}`
              : activity.state === "terminated"
                ? "활동 종료"
                : "정상 활동 중"
        }
      >
        <dl>
          <Row label="activity_status">{activity.raw ?? "—"}</Row>
          <Row label="일시정지 복귀(pause_until)">{formatKoDateTimeKst(activity.pauseUntil)}</Row>
          {activity.pauseReason ? <Row label="일시정지 사유">{activity.pauseReason}</Row> : null}
          <Row label="종료 효력(termination_effective_at)">{formatKoDateTimeKst(activity.terminationEffectiveAt)}</Row>
          <Row label="이탈 플래그(abandonment_flagged_at)">{formatKoDateTimeKst(activity.abandonmentFlaggedAt)}</Row>
        </dl>
        <p className="mt-2 text-[11px] text-slate-500">활동 상태는 멘토 본인이 정한다 — 이 화면에는 조치 버튼이 없다.</p>
      </Section>

      {/* 정산 계좌 */}
      <Section id="payout" title="정산 계좌" summary={payout.registered ? `${payout.bankName} ${payout.accountMasked}` : MENTOR_PAYOUT_MISSING_WARNING} tone={payout.registered ? "default" : "warning"}>
        {payout.registered ? (
          <dl>
            <Row label="은행">{payout.bankName}</Row>
            <Row label="계좌번호">{payout.accountMasked}</Row>
            <Row label="등록 여부">등록됨</Row>
          </dl>
        ) : (
          <p role="status" className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900" data-payout-missing-warning>
            {MENTOR_PAYOUT_MISSING_WARNING} — 멘토가 프로필 관리에서 계좌를 등록해야 정산이 지급됩니다.
          </p>
        )}
        {/* PR-9: 이 멘토의 정산 항목 전체(구독·개별질문·맞춤의뢰)는 정산 관리 멘토별 탭에서 */}
        <p className="mt-3">
          <Link href={settlementMentorTabPath(userId)} className="text-xs font-extrabold text-blue-700 hover:underline" prefetch={false} data-settlement-mentor-link>
            정산 항목 보기 →
          </Link>
        </p>
      </Section>

      {/* 받은 리뷰 */}
      <Section
        id="reviews"
        title="받은 리뷰"
        summary={reviews.statsError ?? (reviews.stats ? `평균 ${reviews.stats.avg == null ? "—" : reviews.stats.avg.toFixed(1)} · ${reviews.stats.count}건` : "—")}
      >
        {reviews.stats ? (
          <p className="text-xs text-slate-600">
            분포 {([5, 4, 3, 2, 1] as const).map((r) => `${r}점 ${reviews.stats!.distribution[r]}`).join(" · ")} (숨김·블라인드 포함 — 평균은 RPC 집계값)
          </p>
        ) : null}
        {reviews.recentError ? (
          <p className="mt-2 text-xs font-bold text-amber-900">{reviews.recentError}</p>
        ) : reviews.recent.length ? (
          <ul className="mt-2 divide-y divide-slate-100">
            {reviews.recent.map((r) => (
              <li key={r.id} className="py-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-extrabold text-slate-900">{r.rating == null ? "—" : `★ ${r.rating}`}</span>
                  <span className="text-slate-500">
                    {formatKoreanDate(r.createdAt)}
                    {r.hidden ? <span className="ml-1 font-bold text-amber-700">숨김</span> : null}
                    {r.moderationState && r.moderationState !== "visible" ? <span className="ml-1 text-slate-400">{r.moderationState}</span> : null}
                  </span>
                </div>
                <p className="mt-0.5 line-clamp-2 text-slate-700">{r.body || "(내용 없음)"}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-slate-600">받은 리뷰가 없습니다.</p>
        )}
      </Section>

      {/* 처리 이력 */}
      <Section id="logs" title="처리 이력" summary={logs.error ? logs.error : `${logs.rows.length}건${logs.totalCount != null && logs.totalCount > logs.rows.length ? ` / 전체 ${logs.totalCount}건` : ""}`}>
        <AccountActionLogList logs={logs} mode="target" moreHref={logsMoreHref} />
      </Section>
    </div>
  );
}
