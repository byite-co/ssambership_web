import type { Metadata } from "next";
import { MentorRecentRecorder } from "@/components/mentor/MentorRecentRecorder";
import { PublicMentorDetailBody, PublicMentorNotFoundBody } from "@/components/mentor/PublicMentorDetailBody";
import { buildMentorProfileDisplay } from "@/lib/mentor/mentorDisplayFields";
import { loadFavoriteMentorIdsForUser } from "@/lib/mentor/mentorFavorites";
import { loadPublicMentorBundle } from "@/lib/mentor/publicMentorBundle";
import { createClient } from "@/lib/supabase/server";
import { getServerUserWithProfile } from "@/lib/auth/getServerUserWithProfile";
import { loadFreeQuestionRemainingForMentor } from "@/lib/qna/freeQuestionUsage";
import { checkReviewEligibility } from "@/lib/reviews/checkReviewEligibility";
import { loadMentorCapUsage } from "@/lib/subscribe/mentorCapService";
import { mentorVerificationStatusAllowsActivity } from "@/lib/mentor/mentorVerificationGate";
import { loadMentorAvgResponseHours } from "@/lib/mentor/avgResponseHoursDisplay";
import { fetchMentorIndividualQuestionPrice } from "@/lib/individualQuestion/individualQuestionPricing";
import { applySchoolClassificationLabels, loadSchoolClassificationCatalogs } from "@/lib/mentor/schoolClassificationCatalog";

type Props = {
  params: Promise<{ mentorId: string }>;
};

// 멘토 상세는 멘토 실명·학교 등 개인정보의 공개 범위 판단이 끝나지 않아 의도적으로 색인에서 제외한다.
// follow: true — 색인만 막고 링크 추적은 허용해, 멘토 찾기 목록에서 이어지는 크롤 경로가 끊기지 않게 한다.
export const metadata: Metadata = {
  robots: { index: false, follow: true },
};

export default async function MentorDetailByIdPage(props: Props) {
  const { mentorId } = await props.params;
  const supabase = await createClient();
  const bundle = await loadPublicMentorBundle(supabase, mentorId);

  const { user, profile } = await getServerUserWithProfile();
  const viewer =
    user && profile?.role
      ? { userId: user.id, role: profile.role as "student" | "mentor" | "admin" }
      : null;

  let reviewEligibility = null;
  if (viewer?.role === "student" && viewer.userId) {
    reviewEligibility = await checkReviewEligibility(supabase, viewer.userId, mentorId);
  }

  let initialFavorited = false;
  let freeQuestionRemaining: number | null = null;
  if (user) {
    const fav = await loadFavoriteMentorIdsForUser(supabase, user.id);
    initialFavorited = fav.ids.has(mentorId);
    if (profile?.role === "student") {
      freeQuestionRemaining = await loadFreeQuestionRemainingForMentor(supabase, user.id, mentorId);
    }
  }

  if (bundle.kind === "not_found") {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <PublicMentorNotFoundBody title="404" message={bundle.message} />
      </div>
    );
  }

  if (bundle.kind === "not_mentor") {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <PublicMentorNotFoundBody title="표시 불가" message={bundle.message} />
      </div>
    );
  }

  const catalogs = await loadSchoolClassificationCatalogs(supabase);
  const display = applySchoolClassificationLabels(buildMentorProfileDisplay(bundle.profileRow, bundle.userRow), catalogs);
  const canViewUnapproved = viewer?.role === "admin" || viewer?.userId === mentorId;
  if (!canViewUnapproved && !mentorVerificationStatusAllowsActivity(bundle.profileRow?.verification_status)) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <PublicMentorNotFoundBody title="표시 불가" message="아직 승인되지 않은 멘토 프로필입니다." />
      </div>
    );
  }
  const [capUsage, avgResponseHours, individualQuestionPrice] = await Promise.all([
    loadMentorCapUsage(mentorId),
    loadMentorAvgResponseHours(supabase, mentorId),
    fetchMentorIndividualQuestionPrice(supabase, mentorId),
  ]);

  return (
    <div className="min-h-screen bg-[#F9FAFB] py-6 sm:py-8">
      <MentorRecentRecorder mentorId={mentorId} />
      <PublicMentorDetailBody
        mentorId={mentorId}
        userRow={bundle.userRow}
        display={display}
        bundle={bundle}
        viewer={viewer}
        reviewEligibility={reviewEligibility}
        isLoggedIn={Boolean(user)}
        initialFavorited={initialFavorited}
        freeQuestionRemaining={freeQuestionRemaining}
        subscriptionClosed={capUsage.isFull}
        avgResponseHours={avgResponseHours}
        individualQuestionPriceCents={individualQuestionPrice.amountCents}
      />
    </div>
  );
}
