/**
 * 관리자 목록 화면 공용 검색·필터·페이지네이션 유틸.
 *
 * - 서버 컴포넌트의 `searchParams` 를 받아 안전하게 `{ search, status, page, pageSize, extra }` 로 파싱.
 * - URL 빌더로 탭/페이지 이동 링크 생성.
 * - 페이지·페이지 사이즈는 클램프(<=0/NaN/지나친 값 방지).
 *
 * `extra` (PR-1 공통 계약 층):
 *   툴바·페이지네이션이 만드는 모든 링크는 현재 URL 의 "다른 파라미터"(refunds `type`/`sort`,
 *   community-content `type` 등)를 그대로 실어 나른다. 예약 키(q/search/status/page/pageSize)와
 *   1회성 플래시 키(ok/error/…)는 제외한다 — 플래시가 탭 이동에 따라 붙어 다니면 안 되기 때문.
 *
 * 동작 변경 X(기존 필드) — 페이지 데이터 로더가 `params.search/status` 가 비어 있으면 기존과 동일하게 전체 조회.
 */

export type AdminListParams = {
  search: string;        // 빈 문자열이면 검색 없음
  status: string;        // 빈 문자열 또는 'all' 이면 필터 없음
  page: number;          // 1-based
  pageSize: number;      // 보통 25~100
  /** 예약·플래시 키를 제외한 나머지 쿼리 파라미터(첫 값·trim). 링크 생성 시 그대로 보존된다. */
  extra: Record<string, string>;
};

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

/** parse 가 전용 필드로 흡수하는 키 — `extra` 에 들어가지 않는다. */
export const ADMIN_LIST_RESERVED_KEYS: readonly string[] = ["q", "search", "status", "page", "pageSize"];

/**
 * 1회성 플래시·결과 통지 키 — 서버 액션 `redirect("…?ok=|error=")` 가 붙이는 값.
 * 탭/검색/페이지 링크에 따라다니면 안 되므로 `extra` 에서 제외한다.
 * (실사용 키: `app/(admin)/**` 의 `sp.ok`·`sp.error`·`sp.capOk`·`sp.capError`)
 */
export const ADMIN_LIST_TRANSIENT_KEYS: readonly string[] = ["ok", "error", "capOk", "capError"];

/** extra 파라미터 상한 — 임의 쿼리 문자열이 hidden input 수백 개로 번지는 것을 막는다. */
export const MAX_EXTRA_PARAM_KEYS = 16;
export const MAX_EXTRA_PARAM_VALUE_LENGTH = 256;
const EXTRA_KEY_PATTERN = /^[A-Za-z0-9_.-]{1,40}$/;

function pickStr(value: string | string[] | undefined): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value) && value[0]) return String(value[0]).trim();
  return "";
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function isReservedOrTransientKey(key: string): boolean {
  return ADMIN_LIST_RESERVED_KEYS.includes(key) || ADMIN_LIST_TRANSIENT_KEYS.includes(key);
}

/**
 * searchParams 에서 보존 대상 extra 파라미터만 골라낸다.
 * 예약·플래시 키 제외 · 빈 값 제외 · 키 형식/개수/길이 상한.
 */
export function pickAdminListExtraParams(
  sp: Record<string, string | string[] | undefined>
): Record<string, string> {
  const extra: Record<string, string> = {};
  let count = 0;
  for (const key of Object.keys(sp)) {
    if (isReservedOrTransientKey(key)) continue;
    if (!EXTRA_KEY_PATTERN.test(key)) continue;
    const value = pickStr(sp[key]);
    if (!value) continue;
    if (count >= MAX_EXTRA_PARAM_KEYS) break;
    extra[key] = value.length > MAX_EXTRA_PARAM_VALUE_LENGTH ? value.slice(0, MAX_EXTRA_PARAM_VALUE_LENGTH) : value;
    count += 1;
  }
  return extra;
}

export function parseAdminListParams(
  sp: Record<string, string | string[] | undefined>,
  opts?: { defaultPageSize?: number; maxPageSize?: number; defaultStatus?: string }
): AdminListParams {
  const defaultPageSize = opts?.defaultPageSize ?? DEFAULT_PAGE_SIZE;
  const maxPageSize = opts?.maxPageSize ?? MAX_PAGE_SIZE;
  const defaultStatus = opts?.defaultStatus ?? "";

  const search = pickStr(sp.q || sp.search);
  const status = pickStr(sp.status) || defaultStatus;
  const page = clamp(Number.parseInt(pickStr(sp.page) || "1", 10), 1, 100000);
  const pageSize = clamp(
    Number.parseInt(pickStr(sp.pageSize) || String(defaultPageSize), 10),
    1,
    maxPageSize
  );
  const extra = pickAdminListExtraParams(sp);

  return { search, status, page, pageSize, extra };
}

