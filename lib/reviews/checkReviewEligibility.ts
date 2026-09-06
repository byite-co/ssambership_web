import type { SupabaseClient } from "@supabase/supabase-js";
import {
  REVIEW_ELIGIBILITY_RPC,
  REVIEW_ELIGIBILITY_RPC_SCHEMA,
  decideReviewEligibilityFromRpc,
  type ReviewEligibilityResult,
} from "@/lib/reviews/reviewEligibilityPolicy";

export type { ReviewEligibilityMode, ReviewEligibilityResult } from "@/lib/reviews/reviewEligibilityPolicy";
export { REVIEW_ELIGIBILITY_REASON } from "@/lib/reviews/reviewEligibilityPolicy";

/**
 * 리뷰 자격 조회 — 판정 정본은 SQL 208(`check_review_eligibility` 와 동일 판정 함수)이고,
 * 이 파일은 `api_app_v1.review_eligibility_self(p_mentor_id)` 호출(I/O)만 담당한다.
 * 응답 해석은 `reviewEligibilityPolicy.decideReviewEligibilityFromRpc`(순수 함수).
 *
 * RPC 는 auth.uid() 로 본인을 식별한다 — `_authorId` 는 호출부 시그니처 호환용(권한에 쓰지 않음).
 * 세션 클라이언트(authenticated)로만 호출한다(anon·service_role EXECUTE 0).
 */
export async function checkReviewEligibility(
  supabase: SupabaseClient,
  _authorId: string,
  mentorId: string
): Promise<ReviewEligibilityResult> {
  const { data, error } = await supabase
    .schema(REVIEW_ELIGIBILITY_RPC_SCHEMA)
    .rpc(REVIEW_ELIGIBILITY_RPC, { p_mentor_id: mentorId });
  if (error) {
    // D-MT-14: 조회 실패를 무음 false 로 흡수하지 않는다 — '판정 불가'(LOOKUP_FAILED)로 전파.
    console.error("[checkReviewEligibility] review_eligibility_self", error.message);
  }
  return decideReviewEligibilityFromRpc(data, error);
}
