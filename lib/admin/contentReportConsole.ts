/**
 * 관리자 · 콘텐츠 검수(신고) 화면(PR-5 §1)의 순수 규칙 — 목록·신고 상세·조치 확인 모달이 함께 쓴다.
 *
 * - 탭 값은 `content_reports.status` CHECK 7종(pending·reviewing·resolved·rejected·dismissed·hidden·removed) 중
 *   **코드가 실제로 쓰는 6종**만이다. `rejected` 는 어떤 액션도 쓰지 않아(adminReportActions·bulkActions·
 *   communityReportActions 실측) 탭에서 뺐다 — 전체 탭 건수에는 포함된다.
 * - 오래된 신고가 위(`created_at asc`). 미처리(pending·reviewing) 건의 경과 시간이 24시간을 넘으면 주의색, 48시간을 넘으면 위험색.
 * - 조치 등급: 검토 중·처리 완료·기각·숨김·복구 = stateChange(한 줄 확인) · 삭제 = destructive(대상 ID 재입력).
 *   삭제 모달에는 안전한 대안 `숨김으로 대신하기` 버튼을 함께 둔다.
 * - 삭제 방식은 `communityModerationCore.applyContentModeration` 그대로다(바꾸지 않는다):
 *   게시판 글(community_post)은 soft-delete(deleted_at) → 복구 가능 · 숏폼·댓글은 하드 DELETE → 복구 불가(8/30 실사).
 *   summary 는 그 사실을 대상 종류별로 명시한다.
 * - 서버 액션(`updateContentReportStatusAction` · `updateContentReportModerationAction`)이 읽는 필드명
 *   (`reportId` · `nextStatus` · `intent` · `note`)은 바꾸지 않는다. DB 쓰기 불변.
 *
 * node --test 계약 테스트가 직접 import 하므로 React·`@/` import 를 두지 않는다.
 */
import type { AdminListParams } from "./adminListParams.ts";
import { ADMIN_LIST_SEARCH_USER_ID_LIMIT, buildAdminDataTableUrl } from "./adminDataTable.ts";
import { contentReportRowIsActionable } from "./contentReportLabels.ts";

export const CONTENT_REPORT_BASE_PATH = "/admin/moderation";
export const CONTENT_REPORT_DETAIL_BASE_PATH = "/admin/reports";
export const CONTENT_REPORT_DEFAULT_PAGE_SIZE = 25;

// ── 탭 — 쿼리 키는 `status` 하나 ─────────────────────────────────────────────

export const CONTENT_REPORT_TAB_VALUES = ["pending", "reviewing", "resolved", "dismissed", "hidden", "removed", "all"] as const;
export type ContentReportTab = (typeof CONTENT_REPORT_TAB_VALUES)[number];
export const CONTENT_REPORT_DEFAULT_TAB: ContentReportTab = "pending";

/** 코드가 `content_reports.status` 에 실제로 쓰는 값(CHECK 7종 중 rejected 제외) */
export const CONTENT_REPORT_WRITTEN_STATUSES: readonly string[] = ["pending", "reviewing", "resolved", "dismissed", "hidden", "removed"];

export const CONTENT_REPORT_TABS: readonly { value: ContentReportTab; label: string }[] = [
  { value: "pending", label: "대기" },
  { value: "reviewing", label: "검토 중" },
  { value: "resolved", label: "해결" },
  { value: "dismissed", label: "기각" },
  { value: "hidden", label: "숨김" },
  { value: "removed", label: "삭제" },
  { value: "all", label: "전체" },
];

export function isContentReportTab(value: string): value is ContentReportTab {
  return (CONTENT_REPORT_TAB_VALUES as readonly string[]).includes(value);
}

/** `status` 파라미터 → 탭. 비어 있거나 모르는 값은 기본 탭(대기). */
export function resolveContentReportTab(status: string | null | undefined): ContentReportTab {
  const s = typeof status === "string" ? status.trim() : "";
  return isContentReportTab(s) ? s : CONTENT_REPORT_DEFAULT_TAB;
}

/** 탭이 필터하는 `content_reports.status` 값. `all` 은 null(필터 없음). */
export function contentReportTabStatus(tab: ContentReportTab): string | null {
  return tab === "all" ? null : tab;
}

