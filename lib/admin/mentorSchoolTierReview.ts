/**
 * 멘토 승인 작업대 — ③ 학교 등급 확정 블록의 순수 판정(PR-2 §6 · PR-2c 잠금 완화 · PR-W1 등급 정정).
 *
 * 트리거는 건드리지 않고 화면에서 구분한다:
 *   `mentor_school_verifications.reviewed_by IS NULL`     → 자동 판정(잠정) → "자동 판정 · 미확정"
 *   `mentor_school_verifications.reviewed_by IS NOT NULL` → 사람이 확정 → "확정됨 · {관리자} · {일시}"
 *
 * 확정·정정 액션은 기존 RPC `approve_mentor_school_verification_admin` 한 경로다(새 쓰기 경로 없음). RPC 는
 * `reviewed_by = auth.uid()` · `reviewed_at = now()` 를 채우고, 확정된 행을 다시 확정하면(= 정정) 이전 등급·이전 확정자를
 * `admin_action_logs`(school_tier_corrected)에 남긴다(DB-2 · SQL 193 A-2).
 *
 * 버튼 잠금 조건(PR-W1 · 2026-09-03 오너 결정 · DB-2 SQL 193 A-2 규칙과 동일):
 *   가능 = status 가 `pending` · `resubmit_required` · `approved`(잠정·확정 무관 — 확정된 행은 "등급 정정")
 *   잠금 = 그 외 status(rejected · superseded …)
 *   서류(`document_storage_ref`) 유무는 잠금 조건이 아니다(PR-2c) — 없으면 경고 문구만 보이고 버튼은 열린다.
 *   (구 잠금 `already_confirmed`(이미 확정된 approved)는 폐기 — 정정이 가능해졌다.)
 *
 * 버튼 라벨: 확정된 행(mode `confirmed`) → `등급 정정` · 그 외 → `확정` (`schoolTierConfirmButtonLabel`).
 *
 * 순서 주의: 이 모듈이 먼저 배포되고 DB-2(SQL 193)가 적용되기 전까지는, 확정된 행의 정정을 누르면 옛 RPC(192)가
 * NOT_REVIEWABLE 로 거절한다(화면은 처리 실패를 표시 · 데이터 불변). 이 짧은 불일치 구간은 오너가 허용했다.
 *
 * node --test 계약 테스트가 직접 import 하므로 React·`@/` import 를 두지 않는다.
 */

/** RPC 가 무조건 심사 대상으로 받는 status(174 · 192 · 193 공통) — 행 선택(`pickSchoolTierReviewRow`)의 "심사 대상" 판정에도 쓴다. */
export const SCHOOL_TIER_RPC_REVIEWABLE_STATUSES: readonly string[] = ["pending", "resubmit_required"];

/** approved — 잠정(reviewed_by NULL)이든 확정이든 확정·정정 대상(SQL 193 A-2). 행 선택에서 최우선. */
export const SCHOOL_TIER_PROVISIONAL_STATUS = "approved";

/** 확정 버튼이 열리는 status 전체 = RPC 허용 status (pending · resubmit_required · approved). */
export const SCHOOL_TIER_CONFIRMABLE_STATUSES: readonly string[] = [...SCHOOL_TIER_RPC_REVIEWABLE_STATUSES, SCHOOL_TIER_PROVISIONAL_STATUS];

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

/**
 * 확정 블록 아래 목록에 보이는 사유.
 *   `not_reviewable_status` → 잠금(버튼 비활성)
 *   `document_missing`      → 경고 전용(버튼은 열린다 — PR-2c)
 */
export type SchoolTierConfirmBlocker = "not_reviewable_status" | "document_missing";

/** 확정 버튼을 실제로 잠그는 사유. 여기 없는 사유(`document_missing`)는 경고만 한다. */
export const SCHOOL_TIER_LOCKING_BLOCKERS: readonly SchoolTierConfirmBlocker[] = ["not_reviewable_status"];

export function isSchoolTierLockingBlocker(blocker: SchoolTierConfirmBlocker): boolean {
  return SCHOOL_TIER_LOCKING_BLOCKERS.includes(blocker);
}

export type SchoolTierReviewState = {
  mode: SchoolTierReviewMode;
  row: SchoolTierReviewRowLite | null;
  /** 화면 목록에 보일 사유 — 잠금 사유(`isSchoolTierLockingBlocker`) + 경고. 잠금 여부는 `confirmable` 로 본다 */
  blockers: SchoolTierConfirmBlocker[];
  /** 잠금 사유가 하나도 없으면 true. 서류 없음(경고)만으로는 false 가 되지 않는다 */
  confirmable: boolean;
  /** 드롭다운 초기 선택값(자동값 또는 확정값). 행이 없으면 폴백 */
  suggestedTier: string;
  suggestedCategory: string;
};

export const SCHOOL_TIER_FALLBACK = "미분류";
export const MAJOR_CATEGORY_FALLBACK = "기타";

export const SCHOOL_TIER_BADGE_AUTO = "자동 판정 · 미확정";
export const SCHOOL_TIER_BADGE_CONFIRMED_PREFIX = "확정됨";

