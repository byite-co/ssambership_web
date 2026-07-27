import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 리뷰 수정 UPDATE 의 **1행 계약**.
 *
 * ⚠️ 왜 error 만 보면 안 되는가 (173 과 한 쌍)
 *    supabase/sql/173 이 reviews_update_author 정책의 USING 에 조정 상태 조건을 더했다.
 *    정책 USING 이 먼저 걸리므로 모더레이션된 리뷰에 대한 UPDATE 는 **예외가 아니라 0행**으로
 *    끝난다 — PostgREST 는 error 없이 빈 배열을 돌려준다.
 *    따라서 error 만 검사하면 아무것도 바뀌지 않은 요청이 "수정 성공"으로 표시된다.
 *    → 영향 행을 회수해 **정확히 1행 · id 일치**일 때만 성공으로 판정한다.
 *
 * 이 모듈은 런타임 의존성이 없다(타입 import 만). 계약 테스트가 체이닝 스텁만으로
 * 네트워크·DB 접근 0 상태에서 전 분기를 고정할 수 있게 하기 위함이다.
 */

/** 기존 문구 — DB 에러가 실제로 발생한 경우(회귀 보존). */
export const REVIEW_UPDATE_FAILED_MESSAGE = "후기 수정에 실패했습니다.";

/** 신규 문구 — error 는 없는데 영향 행이 1행이 아닌 경우(RLS 0행 포함). */
export const REVIEW_UPDATE_NOT_APPLIED_MESSAGE =
  "수정할 수 없는 후기예요. 검토 중이거나 이미 변경된 상태일 수 있어요.";

export type ReviewUpdateOutcome = { ok: true; id: string } | { ok: false; error: string };

/**
 * UPDATE ... RETURNING id 결과를 성공/실패로 판정한다.
 * 성공 조건은 정확히 **1행이고 그 id 가 요청한 reviewId 와 같을 때** 뿐이다.
 * 0행 · 2행 이상 · id 불일치 · error 존재는 전부 실패.
 *
 * DB 원문 에러는 사용자 문구로 노출하지 않는다.
 */
export function decideReviewUpdateOutcome(
  reviewId: string,
  data: unknown,
  error: unknown
): ReviewUpdateOutcome {
  if (error) {
    return { ok: false, error: REVIEW_UPDATE_FAILED_MESSAGE };
  }

  const rows = Array.isArray(data) ? (data as { id?: unknown }[]) : [];
  const first = rows[0];
  if (rows.length !== 1 || !first || String(first.id ?? "") !== reviewId) {
    return { ok: false, error: REVIEW_UPDATE_NOT_APPLIED_MESSAGE };
  }

  return { ok: true, id: reviewId };
}

/**
 * 작성자 본인 후기의 rating·body 를 갱신하고 영향 행으로 성공을 판정한다.
 * `.eq("author_id", authorId)` 는 RLS 가 생긴 뒤에도 남긴다(이중 방어).
 */
export async function applyReviewUpdate(
  supabase: SupabaseClient,
  authorId: string,
  reviewId: string,
  patch: { rating: number; body: string }
): Promise<ReviewUpdateOutcome> {
  const { data, error } = await supabase
    .from("reviews")
    .update({ rating: patch.rating, body: patch.body })
    .eq("id", reviewId)
    .eq("author_id", authorId)
    .select("id");

  return decideReviewUpdateOutcome(reviewId, data, error);
}
