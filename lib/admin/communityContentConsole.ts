/**
 * 관리자 · 커뮤니티 관리 화면(PR-11 §1)의 순수 규칙 — 목록(종류 탭 · 상태 탭 · 검색 · 신고 건수) · 조치 확인 모달(종류별 삭제 방식) · 빈 상태 · 플래시.
 *
 * - 종류 탭 키는 `type`(extra 파라미터 — 글 `posts` · 숏폼 `shortforms` · 댓글 `comments`, 구 URL 값 그대로)이라 `status` 전용 공용
 *   `AdminDataTable.Tabs` 를 쓰지 않고 화면이 직접 그린다(PR-7 방식 · prop 추가 0). 상태 탭(`status`)은 공용 `AdminDataTable.Tabs`.
 * - 상태 사전: `community_posts.status`(draft·published·hidden) · `shortform_posts.status`(같음) · `community_comments.status`(visible·hidden).
 *   **`deleted` 는 CHECK 가 막는다** — 삭제됨은 `deleted_at IS NOT NULL`(게시판 글만 있는 컬럼)로 판정한다. 숏폼·댓글은 하드 DELETE 라 삭제됨 탭이 항상 0.
 * - 댓글 탭은 `community_comments` 하나다 — 게시판 댓글 정본(`comments`)과 브리지(SQL 163·164)로 양방향 동기(status ↔ is_deleted)라 게시판·숏폼 댓글을 모두 담는다.
 * - 조치 등급: 숨김·복원 = stateChange(`복구할 수 있습니다`) · 삭제 = destructive(대상 ID 앞 8자 재입력) + `숨김으로 대신하기`(PR-5 와 같은 부품).
 *   삭제 방식은 `communityModerationCore.applyContentModeration` 그대로다(바꾸지 않는다): 게시판 글 soft-delete(deleted_at) → 복구 가능 ·
 *   숏폼·댓글 하드 DELETE → 복구 불가. summary 첫 줄이 그 사실을 종류별로 말한다.
 * - 서버 액션(`communityModerationActions`)이 읽는 필드명(`targetId` · `reason`)은 바꾸지 않는다. `returnTo` 는 이 화면으로 돌아오기 위한 선택 필드.
 *
 * node --test 계약 테스트가 직접 import 하므로 React·`@/` import 를 두지 않는다.
 */
import type { AdminListParams } from "./adminListParams.ts";
import { ADMIN_LIST_SEARCH_USER_ID_LIMIT, buildAdminDataTableUrl, type AdminDataTableTab } from "./adminDataTable.ts";
import { resolveAdminStatus } from "./adminStatusDictionary.ts";
import { CONTENT_REPORT_BASE_PATH, CONTENT_REPORT_HIDE_INSTEAD_LABEL } from "./contentReportConsole.ts";

export const COMMUNITY_CONTENT_BASE_PATH = "/admin/community-content";
export const COMMUNITY_CONTENT_DEFAULT_PAGE_SIZE = 25;
/** 종류 탭 키 — `extra` 파라미터 */
export const COMMUNITY_CONTENT_TYPE_PARAM = "type";

// ── 종류 탭 ────────────────────────────────────────────────────────────────────

export const COMMUNITY_CONTENT_TYPE_VALUES = ["posts", "shortforms", "comments"] as const;
export type CommunityContentType = (typeof COMMUNITY_CONTENT_TYPE_VALUES)[number];
export const COMMUNITY_CONTENT_DEFAULT_TYPE: CommunityContentType = "posts";

export const COMMUNITY_CONTENT_TYPE_TABS: readonly AdminDataTableTab<CommunityContentType>[] = [
  { value: "posts", label: "글" },
  { value: "shortforms", label: "숏폼" },
  { value: "comments", label: "댓글" },
];

/** 구 URL `type=board-comments`(게시판 댓글 탭)는 댓글 탭으로 — 브리지로 `community_comments` 가 게시판 댓글도 담는다. */
export function resolveCommunityContentType(raw: string | null | undefined): CommunityContentType {
  const v = String(raw ?? "").trim();
  if (v === "board-comments") return "comments";
  return (COMMUNITY_CONTENT_TYPE_VALUES as readonly string[]).includes(v) ? (v as CommunityContentType) : COMMUNITY_CONTENT_DEFAULT_TYPE;
}