/** range(from, to) 계산: PostgREST 0-based inclusive */
export function rangeForPage(params: AdminListParams): { from: number; to: number } {
  const from = (params.page - 1) * params.pageSize;
  const to = from + params.pageSize - 1;
  return { from, to };
}

/** "all" / 빈 문자열을 '필터 없음' 으로 처리 */
export function isStatusActive(status: string): boolean {
  return Boolean(status) && status !== "all";
}

/**
 * `basePath` 에 이미 쿼리가 붙어 있으면(예: `/admin/community-content?type=shortforms`) 경로와 쿼리를 분리한다.
 * - `path`: 링크·GET form action 에 쓸 순수 경로
 * - `baked`: basePath 에 박혀 있던 파라미터(예약·플래시 키 제외) — extra 보다 우선순위가 낮다
 *
 * 과거에는 `${basePath}?${qs}` 로 이어 붙여 `?type=shortforms?status=hidden` 같은 URL 이 만들어졌고,
 * GET form 은 action 의 쿼리를 통째로 버려 `type` 이 소실됐다. 이 분리로 두 경우를 모두 막는다.
 */
export function splitAdminListBasePath(basePath: string): { path: string; baked: Record<string, string> } {
  const idx = basePath.indexOf("?");
  if (idx < 0) return { path: basePath, baked: {} };
  const path = basePath.slice(0, idx);
  const baked: Record<string, string> = {};
  const usp = new URLSearchParams(basePath.slice(idx + 1));
  for (const [key, raw] of usp.entries()) {
    if (isReservedOrTransientKey(key)) continue;
    if (!EXTRA_KEY_PATTERN.test(key)) continue;
    const value = raw.trim();
    if (!value) continue;
    if (!(key in baked)) baked[key] = value;
  }
  return { path, baked };
}

/**
 * 링크·hidden input 에 실을 extra 파라미터의 최종 집합.
 * basePath 에 박힌 값 < params.extra < overrides.extra 순으로 덮어쓴다. 빈 문자열은 '제거' 로 해석.
 */
export function resolveAdminListExtraParams(
  basePath: string,
  params: Pick<AdminListParams, "extra">,
  overrideExtra?: Record<string, string>
): Record<string, string> {
  const { baked } = splitAdminListBasePath(basePath);
  const merged: Record<string, string> = { ...baked, ...(params.extra ?? {}), ...(overrideExtra ?? {}) };
  const out: Record<string, string> = {};
  for (const key of Object.keys(merged)) {
    if (isReservedOrTransientKey(key)) continue;
    const value = merged[key];
    if (typeof value !== "string" || !value.trim()) continue;
    out[key] = value.trim();
  }
  return out;
}

/**
 * 현재 params 위에 override 한 URL 을 만든다. 빈 값은 쿼리에서 제거.
 * 페이지 외 다른 키를 바꾸면 page 는 1 로 리셋(필터/검색 변경 시 의도된 동작).
 * `extra` 파라미터(type·sort 등)는 항상 보존된다 — 탭 전환·검색·초기화·페이지 이동 어디서도 소실되지 않는다.
 */
export function buildAdminListUrl(
  basePath: string,
  params: AdminListParams,
  overrides: Partial<AdminListParams> = {}
): string {
  const { path } = splitAdminListBasePath(basePath);
  const next = { ...params, ...overrides };
  if (
    overrides.search !== undefined ||
    overrides.status !== undefined ||
    overrides.pageSize !== undefined ||
    overrides.extra !== undefined
  ) {
    if (overrides.page === undefined) next.page = 1;
  }

  const usp = new URLSearchParams();
  const extra = resolveAdminListExtraParams(basePath, params, overrides.extra);
  for (const key of Object.keys(extra)) usp.set(key, extra[key]);
  if (next.search) usp.set("q", next.search);
  if (next.status && next.status !== "all") usp.set("status", next.status);
  if (next.page && next.page > 1) usp.set("page", String(next.page));
  if (next.pageSize && next.pageSize !== DEFAULT_PAGE_SIZE) usp.set("pageSize", String(next.pageSize));

  const qs = usp.toString();
  return qs ? `${path}?${qs}` : path;
}
