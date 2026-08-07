import Link from "next/link";
import { BadgeCheck } from "lucide-react";
import { MentorDetailCTASection } from "@/components/mentor/MentorDetailCTASection";
import { MentorDetailHeaderActions } from "@/components/mentor/MentorDetailHeaderActions";
import { MentorDetailSubjectTabs } from "@/components/mentor/MentorDetailSubjectTabs";
import { MentorDetailSubscribeSidebar } from "@/components/mentor/MentorDetailSubscribeSidebar";
import { MentorReviewsCarousel } from "@/components/mentor/MentorReviewsCarousel";
import { SurfaceCard } from "@/components/design-system/SurfaceCard";
import { mentorVerificationKo, type MentorProfileDisplay } from "@/lib/mentor/mentorDisplayFields";
import type { PublicMentorLoadResult } from "@/lib/mentor/publicMentorBundle";
import { assignPlansByTier } from "@/lib/subscribe/subscribePageQueries";
import {
  mentorIsVerified,
  mentorSchoolGradeLine,
  mentorSchoolVerificationBadgeClass,
  mentorSchoolVerificationBadgeLabel,
  mentorSchoolVerificationMetaLine,
  mentorSubjectChips,
} from "@/lib/mentor/mentorPublicProfileDisplay";
import type { AppRole, UserRow } from "@/lib/types/user";
import { ReviewEligibilityBanner } from "@/components/reviews/ReviewEligibilityBanner";
import { ReviewWriteModal } from "@/components/reviews/ReviewWriteModal";
import type { ReviewEligibilityResult } from "@/lib/reviews/checkReviewEligibility";
import {
  USER_UI_MENTOR_PROFILE_LOAD_FAILED,
  USER_UI_MENTOR_USER_LOAD_FAILED,
} from "@/lib/constants/userFacingMessages";
import {
  avgResponseHoursFromProfileRow,
  formatAvgResponseHoursLabel,
} from "@/lib/mentor/avgResponseHoursDisplay";

type Row = Record<string, unknown>;

function statFromProfile(row: Row | null, keys: string[]): number | null {
  if (!row) return null;
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "number" && Number.isFinite(v)) return Math.round(v);
  }
  return null;
}

function mentorDetailStats(
  profileRow: Row | null,
  reviews: { count: number | null; avgRating: number | null },
  avgResponseHours?: number | null
) {
  const totalAnswers = statFromProfile(profileRow, [
    "total_answers",
    "cumulative_answers",
    "answer_count",
  ]);
  const connectedStudents = statFromProfile(profileRow, [
    "connected_students",
    "student_count",
    "active_students",
  ]);
  const responseHours = avgResponseHours ?? avgResponseHoursFromProfileRow(profileRow);
  const avgResponseLabel = formatAvgResponseHoursLabel(responseHours);
  const satisfactionLabel =
    reviews.avgRating != null
      ? `${Math.round((reviews.avgRating / 5) * 100)}%`
      : "—";

  return {
    totalAnswers,
    connectedStudents,
    avgResponseLabel,
    satisfactionLabel,
    reviewCount: reviews.count,
    avgRating: reviews.avgRating,
  };
}