export type CommunityContentTable = "community_posts" | "shortform_posts" | "community_comments";
export const COMMUNITY_CONTENT_TABLES: Readonly<Record<CommunityContentType, CommunityContentTable>> = {
  posts: "community_posts",
  shortforms: "shortform_posts",
  comments: "community_comments",
};

/** 서버 액션(`communityModerationCore.ModerationTargetType`)의 대상 종류 */
export type CommunityContentTargetType = "community_post" | "shortform_post" | "community_comment";
export const COMMUNITY_CONTENT_TARGET_TYPES: Readonly<Record<CommunityContentType, CommunityContentTargetType>> = {
  posts: "community_post",
  shortforms: "shortform_post",
  comments: "community_comment",
};

export const COMMUNITY_CONTENT_KIND_LABELS: Readonly<Record<CommunityContentType, string>> = {
  posts: "게시판 글",
  shortforms: "숏폼",
  comments: "댓글",
};

// ── 상태 탭 — 쿼리 키는 `status` 하나 ─────────────────────────────────────────

export const COMMUNITY_CONTENT_TAB_VALUES = ["published", "hidden", "deleted", "all"] as const;
export type CommunityContentTab = (typeof COMMUNITY_CONTENT_TAB_VALUES)[number];
export const COMMUNITY_CONTENT_DEFAULT_TAB: CommunityContentTab = "all";

export const COMMUNITY_CONTENT_TABS: readonly AdminDataTableTab<CommunityContentTab>[] = [
  { value: "published", label: "게시" },
  { value: "hidden", label: "숨김" },
  { value: "deleted", label: "삭제됨" },
  { value: "all", label: "전체" },
];

export function resolveCommunityContentTab(raw: string | null | undefined): CommunityContentTab {
  const v = String(raw ?? "").trim();
  return (COMMUNITY_CONTENT_TAB_VALUES as readonly string[]).includes(v) ? (v as CommunityContentTab) : COMMUNITY_CONTENT_DEFAULT_TAB;
}

// ── 유효 상태 — deleted_at 이 status 보다 우선 ──────────────────────────────────

export const COMMUNITY_CONTENT_STATUS_VALUES = ["published", "hidden", "deleted", "draft"] as const;
export type CommunityContentStatus = (typeof COMMUNITY_CONTENT_STATUS_VALUES)[number];

/** 종류별 status 컬럼의 "게시" 값 — 글·숏폼 `published` · 댓글 `visible`(사전 `community_comments.status`) */
export function communityContentPublishedValue(type: CommunityContentType): string {
  return type === "comments" ? "visible" : "published";
}

function hasValue(v: unknown): boolean {
  return typeof v === "string" ? v.trim().length > 0 : v != null;
}

/**
 * 행의 유효 상태. `deleted_at` 이 있으면 삭제됨(삭제가 숨김보다 강하다 — `communityModerationVisibility` 와 같은 우선순위).
 * 사전 밖 값은 게시로 본다(두 CHECK 가 그 외 값을 막는다).
 */
export function communityContentEffectiveStatus(type: CommunityContentType, rawStatus: unknown, deletedAt: unknown): CommunityContentStatus {
  if (hasValue(deletedAt)) return "deleted";
  const s = String(rawStatus ?? "").trim().toLowerCase();
  if (s === "hidden") return "hidden";
  if (s === "draft") return "draft";
  return "published";
}

export const COMMUNITY_CONTENT_DELETED_LABEL = "삭제됨";

/** 상태 배지 라벨 — 삭제됨은 화면 고유(CHECK 가 deleted 를 막아 사전에 없다) · 나머지는 종류별 사전 라벨. */
export function communityContentStatusLabel(type: CommunityContentType, status: CommunityContentStatus): string {
  if (status === "deleted") return COMMUNITY_CONTENT_DELETED_LABEL;
  const raw = status === "published" ? communityContentPublishedValue(type) : status;
  return resolveAdminStatus(COMMUNITY_CONTENT_TABLES[type], "status", raw).label;
}

