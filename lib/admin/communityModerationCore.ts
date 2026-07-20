/**
 * 커뮤니티 모더레이션 코어 — 헬퍼·타입(서버 전용).
 * server action 은 communityModerationActions.ts 에서 별도 export.
 */
import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/admin";

export type ModerationTargetType =
  | "community_post"
  | "shortform_post"
  | "community_comment"
  | "board_comment";

export type ModerationIntent = "hidden" | "deleted" | "restored";

/** content_reports.target_type 등 외부 표기를 normalize. */
export function normalizeModerationTargetType(raw: string | null | undefined): ModerationTargetType | null {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "community_post" || s === "community" || s === "post") return "community_post";
  if (s === "shortform_post" || s === "shortform") return "shortform_post";
  if (s === "community_comment" || s === "comment") return "community_comment";
  if (s === "board_comment" || s === "board_comment_v2") return "board_comment";
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
 * intent 에 따라 실제 콘텐츠를 변경한다.
 *  - hidden: status='hidden' (글/숏폼/댓글 공통)
 *  - deleted: 행 삭제
 *  - restored: status='published'(글/숏폼) 또는 'visible'(댓글)
 *
 * 지원 안 되는 target_type(individual_question, question_thread 등)은
 * `applied: false` 로 돌아오며 호출자가 신고 상태만 변경할지 결정.
 */
export async function applyContentModeration(args: {
  targetType: ModerationTargetType | string | null | undefined;
  targetId: string | null | undefined;
  intent: ModerationIntent;
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
    // 게시판 글은 hard DELETE 금지 — deleted_at soft-delete 로 행을 보존한다(관리자 감사·복구).
    if (targetType === "community_post") {
      const { data, error } = await admin
        .from(table)
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", targetId)
        .is("deleted_at", null)
        .select("id");
      if (error) return { ok: false, error: error.message };
      if (!data?.length) {
        return { ok: true, applied: false, note: "이미 삭제되었거나 대상 행이 없습니다." };
      }
      return { ok: true, applied: true, note: `${table}.deleted_at set (soft-delete)` };
    }
    const { data, error } = await admin.from(table).delete().eq("id", targetId).select("id");
    if (error) return { ok: false, error: error.message };
    if (!data?.length) {
      return { ok: true, applied: false, note: "이미 삭제되었거나 대상 행이 없습니다." };
    }
    return { ok: true, applied: true, note: `${table} 행 삭제 완료` };
  }

  // 게시판 v2 댓글(comments)은 status 컬럼이 없고 is_deleted 플래그로 노출을 제어한다.
  if (targetType === "board_comment") {
    const nextDeleted = args.intent === "hidden";
    const { data, error } = await admin
      .from(table)
      .update({ is_deleted: nextDeleted })
      .eq("id", targetId)
      .select("id, is_deleted");
    if (error) return { ok: false, error: error.message };
    if (!data?.length) {
      return { ok: true, applied: false, note: "대상 행을 찾을 수 없거나 이미 동일 상태입니다." };
    }
    return { ok: true, applied: true, note: `${table}.is_deleted=${nextDeleted}` };
  }

  const nextStatus =
    args.intent === "hidden" ? hiddenStatusFor(targetType) : publishedStatusFor(targetType);
  // community_post 복원 시 soft-delete 도 함께 해제(관리자 삭제 취소).
  const statusPatch: Record<string, unknown> = { status: nextStatus };
  if (targetType === "community_post" && args.intent === "restored") {
    statusPatch.deleted_at = null;
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
  return { ok: true, applied: true, note: `${table}.status='${nextStatus}'` };
}
