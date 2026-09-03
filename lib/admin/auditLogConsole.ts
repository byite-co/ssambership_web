/**
 * 관리자 · 감사 로그 화면(PR-10 §2)의 순수 규칙 — `admin_action_logs` 만 보여준다(관리자 조치의 정본 감사 트레일).
 *
 * - 구 화면의 9소스 통합 뷰(신고·분쟁·환불·리뷰·주문 이벤트·공지·프로모션·멘토 프로필·검증 로그)는 각자 화면으로 이관됐으므로 폐기한다.
 * - 탭 없음. 필터 3개(실행자 · 액션 계열 · 기간) + 검색(대상) + `열람 기록 제외`(`question_body_viewed` — PR-8 이후 가장 많아진다) — 전부 URL `extra`.
 * - 액션명은 `adminActionTypeLabels` 사전(38계열)으로만 그린다 — 코드값 노출 금지. 실행자 `admin_id` NULL 은 `시스템`(웹훅·배치).
 * - 행의 `→` 는 대상으로: 사람은 계정 상세(PR-7) · 멘토 승인 대상은 계정 상세 멘토 탭(구 별칭 라우트는 리다이렉트가 받는다) · 각 화면 상세.
 * - **사용자 하드 삭제는 기록되지 않는다**(멘토 8명 소멸 사례) — 상시 안내 `AUDIT_LOG_HARD_DELETE_NOTICE`.
 *
 * node --test 계약 테스트가 직접 import 하므로 React·`@/` import 를 두지 않는다.
 */
import type { AdminListParams } from "./adminListParams.ts";
import { buildAdminDataTableUrl, normalizeAdminListSearchTerm, type AdminDataTableTab } from "./adminDataTable.ts";
import { ADMIN_ACTION_GROUPS, adminActionTypesForGroup, isAdminActionGroup, resolveAdminActionType, type AdminActionGroupKey, type AdminActionTypeResolution } from "./adminActionTypeLabels.ts";
import { QUESTION_BODY_VIEWED_ACTION } from "./questionDrilldownConsole.ts";
import { kstDayString } from "../utils/kstTime.ts";

export const AUDIT_LOG_BASE_PATH = "/admin/audit-logs";
export const AUDIT_LOG_DEFAULT_PAGE_SIZE = 50;

export const AUDIT_LOG_HARD_DELETE_NOTICE = "사용자를 완전히 삭제한 경우는 이 로그에 남지 않습니다.";

// ── 필터(URL extra) ───────────────────────────────────────────────────────────

export const AUDIT_LOG_ACTOR_PARAM = "actor";
export const AUDIT_LOG_ACTION_PARAM = "action";
export const AUDIT_LOG_PERIOD_PARAM = "period";
export const AUDIT_LOG_HIDE_VIEWS_PARAM = "hideViews";
/** 실행자 필터의 시스템(웹훅·배치 — `admin_id` NULL) 값 */
export const AUDIT_LOG_SYSTEM_ACTOR = "system";
export const AUDIT_LOG_SYSTEM_ACTOR_LABEL = "시스템";

export const AUDIT_LOG_PERIOD_VALUES = ["all", "today", "7d", "30d"] as const;
export type AuditLogPeriod = (typeof AUDIT_LOG_PERIOD_VALUES)[number];
export const AUDIT_LOG_PERIODS: readonly AdminDataTableTab<AuditLogPeriod>[] = [
  { value: "all", label: "전체 기간" },
  { value: "today", label: "오늘" },
  { value: "7d", label: "최근 7일" },
  { value: "30d", label: "최근 30일" },
];

/** 액션 필터 옵션 — 전체 + 사전 계열 */
export const AUDIT_LOG_ACTION_OPTIONS: readonly { value: "" | AdminActionGroupKey; label: string }[] = [
  { value: "", label: "전체 액션" },
  ...ADMIN_ACTION_GROUPS.map((g) => ({ value: g.key, label: g.label })),
];

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function isUuidLikeId(value: string | null | undefined): boolean {
  return UUID_PATTERN.test(String(value ?? "").trim());
}

