/**
 * 관리자 · 공지·이벤트 화면(PR-10 §1)의 순수 규칙 — 목록(유형 탭 · 제목 검색 · 활성/전체 건수 · 만료 표시) · 작성·수정 폼(노출 방식 팝업 · 미리보기) ·
 * 활성 토글의 확인 등급 · 프로모션 접힘 섹션.
 *
 * - 탭 키는 `type`(app_notices.type — 사전 4값 + 전체)이라 `status` 전용 공용 `AdminDataTable.Tabs` 를 쓰지 않고 화면이 직접 그린다(PR-7 방식 · prop 추가 0).
 *   `AdminDataTable.Counts` 도 대기 전용이라 `활성 N / 전체 M` 은 화면이 그린다. 페이지네이션은 공용 조각.
 * - `display_mode`(page·popup — 20260830140804)는 사전 `app_notices.display_mode`. 팝업 공지의 **활성화**만 `stateChange` 확인(전원에게 뜬다) · 나머지는 즉시.
 * - `target` 은 CHECK 가 없고 현행 행 전부 NULL. 구 코드는 자유 문자열 입력 한 곳뿐이고 읽는 곳이 없었다 → PR-10 부터 사전 `app_notices.target`
 *   3값(all·student·mentor)만 쓴다. NULL 은 `all` 로 읽는다.
 * - 팝업을 실제로 띄우는 것은 PR-10b(서비스 레이아웃 마운트) — 그 전까지 폼 상단에 `NOTICE_POPUP_PENDING_NOTICE` 를 보인다.
 * - 이미지 첨부는 없다(`image_url` 컬럼·버킷 보류 — DB).
 *
 * node --test 계약 테스트가 직접 import 하므로 React·`@/` import 를 두지 않는다.
 */
import type { AdminListParams } from "./adminListParams.ts";
import { buildAdminDataTableUrl, normalizeAdminListSearchTerm, type AdminDataTableTab } from "./adminDataTable.ts";
import { adminStatusAllowedValues, resolveAdminStatus } from "./adminStatusDictionary.ts";
import { formatKoDateTimeKst } from "../utils/kstTime.ts";

export const NOTICE_BASE_PATH = "/admin/notices";
export const NOTICE_DEFAULT_PAGE_SIZE = 25;
/** 유형 탭 키 — `extra` 파라미터 */
export const NOTICE_TYPE_PARAM = "type";
/** 수정 대상 — 목록 링크에 따라다니지 않는다(화면이 extra 에서 뺀다) */
export const NOTICE_EDIT_PARAM = "edit";

// ── 유형 탭 — 사전 `app_notices.type` 4값 + 전체 ───────────────────────────────

export const NOTICE_TYPE_VALUES = ["notice", "event", "maintenance", "update"] as const;
export type NoticeType = (typeof NOTICE_TYPE_VALUES)[number];
export const NOTICE_TYPE_TAB_VALUES = ["all", ...NOTICE_TYPE_VALUES] as const;
export type NoticeTypeTab = (typeof NOTICE_TYPE_TAB_VALUES)[number];
export const NOTICE_DEFAULT_TYPE_TAB: NoticeTypeTab = "all";

/** 탭 라벨은 상태 사전 라벨 그대로(공지 · 이벤트 · 점검 · 업데이트) */
export const NOTICE_TYPE_TABS: readonly AdminDataTableTab<NoticeTypeTab>[] = [
  { value: "all", label: "전체" },
  ...NOTICE_TYPE_VALUES.map((value) => ({ value, label: resolveAdminStatus("app_notices", "type", value).label })),
];

export function resolveNoticeTypeTab(raw: string | null | undefined): NoticeTypeTab {
  const v = String(raw ?? "").trim();
  return (NOTICE_TYPE_TAB_VALUES as readonly string[]).includes(v) ? (v as NoticeTypeTab) : NOTICE_DEFAULT_TYPE_TAB;
}

export function resolveNoticeType(raw: string | null | undefined): NoticeType | null {
  const v = String(raw ?? "").trim().toLowerCase();
  return (NOTICE_TYPE_VALUES as readonly string[]).includes(v) ? (v as NoticeType) : null;
}

export function noticeTypeLabel(type: string | null | undefined): string {
  return resolveAdminStatus("app_notices", "type", type).label;
}

// ── 대상 — 사전 `app_notices.target` 3값(NULL = all) ─────────────────────────────

export const NOTICE_TARGET_VALUES = ["all", "student", "mentor"] as const;
export type NoticeTarget = (typeof NOTICE_TARGET_VALUES)[number];
export const NOTICE_DEFAULT_TARGET: NoticeTarget = "all";