export type CommunityContentStatusTone = "success" | "warning" | "danger" | "neutral";
export const COMMUNITY_CONTENT_STATUS_TONES: Readonly<Record<CommunityContentStatus, CommunityContentStatusTone>> = {
  published: "success",
  hidden: "warning",
  deleted: "danger",
  draft: "neutral",
};

/** 탭 → 서버 필터. `status` 는 컬럼 값(없으면 필터 없음) · `deleted` 는 `deleted_at` 조건. */
export type CommunityContentTabFilter = { status: string | null; deleted: "only" | "exclude" | "any" };

export function communityContentTabFilter(type: CommunityContentType, tab: CommunityContentTab): CommunityContentTabFilter {
  switch (tab) {
    case "published":
      return { status: communityContentPublishedValue(type), deleted: "exclude" };
    case "hidden":
      return { status: "hidden", deleted: "exclude" };
    case "deleted":
      return { status: null, deleted: "only" };
    default:
      return { status: null, deleted: "any" };
  }
}

/** `deleted_at` 컬럼이 있는 종류(게시판 글)만 삭제됨 탭에 행이 남는다 — 하드 DELETE 종류는 항상 0. */
export function communityContentHasDeletedRows(type: CommunityContentType): boolean {
  return type === "posts";
}

// ── 삭제 방식 · 확인 모달 문구 ────────────────────────────────────────────────

/** 삭제 조치가 실제로 하는 일 — `applyContentModeration` 의 분기와 1:1(게시판 글만 soft-delete) */
export type CommunityContentDeleteEffect = "soft_delete" | "hard_delete";

export function communityContentDeleteEffect(type: CommunityContentType): CommunityContentDeleteEffect {
  return type === "posts" ? "soft_delete" : "hard_delete";
}

export const COMMUNITY_CONTENT_DELETE_EFFECT_LABELS: Readonly<Record<CommunityContentDeleteEffect, string>> = {
  soft_delete: "소프트 삭제(복구 가능)",
  hard_delete: "영구 삭제(복구 불가)",
};

/** 하드 DELETE 모달의 첫 줄(굵게) */
export const COMMUNITY_CONTENT_HARD_DELETE_BANNER = "복구 불가";

/** 삭제 확인 summary — 게시판 글은 `삭제 후 복구할 수 있습니다` · 숏폼·댓글은 첫 줄 `복구 불가` + `영구 삭제됩니다. 복구할 수 없습니다`. */
export function buildCommunityContentDeleteSummary(type: CommunityContentType): string {
  const kind = COMMUNITY_CONTENT_KIND_LABELS[type];
  if (communityContentDeleteEffect(type) === "soft_delete") return `이 ${kind}을 삭제합니다. 삭제 후 복구할 수 있습니다.`;
  return `${COMMUNITY_CONTENT_HARD_DELETE_BANNER} — 이 ${kind}은 영구 삭제됩니다. 복구할 수 없습니다.`;
}

export function buildCommunityContentHideSummary(type: CommunityContentType): string {
  return `이 ${COMMUNITY_CONTENT_KIND_LABELS[type]}을 숨깁니다. 복구할 수 있습니다.`;
}

export function buildCommunityContentRestoreSummary(type: CommunityContentType, status: CommunityContentStatus): string {
  const kind = COMMUNITY_CONTENT_KIND_LABELS[type];
  if (status === "deleted") return `삭제된 ${kind}을 복구합니다. 다시 게시 상태가 됩니다.`;
  return `이 ${kind}을 다시 게시합니다.`;
}

/** destructive 재입력 문자열 — 대상 ID 앞 8자(PR-5 와 같은 길이). */
export const COMMUNITY_CONTENT_CONFIRM_TEXT_LENGTH = 8;
export function communityContentDeleteConfirmText(targetId: string): string {
  return String(targetId ?? "").trim().slice(0, COMMUNITY_CONTENT_CONFIRM_TEXT_LENGTH);
}

// ── 조치 — 서버 액션이 읽는 필드명 · 등급 ──────────────────────────────────────

export const COMMUNITY_CONTENT_TARGET_ID_FIELD = "targetId";
export const COMMUNITY_CONTENT_REASON_FIELD = "reason";
export const COMMUNITY_CONTENT_RETURN_TO_FIELD = "returnTo";

