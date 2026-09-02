/**
 * 멘토 승인 작업대 — 좌측 목록(큐)의 순수 규칙(PR-2 §2).
 *
 * - 탭은 서버 필터다. 쿼리 키는 `status` 하나(구 `filter` 키 폐기). 클라이언트 필터는 없다.
 * - 대기 판정은 승인·반려 서버 액션의 `.in(...)` 조건(`MENTOR_PENDING_STATUS_VALUES_FOR_IN`)과
 *   같은 집합을 쓴다(H1 규칙). 그중 `under_review`(추가 서류 요청 액션이 쓰는 값)는 "재제출" 탭으로 보낸다 —
 *   두 탭이 한 행을 겹쳐 보여주지 않게.
 * - "대기 건이 항상 위": 전체 탭은 대기 부분과 나머지 부분을 **서버에서** 두 range 로 이어 붙인다.
 *   그 range 산술이 `splitPendingFirstRange` 다(계약 테스트 대상).
 *
 * node --test 계약 테스트가 직접 import 하므로 React·`@/` import 를 두지 않는다.
 */
import { MENTOR_PENDING_STATUS_VALUES_FOR_IN } from "./mentorApprovalConstants.ts";
import { buildAdminListUrl, type AdminListParams } from "./adminListParams.ts";

export const MENTOR_APPROVAL_BASE_PATH = "/admin/mentor-approval";
/** 선택된 지원자 id 를 싣는 쿼리 키 — 탭·검색·페이지 링크에는 실리지 않는다. */
export const MENTOR_APPROVAL_SELECTED_PARAM = "mentor";
export const MENTOR_APPROVAL_DEFAULT_PAGE_SIZE = 25;

export const MENTOR_APPROVAL_TAB_VALUES = ["pending", "approved", "rejected", "resubmit_required", "all"] as const;
export type MentorApprovalTab = (typeof MENTOR_APPROVAL_TAB_VALUES)[number];
export const MENTOR_APPROVAL_DEFAULT_TAB: MentorApprovalTab = "pending";

export const MENTOR_APPROVAL_TABS: readonly { value: MentorApprovalTab; label: string }[] = [
  { value: "pending", label: "대기" },
  { value: "approved", label: "승인" },
  { value: "rejected", label: "반려" },
  { value: "resubmit_required", label: "재제출" },
  { value: "all", label: "전체" },
];

/** 재제출 탭 — `requestMentorDocumentsAction` 이 쓰는 `under_review` + 사전 값 `resubmit_required`. */
export const MENTOR_APPROVAL_RESUBMIT_STATUSES: readonly string[] = ["under_review", "resubmit_required"];

/** 대기 탭 — 액션 `.in(...)` 집합에서 재제출 탭으로 보낸 값을 뺀 나머지. */
export const MENTOR_APPROVAL_PENDING_TAB_STATUSES: readonly string[] = MENTOR_PENDING_STATUS_VALUES_FOR_IN.filter(
  (s) => !MENTOR_APPROVAL_RESUBMIT_STATUSES.includes(s)
);

export function isMentorApprovalTab(value: string): value is MentorApprovalTab {
  return (MENTOR_APPROVAL_TAB_VALUES as readonly string[]).includes(value);
}

/** `status` 파라미터 → 탭. 비어 있거나 모르는 값은 기본 탭(대기). */
export function resolveMentorApprovalTab(status: string | null | undefined): MentorApprovalTab {
  const s = typeof status === "string" ? status.trim() : "";
  return isMentorApprovalTab(s) ? s : MENTOR_APPROVAL_DEFAULT_TAB;
}

/** 탭이 필터하는 `verification_status` 값 집합. `all` 은 null(필터 없음). */
export function mentorApprovalTabStatuses(tab: MentorApprovalTab): readonly string[] | null {
  switch (tab) {
    case "pending":
      return MENTOR_APPROVAL_PENDING_TAB_STATUSES;
    case "approved":
      return ["approved"];
    case "rejected":
      return ["rejected"];
    case "resubmit_required":
      return MENTOR_APPROVAL_RESUBMIT_STATUSES;
    case "all":
    default:
      return null;
  }
}

/** 행이 "대기 탭" 소속인가(전체 탭 정렬·다음 대기 건 이동 판정). */
export function isMentorApprovalPendingTabStatus(status: string | null | undefined): boolean {
  const s = typeof status === "string" ? status.trim() : "";
  return MENTOR_APPROVAL_PENDING_TAB_STATUSES.includes(s);
}

/**
 * 행에 승인·반려·재제출 결정을 내릴 수 있는가 — 서버 액션의 `.in(...)` 조건과 **동일 집합**(H1).
 * 재제출 탭 행(`under_review`)도 액션 조건에 포함되므로 결정 가능하다.
 */