export const NOTICE_TARGET_OPTIONS: readonly { value: NoticeTarget; label: string }[] = NOTICE_TARGET_VALUES.map((value) => ({
  value,
  label: resolveAdminStatus("app_notices", "target", value).label,
}));

/** NULL·빈 값·모르는 값은 전체로 읽는다(현행 5행 전부 NULL). */
export function resolveNoticeTarget(raw: unknown): NoticeTarget {
  const v = String(raw ?? "").trim().toLowerCase();
  return (NOTICE_TARGET_VALUES as readonly string[]).includes(v) ? (v as NoticeTarget) : NOTICE_DEFAULT_TARGET;
}

export function noticeTargetLabel(target: NoticeTarget): string {
  return resolveAdminStatus("app_notices", "target", target).label;
}

// ── 노출 방식 — 사전 `app_notices.display_mode` 2값 ─────────────────────────────

export const NOTICE_DISPLAY_MODE_VALUES = ["page", "popup"] as const;
export type NoticeDisplayMode = (typeof NOTICE_DISPLAY_MODE_VALUES)[number];
export const NOTICE_DEFAULT_DISPLAY_MODE: NoticeDisplayMode = "page";

export function resolveNoticeDisplayMode(raw: unknown): NoticeDisplayMode {
  const v = String(raw ?? "").trim().toLowerCase();
  return v === "popup" ? "popup" : "page";
}

/** 목록 배지 문구 — 사전 라벨(`목록 노출` · `팝업 노출`)에서 짧게 */
export const NOTICE_DISPLAY_MODE_BADGE: Readonly<Record<NoticeDisplayMode, string>> = { page: "목록", popup: "팝업" };

/** 폼 라디오 문구 */
export const NOTICE_DISPLAY_MODE_OPTIONS: readonly { value: NoticeDisplayMode; label: string }[] = [
  { value: "page", label: "공지 목록에만" },
  { value: "popup", label: "팝업으로도" },
];
export const NOTICE_POPUP_HELP = "팝업은 접속 시 전체 사용자에게 모달로 표시됩니다.";
/** PR-10b(서비스 레이아웃 마운트) 머지 전까지 폼 상단에 보인다 — 관리자가 팝업을 골랐는데 안 뜬다고 오해하지 않게 */
export const NOTICE_POPUP_PENDING_NOTICE = "팝업 노출은 서비스 반영 후 적용됩니다.";
/** 팝업 공지 활성화 확인(stateChange) 문구 */
export const NOTICE_POPUP_ACTIVATE_SUMMARY = "이 공지가 팝업으로 전체 사용자에게 표시됩니다.";

/** 활성 토글의 확인 등급 — 팝업 공지의 활성화만 확인 다이얼로그, 나머지(목록 공지 · 비활성화)는 즉시. */
export function noticeToggleConfirmLevel(displayMode: NoticeDisplayMode, nextActive: boolean): "stateChange" | "immediate" {
  return displayMode === "popup" && nextActive ? "stateChange" : "immediate";
}

// ── 링크 ──────────────────────────────────────────────────────────────────────

export function buildNoticeListUrl(params: AdminListParams, overrides: Partial<AdminListParams> = {}): string {
  return buildAdminDataTableUrl(NOTICE_BASE_PATH, params, overrides);
}

export function buildNoticeTypeTabUrl(params: AdminListParams, tab: NoticeTypeTab): string {
  return buildNoticeListUrl(params, { extra: { ...params.extra, [NOTICE_TYPE_PARAM]: tab === "all" ? "" : tab } });
}

export function noticeEditUrl(id: string): string {
  return `${NOTICE_BASE_PATH}?${NOTICE_EDIT_PARAM}=${encodeURIComponent(String(id ?? "").trim())}#notice-editor`;
}

export function normalizeNoticeSearchTerm(raw: string | null | undefined): string {
  return normalizeAdminListSearchTerm(raw);
}

// ── 목록 행 ────────────────────────────────────────────────────────────────────