/** 이 화면의 목록 링크 빌더 — 공용 정본 `buildAdminDataTableUrl`(PR-4) 에 경로를 묶은 것. 전체 탭은 `status=all` 을 잃지 않는다. */
export function buildContentReportListUrl(params: AdminListParams, overrides: Partial<AdminListParams> = {}): string {
  return buildAdminDataTableUrl(CONTENT_REPORT_BASE_PATH, params, overrides);
}

export function contentReportDetailPath(reportId: string): string {
  return `${CONTENT_REPORT_DETAIL_BASE_PATH}/${encodeURIComponent(reportId)}`;
}

// ── 검색 ─────────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * content_reports 검색 `.or()` 인자 — 사유·설명·운영 메모·대상 유형 부분일치 + (users 검색으로 얻은) 신고자 id 집합.
 * `id`·`target_id` 는 uuid 컬럼이라 `ilike` 를 걸 수 없다(PostgREST 가 캐스팅하지 않는다) — 검색어가 완전한 UUID 일 때만 `eq` 로 잇는다.
 */
export function buildContentReportSearchOr(term: string, reporterIds: readonly string[]): string {
  const parts = [`reason.ilike.%${term}%`, `description.ilike.%${term}%`, `admin_note.ilike.%${term}%`, `target_type.ilike.%${term}%`];
  if (UUID_RE.test(term)) parts.push(`id.eq.${term}`, `target_id.eq.${term}`);
  const ids = reporterIds.filter((id) => UUID_RE.test(id)).slice(0, ADMIN_LIST_SEARCH_USER_ID_LIMIT);
  if (ids.length) parts.push(`reporter_id.in.(${ids.join(",")})`);
  return parts.join(",");
}

// ── 대상 종류 ────────────────────────────────────────────────────────────────

/** `communityModerationCore.normalizeModerationTargetType` 의 결과 — 서버가 판정해 넘긴다. null = 지원되지 않는 유형(레거시 'comment' 포함). */
export type ContentReportTargetKind = "community_post" | "shortform_post" | "community_comment" | "board_comment" | null;

/** 목록·모달 표시용 대상 종류 라벨(원시 target_type 기준) */
export function contentReportTargetLabel(targetType: string | null | undefined): string {
  const t = String(targetType ?? "").trim().toLowerCase().replace(/-/g, "_");
  if (!t) return "—";
  if (t === "community_post" || t === "community" || t === "post") return "게시판 글";
  if (t === "shortform_post" || t === "shortform") return "숏폼";
  if (t === "community_comment" || t === "board_comment" || t === "board_comment_v2" || t === "comment") return "댓글";
  if (t === "mentor_review") return "멘토 리뷰";
  if (t === "user") return "사용자";
  return "기타";
}

/** 삭제 조치가 실제로 하는 일 — `applyContentModeration` 의 분기와 1:1 */
export type ContentReportDeleteEffect = "soft_delete" | "hard_delete" | "report_only";

export function contentReportDeleteEffect(kind: ContentReportTargetKind): ContentReportDeleteEffect {
  if (kind === "community_post") return "soft_delete";
  if (kind === "shortform_post" || kind === "community_comment" || kind === "board_comment") return "hard_delete";
  return "report_only";
}

function kindLabel(kind: ContentReportTargetKind): string {
  if (kind === "community_post") return "게시판 글";
  if (kind === "shortform_post") return "숏폼";
  if (kind === "community_comment" || kind === "board_comment") return "댓글";
  return "콘텐츠";
}

export const CONTENT_REPORT_UNSUPPORTED_TARGET_NOTE = "지원되지 않는 대상 유형이라 콘텐츠는 바뀌지 않습니다.";

/** 삭제 확인 summary — 대상 종류별 복구 가능 여부를 명시한다(게시판 글 복구 가능 · 숏폼·댓글 복구 불가). */
export function buildContentReportDeleteSummary(kind: ContentReportTargetKind): string {
  const effect = contentReportDeleteEffect(kind);
  if (effect === "soft_delete") return `이 ${kindLabel(kind)}을 삭제합니다. 게시판 글은 소프트 삭제라 관리자가 복구할 수 있습니다.`;
  if (effect === "hard_delete") return `이 ${kindLabel(kind)}을 영구 삭제합니다. 복구할 수 없습니다.`;
  return `${CONTENT_REPORT_UNSUPPORTED_TARGET_NOTE} 신고만 '삭제 처리' 상태가 됩니다.`;
}

