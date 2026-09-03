"use server";

/**
 * 관리자 직접 모더레이션 server actions — 신고가 없어도 재량으로
 * community_posts / shortform_posts / community_comments / comments 처리.
 *
 * 동일 처리 헬퍼(`applyContentModeration`) 는 신고-경유 액션도 사용 →
 * 두 경로 결과 일관. PR-W2: 삭제 액션은 하드 DELETE 가 아니라 소프트 삭제(deleted_at=now() · deleted_by=조치 관리자)이고,
 * 복원 액션은 숨김 해제와 삭제 해제(deleted_at NULL)를 함께 한다(삭제됨 탭의 복원 버튼 = 같은 액션).
 */

import { redirect } from "next/navigation";
import { revalidateCommunityModerationPaths } from "@/lib/community/communityRevalidate";
import type { CommunityPostKind } from "@/lib/community/communityRevalidateTargets";
import { requireRole } from "@/lib/auth/routeGuard";
import { logAdminAction } from "@/lib/admin/adminActionLog";
import { createClient } from "@/lib/supabase/server";
import {
  applyContentModeration,
  type ModerationIntent,
  type ModerationTargetType,
} from "@/lib/admin/communityModerationCore";
import { COMMUNITY_CONTENT_BASE_PATH, isSafeCommunityContentReturnTo } from "@/lib/admin/communityContentConsole";

const DIRECT_PATH = COMMUNITY_CONTENT_BASE_PATH;

