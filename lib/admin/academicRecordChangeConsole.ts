/**
 * 관리자 · 학적 변경 요청 화면(PR-5 §2)의 순수 규칙 — 목록·심사 패널·확인 모달이 함께 쓴다. 멘토 승인 작업대(PR-2)의 축소판.
 *
 * - 탭 값은 `mentor_academic_record_change_requests.status` CHECK 4종(pending·approved·rejected·resubmit_required)과 1:1.
 *   심사 대상(pending·resubmit_required)은 서버 액션 `REVIEWABLE_STATUSES` 와 같은 집합이다.
 * - 변경 전·후를 나란히: 전 = `mentor_profiles.university_name`/`department_name`, 후 = 요청의 `requested_university_name`.
 *   요청에는 학과 항목이 없다(멘토 화면 폼 실측: requestedUniversityName·changeReason·서류) → 학과는 "그대로" 로 표시한다.
 * - **학교 등급 미리보기는 생략한다**: 요청 대학명으로 등급을 판정하는 함수가 코드에 없다(규칙은 SQL 트리거
 *   `tmp_auto_school_verification` 의 LIKE 분기에만 있다). 새로 만들지 않는다(지시서 §2-2 · 하지 말 것 5).
 *   대신 **현재 등급**(mentor_school_verifications 행)과, 승인이 등급을 다시 판정하지 않는다는 사실을 보인다 —
 *   승인 액션은 `mentor_profiles.university_name` 만 갱신하고, 트리거는 `verification_status` 갱신에만 반응한다.
 * - 승인 = stateChange(summary 에 전후 학교·등급 변동 없음 포함) · 반려·재제출 = stateChange + 사유 프리셋(칩 클릭 = 확인).
 *   사유는 액션이 읽는 필드명 `rejectReason` 으로 실린다. DB 쓰기 불변.
 *
 * node --test 계약 테스트가 직접 import 하므로 React·`@/` import 를 두지 않는다.
 */
import type { AdminListParams } from "./adminListParams.ts";
import { ADMIN_LIST_SEARCH_USER_ID_LIMIT, buildAdminDataTableUrl } from "./adminDataTable.ts";
import { resolveAdminStatus } from "./adminStatusDictionary.ts";
import type { SchoolTierReviewState } from "./mentorSchoolTierReview.ts";

export const ACADEMIC_RECORD_CHANGE_BASE_PATH = "/admin/academic-record-changes";
/** 선택된 요청 id 를 싣는 쿼리 키 — 탭·검색·페이지 링크에는 실리지 않는다. */
export const ACADEMIC_RECORD_CHANGE_SELECTED_PARAM = "request";
export const ACADEMIC_RECORD_CHANGE_DEFAULT_PAGE_SIZE = 25;

// ── 탭 — 쿼리 키는 `status` 하나 · 값은 CHECK 4종 ───────────────────────────

export const ACADEMIC_RECORD_CHANGE_TAB_VALUES = ["pending", "approved", "rejected", "resubmit_required", "all"] as const;
export type AcademicRecordChangeTab = (typeof ACADEMIC_RECORD_CHANGE_TAB_VALUES)[number];
export const ACADEMIC_RECORD_CHANGE_DEFAULT_TAB: AcademicRecordChangeTab = "pending";

export const ACADEMIC_RECORD_CHANGE_TABS: readonly { value: AcademicRecordChangeTab; label: string }[] = [
  { value: "pending", label: "대기" },
  { value: "approved", label: "승인" },
  { value: "rejected", label: "반려" },
  { value: "resubmit_required", label: "재제출" },
  { value: "all", label: "전체" },
];

/** 서버 액션 `REVIEWABLE_STATUSES`(mentorAcademicRecordChangeReviewActions.ts)와 같은 집합 */
export const ACADEMIC_RECORD_CHANGE_REVIEWABLE_STATUSES: readonly string[] = ["pending", "resubmit_required"];

export function isAcademicRecordChangeTab(value: string): value is AcademicRecordChangeTab {
  return (ACADEMIC_RECORD_CHANGE_TAB_VALUES as readonly string[]).includes(value);
}