export type CommunityContentActionKey = "hidden" | "restored" | "deleted";
export type CommunityContentActionLevel = "stateChange" | "destructive";

export const COMMUNITY_CONTENT_ACTIONS: Readonly<
  Record<CommunityContentActionKey, { level: CommunityContentActionLevel; label: string; dialogTitle: string; confirmLabel: string; pendingLabel: string }>
> = {
  hidden: { level: "stateChange", label: "숨김", dialogTitle: "콘텐츠 숨김", confirmLabel: "숨김", pendingLabel: "숨기는 중…" },
  restored: { level: "stateChange", label: "복원", dialogTitle: "콘텐츠 복원", confirmLabel: "복원", pendingLabel: "복원 중…" },
  deleted: { level: "destructive", label: "삭제", dialogTitle: "콘텐츠 삭제 — 되돌릴 수 없는 작업", confirmLabel: "삭제", pendingLabel: "삭제 중…" },
};

/** 유효 상태별 가능한 조치 — 삭제된 행은 복원만(게시판 글만 남는다) · 임시 저장은 삭제만. */
export function communityContentAvailableActions(status: CommunityContentStatus): CommunityContentActionKey[] {
  switch (status) {
    case "published":
      return ["hidden", "deleted"];
    case "hidden":
      return ["restored", "deleted"];
    case "draft":
      return ["deleted"];
    default:
      return ["restored"];
  }
}

/** 행마다 다른 트리거 버튼 id — 삭제 모달의 `숨김으로 대신하기` 가 같은 행의 숨김 트리거를 click 한다. */
export function communityContentActionButtonId(key: CommunityContentActionKey, targetId: string): string {
  return `community-content-${key}-${String(targetId ?? "").trim()}`;
}

export const COMMUNITY_CONTENT_HIDE_INSTEAD_LABEL = CONTENT_REPORT_HIDE_INSTEAD_LABEL;

/** 서버 액션의 복귀 경로 — 이 화면 안으로만. */
export function isSafeCommunityContentReturnTo(value: string | null | undefined): boolean {
  const v = String(value ?? "").trim();
  return v.startsWith(COMMUNITY_CONTENT_BASE_PATH) && !v.startsWith("//") && !/[\r\n]/.test(v);
}

// ── 링크 ──────────────────────────────────────────────────────────────────────

/** 목록 링크 — 공용 정본(`status=all` 되살림 · `extra`(type) 보존). */
export function buildCommunityContentListUrl(params: AdminListParams, overrides: Partial<AdminListParams> = {}): string {
  return buildAdminDataTableUrl(COMMUNITY_CONTENT_BASE_PATH, params, overrides);
}

/** 종류 탭 링크 — `type` 은 extra 라 기본 종류(글)는 빈 값으로 지운다. 상태 탭·검색은 유지된다. */
export function buildCommunityContentTypeTabUrl(params: AdminListParams, type: CommunityContentType): string {
  return buildCommunityContentListUrl(params, {
    extra: { ...params.extra, [COMMUNITY_CONTENT_TYPE_PARAM]: type === COMMUNITY_CONTENT_DEFAULT_TYPE ? "" : type },
  });
}

/** 신고 건수 → 신고 검수 목록(전체 탭 · 대상 ID 검색 — 완전한 UUID 는 `target_id.eq`). */
export function communityContentReportsUrl(targetId: string): string {
  return `${CONTENT_REPORT_BASE_PATH}?status=all&q=${encodeURIComponent(String(targetId ?? "").trim())}`;
}

/** 공개 화면 경로 — 댓글은 소속 글(post_type · post_id)로. 만들 수 없으면 null. */
export function communityContentPublicPath(type: CommunityContentType, id: string, comment?: { postType: string | null; postId: string | null }): string | null {
  const key = String(id ?? "").trim();
  if (type === "posts") return key ? `/community/board/${encodeURIComponent(key)}` : null;
  if (type === "shortforms") return key ? `/community/shortform/${encodeURIComponent(key)}` : null;
  const postId = String(comment?.postId ?? "").trim();
  if (!postId) return null;
  return comment?.postType === "shortform" ? `/community/shortform/${encodeURIComponent(postId)}` : `/community/board/${encodeURIComponent(postId)}`;
}