export function buildContentReportHideSummary(kind: ContentReportTargetKind): string {
  if (contentReportDeleteEffect(kind) === "report_only") return `${CONTENT_REPORT_UNSUPPORTED_TARGET_NOTE} 신고만 '숨김 처리' 상태가 됩니다.`;
  return `이 ${kindLabel(kind)}을 숨깁니다. 복구할 수 있습니다.`;
}

export function buildContentReportRestoreSummary(kind: ContentReportTargetKind): string {
  if (contentReportDeleteEffect(kind) === "report_only") return `${CONTENT_REPORT_UNSUPPORTED_TARGET_NOTE} 신고만 '해결' 상태가 됩니다.`;
  return `이 ${kindLabel(kind)}을 정상 상태로 복구합니다. 신고는 '해결'로 바뀝니다.`;
}

export type ContentReportNextStatus = "reviewing" | "resolved" | "dismissed";

export function buildContentReportStatusSummary(next: ContentReportNextStatus): string {
  if (next === "reviewing") return "이 신고를 '검토 중'으로 표시합니다. 콘텐츠는 바뀌지 않습니다.";
  if (next === "resolved") return "이 신고를 '해결'로 종료합니다. 콘텐츠는 바뀌지 않습니다.";
  return "이 신고를 기각합니다. 콘텐츠는 바뀌지 않습니다.";
}

/** destructive 재입력 문자열 — 대상 ID 앞 8자(UUID 전체 타이핑은 주의 환기가 아니라 벌이다). 대상 ID 가 없으면 신고 ID 로. */
export const CONTENT_REPORT_CONFIRM_TEXT_LENGTH = 8;
export function contentReportDeleteConfirmText(targetId: string | null | undefined, reportId: string): string {
  const t = String(targetId ?? "").trim();
  const base = t || String(reportId ?? "").trim();
  return base.slice(0, CONTENT_REPORT_CONFIRM_TEXT_LENGTH);
}

// ── 조치 목록 — 서버 액션이 읽는 필드명·등급 ──────────────────────────────────

export const CONTENT_REPORT_REPORT_ID_FIELD = "reportId";
export const CONTENT_REPORT_STATUS_FIELD = "nextStatus";
export const CONTENT_REPORT_INTENT_FIELD = "intent";
export const CONTENT_REPORT_NOTE_FIELD = "note";

export type ContentReportActionKey = "reviewing" | "resolved" | "dismissed" | "hidden" | "restored" | "deleted";
export type ContentReportActionLevel = "stateChange" | "destructive";

export const CONTENT_REPORT_ACTIONS: Readonly<
  Record<ContentReportActionKey, { level: ContentReportActionLevel; label: string; dialogTitle: string; confirmLabel: string; pendingLabel: string }>
> = {
  reviewing: { level: "stateChange", label: "검토 중", dialogTitle: "검토 중으로 표시", confirmLabel: "검토 중으로", pendingLabel: "처리 중…" },
  resolved: { level: "stateChange", label: "처리 완료", dialogTitle: "신고 해결", confirmLabel: "해결로 종료", pendingLabel: "처리 중…" },
  dismissed: { level: "stateChange", label: "기각", dialogTitle: "신고 기각", confirmLabel: "기각", pendingLabel: "처리 중…" },
  hidden: { level: "stateChange", label: "콘텐츠 숨김", dialogTitle: "콘텐츠 숨김", confirmLabel: "숨김", pendingLabel: "숨기는 중…" },
  restored: { level: "stateChange", label: "콘텐츠 복구", dialogTitle: "콘텐츠 복구", confirmLabel: "복구", pendingLabel: "복구 중…" },
  deleted: { level: "destructive", label: "콘텐츠 삭제", dialogTitle: "콘텐츠 삭제 — 되돌릴 수 없는 작업", confirmLabel: "삭제", pendingLabel: "삭제 중…" },
};

/** 삭제 모달 안의 안전한 대안 버튼이 클릭할 트리거 버튼 id */
export const CONTENT_REPORT_ACTION_BUTTON_IDS: Readonly<Record<ContentReportActionKey, string>> = {
  reviewing: "content-report-action-reviewing",
  resolved: "content-report-action-resolved",
  dismissed: "content-report-action-dismissed",
  hidden: "content-report-action-hidden",
  restored: "content-report-action-restored",
  deleted: "content-report-action-deleted",
};

