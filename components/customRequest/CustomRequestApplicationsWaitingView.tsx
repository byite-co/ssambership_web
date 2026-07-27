"use client";

import Link from "next/link";
import { CustomRequestLifecycleStepper } from "@/components/customRequest/CustomRequestLifecycleStepper";
import { CustomRequestAppsBreadcrumb, CustomRequestStepperShell } from "@/components/customRequest/customRequestDetailLayout";
import { WaitingCountdown } from "@/components/customRequest/WaitingCountdown";
import { formatMentorRatingLabel } from "@/lib/mentor/mentorPublicProfileDisplay";

export type WaitingApplicationItem = {
  id: string;
  mentorName: string;
  schoolLine: string;
  subjectTags: string[];
  avgRating: number | null;
  appliedAtLabel: string;
  photoUrl: string | null;
  verified: boolean;
  attachmentCount: number;
};

export type WaitingPostSummary = {
  title: string;
  category: string;
  budgetLine: string;
  deadline: string;
  deadlineIso: string | null;
};

export type CustomRequestApplicationsWaitingViewProps = {
  postId: string;
  post: WaitingPostSummary;
  applications: WaitingApplicationItem[];
  applicantCount: number;
  maxApplicants: number;
  listError: string | null;
};

function StarRating(props: { avgRating: number | null }) {
  const label = formatMentorRatingLabel(props.avgRating);
  const filled = props.avgRating != null ? Math.round(props.avgRating) : 0;
  return (
    <span className="inline-flex items-center gap-1 text-sm font-bold text-[var(--c-secondary,#3f4b5f)]">
      <span className="text-[#F59E0B]" aria-hidden>
        {"★".repeat(Math.min(5, filled))}
        {"☆".repeat(Math.max(0, 5 - filled))}
      </span>
      <span>{label}</span>
    </span>
  );
}