export function isMentorApprovalDecidable(status: string | null | undefined): boolean {
  const s = typeof status === "string" ? status.trim() : "";
  return MENTOR_PENDING_STATUS_VALUES_FOR_IN.includes(s);
}

export type PgRange = { from: number; to: number };

/**
 * 전체 탭 "대기 건이 항상 위" 페이징 — 대기 행이 [0, pendingCount) 을 차지하고 나머지가 그 뒤를 잇는
 * 가상 목록에서 [from, to] 구간을 두 실제 쿼리 range 로 쪼갠다(0-based inclusive, PostgREST `.range`).
 * 어느 쪽도 해당 구간이 없으면 null.
 */
export function splitPendingFirstRange(pendingCount: number, from: number, to: number): { pending: PgRange | null; rest: PgRange | null } {
  const p = Math.max(0, Math.trunc(pendingCount));
  const f = Math.max(0, Math.trunc(from));
  const t = Math.max(f, Math.trunc(to));
  const pending = f <= p - 1 ? { from: f, to: Math.min(t, p - 1) } : null;
  const rest = t >= p ? { from: Math.max(0, f - p), to: t - p } : null;
  return { pending, rest };
}

export const MENTOR_SEARCH_TERM_MAX_LENGTH = 80;
/** users 조회로 뽑는 후보 id 상한 — `user_id.in.(...)` 절이 무한히 길어지지 않게. */
export const MENTOR_SEARCH_USER_ID_LIMIT = 100;

/**
 * 검색어 정규화 — PostgREST `ilike` 패턴·`or()` 구분자로 해석될 문자(`% _ , ( )`)를 공백으로 바꾸고 상한을 건다.
 * 비어 있으면 "".
 */
export function normalizeMentorSearchTerm(raw: string | null | undefined): string {
  const s = typeof raw === "string" ? raw : "";
  return s.replace(/[%_,()]/g, " ").replace(/\s+/g, " ").trim().slice(0, MENTOR_SEARCH_TERM_MAX_LENGTH);
}

/** users 테이블에서 이름·닉네임·이메일 부분일치 — PostgREST `.or()` 인자. */
export function buildMentorUserSearchOr(term: string): string {
  return [`full_name.ilike.%${term}%`, `nickname.ilike.%${term}%`, `email.ilike.%${term}%`].join(",");
}

/**
 * mentor_profiles 에서 대학·학과 부분일치 + (users 검색으로 얻은) user_id 집합 — PostgREST `.or()` 인자.
 * 이름·이메일은 mentor_profiles 에 없으므로 users 조회 결과 id 로 잇는다(분석 §3-3 삽입 지점).
 */
export function buildMentorProfileSearchOr(term: string, userIds: readonly string[]): string {
  const parts = [`university_name.ilike.%${term}%`, `department_name.ilike.%${term}%`];
  const ids = userIds.filter((id) => /^[0-9a-fA-F-]{36}$/.test(id)).slice(0, MENTOR_SEARCH_USER_ID_LIMIT);
  if (ids.length) parts.push(`user_id.in.(${ids.join(",")})`);
  return parts.join(",");
}

/** 목록 하단 진행 표시 `N / 전체` 의 구간 — 표시용 1-based. */
export function queueProgressRange(page: number, pageSize: number, rowsOnPage: number, totalCount: number): { first: number; last: number } {
  if (totalCount <= 0 || rowsOnPage <= 0) return { first: 0, last: 0 };
  const first = (Math.max(1, page) - 1) * Math.max(1, pageSize) + 1;
  return { first, last: first + rowsOnPage - 1 };
}

/**
 * 이 화면의 목록 링크 빌더 — 공용 `buildAdminListUrl` 위에 한 가지를 보탠다:
 * 공용 빌더는 `status=all` 을 "필터 없음" 으로 보고 쿼리에서 지운다. 그런데 이 화면의 기본 탭은 **대기**라서
 * 전체 탭의 링크가 status 를 잃으면 재파싱 시 대기 탭으로 튄다(구 화면의 전체 탭·행 클릭이 그렇게 깨졌다).
 * 그래서 결과 탭이 all 이면 `status=all` 을 명시적으로 되살린다. 나머지(q·page·extra 보존·page 리셋)는 공용 규칙 그대로.
 */
export function buildMentorApprovalListUrl(params: AdminListParams, overrides: Partial<AdminListParams> = {}): string {
  const url = buildAdminListUrl(MENTOR_APPROVAL_BASE_PATH, params, overrides);
  const status = overrides.status !== undefined ? overrides.status : params.status;
  if (resolveMentorApprovalTab(status) !== "all" || status !== "all") return url;
  const [path, qs = ""] = url.split("?");
  const usp = new URLSearchParams(qs);
  usp.set("status", "all");
  return `${path}?${usp.toString()}`;
}
