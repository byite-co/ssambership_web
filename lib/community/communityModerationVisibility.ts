/**
 * 작성자 본인 표면의 모더레이션 상태 판정 — 순수 모듈(node --test 대상).
 *
 * 계약:
 *  - 관리자 숨김(status='hidden')·관리자 삭제(deleted_at)된 글은 **작성자 본인에게만**
 *    행을 유지하고 배지·사유를 노출한다. 타인·비로그인·공개 목록은 기존 필터링 그대로다
 *    (판정은 이 모듈이 아니라 각 목록 쿼리의 status 필터·RLS 가 계속 담당한다).
 *  - 사유 문구는 **공개 가능한 정책 문구 고정값**만 쓴다. 관리자가 입력한 내부 사유는
 *    admin_action_logs 에 있고 그 테이블은 admin 전용 SELECT RLS
 *    (supabase/sql/040_admin_action_logs.sql:22) 라 작성자에게 노출할 수 없고, 노출해서도
 *    안 된다(내부 메모 유출 금지).
 *
 * RLS 전제(실측): 작성자 본인은 자신의 숨김 행을 읽을 수 있다.
 *  - community_posts  : cp_select_published — status='published' OR author_id=auth.uid() OR is_admin()
 *                       (supabase/sql/037_p1_community_board_v2.sql:301-308)
 *  - shortform_posts  : sf_select_published — status='published' OR author_id=auth.uid()
 *                       OR creator_id=auth.uid() OR is_admin()
 *                       (supabase/sql/053_community_rls_legacy_select_cleanup.sql:18-25)
 */

export type CommunityVisibilityState = "published" | "hidden" | "draft" | "deleted";

type Row = Record<string, unknown>;

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** 행의 노출 상태. deleted_at 이 우선(삭제가 숨김보다 강하다). */
export function resolveCommunityVisibility(row: Row | null | undefined): CommunityVisibilityState {
  if (!row) return "published";
  const deletedAt = row.deleted_at;
  if (typeof deletedAt === "string" ? deletedAt.trim().length > 0 : deletedAt != null) {
    return "deleted";
  }
  const status = str(row.status) || "published";
  if (status === "hidden") return "hidden";
  if (status === "draft") return "draft";
  return "published";
}

/** 행의 작성자 id — community_posts.author_id, shortform_posts 의 creator_id 폴백 포함. */
export function communityRowAuthorId(row: Row | null | undefined): string | null {
  if (!row) return null;
  for (const key of ["author_id", "creator_id", "user_id"] as const) {
    const v = str(row[key]);
    if (v) return v;
  }
  return null;
}

export function isCommunityRowAuthor(row: Row | null | undefined, viewerId: string | null | undefined): boolean {
  const author = communityRowAuthorId(row);
  const viewer = str(viewerId);
  return Boolean(author && viewer && author === viewer);
}

export type AuthorModerationNotice = {
  state: "hidden" | "deleted";
  /** 배지 라벨(짧게) */
  badgeLabel: string;
  /** 공개 가능한 사유 — 내부 관리자 메모는 절대 포함하지 않는다. */
  reason: string;
};

const HIDDEN_NOTICE: AuthorModerationNotice = {
  state: "hidden",
  badgeLabel: "숨김",
  reason:
    "커뮤니티 운영정책에 따라 관리자가 숨김 처리했어요. 지금은 다른 사용자에게 보이지 않아요. 문의는 고객센터로 남겨 주세요.",
};

const DELETED_NOTICE: AuthorModerationNotice = {
  state: "deleted",
  badgeLabel: "삭제됨",
  reason:
    "커뮤니티 운영정책에 따라 관리자가 삭제 처리했어요. 지금은 다른 사용자에게 보이지 않아요. 문의는 고객센터로 남겨 주세요.",
};

/**
 * 작성자 본인에게 보여줄 모더레이션 배지·사유. 조건에 맞지 않으면 null(배지 없음).
 * - 뷰어가 작성자 본인이 아니면 항상 null(타인 표면에는 어떤 정보도 노출하지 않는다).
 * - published/draft 는 null → 복구(restored) 후 배지가 자동으로 사라진다.
 */
export function authorModerationNotice(
  row: Row | null | undefined,
  viewerId: string | null | undefined
): AuthorModerationNotice | null {
  if (!isCommunityRowAuthor(row, viewerId)) return null;
  const state = resolveCommunityVisibility(row);
  if (state === "hidden") return HIDDEN_NOTICE;
  if (state === "deleted") return DELETED_NOTICE;
  return null;
}

/**
 * 작성자 본인이 상세 화면에서 자신의 숨김 글을 열 수 있는지.
 * 삭제(deleted_at)·임시저장(draft)은 기존 not-found/전용 편집 경로를 유지한다.
 */
export function canAuthorViewHiddenDetail(
  row: Row | null | undefined,
  viewerId: string | null | undefined
): boolean {
  return isCommunityRowAuthor(row, viewerId) && resolveCommunityVisibility(row) === "hidden";
}
