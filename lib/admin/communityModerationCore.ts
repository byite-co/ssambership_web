/**
 * 커뮤니티 모더레이션 코어 — 헬퍼·타입(서버 전용).
 * server action 은 communityModerationActions.ts 에서 별도 export.
 *
 * PR-W2(DB-2 SQL 194 소프트 삭제): 삭제는 네 테이블(community_posts · shortform_posts · community_comments · comments) 전부
 * `deleted_at`/`deleted_by` UPDATE 다 — 이 모듈에 하드 DELETE 경로는 없다. service_role 경로라 DB 의 auth.uid() 가 비어 있으므로
 * 조치한 관리자 id(`actorId` = requireRole("admin") 의 user.id)를 `deleted_by` 로 넘긴다(194 쓰기 가드는 anon·authenticated 에만
 * deleted_by = auth.uid() 를 강제하고 service_role 은 통과시킨다). 복원(`restored`)은 숨김 해제와 삭제 해제(deleted_at NULL)를 함께 한다.
 */
import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/admin";

export type ModerationTargetType =
  | "community_post"
  | "shortform_post"
  | "community_comment"
  | "board_comment";

export type ModerationIntent = "hidden" | "deleted" | "restored";

/** content_reports.target_type 등 외부 표기를 normalize.
 * legacy 'comment' 는 게시판/숏폼 중 어느 댓글인지 판정 근거가 없으므로 자동
 * 매핑하지 않는다(null → 자동 콘텐츠 조치 없이 수동 검토 상태 유지 — 수렴 §9.3).
 * 대상 테이블을 확인할 수 있는 경로는 resolveLegacyCommentTargetType 을 쓴다. */
export function normalizeModerationTargetType(raw: string | null | undefined): ModerationTargetType | null {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "community_post" || s === "community" || s === "post") return "community_post";
  if (s === "shortform_post" || s === "shortform") return "shortform_post";
  if (s === "community_comment") return "community_comment";
  if (s === "board_comment" || s === "board_comment_v2") return "board_comment";
  return null;
}

/** legacy 'comment' 행의 실제 대상 판정: target_id 가 어느 댓글 테이블에 실재하는지
 * 조회해 수렴한다. 게시판 정본(comments)에 있으면 board_comment, 숏폼
 * (community_comments post_type='shortform')에 있으면 community_comment.
 * 어느 쪽도 아니거나 양쪽 모두면 null(수동 검토).
 * deleted_at 무관 — 삭제(soft-delete)된 댓글의 신고도 종류를 판정해야 증거·조치 화면이 열린다(행 실재 확인이 목적). */
export async function resolveLegacyCommentTargetType(targetId: string): Promise<ModerationTargetType | null> {
  // D-AD-4: service role 키 부재는 500 대신 null(수동 검토)로 강등 — 관리자 신고 상세
  // (adminReportEvidence → reports/[id])가 증거 조회 실패로 죽지 않게 한다.
  // applyContentModeration 의 fail-closed 패턴과 동일.
  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch {
    return null;
  }
  const [board, shortform] = await Promise.all([
    admin.from("comments").select("id").eq("id", targetId).maybeSingle(),
    admin
      .from("community_comments")
      .select("id")
      .eq("id", targetId)
      .eq("post_type", "shortform")
      .maybeSingle(),
  ]);
  const inBoard = !board.error && board.data != null;
  const inShortform = !shortform.error && shortform.data != null;
  if (inBoard && !inShortform) return "board_comment";
  if (inShortform && !inBoard) return "community_comment";
  return null;
}

type Result =
  | { ok: true; applied: true; note: string }
  | { ok: true; applied: false; note: string }
  | { ok: false; error: string };

const TARGET_TABLE_BY_TYPE: Record<ModerationTargetType, string> = {
  community_post: "community_posts",
  shortform_post: "shortform_posts",
  community_comment: "community_comments",
  board_comment: "comments",
};

function publishedStatusFor(targetType: ModerationTargetType): string {
  return targetType === "community_comment" ? "visible" : "published";
}

function hiddenStatusFor(targetType: ModerationTargetType): string {
  void targetType;
  return "hidden";
}