/** 버튼 라벨 — 확정된 행은 "등급 정정", 잠정·심사 대상은 "확정". */
export const SCHOOL_TIER_CONFIRM_BUTTON_LABEL = "확정";
export const SCHOOL_TIER_CORRECT_BUTTON_LABEL = "등급 정정";

function timeOf(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/** `reviewed_by IS NOT NULL` — 사람이 확정한 행. 배지(확정됨)와 버튼 라벨(등급 정정) 판정이 같은 기준을 쓴다. */
function isReviewedRow(row: Pick<SchoolTierReviewRowLite, "reviewed_by">): boolean {
  return typeof row.reviewed_by === "string" && row.reviewed_by.trim().length > 0;
}

/**
 * 한 멘토의 인증 행들 중 화면에 보일 행 — approved(1인 1승인) 우선, 없으면 심사 대상(pending·resubmit_required)
 * 최신, 그것도 없으면 최신 행. superseded 만 남은 경우도 최신 행으로 보인다(이력 표시).
 */
export function pickSchoolTierReviewRow(rows: readonly SchoolTierReviewRowLite[]): SchoolTierReviewRowLite | null {
  if (!rows.length) return null;
  const byNewest = [...rows].sort((a, b) => timeOf(b.created_at) - timeOf(a.created_at));
  return (
    byNewest.find((r) => r.status === SCHOOL_TIER_PROVISIONAL_STATUS) ??
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
  const reviewed = isReviewedRow(row);
  const blockers: SchoolTierConfirmBlocker[] = [];
  // PR-W1: approved 는 잠정(reviewed_by NULL)이든 확정이든 대상 — 확정된 행은 "등급 정정"(SQL 193 A-2). 그 외 status 만 잠근다.
  if (!SCHOOL_TIER_CONFIRMABLE_STATUSES.includes(row.status)) {
    blockers.push("not_reviewable_status");
  }
  // 서류 없음은 경고만 — 잠그지 않는다(PR-2c)
  if (!String(row.document_storage_ref ?? "").trim()) blockers.push("document_missing");
  return {
    mode: reviewed ? "confirmed" : "auto",
    row,
    blockers,
    confirmable: !blockers.some(isSchoolTierLockingBlocker),
    suggestedTier: row.school_tier?.trim() || SCHOOL_TIER_FALLBACK,
    suggestedCategory: row.verified_major_category?.trim() || MAJOR_CATEGORY_FALLBACK,
  };
}

/** 확정 버튼 문구 — 확정된 행(reviewed_by 기록)은 `등급 정정`, 그 외(잠정·심사 대상·행 없음)는 `확정`. */
export function schoolTierConfirmButtonLabel(state: Pick<SchoolTierReviewState, "mode">): string {
  return state.mode === "confirmed" ? SCHOOL_TIER_CORRECT_BUTTON_LABEL : SCHOOL_TIER_CONFIRM_BUTTON_LABEL;
}

export function schoolTierConfirmDialogTitle(state: Pick<SchoolTierReviewState, "mode">): string {
  return state.mode === "confirmed" ? "학교 등급 정정" : "학교 등급 확정";
}

export function schoolTierConfirmPendingLabel(state: Pick<SchoolTierReviewState, "mode">): string {
  return state.mode === "confirmed" ? "정정 중…" : "확정 중…";
}

/**
 * 확인 다이얼로그 summary — 확정된 행은 "정정"(reviewed_by·reviewed_at 갱신 · 이전 등급·확정자는 감사 로그),
 * 그 외는 "확정"(reviewed_by 기록). `afterNote` 는 화면별 후속 안내(예: 이동 안내)를 뒤에 붙인다.
 */
export function buildSchoolTierConfirmSummary(displayName: string, state: Pick<SchoolTierReviewState, "mode">, opts?: { afterNote?: string }): string {
  const name = String(displayName ?? "").trim() || "이";
  const base =
    state.mode === "confirmed"
      ? `${name} 멘토의 확정된 학교 등급을 정정합니다. 정정하면 reviewed_by·reviewed_at 이 새로 기록되고 이전 등급·확정자는 감사 로그에 남습니다.`
      : `${name} 멘토의 학교 등급을 확정합니다. 확정하면 reviewed_by 에 처리한 관리자가 기록됩니다.`;
  const note = String(opts?.afterNote ?? "").trim();
  return note ? `${base} ${note}` : base;
}

/** 확정 블록 아래 목록 문장 — 잠금 사유는 이유를, 경고는 확정이 가능하다는 사실을 운영자에게 알린다 */
export function schoolTierConfirmBlockerMessage(blocker: SchoolTierConfirmBlocker, status?: string | null): string {
  switch (blocker) {
    case "not_reviewable_status":
      return `이 행은 '${status ?? "?"}' 상태라 확정 RPC(approve_mentor_school_verification_admin)가 받지 않습니다(NOT_REVIEWABLE). 확정·정정 대상은 pending · resubmit_required · approved 행입니다.`;
    case "document_missing":
    default:
      return "제출된 학교 인증 서류가 없습니다. 오너 결정(2026-09-03)에 따라 서류 없이도 확정할 수 있습니다 — 아래 등급·계열 선택값을 확인한 뒤 확정하세요.";
  }
}
