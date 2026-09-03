/**
 * 관리자 · 리뷰 관리 화면(PR-11 §2)의 순수 규칙 — 목록(상태 탭 · 멘토·작성자 검색 · 격리 보관함) · 상세 · 조치 확인 모달 · 빈 상태 · 플래시.
 *
 * - 상태는 `reviews` 의 세 컬럼(`is_blinded` > `is_hidden` > `moderation_state`)에서 하나로 접는다(`reviewEffectiveState`) — 우선순위는
 *   구 `reviewLabels.adminReviewExposureLabel` 그대로다. 라벨·톤은 상태 사전 `reviews.moderation_state`(CHECK 없음 → 사전이 유일 허용 목록 4값).
 * - `격리` 탭 = `reviews_quarantine_archive` + `reviews_duplicates_archive`(123_reviews_converge 가 옮긴 행 · service_role 전용 · 조회만).
 * - 조치 4종(숨김 · 블라인드 · 복원 · 검토 완료)은 전부 `stateChange`(한 줄 확인). 서버 액션(`moderateAdminReviewAction`)이 읽는 필드명
 *   (`reviewId` · `action`)과 허용 값(`hide` · `restore` · `blind` · `review`)은 바꾸지 않는다. `returnTo` 는 상세로 돌아오기 위한 선택 필드.
 * - **삭제 조치는 없다** — `reviews` 에 삭제 경로(하드·소프트 어느 쪽도)가 없고 이 PR 은 새 쓰기 경로를 만들지 않는다(§2-3 보고).
 * - 평점은 리뷰 행 값 그대로(멘토 집계 평점은 뷰 계산값이라 stale 이 아니다).
 *
 * node --test 계약 테스트가 직접 import 하므로 React·`@/` import 를 두지 않는다.
 */
import type { AdminListParams } from "./adminListParams.ts";
import { ADMIN_LIST_SEARCH_USER_ID_LIMIT, buildAdminDataTableUrl, type AdminDataTableTab } from "./adminDataTable.ts";
import { resolveAdminStatus } from "./adminStatusDictionary.ts";
import { CONTENT_REPORT_BASE_PATH } from "./contentReportConsole.ts";
import { adminReviewRowIsBlinded, adminReviewRowIsHidden, adminReviewRowIsReviewed, type AdminReviewModerationPlan } from "./reviewLabels.ts";

export const REVIEW_BASE_PATH = "/admin/reviews";
export const REVIEW_DEFAULT_PAGE_SIZE = 25;
export const REVIEW_TABLE = "reviews";

/** 조치 컬럼 플랜 — `adminQueries.probeAdminReviewModerationPlan` 이 돌려주는 상수와 같아야 한다(계약 테스트가 대조). */
export const REVIEW_MODERATION_PLAN: AdminReviewModerationPlan = {
  hide: { column: "is_hidden", mode: "boolean_true" },
  blind: { column: "is_blinded" },
  reviewDone: { column: "moderation_state", kind: "enum", enumValue: "reviewed" },
};

// ── 유효 상태 — 사전 `reviews.moderation_state` 4값 ───────────────────────────

export const REVIEW_STATE_VALUES = ["visible", "hidden", "blinded", "reviewed"] as const;
export type ReviewState = (typeof REVIEW_STATE_VALUES)[number];

type Row = Record<string, unknown>;

/** 블라인드 > 숨김 > 검토 완료 > 공개 */
export function reviewEffectiveState(row: Row): ReviewState {
  if (adminReviewRowIsBlinded(row, REVIEW_MODERATION_PLAN)) return "blinded";
  if (adminReviewRowIsHidden(row, REVIEW_MODERATION_PLAN)) return "hidden";
  if (adminReviewRowIsReviewed(row, REVIEW_MODERATION_PLAN)) return "reviewed";
  return "visible";
}

export function reviewStateLabel(state: ReviewState): string {
  return resolveAdminStatus(REVIEW_TABLE, "moderation_state", state).label;
}

// ── 탭 — 쿼리 키는 `status` 하나 ─────────────────────────────────────────────

export const REVIEW_TAB_VALUES = ["visible", "hidden", "blinded", "quarantine", "all"] as const;
export type ReviewTab = (typeof REVIEW_TAB_VALUES)[number];
export const REVIEW_DEFAULT_TAB: ReviewTab = "all";

export const REVIEW_QUARANTINE_TAB_LABEL = "격리";
export const REVIEW_ALL_TAB_LABEL = "전체";