// ── 검색 ─────────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** 종류별 본문 검색 컬럼 — 글 제목·본문 · 숏폼 제목·설명 · 댓글 본문. 작성자 표시명(`author_label`)은 공통. */
export function communityContentSearchColumns(type: CommunityContentType): readonly string[] {
  if (type === "posts") return ["title", "body"];
  if (type === "shortforms") return ["title", "description"];
  return ["body"];
}

/**
 * 검색 `.or()` 인자 — 제목·본문 부분일치 + 작성자 표시명 + (users 검색으로 얻은) 작성자 id 집합.
 * `id`·`author_id` 는 uuid 라 `ilike` 를 걸지 않는다 — 완전한 UUID 일 때만 `eq`.
 */
export function buildCommunityContentSearchOr(type: CommunityContentType, term: string, authorIds: readonly string[]): string {
  const parts = communityContentSearchColumns(type).map((c) => `${c}.ilike.%${term}%`);
  parts.push(`author_label.ilike.%${term}%`);
  if (UUID_RE.test(term)) {
    parts.push(`id.eq.${term}`, `author_id.eq.${term}`);
    if (type === "comments") parts.push(`post_id.eq.${term}`);
  }
  const ids = authorIds.filter((id) => UUID_RE.test(id)).slice(0, ADMIN_LIST_SEARCH_USER_ID_LIMIT);
  if (ids.length) parts.push(`author_id.in.(${ids.join(",")})`);
  return parts.join(",");
}

// ── 행 요약 ────────────────────────────────────────────────────────────────────

export const COMMUNITY_CONTENT_SUMMARY_MAX_LENGTH = 80;

/** 제목이 있으면 제목, 없으면 본문·내용·설명 앞 80자. 전부 비면 `—`. */
export function communityContentSummaryText(row: { title?: unknown; body?: unknown; content?: unknown; description?: unknown }): string {
  const pick = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
  const title = pick(row.title);
  if (title) return title.length > COMMUNITY_CONTENT_SUMMARY_MAX_LENGTH ? `${title.slice(0, COMMUNITY_CONTENT_SUMMARY_MAX_LENGTH - 1)}…` : title;
  const text = pick(row.body) || pick(row.content) || pick(row.description);
  if (!text) return "—";
  return text.length > COMMUNITY_CONTENT_SUMMARY_MAX_LENGTH ? `${text.slice(0, COMMUNITY_CONTENT_SUMMARY_MAX_LENGTH - 1)}…` : text;
}

// ── 플래시 · 빈 상태 ───────────────────────────────────────────────────────────

const FLASH_TARGET_LABELS: Readonly<Record<string, string>> = {
  community_post: "게시판 글",
  shortform_post: "숏폼",
  community_comment: "댓글",
  board_comment: "게시판 댓글",
};

const FLASH_INTENT_LABELS: Readonly<Record<string, string>> = {
  hidden: "숨김 처리했습니다.",
  restored: "복원했습니다.",
  deleted: "삭제했습니다.",
};

/** 서버 액션 `?ok=${targetType}_${intent}` → 안내 문장. 모르는 값은 null. */
export function communityContentFlashOkMessage(ok: string | null | undefined): string | null {
  const s = String(ok ?? "").trim();
  const idx = s.lastIndexOf("_");
  if (idx <= 0) return null;
  const target = FLASH_TARGET_LABELS[s.slice(0, idx)];
  const intent = FLASH_INTENT_LABELS[s.slice(idx + 1)];
  if (!target || !intent) return null;
  return `${target}을 ${intent}`;
}

export const COMMUNITY_CONTENT_EMPTY_STATE = {
  title: "아직 등록된 콘텐츠가 없습니다",
  description: "멘토가 숏폼·게시글을 올리면 검수 후 여기에 보입니다.",
} as const;

export type CommunityContentEmptyVariant = "first" | "tab" | "search";

/** 검색 중이면 search · 이 종류에 행이 하나도 없으면 first · 그 외(이 탭만 비었음) tab */
export function communityContentEmptyVariant(search: string, typeAllCount: number): CommunityContentEmptyVariant {
  if (search.trim()) return "search";
  if (typeAllCount <= 0) return "first";
  return "tab";
}
