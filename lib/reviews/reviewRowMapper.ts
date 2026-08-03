/** DB `reviews` 행 → 앱 내부 타입 (body → UI content) */
export type ReviewDbRow = {
  id: string;
  mentor_id: string;
  author_id: string;
  rating: number;
  body: string;
  subscription_count: number;
  mentor_reply: string | null;
  mentor_replied_at: string | null;
  is_hidden: boolean;
  is_blinded: boolean;
  moderation_state: string | null;
  created_at: string;
};

export function mapReviewDbRow(raw: Record<string, unknown>): ReviewDbRow {
  const body =
    typeof raw.body === "string"
      ? raw.body
      : typeof raw.content === "string"
        ? raw.content
        : "";
  const authorId =
    typeof raw.author_id === "string"
      ? raw.author_id
      : typeof raw.student_id === "string"
        ? raw.student_id
        : "";

  return {
    id: String(raw.id ?? ""),
    mentor_id: String(raw.mentor_id ?? ""),
    author_id: authorId,
    rating: typeof raw.rating === "number" ? raw.rating : Number(raw.rating) || 0,
    body,
    subscription_count:
      typeof raw.subscription_count === "number" ? raw.subscription_count : Number(raw.subscription_count) || 0,
    mentor_reply: typeof raw.mentor_reply === "string" ? raw.mentor_reply : null,
    mentor_replied_at: typeof raw.mentor_replied_at === "string" ? raw.mentor_replied_at : null,
    is_hidden: Boolean(raw.is_hidden),
    is_blinded: Boolean(raw.is_blinded),
    moderation_state: typeof raw.moderation_state === "string" ? raw.moderation_state : null,
    created_at: String(raw.created_at ?? ""),
  };
}

/** 공개 목록용 필터 (RLS·집계와 동일한 정본 predicate — 수렴 §11.2) */
export function isPubliclyVisibleReview(row: ReviewDbRow): boolean {
  return row.moderation_state === "visible" && !row.is_hidden && !row.is_blinded;
}