/** 공개·숨김·블라인드 라벨은 사전에서 · 격리·전체만 화면 고유 */
export const REVIEW_TABS: readonly AdminDataTableTab<ReviewTab>[] = REVIEW_TAB_VALUES.map((value) => ({
  value,
  label: value === "quarantine" ? REVIEW_QUARANTINE_TAB_LABEL : value === "all" ? REVIEW_ALL_TAB_LABEL : resolveAdminStatus(REVIEW_TABLE, "moderation_state", value).label,
}));

export function resolveReviewTab(raw: string | null | undefined): ReviewTab {
  const v = String(raw ?? "").trim();
  return (REVIEW_TAB_VALUES as readonly string[]).includes(v) ? (v as ReviewTab) : REVIEW_DEFAULT_TAB;
}

/** 탭 → `reviews` 서버 필터(null = 조건 없음). 격리·전체는 조건 없음(격리는 보관함 테이블을 읽는다). */
export type ReviewTabFilter = { isHidden: boolean | null; isBlinded: boolean | null };

export function reviewTabFilter(tab: ReviewTab): ReviewTabFilter {
  switch (tab) {
    case "visible":
      return { isHidden: false, isBlinded: false };
    case "hidden":
      return { isHidden: true, isBlinded: null };
    case "blinded":
      return { isHidden: null, isBlinded: true };
    default:
      return { isHidden: null, isBlinded: null };
  }
}

export function reviewTabIsArchive(tab: ReviewTab): boolean {
  return tab === "quarantine";
}

export const REVIEW_ARCHIVE_SOURCES = [
  { table: "reviews_quarantine_archive", label: "격리" },
  { table: "reviews_duplicates_archive", label: "중복" },
] as const;
export type ReviewArchiveTable = (typeof REVIEW_ARCHIVE_SOURCES)[number]["table"];

export const REVIEW_ARCHIVE_NOTE =
  "격리·중복 보관함은 123_reviews_converge 수렴 때 본문·작성자가 비었거나(격리) 같은 멘토·작성자 중복이던(중복) 행을 옮긴 곳입니다. service_role 전용 · 조회만 됩니다.";

// ── 조치 — 서버 액션이 읽는 필드명 · 허용 값 · 등급 ────────────────────────────

export const REVIEW_ID_FIELD = "reviewId";
export const REVIEW_ACTION_FIELD = "action";
export const REVIEW_RETURN_TO_FIELD = "returnTo";

/** `adminReviewActions.ACTION_SET` 과 같은 집합 */
export const REVIEW_ACTION_KEYS = ["hide", "blind", "restore", "review"] as const;
export type ReviewActionKey = (typeof REVIEW_ACTION_KEYS)[number];

export const REVIEW_ACTIONS: Readonly<
  Record<ReviewActionKey, { level: "stateChange"; label: string; dialogTitle: string; confirmLabel: string; pendingLabel: string; summary: string }>
> = {
  hide: {
    level: "stateChange",
    label: "숨김",
    dialogTitle: "리뷰 숨김",
    confirmLabel: "숨김",
    pendingLabel: "숨기는 중…",
    summary: "이 리뷰를 숨깁니다. 공개 화면과 평점 집계에서 빠지며, 복원할 수 있습니다.",
  },
  blind: {
    level: "stateChange",
    label: "블라인드",
    dialogTitle: "리뷰 블라인드",
    confirmLabel: "블라인드",
    pendingLabel: "처리 중…",
    summary: "이 리뷰를 블라인드 처리합니다. 공개 화면에서 빠지고 블라인드로 기록되며, 복원할 수 있습니다.",
  },
  restore: {
    level: "stateChange",
    label: "복원",
    dialogTitle: "리뷰 복원",
    confirmLabel: "복원",
    pendingLabel: "복원 중…",
    summary: "이 리뷰를 공개 상태로 복원합니다. 공개 화면과 평점 집계에 다시 포함됩니다.",
  },
  review: {
    level: "stateChange",
    label: "검토 완료",
    dialogTitle: "검토 완료 표시",
    confirmLabel: "검토 완료",
    pendingLabel: "처리 중…",
    summary: "현재 노출 상태를 유지한 채 검토 완료로 표시합니다.",
  },
};

/** 유효 상태별 가능한 조치 — 공개: 숨김·블라인드·검토 완료 · 검토 완료: 숨김·블라인드 · 숨김: 복원·블라인드 · 블라인드: 복원 */
export function reviewAvailableActions(state: ReviewState): ReviewActionKey[] {
  switch (state) {
    case "visible":
      return ["hide", "blind", "review"];
    case "reviewed":
      return ["hide", "blind"];
    case "hidden":
      return ["restore", "blind"];
    default:
      return ["restore"];
  }
}

export const REVIEW_DELETE_UNAVAILABLE_NOTE =
  "삭제 조치는 없습니다 — reviews 에 삭제 경로(하드·소프트 어느 쪽도)가 없고 새 쓰기 경로는 만들지 않습니다. 비노출은 숨김·블라인드로 합니다.";

