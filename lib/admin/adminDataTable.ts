/**
 * 관리자 목록 공용 부품 `AdminDataTable` 의 순수 규칙(PR-4).
 *
 * 멘토 승인 목록(PR-2 `mentorApprovalQueue.ts`)과 환불 목록(PR-3 `refundConsole.ts`)이 **글자 그대로 같게** 갖고 있던
 * 규칙만 여기로 모았다. 두 화면 모듈은 자기 이름(`buildMentorApprovalListUrl` · `buildRefundListUrl` 등)을 유지한 채
 * 이 모듈에 위임한다 — 계약 테스트·조회 모듈이 그 이름으로 import 하기 때문이다.
 *
 * - 목록 링크: 공용 `buildAdminListUrl` 은 `status=all` 을 "필터 없음" 으로 보고 지운다. 기본 탭이 대기인 화면에서는
 *   전체 탭 링크가 status 를 잃으면 재파싱 시 대기 탭으로 튀므로, 결과 탭이 all 이면 `status=all` 을 되살린다.
 * - 대기 건이 항상 위: 전체 탭은 대기 부분과 나머지 부분을 서버에서 두 range 로 이어 붙인다. 그 range 산술이
 *   `splitPendingFirstRange` 다(정본 — PR-2 에서 옮겨 왔고, 각 부분 안의 정렬은 화면 조회 모듈이 정한다).
 * - 하단 진행 표시 `첫–끝 / 전체` 구간 산술.
 * - 서버 검색어 정규화(PostgREST `ilike` 패턴·`or()` 구분자 제거 + 상한)와 users 이름·닉네임·이메일 `or()` 인자.
 *
 * node --test 계약 테스트가 직접 import 하므로 React·`@/` import 를 두지 않는다.
 */
import { buildAdminListUrl, type AdminListParams } from "./adminListParams.ts";

/** 상태 탭 정의 — 건수는 화면이 `Record<value, number>` 로 따로 넘긴다. */
export type AdminDataTableTab<V extends string = string> = { value: V; label: string };

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

/** 목록 하단 진행 표시 `첫–끝 / 전체` 의 구간 — 표시용 1-based. 행이 없으면 0–0. */
export function adminListProgressRange(page: number, pageSize: number, rowsOnPage: number, totalCount: number): { first: number; last: number } {
  if (totalCount <= 0 || rowsOnPage <= 0) return { first: 0, last: 0 };
  const first = (Math.max(1, page) - 1) * Math.max(1, pageSize) + 1;
  return { first, last: first + rowsOnPage - 1 };
}

/**
 * 목록 링크 빌더 — 공용 `buildAdminListUrl` 위에 한 가지를 보탠다: 결과 탭이 all 이면 `status=all` 을 명시적으로 되살린다.
 * 나머지(q·page·extra 보존 · 필터 변경 시 page 리셋)는 공용 규칙 그대로다.
 */
export function buildAdminDataTableUrl(basePath: string, params: AdminListParams, overrides: Partial<AdminListParams> = {}): string {
  const url = buildAdminListUrl(basePath, params, overrides);
  const status = overrides.status !== undefined ? overrides.status : params.status;
  if (status !== "all") return url;
  const [path, qs = ""] = url.split("?");
  const usp = new URLSearchParams(qs);
  usp.set("status", "all");
  return `${path}?${usp.toString()}`;
}

export const ADMIN_LIST_SEARCH_TERM_MAX_LENGTH = 80;
/** users 조회로 뽑는 후보 id 상한 — `user_id.in.(...)` 절이 무한히 길어지지 않게. */
export const ADMIN_LIST_SEARCH_USER_ID_LIMIT = 100;

/**
 * 검색어 정규화 — PostgREST `ilike` 패턴·`or()` 구분자로 해석될 문자(`% _ , ( )`)를 공백으로 바꾸고 상한을 건다.
 * 비어 있으면 "".
 */
export function normalizeAdminListSearchTerm(raw: string | null | undefined): string {
  const s = typeof raw === "string" ? raw : "";
  return s.replace(/[%_,()]/g, " ").replace(/\s+/g, " ").trim().slice(0, ADMIN_LIST_SEARCH_TERM_MAX_LENGTH);
}

/** users 테이블에서 이름·닉네임·이메일 부분일치 — PostgREST `.or()` 인자. */
export function buildAdminUsersSearchOr(term: string): string {
  return [`full_name.ilike.%${term}%`, `nickname.ilike.%${term}%`, `email.ilike.%${term}%`].join(",");
}