export type NoticeListItem = {
  id: string;
  title: string;
  body: string;
  type: NoticeType | null;
  /** 원시 type(사전 밖 값 표시용) */
  typeRaw: string;
  target: NoticeTarget;
  displayMode: NoticeDisplayMode;
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

type Row = Record<string, unknown>;

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
function strOrNull(v: unknown): string | null {
  const s = str(v);
  return s || null;
}

export function parseNoticeRow(row: Row | null | undefined): NoticeListItem | null {
  if (!row) return null;
  const id = str(row.id);
  if (!id) return null;
  const typeRaw = str(row.type) || "notice";
  return {
    id,
    title: str(row.title) || "제목 없음",
    body: typeof row.body === "string" ? row.body : "",
    type: resolveNoticeType(typeRaw),
    typeRaw,
    target: resolveNoticeTarget(row.target),
    displayMode: resolveNoticeDisplayMode(row.display_mode),
    isActive: row.is_active === true,
    startsAt: strOrNull(row.starts_at),
    endsAt: strOrNull(row.ends_at),
    createdAt: strOrNull(row.created_at),
    updatedAt: strOrNull(row.updated_at),
  };
}

export type PromotionListItem = {
  id: string;
  title: string;
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string | null;
};

export function parsePromotionRow(row: Row | null | undefined): PromotionListItem | null {
  if (!row) return null;
  const id = str(row.id);
  if (!id) return null;
  return {
    id,
    title: str(row.title) || "제목 없음",
    isActive: row.is_active === true,
    startsAt: strOrNull(row.starts_at),
    endsAt: strOrNull(row.ends_at),
    createdAt: strOrNull(row.created_at),
  };
}

// ── 노출 상태(활성 + 기간) ───────────────────────────────────────────────────────

export type NoticeExposureState = "active" | "expired" | "scheduled" | "inactive";

export const NOTICE_EXPOSURE_LABELS: Readonly<Record<NoticeExposureState, string>> = {
  active: "표시 중",
  expired: "만료됨",
  scheduled: "예정",
  inactive: "숨김",
};

/**
 * 활성 여부와 기간을 합친 노출 상태. 공개 RLS(`ends_at >= now()` · `starts_at <= now()`)와 같은 경계 —
 * 종료 시각을 지난 활성 공지는 `만료됨`, 시작 전이면 `예정`.
 */
export function noticeExposureState(item: { isActive: boolean; startsAt: string | null; endsAt: string | null }, nowIso: string): NoticeExposureState {
  if (!item.isActive) return "inactive";
  const now = Date.parse(nowIso);
  if (!Number.isFinite(now)) return "active";
  if (item.endsAt) {
    const end = Date.parse(item.endsAt);
    if (Number.isFinite(end) && end < now) return "expired";
  }
  if (item.startsAt) {
    const start = Date.parse(item.startsAt);
    if (Number.isFinite(start) && start > now) return "scheduled";
  }
  return "active";
}

/** `8. 30. 오후 9:00 ~ 8. 31. 오후 11:59` · 한쪽만 있으면 `~` 로, 둘 다 없으면 `기간 미설정` */
export function formatNoticePeriod(startsAt: string | null, endsAt: string | null): string {
  const s = startsAt ? formatKoDateTimeKst(startsAt) : "";
  const e = endsAt ? formatKoDateTimeKst(endsAt) : "";
  if (!s && !e) return "기간 미설정";
  if (!s) return `~ ${e}`;
  if (!e) return `${s} ~`;
  return `${s} ~ ${e}`;
}

// ── 폼 ────────────────────────────────────────────────────────────────────────

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
/** datetime-local(YYYY-MM-DDTHH:mm) — 폼의 KST 벽시계 값(저장은 `adminNoticesMutations` 가 +09:00 을 붙인다) */
export const NOTICE_DATETIME_LOCAL_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/** timestamptz ISO → KST 벽시계 datetime-local 값. 없거나 못 읽으면 "" */
export function toKstDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const s = new Date(d.getTime() + KST_OFFSET_MS);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${s.getUTCFullYear()}-${p(s.getUTCMonth() + 1)}-${p(s.getUTCDate())}T${p(s.getUTCHours())}:${p(s.getUTCMinutes())}`;
}

export const NOTICE_TITLE_MAX_LENGTH = 200;

export type NoticeFormValue = {
  title: string;
  body: string;
  type: NoticeType;
  target: NoticeTarget;
  displayMode: NoticeDisplayMode;
  /** datetime-local 또는 "" */
  start: string;
  end: string;
  active: boolean;
};

export type NoticeFormDefaults = Omit<NoticeFormValue, "active"> & { active: boolean };

export function noticeFormDefaults(item: NoticeListItem | null): NoticeFormDefaults {
  if (!item) {
    return { title: "", body: "", type: "notice", target: NOTICE_DEFAULT_TARGET, displayMode: NOTICE_DEFAULT_DISPLAY_MODE, start: "", end: "", active: true };
  }
  return {
    title: item.title,
    body: item.body,
    type: item.type ?? "notice",
    target: item.target,
    displayMode: item.displayMode,
    start: toKstDatetimeLocal(item.startsAt),
    end: toKstDatetimeLocal(item.endsAt),
    active: item.isActive,
  };
}

export type NoticeFormRaw = Record<string, string | null | undefined>;

export const NOTICE_FORM_ERRORS = {
  titleRequired: "제목을 입력해 주세요.",
  titleTooLong: `제목은 ${NOTICE_TITLE_MAX_LENGTH}자 이내로 입력해 주세요.`,
  typeInvalid: "유형 값이 올바르지 않습니다.",
  targetInvalid: "대상 값이 올바르지 않습니다.",
  displayModeInvalid: "노출 방식 값이 올바르지 않습니다.",
  datetimeInvalid: "노출 기간 형식이 올바르지 않습니다.",
  endBeforeStart: "노출 종료가 시작보다 빠릅니다.",
} as const;

/** 서버 액션이 FormData 를 검증할 때 쓰는 순수 규칙. 실패 사유는 운영자 문구 하나. */
export function validateNoticeFormInput(raw: NoticeFormRaw): { ok: true; value: NoticeFormValue } | { ok: false; error: string } {
  const title = String(raw.title ?? "").trim();
  if (!title) return { ok: false, error: NOTICE_FORM_ERRORS.titleRequired };
  if (title.length > NOTICE_TITLE_MAX_LENGTH) return { ok: false, error: NOTICE_FORM_ERRORS.titleTooLong };
  const type = resolveNoticeType(raw.type ?? "notice");
  if (!type) return { ok: false, error: NOTICE_FORM_ERRORS.typeInvalid };
  const targetRaw = String(raw.target ?? "all").trim().toLowerCase();
  if (!(NOTICE_TARGET_VALUES as readonly string[]).includes(targetRaw)) return { ok: false, error: NOTICE_FORM_ERRORS.targetInvalid };
  const modeRaw = String(raw.display_mode ?? "page").trim().toLowerCase();
  if (!(NOTICE_DISPLAY_MODE_VALUES as readonly string[]).includes(modeRaw)) return { ok: false, error: NOTICE_FORM_ERRORS.displayModeInvalid };
  const start = String(raw.start ?? "").trim();
  const end = String(raw.end ?? "").trim();
  if ((start && !NOTICE_DATETIME_LOCAL_RE.test(start)) || (end && !NOTICE_DATETIME_LOCAL_RE.test(end))) {
    return { ok: false, error: NOTICE_FORM_ERRORS.datetimeInvalid };
  }
  if (start && end && end < start) return { ok: false, error: NOTICE_FORM_ERRORS.endBeforeStart };
  return {
    ok: true,
    value: {
      title,
      body: String(raw.body ?? "").trim(),
      type,
      target: targetRaw as NoticeTarget,
      displayMode: modeRaw as NoticeDisplayMode,
      start,
      end,
      active: raw.active === "on" || raw.active === "true",
    },
  };
}

// ── 플래시 · 빈 상태 · 프로모션 ───────────────────────────────────────────────

export const NOTICE_FLASH_OK_MESSAGES: Readonly<Record<string, string>> = {
  created: "공지를 등록했습니다.",
  updated: "공지를 수정했습니다.",
  toggled: "변경을 저장했습니다.",
  /** 구 액션의 `ok=1` */
  "1": "변경을 저장했습니다.",
};

export function noticeFlashOkMessage(code: string | null | undefined): string | null {
  const k = String(code ?? "").trim();
  return k ? (NOTICE_FLASH_OK_MESSAGES[k] ?? null) : null;
}

export const NOTICE_EMPTY_STATE = {
  none: { title: "등록된 공지가 없습니다", description: "아래 폼에서 첫 공지를 등록할 수 있습니다." },
  filtered: { title: "조건에 맞는 공지가 없습니다", description: "검색어나 유형 탭을 바꿔 보세요." },
} as const;

export function noticeEmptyState(tab: NoticeTypeTab, search: string, totalAll: number): { title: string; description: string } {
  return tab !== "all" || search || totalAll > 0 ? NOTICE_EMPTY_STATE.filtered : NOTICE_EMPTY_STATE.none;
}

export const PROMOTION_SECTION_LABEL = "프로모션";
/** 실사용 0(액션 로그 0건) — 접힌 상태 유지, 삭제는 오너 결정 후(§1-4) */
export const PROMOTION_NO_USAGE_LABEL = "사용 이력 없음";
export const PROMOTION_EMPTY_LABEL = "등록된 프로모션이 없습니다.";

/** 사전 값 집합이 폼 옵션과 어긋나지 않는지 — 계약 테스트용 */
export function noticeDictionaryValues(): { type: string[]; target: string[]; displayMode: string[] } {
  return {
    type: adminStatusAllowedValues("app_notices", "type"),
    target: adminStatusAllowedValues("app_notices", "target"),
    displayMode: adminStatusAllowedValues("app_notices", "display_mode"),
  };
}