/** 서버 액션의 복귀 경로 — 리뷰 화면 안으로만. */
export function isSafeReviewReturnTo(value: string | null | undefined): boolean {
  const v = String(value ?? "").trim();
  return v.startsWith(REVIEW_BASE_PATH) && !v.startsWith("//") && !/[\r\n]/.test(v);
}

// ── 링크 ──────────────────────────────────────────────────────────────────────

export function reviewDetailPath(reviewId: string): string {
  return `${REVIEW_BASE_PATH}/${encodeURIComponent(String(reviewId ?? "").trim())}`;
}

export function buildReviewListUrl(params: AdminListParams, overrides: Partial<AdminListParams> = {}): string {
  return buildAdminDataTableUrl(REVIEW_BASE_PATH, params, overrides);
}

/** 신고 건수 → 신고 검수 목록(전체 탭 · 대상 ID 검색). */
export function reviewReportsUrl(reviewId: string): string {
  return `${CONTENT_REPORT_BASE_PATH}?status=all&q=${encodeURIComponent(String(reviewId ?? "").trim())}`;
}

// ── 검색 ─────────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * 검색 `.or()` 인자 — 본문 부분일치 + (users 검색으로 얻은) 멘토·작성자 id 집합. `id`·`mentor_id`·`author_id` 는 uuid 라
 * `ilike` 를 걸지 않는다 — 완전한 UUID 일 때만 `eq`.
 */
export function buildReviewSearchOr(term: string, userIds: readonly string[]): string {
  const parts = [`body.ilike.%${term}%`];
  if (UUID_RE.test(term)) parts.push(`id.eq.${term}`, `mentor_id.eq.${term}`, `author_id.eq.${term}`);
  const ids = userIds.filter((id) => UUID_RE.test(id)).slice(0, ADMIN_LIST_SEARCH_USER_ID_LIMIT);
  if (ids.length) parts.push(`mentor_id.in.(${ids.join(",")})`, `author_id.in.(${ids.join(",")})`);
  return parts.join(",");
}

// ── 표시 ──────────────────────────────────────────────────────────────────────

export const REVIEW_SUMMARY_MAX_LENGTH = 100;

export function reviewSummaryText(body: unknown): string {
  const text = typeof body === "string" ? body.replace(/\s+/g, " ").trim() : "";
  if (!text) return "—";
  return text.length > REVIEW_SUMMARY_MAX_LENGTH ? `${text.slice(0, REVIEW_SUMMARY_MAX_LENGTH - 1)}…` : text;
}

/** `★ 4` · 값이 없으면 `—` */
export function reviewRatingLabel(rating: unknown): string {
  const n = typeof rating === "number" ? rating : typeof rating === "string" && rating.trim() ? Number(rating) : NaN;
  return Number.isFinite(n) ? `★ ${n}` : "—";
}

/** 후기 작성 조건(CLAUDE.md 잠금값 · DB `check_review_eligibility`) — 상세의 결제 이력 섹션 설명 */
export const REVIEW_ELIGIBILITY_RULE = "같은 멘토에게 2회 연속 결제 성공(2개월 연속 결제 · check_review_eligibility)";

export type ReviewEligibility = "eligible" | "ineligible" | "unknown";
export const REVIEW_ELIGIBILITY_LABELS: Readonly<Record<ReviewEligibility, string>> = {
  eligible: "조건 충족",
  ineligible: "조건 미충족",
  unknown: "확인 불가",
};

// ── 플래시 · 빈 상태 ───────────────────────────────────────────────────────────

const FLASH_OK: Readonly<Record<string, string>> = {
  hide: "리뷰를 숨김 처리했습니다.",
  restore: "리뷰를 복원했습니다.",
  blind: "리뷰를 블라인드 처리했습니다.",
  review: "검토 완료로 표시했습니다.",
};

export function reviewFlashOkMessage(ok: string | null | undefined): string | null {
  const k = String(ok ?? "").trim();
  return k ? (FLASH_OK[k] ?? null) : null;
}

export const REVIEW_EMPTY_STATE = {
  title: "아직 작성된 리뷰가 없습니다",
  description: "학생이 같은 멘토에게 2회 이상 결제하면 후기를 남길 수 있습니다.",
} as const;

export type ReviewEmptyVariant = "first" | "tab" | "search";

/** 검색 중이면 search · 리뷰가 한 건도 없으면 first · 그 외(이 탭만 비었음) tab */
export function reviewEmptyVariant(search: string, allCount: number): ReviewEmptyVariant {
  if (search.trim()) return "search";
  if (allCount <= 0) return "first";
  return "tab";
}
