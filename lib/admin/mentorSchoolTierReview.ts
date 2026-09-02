/**
 * 멘토 승인 작업대 — ③ 학교 등급 확정 블록의 순수 판정(PR-2 §6).
 *
 * 트리거(`tmp_auto_school_verification`)는 건드리지 않고 화면에서 구분한다:
 *   `mentor_school_verifications.reviewed_by IS NULL`     → 트리거 자동 생성 → "자동 판정 · 미확정"
 *   `mentor_school_verifications.reviewed_by IS NOT NULL` → 사람이 확정 → "확정됨 · {관리자} · {일시}"
 *
 * 확정 액션은 기존 RPC `approve_mentor_school_verification_admin`(SQL 174) 한 경로다. 그 RPC 는
 * `reviewed_by = auth.uid()` · `reviewed_at = now()` 를 채운다(확인 완료 — 중단 조건 아님). 다만 RPC 는
 *   (a) status 가 pending·resubmit_required 인 행만 받고(그 외 NOT_REVIEWABLE)
 *   (b) `document_storage_ref` 가 비어 있으면 DOCUMENT_REF_MISSING 으로 거부한다.
 * 트리거가 만든 행은 status='approved' · 서류 없음이라 (a)(b) 둘 다 걸린다. 이 모듈은 그 사실을
 * `blockers` 로 드러내고, 화면은 확정 버튼을 잠근 채 이유를 보여준다(새 쓰기 경로를 만들지 않는다).
 *
 * node --test 계약 테스트가 직접 import 하므로 React·`@/` import 를 두지 않는다.
 */

/** RPC 174 가 승인 대상으로 받는 status — SQL 의 `v_row.status not in ('pending','resubmit_required')` 와 동일. */
export const SCHOOL_TIER_RPC_REVIEWABLE_STATUSES: readonly string[] = ["pending", "resubmit_required"];

export type SchoolTierReviewRowLite = {
  id: string;
  status: string;
  school_tier: string | null;
  verified_major_category: string | null;
  verified_university_name: string | null;
  verified_university_id: string | null;
  verified_department_name: string | null;
  document_storage_ref: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string | null;
};

export type SchoolTierReviewMode = "none" | "auto" | "confirmed";
export type SchoolTierConfirmBlocker = "not_reviewable_status" | "document_missing";

export type SchoolTierReviewState = {
  mode: SchoolTierReviewMode;
  row: SchoolTierReviewRowLite | null;
  /** RPC 가 이 행을 받지 않는 이유들. 비어 있으면 확정 가능 */
  blockers: SchoolTierConfirmBlocker[];
  confirmable: boolean;
  /** 드롭다운 초기 선택값(자동값 또는 확정값). 행이 없으면 폴백 */
  suggestedTier: string;
  suggestedCategory: string;
};

export const SCHOOL_TIER_FALLBACK = "미분류";
export const MAJOR_CATEGORY_FALLBACK = "기타";

export const SCHOOL_TIER_BADGE_AUTO = "자동 판정 · 미확정";
export const SCHOOL_TIER_BADGE_CONFIRMED_PREFIX = "확정됨";

function timeOf(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/**
 * 한 멘토의 인증 행들 중 화면에 보일 행 — approved(1인 1승인) 우선, 없으면 심사 대상(pending·resubmit_required)
 * 최신, 그것도 없으면 최신 행. superseded 만 남은 경우도 최신 행으로 보인다(이력 표시).
 */
export function pickSchoolTierReviewRow(rows: readonly SchoolTierReviewRowLite[]): SchoolTierReviewRowLite | null {
  if (!rows.length) return null;
  const byNewest = [...rows].sort((a, b) => timeOf(b.created_at) - timeOf(a.created_at));
  return (
    byNewest.find((r) => r.status === "approved") ??
    byNewest.find((r) => SCHOOL_TIER_RPC_REVIEWABLE_STATUSES.includes(r.status)) ??
    byNewest[0]
  );
}

export function resolveSchoolTierReviewState(row: SchoolTierReviewRowLite | null): SchoolTierReviewState {
  if (!row) {
    return {
      mode: "none",
      row: null,
      blockers: [],
      confirmable: false,
      suggestedTier: SCHOOL_TIER_FALLBACK,
      suggestedCategory: MAJOR_CATEGORY_FALLBACK,
    };
  }
  const blockers: SchoolTierConfirmBlocker[] = [];
  if (!SCHOOL_TIER_RPC_REVIEWABLE_STATUSES.includes(row.status)) blockers.push("not_reviewable_status");
  if (!String(row.document_storage_ref ?? "").trim()) blockers.push("document_missing");
  const reviewed = typeof row.reviewed_by === "string" && row.reviewed_by.trim().length > 0;
  return {
    mode: reviewed ? "confirmed" : "auto",
    row,
    blockers,
    confirmable: blockers.length === 0,
    suggestedTier: row.school_tier?.trim() || SCHOOL_TIER_FALLBACK,
    suggestedCategory: row.verified_major_category?.trim() || MAJOR_CATEGORY_FALLBACK,
  };
}

/** 확정 버튼을 잠근 이유 — 운영자에게 보이는 문장 */
export function schoolTierConfirmBlockerMessage(blocker: SchoolTierConfirmBlocker, status?: string | null): string {
  switch (blocker) {
    case "not_reviewable_status":
      return `이 행은 이미 '${status ?? "?"}' 상태라 확정 RPC(approve_mentor_school_verification_admin)가 받지 않습니다. 자동 판정 행의 확정 경로는 오너 처리 대기입니다.`;
    case "document_missing":
    default:
      return "제출된 학교 인증 서류가 없어 확정 RPC 가 승인을 거부합니다(DOCUMENT_REF_MISSING).";
  }
}
