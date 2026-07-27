/**
 * 커뮤니티 revalidate 매트릭스 정본 — 순수 모듈(next/cache 미의존, node --test 대상).
 *
 * mutation(글·댓글 작성/수정/삭제, 관리자 숨김·복구·삭제, 반응, 신고) × 표면(공개 목록·
 * 상세·내 활동·관리자)의 조합을 여기 한 곳에서 결정한다. server action 은
 * `revalidateCommunityPaths()`(communityRevalidate.ts) 로 이 목록을 그대로 소비한다.
 *
 * 설계 메모:
 *  - `/community/shorts`·`/community/shorts/{id}`·`/community/posts` 는 현재
 *    permanentRedirect 스텁이다(app/(public)/community/shorts/page.tsx 등). 데이터를
 *    렌더하지 않으므로 revalidate 는 no-op 이지만, 기존 액션들이 이미 호출하고 있어
 *    레거시 별칭으로 그대로 유지한다(동작 변화 0).
 *  - 관리자 표면은 service-role 로 매 요청 조회하지만, 숨김·복구 직후 목록/카운트가
 *    캐시로 남지 않도록 매트릭스에 포함한다.
 */

export type CommunityPostKind = "board" | "shortform";

export type CommunityMutation =
  | "post_create"
  | "post_update"
  | "post_delete"
  | "comment_create"
  | "comment_delete"
  | "reaction_toggle"
  | "report_create"
  | "admin_hide"
  | "admin_restore"
  | "admin_delete";

/** 공개 목록 표면 */
export const COMMUNITY_HOME_PATH = "/community";
export const COMMUNITY_BOARD_LIST_PATH = "/community/board";
export const COMMUNITY_SHORTFORM_LIST_PATH = "/community/shortform";
/** 레거시 별칭(permanentRedirect 스텁) — 기존 액션 호출 보존용 */
export const COMMUNITY_SHORTS_LIST_PATH = "/community/shorts";

/** 내 활동 표면 */
export const COMMUNITY_ME_PATH = "/community/me";

/** 관리자 표면 */
export const ADMIN_COMMUNITY_CONTENT_PATH = "/admin/community-content";
export const ADMIN_MODERATION_PATH = "/admin/moderation";
export const ADMIN_REPORTS_PATH = "/admin/reports";

export const ADMIN_COMMUNITY_SURFACES: readonly string[] = [
  ADMIN_COMMUNITY_CONTENT_PATH,
  ADMIN_MODERATION_PATH,
  ADMIN_REPORTS_PATH,
];

/** 종류별 공개 목록 경로(홈 포함) */
export function communityListPaths(kind: CommunityPostKind): string[] {
  if (kind === "shortform") {
    return [COMMUNITY_HOME_PATH, COMMUNITY_SHORTFORM_LIST_PATH, COMMUNITY_SHORTS_LIST_PATH];
  }
  return [COMMUNITY_HOME_PATH, COMMUNITY_BOARD_LIST_PATH];
}

/** 종류별 상세 경로(레거시 별칭 포함). postId 가 비면 빈 배열. */
export function communityDetailPaths(kind: CommunityPostKind, postId: string | null | undefined): string[] {
  const id = String(postId ?? "").trim();
  if (!id) return [];
  if (kind === "shortform") {
    return [`${COMMUNITY_SHORTFORM_LIST_PATH}/${id}`, `${COMMUNITY_SHORTS_LIST_PATH}/${id}`];
  }
  return [`${COMMUNITY_BOARD_LIST_PATH}/${id}`];
}

/** mutation 별 표면 그룹 사용 여부 — 매트릭스 정본 */
type SurfaceFlags = { lists: boolean; detail: boolean; me: boolean; admin: boolean };

const MATRIX: Record<CommunityMutation, SurfaceFlags> = {
  // 글 작성/수정: 목록·상세·내 활동 모두 바뀐다. 관리자 콘텐츠 목록에도 새 행이 뜬다.
  post_create: { lists: true, detail: true, me: true, admin: true },
  post_update: { lists: true, detail: true, me: true, admin: true },
  post_delete: { lists: true, detail: true, me: true, admin: true },
  // 댓글: 상세의 댓글 목록 + 목록의 댓글수 + 내 활동 요약.
  comment_create: { lists: true, detail: true, me: true, admin: true },
  comment_delete: { lists: true, detail: true, me: true, admin: true },
  // 반응(좋아요·스크랩): 목록 카운트·상세 버튼 상태. 내 활동 목록 항목 자체는 불변.
  reaction_toggle: { lists: true, detail: true, me: false, admin: false },
  // 신고 접수: 사용자 표면 표시는 그대로지만 관리자 큐가 즉시 바뀐다.
  report_create: { lists: true, detail: true, me: false, admin: true },
  // 관리자 처분: 공개 표면에서 사라지고, 작성자 「내 활동」에는 숨김 배지로 남는다.
  admin_hide: { lists: true, detail: true, me: true, admin: true },
  admin_restore: { lists: true, detail: true, me: true, admin: true },
  admin_delete: { lists: true, detail: true, me: true, admin: true },
};

export function communityRevalidateTargets(input: {
  mutation: CommunityMutation;
  kind: CommunityPostKind;
  postId?: string | null;
  /** 액션별 추가 경로(returnPath 등). 중복은 제거된다. */
  extraPaths?: readonly (string | null | undefined)[];
}): string[] {
  const flags = MATRIX[input.mutation];
  const out: string[] = [];
  const push = (p: string | null | undefined) => {
    const v = String(p ?? "").trim();
    // 외부 URL·상대 경로 오염 방지: 앱 내부 절대 경로만 revalidate 한다.
    if (!v.startsWith("/")) return;
    if (!out.includes(v)) out.push(v);
  };

  if (flags.lists) communityListPaths(input.kind).forEach(push);
  if (flags.detail) communityDetailPaths(input.kind, input.postId).forEach(push);
  if (flags.me) push(COMMUNITY_ME_PATH);
  if (flags.admin) ADMIN_COMMUNITY_SURFACES.forEach(push);
  (input.extraPaths ?? []).forEach(push);

  return out;
}

/** 관리자 모더레이션은 대상 종류를 알 수 없을 때 두 종류 표면을 모두 갱신한다. */
export function communityRevalidateTargetsForModeration(input: {
  mutation: Extract<CommunityMutation, "admin_hide" | "admin_restore" | "admin_delete">;
  kind: CommunityPostKind | null;
  postId?: string | null;
  extraPaths?: readonly (string | null | undefined)[];
}): string[] {
  const kinds: CommunityPostKind[] = input.kind ? [input.kind] : ["board", "shortform"];
  const out: string[] = [];
  for (const kind of kinds) {
    for (const p of communityRevalidateTargets({
      mutation: input.mutation,
      kind,
      postId: input.postId,
      extraPaths: [],
    })) {
      if (!out.includes(p)) out.push(p);
    }
  }
  for (const raw of input.extraPaths ?? []) {
    const v = String(raw ?? "").trim();
    if (v.startsWith("/") && !out.includes(v)) out.push(v);
  }
  return out;
}
