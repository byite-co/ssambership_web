/**
 * 리뷰 자격 정책 — 웹(TS) 측 정본.
 *
 * ⚠️ 판정 정본은 SQL 208(`supabase/sql/208_review_eligibility_paid_twice.sql`)의
 *    `core_private.review_eligibility_impl` 이며, INSERT 정책 `reviews_insert_student`(126)이 호출하는
 *    `check_review_eligibility(p_mentor_id, p_student_id)` 와 **동일 판정 함수**다.
 *    웹은 상태 집합을 직접 세지 않고 `api_app_v1.review_eligibility_self(p_mentor_id)` 를 호출해
 *    `{eligible, reason, paid_count, required_count, existing_review_id, can_edit}` 를 그대로 쓴다
 *    (세션 클라이언트 · authenticated). 이 모듈은 그 응답을 UI 판정·사유 문구로 바꾸는 순수 함수만 둔다.
 *
 * 자격 기준(208 · CLAUDE.md 잠금값 "동일 멘토 2회 연속 결제 성공"의 정본 해석 = **누적 2회**):
 *   같은 (학생, 멘토) 의 `subscription_billing_events` `status='succeeded'` · `event_type in ('initial','renewal')`
 *   · `amount_cents > 0` 가 2건 이상. 개별질문 결제는 세지 않는다.
 *
 * 구 170 규칙(구독 상태 집합 B / 완료 개별질문 C)과 그 상태 상수는 폐기됐다 — 화면 "작성 가능"인데
 * INSERT 가 막히던 어긋남(DB-5 보고서 §2-4)이 이 전환으로 사라진다.
 */

export const REVIEW_ELIGIBILITY_RPC_SCHEMA = "api_app_v1" as const;
export const REVIEW_ELIGIBILITY_RPC = "review_eligibility_self" as const;

/** 208 정본 요구 결제 횟수(응답 `required_count` 가 정본 · 이 값은 응답 부재 시 문구 폴백). */
export const REVIEW_REQUIRED_PAID_COUNT = 2;

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
  /** 같은 멘토 결제 성공 누적 횟수(ALREADY_REVIEWED · 조회 실패는 null) */
  paidCount?: number | null;
  /** 요구 횟수(208 = 2) */
  requiredCount?: number;
  /** RPC 원문 사유 코드 */
  reasonCode?: ReviewEligibilityReasonCode;
};

export type ReviewEligibilityReasonCode =
  | "OK"
  | "NOT_ENOUGH_PAYMENTS"
  | "ALREADY_REVIEWED"
  | "MENTOR_NOT_FOUND"
  | "AUTH_REQUIRED"
  | "LOOKUP_FAILED";

export const REVIEW_ELIGIBILITY_REASON = {
  /** 208: 결제 누적 부족 — "같은 멘토에게 2회 결제하면 후기를 남길 수 있어요 (현재 N/2)" */
  NOT_ENOUGH_PAYMENTS: (paidCount: number | null | undefined, requiredCount: number = REVIEW_REQUIRED_PAID_COUNT): string =>
    `같은 멘토에게 ${requiredCount}회 결제하면 후기를 남길 수 있어요 (현재 ${Math.max(0, paidCount ?? 0)}/${requiredCount})`,
  MODERATED: "검토 중인 후기라 지금은 수정할 수 없습니다.",
  MENTOR_NOT_FOUND: "후기를 남길 수 있는 멘토가 아니에요.",
  AUTH_REQUIRED: "로그인한 학생만 후기를 남길 수 있어요.",
  LOOKUP_FAILED: "후기 작성 자격을 확인하지 못했습니다.",
} as const;

/** 서버(RLS)가 INSERT 를 거부했을 때의 고정 문구 — 판정 원문(정책명 등)은 비추지 않는다. */
export const REVIEW_INSERT_DENIED_MESSAGE = `같은 멘토에게 ${REVIEW_REQUIRED_PAID_COUNT}회 결제한 학생만 후기를 남길 수 있어요.`;

export type ReviewEligibilityRpcPayload = {
  ok?: unknown;
  code?: unknown;
  eligible?: unknown;
  reason?: unknown;
  paid_count?: unknown;
  required_count?: unknown;
  existing_review_id?: unknown;
  can_edit?: unknown;
};