export type AuditLogFilters = {
  /** 관리자 uuid · `system` · null(전체) */
  actor: string | null;
  group: AdminActionGroupKey | null;
  period: AuditLogPeriod;
  hideViews: boolean;
};

export function resolveAuditLogFilters(extra: Readonly<Record<string, string>>): AuditLogFilters {
  const actorRaw = String(extra[AUDIT_LOG_ACTOR_PARAM] ?? "").trim();
  const actor = actorRaw === AUDIT_LOG_SYSTEM_ACTOR ? AUDIT_LOG_SYSTEM_ACTOR : isUuidLikeId(actorRaw) ? actorRaw : null;
  const groupRaw = String(extra[AUDIT_LOG_ACTION_PARAM] ?? "").trim();
  const periodRaw = String(extra[AUDIT_LOG_PERIOD_PARAM] ?? "").trim();
  return {
    actor,
    group: isAdminActionGroup(groupRaw) ? groupRaw : null,
    period: (AUDIT_LOG_PERIOD_VALUES as readonly string[]).includes(periodRaw) ? (periodRaw as AuditLogPeriod) : "all",
    hideViews: String(extra[AUDIT_LOG_HIDE_VIEWS_PARAM] ?? "").trim() === "1",
  };
}

/** 링크·hidden input 에 실을 정규화된 extra — 기본값은 싣지 않는다. */
export function auditLogFilterExtra(filters: AuditLogFilters): Record<string, string> {
  const extra: Record<string, string> = {};
  if (filters.actor) extra[AUDIT_LOG_ACTOR_PARAM] = filters.actor;
  if (filters.group) extra[AUDIT_LOG_ACTION_PARAM] = filters.group;
  if (filters.period !== "all") extra[AUDIT_LOG_PERIOD_PARAM] = filters.period;
  if (filters.hideViews) extra[AUDIT_LOG_HIDE_VIEWS_PARAM] = "1";
  return extra;
}

export function auditLogFiltersActive(filters: AuditLogFilters, search: string): boolean {
  return Boolean(filters.actor || filters.group || filters.period !== "all" || filters.hideViews || search);
}

export function buildAuditLogUrl(params: AdminListParams, overrides: Partial<AdminListParams> = {}): string {
  return buildAdminDataTableUrl(AUDIT_LOG_BASE_PATH, params, overrides);
}

export function normalizeAuditLogSearchTerm(raw: string | null | undefined): string {
  return normalizeAdminListSearchTerm(raw);
}

/** 기간 필터의 시작 instant(ISO) — 오늘은 KST 자정, N일은 지금−N일. 전체는 null. */
export function auditLogPeriodStartIso(period: AuditLogPeriod, nowIso: string): string | null {
  const now = new Date(nowIso);
  if (Number.isNaN(now.getTime())) return null;
  switch (period) {
    case "today":
      return `${kstDayString(now)}T00:00:00+09:00`;
    case "7d":
      return new Date(now.getTime() - 7 * 86_400_000).toISOString();
    case "30d":
      return new Date(now.getTime() - 30 * 86_400_000).toISOString();
    default:
      return null;
  }
}

/** 서버 필터 — 계열은 사전 전개 목록으로 `in (...)`, 열람 제외는 `neq`. */
export function auditLogActionTypesFilter(filters: AuditLogFilters): { include: string[] | null; exclude: string | null } {
  return {
    include: filters.group ? adminActionTypesForGroup(filters.group) : null,
    exclude: filters.hideViews ? QUESTION_BODY_VIEWED_ACTION : null,
  };
}

/** 검색(대상): uuid 면 `target_id` 일치, 아니면 users 이름·닉네임·이메일 → id 목록 */
export function auditLogSearchScope(rawTerm: string): { kind: "none" } | { kind: "uuid"; id: string } | { kind: "users"; term: string } {
  const term = normalizeAuditLogSearchTerm(rawTerm);
  if (!term) return { kind: "none" };
  if (isUuidLikeId(term)) return { kind: "uuid", id: term.toLowerCase() };
  return { kind: "users", term };
}

// ── 행 ────────────────────────────────────────────────────────────────────────