/**
 * intent 에 따라 실제 콘텐츠를 변경한다(전부 UPDATE — 하드 DELETE 없음).
 *  - hidden:   status='hidden'(글/숏폼/댓글) · 게시판 v2 댓글(comments)은 is_deleted=true(숨김 플래그)
 *  - deleted:  deleted_at=now() · deleted_by=actorId — 네 테이블 공통 소프트 삭제(행 보존 · 관리자 복원 가능 · 이미 삭제된 행은 건너뜀).
 *              comments 는 DB 트리거(comments_sync_deleted_flag)가 is_deleted 를 따라 올리고, 브리지가 레거시 행에도 옮긴다.
 *  - restored: deleted_at/deleted_by=NULL + status='published'(글/숏폼) · 'visible'(댓글) · is_deleted=false(comments)
 *              — 숨김 복원과 삭제 복원(삭제됨 탭의 복원 버튼)이 같은 경로다.
 *
 * 지원 안 되는 target_type(individual_question, question_thread 등)은
 * `applied: false` 로 돌아오며 호출자가 신고 상태만 변경할지 결정.
 */
export async function applyContentModeration(args: {
  targetType: ModerationTargetType | string | null | undefined;
  targetId: string | null | undefined;
  intent: ModerationIntent;
  /** 조치한 관리자 id — 삭제 시 `deleted_by` 에 기록한다(requireRole("admin") 의 user.id). */
  actorId: string;
}): Promise<Result> {
  const targetType = normalizeModerationTargetType(args.targetType);
  if (!targetType) {
    return { ok: true, applied: false, note: "지원되지 않는 신고 대상 유형 — 신고 상태만 변경됩니다." };
  }
  const targetId = String(args.targetId ?? "").trim();
  if (!targetId) {
    return { ok: false, error: "대상 ID가 없습니다." };
  }

  const table = TARGET_TABLE_BY_TYPE[targetType];
  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `서비스 클라이언트 생성 실패: ${m}` };
  }

  if (args.intent === "deleted") {
    const actorId = String(args.actorId ?? "").trim();
    if (!actorId) {
      return { ok: false, error: "조치한 관리자를 식별할 수 없습니다." };
    }
    // 소프트 삭제(SQL 194) — 행을 보존하고 deleted_at/deleted_by 만 기록한다. 이미 삭제된 행(deleted_at 있음)은 건너뛴다(멱등).
    const { data, error } = await admin
      .from(table)
      .update({ deleted_at: new Date().toISOString(), deleted_by: actorId })
      .eq("id", targetId)
      .is("deleted_at", null)
      .select("id");
    if (error) return { ok: false, error: error.message };
    if (!data?.length) {
      return { ok: true, applied: false, note: "이미 삭제되었거나 대상 행이 없습니다." };
    }
    return { ok: true, applied: true, note: `${table}.deleted_at set (soft-delete)` };
  }

  // 게시판 v2 댓글(comments)은 status 컬럼이 없고 is_deleted 플래그로 숨김을 제어한다. 복원은 삭제 표시(deleted_at)도 함께 푼다.
  if (targetType === "board_comment") {
    const nextDeleted = args.intent === "hidden";
    const patch: Record<string, unknown> = nextDeleted ? { is_deleted: true } : { is_deleted: false, deleted_at: null, deleted_by: null };
    const { data, error } = await admin
      .from(table)
      .update(patch)
      .eq("id", targetId)
      .select("id, is_deleted");
    if (error) return { ok: false, error: error.message };
    if (!data?.length) {
      return { ok: true, applied: false, note: "대상 행을 찾을 수 없거나 이미 동일 상태입니다." };
    }
    return { ok: true, applied: true, note: `${table}.is_deleted=${nextDeleted}${nextDeleted ? "" : " · deleted_at cleared"}` };
  }

  const nextStatus =
    args.intent === "hidden" ? hiddenStatusFor(targetType) : publishedStatusFor(targetType);
  // 복원 시 소프트 삭제도 함께 해제(관리자 삭제 취소) — 글·숏폼·댓글 공통.
  const statusPatch: Record<string, unknown> = { status: nextStatus };
  if (args.intent === "restored") {
    statusPatch.deleted_at = null;
    statusPatch.deleted_by = null;
  }
  const { data, error } = await admin
    .from(table)
    .update(statusPatch)
    .eq("id", targetId)
    .select("id, status");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) {
    return { ok: true, applied: false, note: "대상 행을 찾을 수 없거나 이미 동일 상태입니다." };
  }
  return { ok: true, applied: true, note: `${table}.status='${nextStatus}'${args.intent === "restored" ? " · deleted_at cleared" : ""}` };
}