function textFromForm(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

/** 복귀 경로(PR-11): 폼의 `returnTo`(종류·탭·검색이 실린 목록 URL)가 이 화면 안이면 거기로, 아니면 목록 첫 화면으로. 플래시는 쿼리에 덧붙인다. */
function withFlash(returnTo: string, key: "ok" | "error", value: string) {
  const base = isSafeCommunityContentReturnTo(returnTo) ? returnTo : DIRECT_PATH;
  return `${base}${base.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}`;
}

function errUrl(msg: string, returnTo = "") {
  return withFlash(returnTo, "error", msg);
}

function okUrl(intent: ModerationIntent, type: ModerationTargetType, returnTo = "") {
  return withFlash(returnTo, "ok", `${type}_${intent}`);
}

/**
 * 모더레이션 대상 → revalidate 대상 종류.
 * 댓글은 소속 글 종류를 targetId 만으로 알 수 없어 null(게시판·숏폼 표면 모두 갱신).
 */
function moderationKindFor(targetType: ModerationTargetType): CommunityPostKind | null {
  if (targetType === "community_post" || targetType === "board_comment") return "board";
  if (targetType === "shortform_post") return "shortform";
  return null;
}

/** 상세 경로 산출용 글 id — 댓글 처분은 targetId 가 댓글 id 라 상세 경로를 만들 수 없다. */
function moderationPostIdFor(targetType: ModerationTargetType, targetId: string): string | null {
  return targetType === "community_post" || targetType === "shortform_post" ? targetId : null;
}

async function runDirectModeration(args: {
  targetType: ModerationTargetType;
  targetId: string;
  intent: ModerationIntent;
  reason: string;
  returnTo: string;
}) {
  const { user } = await requireRole("admin");
  if (!args.targetId) {
    redirect(errUrl("대상 콘텐츠를 식별할 수 없습니다.", args.returnTo));
  }

  const result = await applyContentModeration({
    targetType: args.targetType,
    targetId: args.targetId,
    intent: args.intent,
    actorId: user.id,
  });
  if (!result.ok) {
    redirect(errUrl(`처리 실패: ${result.error}`, args.returnTo));
  }

  const session = await createClient();
  await logAdminAction(session, {
    adminId: user.id,
    actionType: `community_${args.intent}_${args.targetType}`,
    targetType: args.targetType,
    targetId: args.targetId,
    detail: { reason: args.reason, applied: result.applied, note: result.note },
  });

  // 매트릭스: 관리자 숨김·복구·삭제 × (공개 목록·상세·내 활동·관리자).
  // 「내 활동」은 작성자 본인에게 숨김 배지를 즉시 반영/해제하기 위해 반드시 포함한다.
  revalidateCommunityModerationPaths({
    mutation:
      args.intent === "hidden" ? "admin_hide" : args.intent === "restored" ? "admin_restore" : "admin_delete",
    kind: moderationKindFor(args.targetType),
    postId: moderationPostIdFor(args.targetType, args.targetId),
    extraPaths: [DIRECT_PATH],
  });
  redirect(okUrl(args.intent, args.targetType, args.returnTo));
}

export async function directHideCommunityPostAction(formData: FormData) {
  await runDirectModeration({
    targetType: "community_post",
    targetId: textFromForm(formData.get("targetId")),
    intent: "hidden",
    reason: textFromForm(formData.get("reason")),
    returnTo: textFromForm(formData.get("returnTo")),
  });
}

export async function directDeleteCommunityPostAction(formData: FormData) {
  await runDirectModeration({
    targetType: "community_post",
    targetId: textFromForm(formData.get("targetId")),
    intent: "deleted",
    reason: textFromForm(formData.get("reason")),
    returnTo: textFromForm(formData.get("returnTo")),
  });
}

export async function directRestoreCommunityPostAction(formData: FormData) {
  await runDirectModeration({
    targetType: "community_post",
    targetId: textFromForm(formData.get("targetId")),
    intent: "restored",
    reason: textFromForm(formData.get("reason")),
    returnTo: textFromForm(formData.get("returnTo")),
  });
}

export async function directHideShortformAction(formData: FormData) {
  await runDirectModeration({
    targetType: "shortform_post",
    targetId: textFromForm(formData.get("targetId")),
    intent: "hidden",
    reason: textFromForm(formData.get("reason")),
    returnTo: textFromForm(formData.get("returnTo")),
  });
}

export async function directDeleteShortformAction(formData: FormData) {
  await runDirectModeration({
    targetType: "shortform_post",
    targetId: textFromForm(formData.get("targetId")),
    intent: "deleted",
    reason: textFromForm(formData.get("reason")),
    returnTo: textFromForm(formData.get("returnTo")),
  });
}

export async function directRestoreShortformAction(formData: FormData) {
  await runDirectModeration({
    targetType: "shortform_post",
    targetId: textFromForm(formData.get("targetId")),
    intent: "restored",
    reason: textFromForm(formData.get("reason")),
    returnTo: textFromForm(formData.get("returnTo")),
  });
}

export async function directHideCommentAction(formData: FormData) {
  await runDirectModeration({
    targetType: "community_comment",
    targetId: textFromForm(formData.get("targetId")),
    intent: "hidden",
    reason: textFromForm(formData.get("reason")),
    returnTo: textFromForm(formData.get("returnTo")),
  });
}

export async function directDeleteCommentAction(formData: FormData) {
  await runDirectModeration({
    targetType: "community_comment",
    targetId: textFromForm(formData.get("targetId")),
    intent: "deleted",
    reason: textFromForm(formData.get("reason")),
    returnTo: textFromForm(formData.get("returnTo")),
  });
}

export async function directRestoreCommentAction(formData: FormData) {
  await runDirectModeration({
    targetType: "community_comment",
    targetId: textFromForm(formData.get("targetId")),
    intent: "restored",
    reason: textFromForm(formData.get("reason")),
    returnTo: textFromForm(formData.get("returnTo")),
  });
}

export async function directHideBoardCommentAction(formData: FormData) {
  await runDirectModeration({
    targetType: "board_comment",
    targetId: textFromForm(formData.get("targetId")),
    intent: "hidden",
    reason: textFromForm(formData.get("reason")),
    returnTo: textFromForm(formData.get("returnTo")),
  });
}

export async function directDeleteBoardCommentAction(formData: FormData) {
  await runDirectModeration({
    targetType: "board_comment",
    targetId: textFromForm(formData.get("targetId")),
    intent: "deleted",
    reason: textFromForm(formData.get("reason")),
    returnTo: textFromForm(formData.get("returnTo")),
  });
}

export async function directRestoreBoardCommentAction(formData: FormData) {
  await runDirectModeration({
    targetType: "board_comment",
    targetId: textFromForm(formData.get("targetId")),
    intent: "restored",
    reason: textFromForm(formData.get("reason")),
    returnTo: textFromForm(formData.get("returnTo")),
  });
}