export type AuditLogItem = {
  id: string;
  createdAt: string | null;
  actorId: string | null;
  /** 실행자 표시명(관리자 이름 · 시스템) */
  actorLabel: string;
  actionType: string;
  action: AdminActionTypeResolution;
  targetType: string | null;
  targetId: string | null;
  /** 대상 표시(사람은 이름, 아니면 유형 라벨 + 앞 8자) */
  targetLabel: string;
  targetHref: string | null;
  reason: string | null;
};

/** `target_type` 운영자 표기 — 코드값 노출 금지(모르면 `기타`). */
const TARGET_TYPE_LABELS: Readonly<Record<string, string>> = {
  user: "사용자",
  mentor_profile: "멘토",
  mentor_school_verification: "학교 인증",
  mentor_academic_record_change: "학적 변경 요청",
  mentor_activity_event: "멘토 활동 이벤트",
  dispute: "분쟁",
  content_report: "신고",
  community_post: "게시글",
  shortform_post: "숏폼",
  community_comment: "커뮤니티 댓글",
  board_comment: "게시판 댓글",
  review: "리뷰",
  refund: "환불",
  payout_run: "정산 실행",
  question_thread: "질문",
  individual_question: "개별 질문",
  question_room: "질문방",
  app_notice: "공지",
  promotion_campaign: "프로모션",
  cash_topup_package: "충전 패키지",
  cash_topup: "캐시 충전",
  school_tier_catalog: "학교 등급 목록",
  major_category_catalog: "전공 계열 목록",
  school_tier_mapping: "학교 등급 매핑",
};

export function auditLogTargetTypeLabel(targetType: string | null | undefined): string {
  const t = String(targetType ?? "").trim();
  if (!t) return "—";
  return TARGET_TYPE_LABELS[t] ?? "기타";
}

/** 사람(계정 상세로 가는) 대상 유형 — 이름을 users 에서 채운다 */
export const AUDIT_LOG_PERSON_TARGET_TYPES: readonly string[] = ["user", "mentor_profile"];

function accountPath(userId: string, tab?: "mentor"): string {
  const base = `/admin/users/${encodeURIComponent(userId)}`;
  return tab ? `${base}?tab=${tab}` : base;
}

/**
 * 행의 `→` 링크. 사람 → 계정 상세(멘토 대상은 멘토 탭 — 구 `/admin/mentor-approvals/[id]` 별칭은 리다이렉트가 받으므로 남은 행도 안전) ·
 * 학교 인증 → detail.mentorId 로 계정 상세 멘토 탭 · 각 화면 상세 · 모르면 null(`—`).
 */
export function auditLogTargetHref(targetType: string | null | undefined, targetId: string | null | undefined, detail: unknown): string | null {
  const t = String(targetType ?? "").trim();
  const id = String(targetId ?? "").trim();
  const d = detail && typeof detail === "object" && !Array.isArray(detail) ? (detail as Record<string, unknown>) : null;
  switch (t) {
    case "user":
      return id ? accountPath(id) : null;
    case "mentor_profile":
      return id ? accountPath(id, "mentor") : null;
    case "mentor_school_verification": {
      const mentorId = d && typeof d.mentorId === "string" ? d.mentorId.trim() : "";
      return mentorId ? accountPath(mentorId, "mentor") : null;
    }
    case "mentor_academic_record_change":
      return id ? `/admin/academic-record-changes?request=${encodeURIComponent(id)}` : null;
    case "dispute":
      return id ? `/admin/disputes/${encodeURIComponent(id)}` : null;
    case "content_report":
      return id ? `/admin/reports/${encodeURIComponent(id)}` : null;
    case "refund":
      return id ? `/admin/refunds/${encodeURIComponent(id)}` : null;
    case "review":
      return id ? `/admin/reviews/${encodeURIComponent(id)}` : null;
    case "question_thread":
      return id ? `/admin/question-threads/${encodeURIComponent(id)}` : null;
    case "individual_question":
      return id ? `/admin/individual-questions/${encodeURIComponent(id)}` : null;
    case "question_room":
      return id ? `/admin/question-rooms/${encodeURIComponent(id)}` : null;
    case "app_notice":
      return id ? `/admin/notices?edit=${encodeURIComponent(id)}#notice-editor` : "/admin/notices";
    case "promotion_campaign":
      return "/admin/notices";
    case "cash_topup_package":
      return "/admin/settings";
    case "cash_topup":
      return "/admin/topups";
    case "payout_run":
      return id ? `/admin/settlements?tab=history&run=${encodeURIComponent(id)}` : "/admin/settlements?tab=history";
    case "school_tier_catalog":
    case "major_category_catalog":
    case "school_tier_mapping":
      return "/admin/school-classifications";
    case "community_post":
    case "shortform_post":
    case "community_comment":
    case "board_comment":
      return "/admin/community-content";
    default:
      return null;
  }
}