export function resolveAcademicRecordChangeTab(status: string | null | undefined): AcademicRecordChangeTab {
  const s = typeof status === "string" ? status.trim() : "";
  return isAcademicRecordChangeTab(s) ? s : ACADEMIC_RECORD_CHANGE_DEFAULT_TAB;
}

/** 탭이 필터하는 status 값. `all` 은 null(필터 없음). */
export function academicRecordChangeTabStatus(tab: AcademicRecordChangeTab): string | null {
  return tab === "all" ? null : tab;
}

/** 심사 대기 탭(대기·재제출)은 오래된 것부터, 처리된 탭·전체는 최근 것부터 */
export function academicRecordChangeTabAscending(tab: AcademicRecordChangeTab): boolean {
  return tab === "pending" || tab === "resubmit_required";
}

export function isAcademicRecordChangeReviewable(status: string | null | undefined): boolean {
  return ACADEMIC_RECORD_CHANGE_REVIEWABLE_STATUSES.includes(String(status ?? "").trim());
}

export function buildAcademicRecordChangeListUrl(params: AdminListParams, overrides: Partial<AdminListParams> = {}): string {
  return buildAdminDataTableUrl(ACADEMIC_RECORD_CHANGE_BASE_PATH, params, overrides);
}

// ── 검색 ─────────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * 요청 테이블 검색 `.or()` 인자 — 요청·확정 대학명·사유 부분일치 + (users 검색으로 얻은) 멘토 id 집합.
 * 멘토 이름·이메일은 이 테이블에 없으므로 users 조회 결과 id 로 잇는다(멘토 승인 목록과 같은 삽입 지점).
 * `id`·`mentor_id` 는 uuid 라 ilike 불가 — 완전한 UUID 일 때만 `eq`.
 */
export function buildAcademicRecordChangeSearchOr(term: string, mentorIds: readonly string[]): string {
  const parts = [`requested_university_name.ilike.%${term}%`, `approved_university_name.ilike.%${term}%`, `change_reason.ilike.%${term}%`];
  if (UUID_RE.test(term)) parts.push(`id.eq.${term}`, `mentor_id.eq.${term}`);
  const ids = mentorIds.filter((id) => UUID_RE.test(id)).slice(0, ADMIN_LIST_SEARCH_USER_ID_LIMIT);
  if (ids.length) parts.push(`mentor_id.in.(${ids.join(",")})`);
  return parts.join(",");
}

// ── 결정 — 서버 액션이 읽는 필드명·프리셋 ─────────────────────────────────────

export const ACADEMIC_RECORD_CHANGE_REQUEST_ID_FIELD = "requestId";
export const ACADEMIC_RECORD_CHANGE_APPROVED_NAME_FIELD = "approvedUniversityName";
/** 반려·재제출 액션이 모두 읽는 사유 필드명 */
export const ACADEMIC_RECORD_CHANGE_REASON_FIELD = "rejectReason";

export const ACADEMIC_RECORD_CHANGE_REASON_PRESETS: readonly string[] = ["서류를 알아볼 수 없음", "서류와 요청 불일치"];
export const ACADEMIC_RECORD_CHANGE_CUSTOM_REASON_LABEL = "직접 입력";

export const ACADEMIC_RECORD_CHANGE_DECISION_LABELS = { approve: "승인", reject: "반려", resubmit: "재제출 요청" } as const;

export const ACADEMIC_RECORD_CHANGE_DECISION_BUTTON_IDS = {
  approve: "academic-record-change-approve",
  reject: "academic-record-change-reject",
  resubmit: "academic-record-change-resubmit",
} as const;

export type AcademicRecordChangeApproveSummaryInput = {
  name: string;
  beforeUniversity: string;
  beforeDepartment: string;
  afterUniversity: string;
  /** 현재 학교 등급 라벨. null = 학교 인증 행 없음 */
  tierLabel: string | null;
};

