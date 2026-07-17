"use server";

/**
 * 관리자 직접 모더레이션 server actions — 신고가 없어도 재량으로
 * community_posts / shortform_posts / community_comments 처리.
 *
 * 동일 처리 헬퍼(`applyContentModeration`) 는 신고-경유 액션도 사용 →
 * 두 경로 결과 일관.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/routeGuard";
import { logAdminAction } from "@/lib/admin/adminActionLog";
import { createClient } from "@/lib/supabase/server";
import {
  applyContentModeration,
  type ModerationIntent,
  type ModerationTargetType,
} from "@/lib/admin/communityModerationCore";

const DIRECT_PATH = "/admin/community-content";

function textFromForm(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

function errUrl(msg: string) {
  return `${DIRECT_PATH}?error=${encodeURIComponent(msg)}`;
}

function okUrl(intent: ModerationIntent, type: ModerationTargetType) {
  return `${DIRECT_PATH}?ok=${encodeURIComponent(`${type}_${intent}`)}`;
}

async function runDirectModeration(args: {
  targetType: ModerationTargetType;
  targetId: string;
  intent: ModerationIntent;
  reason: string;
}) {
  const { user } = await requireRole("admin");
  if (!args.targetId) {
    redirect(errUrl("대상 콘텐츠를 식별할 수 없습니다."));
  }

  const result = await applyContentModeration({
    targetType: args.targetType,
    targetId: args.targetId,
    intent: args.intent,
  });
  if (!result.ok) {
    redirect(errUrl(`처리 실패: ${result.error}`));
  }

  const session = await createClient();
  await logAdminAction(session, {
    adminId: user.id,
    actionType: `community_${args.intent}_${args.targetType}`,
    targetType: args.targetType,
    targetId: args.targetId,
    detail: { reason: args.reason, applied: result.applied, note: result.note },
  });

  revalidatePath(DIRECT_PATH);
  revalidatePath("/community");
  revalidatePath("/community/shortform");
  redirect(okUrl(args.intent, args.targetType));
}

export async function directHideCommunityPostAction(formData: FormData) {
  await runDirectModeration({
    targetType: "community_post",
    targetId: textFromForm(formData.get("targetId")),
    intent: "hidden",
    reason: textFromForm(formData.get("reason")),
  });
}

export async function directDeleteCommunityPostAction(formData: FormData) {
  await runDirectModeration({
    targetType: "community_post",
    targetId: textFromForm(formData.get("targetId")),
    intent: "deleted",
    reason: textFromForm(formData.get("reason")),
  });
}

export async function directRestoreCommunityPostAction(formData: FormData) {
  await runDirectModeration({
    targetType: "community_post",
    targetId: textFromForm(formData.get("targetId")),
    intent: "restored",
    reason: textFromForm(formData.get("reason")),
  });
}

export async function directHideShortformAction(formData: FormData) {
  await runDirectModeration({
    targetType: "shortform_post",
    targetId: textFromForm(formData.get("targetId")),
    intent: "hidden",
    reason: textFromForm(formData.get("reason")),
  });
}

export async function directDeleteShortformAction(formData: FormData) {
  await runDirectModeration({
    targetType: "shortform_post",
    targetId: textFromForm(formData.get("targetId")),
    intent: "deleted",
    reason: textFromForm(formData.get("reason")),
  });
}

export async function directRestoreShortformAction(formData: FormData) {
  await runDirectModeration({
    targetType: "shortform_post",
    targetId: textFromForm(formData.get("targetId")),
    intent: "restored",
    reason: textFromForm(formData.get("reason")),
  });
}

export async function directHideCommentAction(formData: FormData) {
  await runDirectModeration({
    targetType: "community_comment",
    targetId: textFromForm(formData.get("targetId")),
    intent: "hidden",
    reason: textFromForm(formData.get("reason")),
  });
}

export async function directDeleteCommentAction(formData: FormData) {
  await runDirectModeration({
    targetType: "community_comment",
    targetId: textFromForm(formData.get("targetId")),
    intent: "deleted",
    reason: textFromForm(formData.get("reason")),
  });
}

export async function directRestoreCommentAction(formData: FormData) {
  await runDirectModeration({
    targetType: "community_comment",
    targetId: textFromForm(formData.get("targetId")),
    intent: "restored",
    reason: textFromForm(formData.get("reason")),
  });
}

export async function directHideBoardCommentAction(formData: FormData) {
  await runDirectModeration({
    targetType: "board_comment",
    targetId: textFromForm(formData.get("targetId")),
    intent: "hidden",
    reason: textFromForm(formData.get("reason")),
  });
}

export async function directDeleteBoardCommentAction(formData: FormData) {
  await runDirectModeration({
    targetType: "board_comment",
    targetId: textFromForm(formData.get("targetId")),
    intent: "deleted",
    reason: textFromForm(formData.get("reason")),
  });
}

export async function directRestoreBoardCommentAction(formData: FormData) {
  await runDirectModeration({
    targetType: "board_comment",
    targetId: textFromForm(formData.get("targetId")),
    intent: "restored",
    reason: textFromForm(formData.get("reason")),
  });
}