/** detail 에서 사유로 볼 문자열 하나 — 액션마다 키가 다르다(reason · rejectionReason · adminNote · note). 없으면 null(`—`). */
export function auditLogReason(detail: unknown): string | null {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return null;
  const d = detail as Record<string, unknown>;
  for (const key of ["reason", "rejectionReason", "adminNote", "note"]) {
    const v = d[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

export function shortTargetId(id: string | null | undefined): string {
  const s = String(id ?? "").trim();
  if (!s) return "";
  return s.length > 8 ? `${s.slice(0, 8)}…` : s;
}

export type AuditLogRowInput = {
  id: string;
  createdAt: string | null;
  actorId: string | null;
  actionType: string;
  targetType: string | null;
  targetId: string | null;
  detail: unknown;
};

/** 행 조립 — 이름 표는 조회 모듈이 채운다(관리자 이름 · 대상 사람 이름). */
export function buildAuditLogItem(row: AuditLogRowInput, names: { admins: ReadonlyMap<string, string>; users: ReadonlyMap<string, string> }): AuditLogItem {
  const actorLabel = row.actorId ? (names.admins.get(row.actorId) ?? `관리자 ${shortTargetId(row.actorId)}`) : AUDIT_LOG_SYSTEM_ACTOR_LABEL;
  const typeLabel = auditLogTargetTypeLabel(row.targetType);
  const isPerson = row.targetType ? AUDIT_LOG_PERSON_TARGET_TYPES.includes(row.targetType) : false;
  const personName = isPerson && row.targetId ? names.users.get(row.targetId) ?? null : null;
  const targetLabel = personName
    ? `${typeLabel} · ${personName}`
    : row.targetId
      ? `${typeLabel} · ${shortTargetId(row.targetId)}`
      : row.targetType
        ? typeLabel
        : "—";
  return {
    id: row.id,
    createdAt: row.createdAt,
    actorId: row.actorId,
    actorLabel,
    actionType: row.actionType,
    action: resolveAdminActionType(row.actionType),
    targetType: row.targetType,
    targetId: row.targetId,
    targetLabel,
    targetHref: auditLogTargetHref(row.targetType, row.targetId, row.detail),
    reason: auditLogReason(row.detail),
  };
}

// ── 실행자 옵션 · 빈 상태 ─────────────────────────────────────────────────────

export type AuditLogActorOption = { value: string; label: string };

/** 관리자 N명 + 시스템 */
export function buildAuditLogActorOptions(admins: readonly { id: string; name: string }[]): AuditLogActorOption[] {
  return [
    { value: "", label: "전체 실행자" },
    ...admins.map((a) => ({ value: a.id, label: a.name })),
    { value: AUDIT_LOG_SYSTEM_ACTOR, label: `${AUDIT_LOG_SYSTEM_ACTOR_LABEL}(웹훅·배치)` },
  ];
}

export const AUDIT_LOG_EMPTY_STATE = {
  filtered: { title: "조건에 맞는 기록이 없습니다", description: "필터·검색어를 바꾸거나 열람 기록 제외를 해제해 보세요." },
  none: { title: "기록된 조치가 없습니다", description: "관리자 조치가 실행되면 이곳에 남습니다." },
} as const;

export function auditLogEmptyState(filters: AuditLogFilters, search: string): { title: string; description: string } {
  return auditLogFiltersActive(filters, search) ? AUDIT_LOG_EMPTY_STATE.filtered : AUDIT_LOG_EMPTY_STATE.none;
}