export function CustomRequestApplicationsWaitingView(props: CustomRequestApplicationsWaitingViewProps) {
  const { postId, post, applications, applicantCount, maxApplicants, listError } = props;

  return (
    <div className="w-full space-y-4 sm:space-y-5">
      <CustomRequestAppsBreadcrumb postId={postId} />

      <section className="cr-apps-summary">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between lg:gap-6">
          <div className="min-w-0 flex-1">
            <p className="cr-apps-summary-kicker">요청 요약</p>
            <p className="mt-1 break-words text-lg font-black leading-snug text-[#0f172a] sm:text-xl">{post.title}</p>
            {post.category && post.category !== "—" ? (
              <span className="cr-category-badge mt-2">{post.category}</span>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm font-medium text-[var(--c-secondary,#3f4b5f)]">
            <div>
              <p className="cr-apps-meta-label">예산</p>
              <p className="mt-0.5 font-bold text-[#0f172a]">{post.budgetLine}</p>
            </div>
            <div>
              <p className="cr-apps-meta-label">마감일</p>
              <p className="mt-0.5 font-bold text-[#0f172a]">{post.deadline}</p>
            </div>
          </div>
          <Link href={`/custom-request/${postId}`} className="btn btn-ghost !min-h-[40px] shrink-0 !px-4 !py-2 !text-sm">
            요청 내용 보기
          </Link>
        </div>
      </section>

      <div className="cr-apps-page-head">
        <h2>멘토 지원 대기</h2>
        <p>멘토들의 지원을 기다리는 중이에요. 마감일까지 제안이 들어오면 확인할 수 있어요.</p>
      </div>

      <CustomRequestStepperShell>
        <CustomRequestLifecycleStepper active="compare" />
      </CustomRequestStepperShell>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(240px,280px)] lg:gap-5">
        <div className="min-w-0 space-y-4 sm:space-y-5">
          <section className="cr-apps-card">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-sm font-extrabold text-[#0f172a]">지원 현황</p>
                <p className="mt-1 text-2xl font-black text-[#2563EB]">
                  {applicantCount}
                  <span className="text-base font-bold text-[var(--c-tertiary,#8a96a8)]"> / 최대 {maxApplicants}명</span>
                </p>
                <p className="mt-1 text-sm font-medium text-[var(--c-secondary,#3f4b5f)]">멘토가 제안을 내면 아래 목록에 표시돼요.</p>
              </div>
              <div className="shrink-0">
                <p className="cr-apps-meta-label">마감까지</p>
                <WaitingCountdown deadlineIso={post.deadlineIso} className="mt-2" />
              </div>
            </div>
            {/* P2-28: 알림 설정 기능(P2-17)이 아직 없어 무동작 버튼이었다 → 명시적 disabled + 사유 표시. */}
            <button
              type="button"
              disabled
              aria-disabled="true"
              title="알림 설정 기능은 준비 중이에요."
              className="btn btn-ghost mt-4 !min-h-[40px] cursor-not-allowed !border-slate-200 !bg-slate-50 !text-slate-400"
            >
              알림 설정 (준비 중)
            </button>
          </section>

          {listError ? (
            <div className="cr-apps-card text-sm text-red-900">
              <p className="font-extrabold">지원서를 불러오지 못했어요</p>
              <p className="mt-1.5">{listError}</p>
            </div>
          ) : null}

          <section>
            <div className="cr-apps-page-head">
              <h2>지원서 목록</h2>
              <p>최신 지원 순으로 정렬돼요.</p>
            </div>

            {applications.length === 0 && !listError ? (
              <div className="mt-4 rounded-2xl border border-dashed border-[var(--c-border,#e2e8f2)] bg-[var(--c-band,#f8fafc)] px-4 py-8 text-center sm:px-6">
                <p className="text-sm font-extrabold text-[#0f172a]">아직 지원한 멘토가 없어요</p>
                <p className="mt-1.5 text-sm font-medium text-[var(--c-secondary,#3f4b5f)]">마감일까지 멘토들의 제안을 기다려 주세요.</p>
              </div>
            ) : (
              <ul className="mt-4 space-y-4">
                {applications.map((app) => (
                  <li key={app.id} className="cr-apps-card">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                      <div className="flex min-w-0 flex-1 gap-3 sm:gap-4">
                        <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--c-border,#e2e8f2)] bg-[var(--c-band,#f8fafc)] text-lg font-black text-[var(--c-tertiary,#8a96a8)]">
                          {app.photoUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={app.photoUrl} alt="" className="h-full w-full object-cover" />
                          ) : (
                            (app.mentorName[0] ?? "M").toUpperCase()
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-base font-extrabold text-[#0f172a]">{app.mentorName}</p>
                            {app.verified ? (
                              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-black text-blue-800">
                                인증
                              </span>
                            ) : null}
                          </div>
                          {app.schoolLine ? (
                            <p className="mt-0.5 text-sm font-medium text-[var(--c-secondary,#3f4b5f)]">{app.schoolLine}</p>
                          ) : null}
                          {app.subjectTags.length > 0 ? (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {app.subjectTags.map((tag) => (
                                <span key={tag} className="cr-category-badge !h-auto !py-0.5 !text-[11px]">
                                  {tag}
                                </span>
                              ))}
                            </div>
                          ) : null}
                          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
                            <StarRating avgRating={app.avgRating} />
                            <span className="text-xs font-medium text-[var(--c-tertiary,#8a96a8)]">지원 {app.appliedAtLabel}</span>
                            {app.attachmentCount > 0 ? (
                              <span className="cr-category-badge !h-auto !py-0.5 !text-[11px]">첨부 {app.attachmentCount}개</span>
                            ) : null}
                          </div>
                          <p className="mt-2 text-[11px] font-medium text-[var(--c-tertiary,#8a96a8)]">
                            연락처는 선택 후에만 확인할 수 있어요
                          </p>
                        </div>
                      </div>
                      <Link
                        href={`/custom-request/${postId}/applications`}
                        className="btn btn-primary !min-h-[44px] shrink-0 !px-4 !text-sm"
                      >
                        자세히 보기
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="space-y-4">
          <section className="cr-apps-aside-note">
            <p className="text-sm font-extrabold text-amber-950">마감 안내</p>
            <p className="mt-2 text-sm font-medium leading-relaxed text-amber-900/90">
              마감일 자정 이후에는 지원이 마감되며, 멘토를 선택하지 않으면 요청이 자동으로 취소될 수 있어요.
            </p>
          </section>

          <section className="cr-apps-card">
            <p className="text-sm font-extrabold text-[#0f172a]">이용 안내</p>
            <ul className="cr-guide-list mt-3">
              <li>요청 내용 수정은 의뢰 상세 화면에서 확인해 주세요.</li>
              <li>멘토를 선택하기 전까지 연락처는 공개되지 않아요.</li>
              <li>지원이 모이면 비교·선택 화면에서 한 분을 고를 수 있어요.</li>
            </ul>
          </section>

          {/* P2-28: 지원 알림 설정 기능 미구현 → 무동작 대신 명시적 disabled + 사유. */}
          <button
            type="button"
            disabled
            aria-disabled="true"
            title="지원 알림 설정 기능은 준비 중이에요."
            className="btn btn-primary w-full !min-h-[44px] !text-sm cursor-not-allowed !bg-slate-200 !text-slate-500"
          >
            새로운 지원 알림 설정하기 (준비 중)
          </button>
        </aside>
      </div>
    </div>
  );
}