export function PublicMentorDetailBody(props: {
  mentorId: string;
  userRow: UserRow;
  display: MentorProfileDisplay;
  bundle: Extract<PublicMentorLoadResult, { kind: "ok" }>;
  viewer?: { userId: string; role: AppRole } | null;
  reviewEligibility?: ReviewEligibilityResult | null;
  isLoggedIn?: boolean;
  initialFavorited?: boolean;
  freeQuestionRemaining?: number | null;
  subscriptionClosed?: boolean;
  avgResponseHours?: number | null;
  individualQuestionPriceCents?: number | null;
}) {
  const { mentorId, display, bundle, viewer, reviewEligibility } = props;
  const isLoggedIn = props.isLoggedIn ?? Boolean(viewer);
  const { byTier } = assignPlansByTier(bundle.plans.rows as Row[]);
  const subscribeHref = `/subscribe?mentorId=${encodeURIComponent(mentorId)}`;
  const freeQuestionHref = isLoggedIn
    ? `/question-room?mentorId=${encodeURIComponent(mentorId)}`
    : `/login/student?next=${encodeURIComponent(`/mentors/${mentorId}`)}`;
  const individualQuestionHref =
    viewer?.role === "student"
      ? `/mentors/${encodeURIComponent(mentorId)}/individual-question/new`
      : `/login/student?next=${encodeURIComponent(`/mentors/${mentorId}/individual-question/new`)}`;

  const verified = mentorIsVerified(display.verification);
  const schoolLine = mentorSchoolGradeLine(display);
  const schoolMeta = mentorSchoolVerificationMetaLine(display);
  const chips = mentorSubjectChips(display.subjects || display.tags, 8);
  const introLong =
    display.intro?.trim() ||
    "멘토 소개가 곧 업데이트될 예정이에요. 구독 전 궁금한 점은 무료 질문권으로 먼저 확인해 보세요.";

  const stats = mentorDetailStats(bundle.profileRow, {
    count: bundle.reviews.count,
    avgRating: bundle.reviews.avgRating,
  }, props.avgResponseHours);

  const photo = display.photoUrl?.trim();
  const verKo = mentorVerificationKo(display.verification);

  // 표본이 적으면(리뷰<3) 만족도 %를 과장 노출하지 않고, 느린 응답(48시간 이상) 칸은 숨김
  const enoughReviews = (stats.reviewCount ?? 0) >= 3;
  const isSlowResponse =
    !stats.avgResponseLabel || stats.avgResponseLabel === "—" || stats.avgResponseLabel.includes("48시간 이상");

  // 대상 학년: 멘토 목록 필터(gradeMatchesFilter)와 동일한 휴리스틱으로 프로필 텍스트에서 도출
  const gradeBlob = [display.subjects, display.tags, display.intro].filter(Boolean).join(" ").toLowerCase();
  const targetGradesLabel =
    [
      /중등|중학|중1|중2|중3/.test(gradeBlob) ? "중등" : null,
      /고등|고1|고2|고3|내신|수능/.test(gradeBlob) ? "고등" : null,
      /n수|재수|검정/.test(gradeBlob) ? "N수" : null,
    ]
      .filter(Boolean)
      .join(" · ") || "전체 학년";

  const statCards = [
    {
      label: "누적 답변 수",
      value:
        stats.totalAnswers != null
          ? `${stats.totalAnswers.toLocaleString("ko-KR")}개+`
          : "—",
      hint: "정성 답변 제공",
    },
    {
      label: "연결 학생 수",
      value:
        stats.connectedStudents != null
          ? `${stats.connectedStudents.toLocaleString("ko-KR")}명+`
          : "—",
      hint: "누적 학생 수",
    },
    ...(!isSlowResponse
      ? [{ label: "평균 답변 시간", value: stats.avgResponseLabel, hint: "빠른 답변" }]
      : []),
    enoughReviews
      ? { label: "답변 만족도", value: stats.satisfactionLabel, hint: "실제 학생 평가" }
      : { label: "멘토 등급", value: "신규 멘토", hint: "리뷰가 쌓이면 공개돼요" },
    { label: "대상 학년", value: targetGradesLabel, hint: "멘토링 대상" },
  ];

  const trustBadges = [
    {
      title: display.schoolVerified ? `${display.university || "대학"} 인증` : "학교·전공 미인증",
      sub: display.schoolVerified ? "학교·전공 검증 완료" : "자유입력 참고 정보",
    },
    { title: "멘토 승인", sub: verified ? "멘토 인증 완료" : "승인 검토 중" },
    { title: "활동 인증", sub: verified ? "우수 멘토" : "활동 검증 예정" },
    {
      title: enoughReviews && stats.avgRating != null ? `★ ${stats.avgRating.toFixed(1)}` : "신규 멘토",
      sub:
        enoughReviews && stats.reviewCount != null
          ? `리뷰 ${stats.reviewCount.toLocaleString("ko-KR")}개`
          : "리뷰가 쌓이는 중",
    },
  ];

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 pb-16 sm:px-6 lg:px-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/mentors"
          className="inline-flex items-center text-sm font-extrabold text-slate-600 transition hover:text-[#2563EB]"
        >
          ← 멘토 찾기로 돌아가기
        </Link>
        <MentorDetailHeaderActions
          mentorId={mentorId}
          isLoggedIn={isLoggedIn}
          initialFavorited={props.initialFavorited ?? false}
        />
      </div>

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-12 xl:gap-10">
        <div className="min-w-0 space-y-6 xl:col-span-8">
          {/* 프로필 헤더 */}
          <SurfaceCard tone="neutral" bodyClassName="sm:p-6">
            <div className="flex flex-col gap-5 sm:flex-row sm:gap-6">
              <div className="relative mx-auto h-[120px] w-[120px] shrink-0 sm:mx-0">
                <div className="h-[120px] w-[120px] overflow-hidden rounded-full border-4 border-white bg-[#059669]/10 shadow-md ring-2 ring-slate-100">
                  {photo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photo} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-[#059669]/10 text-3xl font-black text-[#059669]">
                      {(display.displayName || "멘").trim().slice(0, 1)}
                    </div>
                  )}
                </div>
              </div>
              <div className="min-w-0 flex-1 text-center sm:text-left">
                <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                  <h1 className="text-2xl font-black text-slate-900 sm:text-3xl">{display.displayName}</h1>
                  {verified ? (
                    <span className="inline-flex items-center gap-0.5 rounded-md bg-[#059669] px-2 py-0.5 text-xs font-black text-white">
                      <BadgeCheck className="h-3.5 w-3.5" aria-hidden />
                      인증
                    </span>
                  ) : null}
                </div>
                <div className="mt-1 flex flex-wrap items-center justify-center gap-1.5 text-sm font-bold text-slate-700 sm:justify-start">
                  <span>{schoolLine}</span>
                  <span
                    className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-black ${mentorSchoolVerificationBadgeClass(display)}`}
                  >
                    {mentorSchoolVerificationBadgeLabel(display)}
                  </span>
                  {schoolMeta ? <span className="text-[11px] font-bold text-slate-500">{schoolMeta}</span> : null}
                </div>
                {chips.length > 0 ? (
                  <ul className="mt-3 flex flex-wrap justify-center gap-1.5 sm:justify-start">
                    {chips.map((c) => (
                      <li
                        key={c}
                        className="rounded-md border border-[#2563EB]/40 bg-blue-50/30 px-2 py-0.5 text-[11px] font-bold text-[#2563EB]"
                      >
                        {c}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {bundle.userError ? (
                  <p className="mt-2 text-xs font-bold text-amber-800">{USER_UI_MENTOR_USER_LOAD_FAILED}</p>
                ) : null}
                {bundle.profileError ? (
                  <p className="mt-1 text-xs font-bold text-amber-800">{USER_UI_MENTOR_PROFILE_LOAD_FAILED}</p>
                ) : null}
              </div>
            </div>

            <ul className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {trustBadges.map((b) => (
                <li
                  key={b.title}
                  className="rounded-xl border border-slate-100 bg-slate-50/80 px-2.5 py-2.5 text-center sm:px-3"
                >
                  <p className="text-[11px] font-black text-slate-900">{b.title}</p>
                  <p className="mt-0.5 text-[10px] font-semibold text-slate-500">{b.sub}</p>
                </li>
              ))}
            </ul>
          </SurfaceCard>

          {/* 멘토 소개 */}
          <SurfaceCard tone="neutral" title="멘토 소개">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{introLong}</p>
            <p className="mt-3 text-xs text-slate-500">인증 상태: {verKo}</p>
          </SurfaceCard>

          {/* 통계 카드 */}
          <div className={`grid grid-cols-2 gap-3 ${statCards.length === 5 ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}>
            {statCards.map((s) => (
              <div
                key={s.label}
                className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <p className="text-[10px] font-bold text-slate-500">{s.label}</p>
                <p className="mt-1 text-lg font-black tabular-nums text-slate-900">{s.value}</p>
                <p className="mt-0.5 text-[10px] font-semibold text-[#2563EB]">{s.hint}</p>
              </div>
            ))}
          </div>

          <MentorDetailSubjectTabs display={display} />

          {/* D-MT-13: 대표 콘텐츠(미디어) 섹션 제거 — 소스가 스텁이라 상시 빈 결과였다. */}

          <MentorReviewsCarousel mentorId={mentorId} />

          {viewer?.role === "student" ? (
            <SurfaceCard tone="neutral" title="리뷰 작성">
              <div className="space-y-4">
                <ReviewEligibilityBanner
                  eligibilityKnown={reviewEligibility != null}
                  eligible={reviewEligibility?.eligible === true}
                  mode={reviewEligibility?.mode}
                  canEdit={reviewEligibility?.canEdit}
                />
                <ReviewWriteModal
                  mentorId={mentorId}
                  mentorName={display.displayName}
                  initialEligible={reviewEligibility?.eligible === true}
                  initialReason={reviewEligibility?.reason}
                  initialMode={reviewEligibility?.mode}
                  initialReviewId={reviewEligibility?.existingReviewId ?? null}
                  initialCanEdit={reviewEligibility?.canEdit}
                />
              </div>
            </SurfaceCard>
          ) : null}

          <MentorDetailCTASection
            mentorName={display.displayName}
            mentorId={mentorId}
            subscribeHref={subscribeHref}
            freeQuestionHref={freeQuestionHref}
            individualQuestionHref={individualQuestionHref}
            freeQuestionRemaining={props.freeQuestionRemaining}
            subscriptionClosed={props.subscriptionClosed}
            individualQuestionPriceCents={props.individualQuestionPriceCents}
          />
        </div>

        <div className="xl:col-span-4">
          <MentorDetailSubscribeSidebar
            mentorId={mentorId}
            byTier={byTier}
            plansError={bundle.plans.error}
            isLoggedIn={isLoggedIn}
            freeQuestionRemaining={props.freeQuestionRemaining}
            subscriptionClosed={props.subscriptionClosed}
            individualQuestionHref={individualQuestionHref}
            individualQuestionPriceCents={props.individualQuestionPriceCents}
          />
        </div>
      </div>
    </div>
  );
}

export function PublicMentorNotFoundBody(props: { title: string; message: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center sm:p-8">
      <p className="text-lg font-extrabold text-slate-900">{props.title}</p>
      <p className="mt-2 min-h-[1.25rem] text-sm text-slate-600">{props.message}</p>
      <Link
        href="/mentors"
        className="mt-5 inline-block min-h-[44px] rounded-lg bg-[#2563EB] px-4 py-2.5 text-sm font-bold text-white"
      >
        멘토 찾기로
      </Link>
    </div>
  );
}