export const CONTENT_REPORT_HIDE_INSTEAD_LABEL = "숨김으로 대신하기";

// ── 경과 시간 ────────────────────────────────────────────────────────────────

export const CONTENT_REPORT_ELAPSED_WARNING_HOURS = 24;
export const CONTENT_REPORT_ELAPSED_DANGER_HOURS = 48;

export type ContentReportElapsedTone = "ok" | "warning" | "danger" | "none";
export type ContentReportElapsed = {
  /** 접수 후 경과 시간(정수, 시간). 처리된 건·시각 미상은 null */
  hours: number | null;
  label: string;
  tone: ContentReportElapsedTone;
};

/** 미처리(pending·reviewing) 건만 경과를 센다 — 처리된 건은 '—'. 24시간 초과 주의 · 48시간 초과 위험. */
export function contentReportElapsed(createdAt: string | null | undefined, status: string | null | undefined, now: number = Date.now()): ContentReportElapsed {
  if (!contentReportRowIsActionable(String(status ?? ""))) return { hours: null, label: "—", tone: "none" };
  const t = createdAt ? new Date(createdAt).getTime() : NaN;
  if (!Number.isFinite(t)) return { hours: null, label: "—", tone: "none" };
  const elapsedMs = Math.max(0, now - t);
  const hours = Math.floor(elapsedMs / 3_600_000);
  // 색 판정은 내림한 시간이 아니라 실제 경과로 — "24시간을 넘으면" 은 24시간 정각을 1분이라도 지나면이다.
  const tone: ContentReportElapsedTone =
    elapsedMs > CONTENT_REPORT_ELAPSED_DANGER_HOURS * 3_600_000 ? "danger" : elapsedMs > CONTENT_REPORT_ELAPSED_WARNING_HOURS * 3_600_000 ? "warning" : "ok";
  let label: string;
  if (hours < 1) label = "1시간 미만";
  else if (hours < 24) label = `${hours}시간`;
  else {
    const days = Math.floor(hours / 24);
    const rest = hours % 24;
    label = rest ? `${days}일 ${rest}시간` : `${days}일`;
  }
  return { hours, label, tone };
}

export function contentReportElapsedToneClass(tone: ContentReportElapsedTone): string {
  switch (tone) {
    case "danger":
      return "border-red-200 bg-red-50 text-red-700";
    case "warning":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "ok":
      return "border-slate-200 bg-slate-50 text-slate-600";
    default:
      return "border-transparent text-slate-400";
  }
}

// ── 빈 상태(지시서 §1-3 원문) ────────────────────────────────────────────────

export const CONTENT_REPORT_EMPTY_STATE = {
  title: "아직 접수된 신고가 없습니다",
  description: "학생 모집이 시작되면 이 화면으로 신고가 쌓입니다. 지금은 비어 있는 것이 정상입니다.",
  stepsTitle: "신고가 들어오면 이렇게 처리합니다",
  steps: [
    "대상 콘텐츠와 신고 사유를 확인합니다",
    "숨김(복구 가능) · 경고 · 정지 · 삭제(복구 불가) 중 하나를 고릅니다",
    "처리 결과가 신고자에게 전달됩니다",
  ],
} as const;

export type ContentReportEmptyVariant = "first" | "tab" | "search";

/** 검색 중이면 search · 신고가 한 건도 없으면 first · 그 외(이 탭만 비었음) tab */
export function contentReportEmptyVariant(search: string, allCount: number): ContentReportEmptyVariant {
  if (search.trim()) return "search";
  if (allCount <= 0) return "first";
  return "tab";
}

// ── 플래시 ───────────────────────────────────────────────────────────────────

/** 서버 액션 `?ok=` 값 → 안내 문장. 모르는 값은 null(표시 안 함). */
export function contentReportFlashOkMessage(ok: string | null | undefined): string | null {
  switch (String(ok ?? "").trim()) {
    case "reviewing":
      return "신고를 '검토 중'으로 표시했습니다.";
    case "resolved":
      return "신고를 해결로 종료했습니다.";
    case "dismissed":
      return "신고를 기각했습니다.";
    case "hidden":
      return "콘텐츠를 숨김 처리했습니다.";
    case "deleted":
      return "삭제 처리했습니다.";
    case "restored":
      return "정상 복구했습니다.";
    default:
      return null;
  }
}