export const ACADEMIC_RECORD_CHANGE_TIER_UNCHANGED = "변동 없음 — 승인은 등급을 다시 판정하지 않습니다";

/** 승인 확인 summary — 전후 학교 · 학과 그대로 · 등급 변동 없음을 문장으로 */
export function buildAcademicRecordChangeApproveSummary(input: AcademicRecordChangeApproveSummaryInput): string {
  const who = input.name.trim() || "이름 없음";
  const before = input.beforeUniversity.trim() || "학교 미입력";
  const after = input.afterUniversity.trim() || "학교 미입력";
  const dept = input.beforeDepartment.trim() ? `학과(${input.beforeDepartment.trim()})는 그대로입니다.` : "학과는 요청에 없어 그대로입니다.";
  const tier =
    input.tierLabel === null
      ? "학교 등급 정보 없음(학교 인증 행 없음)."
      : `학교 등급 ${input.tierLabel} → ${input.tierLabel} (${ACADEMIC_RECORD_CHANGE_TIER_UNCHANGED}).`;
  return `${who} 멘토의 학교를 ${before} → ${after} 로 바꿔 승인합니다. ${dept} ${tier}`;
}

export function buildAcademicRecordChangeRejectSummary(name: string): string {
  return `${name.trim() || "이름 없음"} 멘토의 학적 변경 요청을 반려합니다. 프로필 학교는 바뀌지 않습니다.`;
}

export function buildAcademicRecordChangeResubmitSummary(name: string): string {
  return `${name.trim() || "이름 없음"} 멘토에게 서류 재제출을 요청합니다. 고쳐서 다시 낼 수 있습니다.`;
}

/**
 * 심사 패널 등급 안내 — 등급 판정 함수가 코드에 없어 "요청 대학의 등급" 은 보이지 않는다.
 * 현재 등급과 승인이 등급을 바꾸지 않는다는 사실만 보인다(지시서 §2-2: 판정 함수 없으면 생략하고 보고).
 */
export const ACADEMIC_RECORD_CHANGE_TIER_NOTE =
  "승인은 프로필 학교명만 갱신하고 학교 등급을 다시 판정하지 않습니다. 등급 변경이 필요하면 멘토 승인 화면 ③ 학교 등급에서 확정합니다.";

export type AcademicRecordChangeTierView = {
  /** 현재 등급 라벨. 인증 행이 없으면 null */
  label: string | null;
  /** auto = 트리거 자동 판정(미확정) · confirmed = 사람이 확정 · none = 인증 행 없음 */
  mode: SchoolTierReviewState["mode"];
};

export function describeAcademicRecordChangeTier(state: SchoolTierReviewState | null | undefined): AcademicRecordChangeTierView {
  if (!state || !state.row) return { label: null, mode: "none" };
  return { label: resolveAdminStatus("mentor_school_verifications", "school_tier", state.suggestedTier).label, mode: state.mode };
}

// ── 빈 상태 ──────────────────────────────────────────────────────────────────

export const ACADEMIC_RECORD_CHANGE_EMPTY_STATE = {
  title: "처리할 학적 변경 요청이 없습니다",
  description: "멘토가 프로필 학교 변경을 신청하면 증빙 서류와 함께 이 화면에 쌓입니다. 지금은 비어 있는 것이 정상입니다.",
} as const;

export type AcademicRecordChangeEmptyVariant = "first" | "tab" | "search";

export function academicRecordChangeEmptyVariant(search: string, allCount: number): AcademicRecordChangeEmptyVariant {
  if (search.trim()) return "search";
  if (allCount <= 0) return "first";
  return "tab";
}

// ── 플래시 ───────────────────────────────────────────────────────────────────

export function academicRecordChangeFlashOkMessage(ok: string | null | undefined): string | null {
  switch (String(ok ?? "").trim()) {
    case "approve":
      return "학적 변경 요청을 승인하고 프로필 학교를 반영했습니다.";
    case "reject":
      return "학적 변경 요청을 반려했습니다.";
    case "resubmit":
      return "서류 재제출을 요청했습니다.";
    default:
      return null;
  }
}
