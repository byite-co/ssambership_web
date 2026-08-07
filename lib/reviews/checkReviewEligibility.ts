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
  /** D-MT-14: 관계 쿼리 중 하나라도 실패하면 true — 무음 false 대신 '판정 불가'로 전파. */
  lookupFailed: boolean;
}> {
  // coalesce(claimed, designated) = mentor
  //   ⟺ (claimed = mentor) OR (claimed IS NULL AND designated = mentor)
  // 이 분기를 PostgREST `.or(...)` 한 줄로 쓰지 않고 **두 개의 단순 질의로 나눈다.**
  // `.or()` 의 중첩 `and(...)` 문법이 틀리면 PostgREST 가 400 을 내고, 이 코드의 오류 처리는
  // 오류를 빈 배열로 흡수하므로 **자격이 조용히 false 가 된다**(IQ 이력만 있는 학생이
  // 영문 없이 거부됨). eq/is 조합만 쓰면 그 실패 모드 자체가 사라진다.
  const [subs, iqClaimed, iqDesignated] = await Promise.all([
    supabase
      .from("subscriptions")
      .select("mentor_id, status")
      .eq("student_id", studentId)
      .eq("mentor_id", mentorId)
      .in("status", [...ELIGIBLE_SUBSCRIPTION_STATUSES]),
    supabase
      .from("individual_questions")
      .select("claimed_mentor_id, designated_mentor_id, status")
      .eq("student_id", studentId)
      .in("status", [...ELIGIBLE_INDIVIDUAL_QUESTION_STATUSES])
      .eq("claimed_mentor_id", mentorId),
    supabase
      .from("individual_questions")
      .select("claimed_mentor_id, designated_mentor_id, status")
      .eq("student_id", studentId)
      .in("status", [...ELIGIBLE_INDIVIDUAL_QUESTION_STATUSES])
      .is("claimed_mentor_id", null)
      .eq("designated_mentor_id", mentorId),
  ]);

  const individualQuestions = [
    ...(iqClaimed.error ? [] : ((iqClaimed.data ?? []) as IndividualQuestionRelationRow[])),
    ...(iqDesignated.error ? [] : ((iqDesignated.data ?? []) as IndividualQuestionRelationRow[])),
  ];

  // D-MT-14: 관계 쿼리 오류를 빈 배열로 흡수하면 자격 있는 학생이 이유 없이 '작성 불가'로
  // 조용히 거부된다(fail-closed 무음). 실패 여부를 별도 신호로 올려 '판정 불가'로 전파한다.
  const lookupFailed = Boolean(subs.error || iqClaimed.error || iqDesignated.error);
  if (lookupFailed) {
    console.error("[loadRelationshipRows]", {
      subs: subs.error?.message,
      iqClaimed: iqClaimed.error?.message,
      iqDesignated: iqDesignated.error?.message,
    });
  }

  return {
    subscriptions: subs.error ? [] : ((subs.data ?? []) as SubscriptionRelationRow[]),
    individualQuestions,
    lookupFailed,
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

  const { lookupFailed, ...rows } = await loadRelationshipRows(supabase, authorId, mentorId);
  // D-MT-14: 관계 조회가 실패했으면 '판정 불가'로 반환한다(무음 false 금지 — 자격 있는
  // 학생이 조용히 거부되지 않게). 기존 후기 조회 실패(LOOKUP_FAILED)와 동일 규약.
  if (lookupFailed) {
    return {
      eligible: false,
      mode: "create",
      existingReviewId: null,
      canEdit: false,
      reason: REVIEW_ELIGIBILITY_REASON.LOOKUP_FAILED,
    };
  }
  const relationshipEligible = hasRelationshipEligibility({ mentorId, ...rows });

  return decideReviewEligibility({ existingReview: null, relationshipEligible });
}
