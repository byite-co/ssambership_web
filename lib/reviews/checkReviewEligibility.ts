import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ELIGIBLE_INDIVIDUAL_QUESTION_STATUSES,
  ELIGIBLE_SUBSCRIPTION_STATUSES,
  REVIEW_ELIGIBILITY_REASON,
  decideReviewEligibility,
  hasRelationshipEligibility,
  type ExistingReviewRef,
  type IndividualQuestionRelationRow,
  type ReviewEligibilityResult,
  type SubscriptionRelationRow,
} from "@/lib/reviews/reviewEligibilityPolicy";

export type { ReviewEligibilityMode, ReviewEligibilityResult } from "@/lib/reviews/reviewEligibilityPolicy";
export { REVIEW_ELIGIBILITY_REASON } from "@/lib/reviews/reviewEligibilityPolicy";

/**
 * 리뷰 자격 조회 — 판정 로직은 `reviewEligibilityPolicy`(순수 함수)에 있고,
 * 이 파일은 조회(I/O)만 담당한다. 판정 정본은 SQL 170 의 check_review_eligibility 다.
 */

/** 본인이 이미 쓴 후기 1건. 숨김·블라인드 행도 반드시 잡혀야 한다(171 reviews_select_author). */
async function findOwnReview(
  supabase: SupabaseClient,
  authorId: string,
  mentorId: string
): Promise<{ ok: true; review: ExistingReviewRef | null } | { ok: false }> {
  const { data, error } = await supabase
    .from("reviews")
    .select("id, is_hidden, is_blinded")
    .eq("author_id", authorId)
    .eq("mentor_id", mentorId)
    .maybeSingle();

  if (error) return { ok: false };
  if (!data) return { ok: true, review: null };

  const row = data as { id?: unknown; is_hidden?: unknown; is_blinded?: unknown };
  const id = String(row.id ?? "").trim();
  if (!id) return { ok: true, review: null };

  return {
    ok: true,
    review: { id, isHidden: Boolean(row.is_hidden), isBlinded: Boolean(row.is_blinded) },
  };
}

async function loadRelationshipRows(
  supabase: SupabaseClient,
  studentId: string,
  mentorId: string
): Promise<{
  subscriptions: SubscriptionRelationRow[];
  individualQuestions: IndividualQuestionRelationRow[];
}> {
  const [subs, iqs] = await Promise.all([
    supabase
      .from("subscriptions")
      .select("mentor_id, status")
      .eq("student_id", studentId)
      .eq("mentor_id", mentorId)
      .in("status", [...ELIGIBLE_SUBSCRIPTION_STATUSES]),
    // coalesce(claimed, designated) = mentor  ⟺  claimed = mentor  OR  (claimed IS NULL AND designated = mentor)
    supabase
      .from("individual_questions")
      .select("claimed_mentor_id, designated_mentor_id, status")
      .eq("student_id", studentId)
      .in("status", [...ELIGIBLE_INDIVIDUAL_QUESTION_STATUSES])
      .or(`claimed_mentor_id.eq.${mentorId},and(claimed_mentor_id.is.null,designated_mentor_id.eq.${mentorId})`),
  ]);

  return {
    subscriptions: (subs.error ? [] : ((subs.data ?? []) as SubscriptionRelationRow[])),
    individualQuestions: (iqs.error ? [] : ((iqs.data ?? []) as IndividualQuestionRelationRow[])),
  };
}

/**
 * 자격 판정. 검사 순서는 정책 모듈의 계약을 따른다:
 *   ① 본인 기존 후기 조회 → ② 있으면 관계 자격 재검사 없이 'edit' → ③ 없을 때만 신규 자격 검사.
 */
export async function checkReviewEligibility(
  supabase: SupabaseClient,
  authorId: string,
  mentorId: string
): Promise<ReviewEligibilityResult> {
  const own = await findOwnReview(supabase, authorId, mentorId);
  if (!own.ok) {
    return {
      eligible: false,
      mode: "create",
      existingReviewId: null,
      canEdit: false,
      reason: REVIEW_ELIGIBILITY_REASON.LOOKUP_FAILED,
    };
  }

  // 기존 후기가 있으면 관계 자격을 다시 묻지 않는다(수정 시 자격 재검사 안 함 — 171 정본).
  if (own.review) {
    return decideReviewEligibility({ existingReview: own.review, relationshipEligible: true });
  }

  const rows = await loadRelationshipRows(supabase, authorId, mentorId);
  const relationshipEligible = hasRelationshipEligibility({ mentorId, ...rows });

  return decideReviewEligibility({ existingReview: null, relationshipEligible });
}
