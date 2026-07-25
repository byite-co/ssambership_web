/**
 * 리뷰 자격 정책 — 웹(TS) 측 정본.
 *
 * ⚠️ 이 모듈은 `supabase/sql/170_review_eligibility_relationship_based.sql` 의
 *    `check_review_eligibility(p_mentor_id, p_student_id)` 와 **1:1 대응**한다.
 *    RPC 가 INSERT 정책(126:57)이 강제하는 **판정 정본**이고, 이 모듈은 UI 사전 판정과
 *    사유 문구 생성을 담당한다. 둘이 어긋나면 화면은 "작성 가능"인데 INSERT 가 막힌다.
 *    → 상태 집합을 바꿀 때는 **170 과 이 파일을 같은 커밋에서** 바꾼다.
 *
 * 자격 기준(둘 중 하나라도 성립):
 *   (B) 구독 상태 ∈ {active, expired, cancel_scheduled}
 *   (C) 개별질문 상태 ∈ {answered, released} · 멘토 = coalesce(claimed, designated)
 *
 * 결제 횟수(구 기준 A, `MIN_PAID_SUBSCRIPTION_COUNT = 2`)는 폐기됐다. 집계 실패가
 * 자격 박탈로 이어지던 취약점도 함께 사라진다.
 */

/** staging 실측 CHECK 제약 기준 — 'confirmed' · 'completed' 는 실 enum에 없다. */
export const ELIGIBLE_SUBSCRIPTION_STATUSES = ["active", "expired", "cancel_scheduled"] as const;
export const EXCLUDED_SUBSCRIPTION_STATUSES = ["pending", "past_due", "canceled", "refunded"] as const;

export const ELIGIBLE_INDIVIDUAL_QUESTION_STATUSES = ["answered", "released"] as const;
export const EXCLUDED_INDIVIDUAL_QUESTION_STATUSES = [
  "escrowed",
  "assigned",
  "open",
  "claimed",
  "expired",
  "refunded",
  "canceled",
] as const;

export type ReviewEligibilityMode = "create" | "edit";

export type ReviewEligibilityResult = {
  /** 후기 작성/수정 화면에 진입할 수 있는가 */
  eligible: boolean;
  /** 'create' = 신규 작성 · 'edit' = 기존 후기 수정 */
  mode: ReviewEligibilityMode;
  /** mode==='edit' 일 때 대상 리뷰 id */
  existingReviewId: string | null;
  /** mode==='edit' 이면서 실제로 수정 가능한가 (모더레이션된 후기는 false) */
  canEdit: boolean;
  /** eligible=false 또는 canEdit=false 의 사유 */
  reason?: string;
};

export const REVIEW_ELIGIBILITY_REASON = {
  NO_RELATIONSHIP:
    "이 멘토의 구독 또는 개별 질문 이용 이력이 있는 학생만 후기를 남길 수 있어요.",
  MODERATED: "검토 중인 후기라 지금은 수정할 수 없습니다.",
  LOOKUP_FAILED: "후기 작성 자격을 확인하지 못했습니다.",
} as const;

export function normalizeStatus(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export function isEligibleSubscriptionStatus(value: unknown): boolean {
  return (ELIGIBLE_SUBSCRIPTION_STATUSES as readonly string[]).includes(normalizeStatus(value));
}

export function isEligibleIndividualQuestionStatus(value: unknown): boolean {
  return (ELIGIBLE_INDIVIDUAL_QUESTION_STATUSES as readonly string[]).includes(normalizeStatus(value));
}

export type SubscriptionRelationRow = {
  mentor_id?: unknown;
  status?: unknown;
};

export type IndividualQuestionRelationRow = {
  claimed_mentor_id?: unknown;
  designated_mentor_id?: unknown;
  status?: unknown;
};

/** SQL 의 `coalesce(claimed_mentor_id, designated_mentor_id)` 와 동일 우선순위. */
export function individualQuestionMentorId(row: IndividualQuestionRelationRow): string | null {
  const claimed = String(row.claimed_mentor_id ?? "").trim();
  if (claimed) return claimed;
  const designated = String(row.designated_mentor_id ?? "").trim();
  return designated || null;
}

/**
 * 관계 자격 판정 — 170 의 (B) OR (C) 와 동일.
 * 호출자가 이미 (student, mentor) 로 좁혀 온 행을 넘겨도, 넘기지 않아도 되도록
 * mentor_id 를 여기서 한 번 더 대조한다(과대 판정 방지).
 */
export function hasRelationshipEligibility(input: {
  mentorId: string;
  subscriptions: SubscriptionRelationRow[];
  individualQuestions: IndividualQuestionRelationRow[];
}): boolean {
  const mentorId = String(input.mentorId ?? "").trim();
  if (!mentorId) return false;

  // (B) 구독 관계
  for (const row of input.subscriptions ?? []) {
    const rowMentor = String(row.mentor_id ?? "").trim();
    if (rowMentor && rowMentor !== mentorId) continue;
    if (isEligibleSubscriptionStatus(row.status)) return true;
  }

  // (C) 완료된 개별질문
  for (const row of input.individualQuestions ?? []) {
    if (individualQuestionMentorId(row) !== mentorId) continue;
    if (isEligibleIndividualQuestionStatus(row.status)) return true;
  }

  return false;
}

export type ExistingReviewRef = {
  id: string;
  isHidden: boolean;
  isBlinded: boolean;
};

/**
 * 최종 판정.
 *
 * ⚠️ 검사 **순서가 계약의 일부**다: ① 본인 기존 후기 → ② 있으면 관계 자격을
 * 재검사하지 않고 'edit' → ③ 없을 때만 신규 작성 자격 검사.
 * 구현이 결제 집계를 먼저 하던 시절에는, 집계가 일시적으로 0 이 되면 이미 후기를 쓴
 * 학생조차 편집 경로에 도달하지 못했다(자격 재검사 안 함 원칙과 정면 충돌).
 *
 * 모더레이션된(숨김·블라인드) 본인 후기는 `mode:'edit'` + `canEdit:false` 로 식별한다.
 * 신규 작성으로 오판하면 uq_reviews_mentor_author 에 막혀 23505 가 난다.
 */
export function decideReviewEligibility(input: {
  existingReview: ExistingReviewRef | null;
  relationshipEligible: boolean;
}): ReviewEligibilityResult {
  const existing = input.existingReview;

  if (existing && existing.id) {
    const moderated = existing.isHidden || existing.isBlinded;
    return {
      eligible: true,
      mode: "edit",
      existingReviewId: existing.id,
      canEdit: !moderated,
      ...(moderated ? { reason: REVIEW_ELIGIBILITY_REASON.MODERATED } : {}),
    };
  }

  if (!input.relationshipEligible) {
    return {
      eligible: false,
      mode: "create",
      existingReviewId: null,
      canEdit: false,
      reason: REVIEW_ELIGIBILITY_REASON.NO_RELATIONSHIP,
    };
  }

  return { eligible: true, mode: "create", existingReviewId: null, canEdit: false };
}