function lookupFailed(): ReviewEligibilityResult {
  return {
    eligible: false,
    mode: "create",
    existingReviewId: null,
    canEdit: false,
    reason: REVIEW_ELIGIBILITY_REASON.LOOKUP_FAILED,
    paidCount: null,
    requiredCount: REVIEW_REQUIRED_PAID_COUNT,
    reasonCode: "LOOKUP_FAILED",
  };
}

function intOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Math.trunc(Number(v));
  return null;
}

/**
 * `review_eligibility_self` 응답 → UI 판정.
 *
 * ⚠️ 검사 **순서가 계약의 일부**다(RPC 도 같은 순서): ① 본인 기존 후기(ALREADY_REVIEWED) → 자격을
 * 재검사하지 않고 'edit'(모더레이션이면 canEdit=false) → ② 없을 때만 신규 작성 자격(OK / NOT_ENOUGH_PAYMENTS).
 * 응답 `eligible` 은 "신규 작성 자격" 이고, 이 결과의 `eligible` 은 "작성/수정 화면 진입 가능" 이다 —
 * 기존 후기가 있으면 신규 자격과 무관하게 진입한다(신규 POST 로 떨어지면 uq_reviews_mentor_author 23505).
 */
export function decideReviewEligibilityFromRpc(
  payload: unknown,
  rpcError?: { message?: string } | null,
): ReviewEligibilityResult {
  if (rpcError) return lookupFailed();
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return lookupFailed();
  const p = payload as ReviewEligibilityRpcPayload;
  const requiredCount = intOrNull(p.required_count) ?? REVIEW_REQUIRED_PAID_COUNT;
  const paidCount = intOrNull(p.paid_count);

  if (p.ok !== true) {
    const code = typeof p.code === "string" ? p.code : "";
    if (code === "MENTOR_NOT_FOUND") {
      return { ...lookupFailed(), reason: REVIEW_ELIGIBILITY_REASON.MENTOR_NOT_FOUND, reasonCode: "MENTOR_NOT_FOUND" };
    }
    if (code === "AUTH_REQUIRED") {
      return { ...lookupFailed(), reason: REVIEW_ELIGIBILITY_REASON.AUTH_REQUIRED, reasonCode: "AUTH_REQUIRED" };
    }
    return lookupFailed();
  }

  const reason = typeof p.reason === "string" ? p.reason : "";
  const existingId = typeof p.existing_review_id === "string" && p.existing_review_id.trim() ? p.existing_review_id.trim() : null;

  // ① 기존 후기 → 수정 경로(자격 재검사 없음 · 171 정본)
  if (reason === "ALREADY_REVIEWED" || existingId) {
    if (!existingId) return lookupFailed();
    const canEdit = p.can_edit === true;
    return {
      eligible: true,
      mode: "edit",
      existingReviewId: existingId,
      canEdit,
      ...(canEdit ? {} : { reason: REVIEW_ELIGIBILITY_REASON.MODERATED }),
      paidCount,
      requiredCount,
      reasonCode: "ALREADY_REVIEWED",
    };
  }

  // ② 신규 작성 자격 — 208 정본(결제 누적 2회)
  if (p.eligible === true || reason === "OK") {
    return { eligible: true, mode: "create", existingReviewId: null, canEdit: false, paidCount, requiredCount, reasonCode: "OK" };
  }
  return {
    eligible: false,
    mode: "create",
    existingReviewId: null,
    canEdit: false,
    reason: REVIEW_ELIGIBILITY_REASON.NOT_ENOUGH_PAYMENTS(paidCount, requiredCount),
    paidCount,
    requiredCount,
    reasonCode: "NOT_ENOUGH_PAYMENTS",
  };
}

/**
 * `reviews` INSERT 실패 매핑 — RLS(`reviews_insert_student` = 208 판정) 거부는 자격 부족 문구,
 * 유니크 위반은 중복 작성 문구, 그 외는 일반 실패. 원문(정책명·테이블명)은 비추지 않는다.
 */
export function mapReviewInsertError(error: { code?: string | null; message?: string | null } | null | undefined): string {
  const code = (error?.code ?? "").trim();
  const message = (error?.message ?? "").toLowerCase();
  if (/unique|duplicate|23505/.test(message) || code === "23505") {
    return "이미 리뷰를 작성했습니다.";
  }
  if (code === "42501" || message.includes("row-level security") || message.includes("permission denied")) {
    return REVIEW_INSERT_DENIED_MESSAGE;
  }
  return "리뷰 저장에 실패했습니다.";
}
