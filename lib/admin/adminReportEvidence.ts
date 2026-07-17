import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeModerationTargetType } from "@/lib/admin/communityModerationCore";
import { resolveCommunityImageUrls } from "@/lib/community/communityImageStorage";
import {
  resolveShortformThumbnailUrl,
  resolveShortformVideoUrl,
} from "@/lib/community/communityShortformStorage";

type Row = Record<string, unknown>;

/** 신고 대상 콘텐츠의 관리자 열람용 스냅샷(증거 뷰). */
export type AdminReportEvidence =
  | {
      kind: "community_post";
      title: string | null;
      body: string | null;
      status: string | null;
      authorId: string | null;
      createdAt: string | null;
      imageUrls: string[];
    }
  | {
      kind: "shortform_post";
      title: string | null;
      body: string | null;
      status: string | null;
      authorId: string | null;
      createdAt: string | null;
      videoUrl: string | null;
      thumbnailUrl: string | null;
    }
  | {
      kind: "community_comment" | "board_comment";
      body: string | null;
      status: string | null;
      authorId: string | null;
      createdAt: string | null;
      postId: string | null;
    }
  | { kind: "unsupported" }
  | { kind: "missing" }
  | { kind: "error"; message: string };

function str(row: Row, key: string): string | null {
  const v = row[key];
  return typeof v === "string" && v.trim().length > 0 ? v : null;
}

/**
 * content_reports 의 target_type/target_id 로 실제 콘텐츠를 조회하고
 * 이미지·영상은 표시용 signed URL 로 변환한다. 조회 실패는 kind 로 구분해
 * 페이지가 신고 처리 자체를 막지 않도록 한다.
 */
export async function loadAdminReportEvidence(
  supabase: SupabaseClient,
  targetTypeRaw: string | null | undefined,
  targetIdRaw: string | null | undefined
): Promise<AdminReportEvidence> {
  const targetType = normalizeModerationTargetType(targetTypeRaw);
  const targetId = String(targetIdRaw ?? "").trim();
  if (!targetType) return { kind: "unsupported" };
  if (!targetId) return { kind: "missing" };

  if (targetType === "community_post") {
    const { data, error } = await supabase
      .from("community_posts")
      .select("id, title, body, content, status, author_id, created_at, image_urls")
      .eq("id", targetId)
      .maybeSingle();
    if (error) return { kind: "error", message: error.message };
    if (!data) return { kind: "missing" };
    const row = data as Row;
    const refs = Array.isArray(row.image_urls) ? (row.image_urls as unknown[]).map(String) : [];
    const imageUrls = await resolveCommunityImageUrls(supabase, refs);
    return {
      kind: "community_post",
      title: str(row, "title"),
      body: str(row, "body") ?? str(row, "content"),
      status: str(row, "status"),
      authorId: str(row, "author_id"),
      createdAt: str(row, "created_at"),
      imageUrls,
    };
  }

  if (targetType === "shortform_post") {
    const { data, error } = await supabase
      .from("shortform_posts")
      .select("id, title, description, body, status, author_id, created_at, video_url, thumbnail_url")
      .eq("id", targetId)
      .maybeSingle();
    if (error) return { kind: "error", message: error.message };
    if (!data) return { kind: "missing" };
    const row = data as Row;
    return {
      kind: "shortform_post",
      title: str(row, "title"),
      body: str(row, "description") ?? str(row, "body"),
      status: str(row, "status"),
      authorId: str(row, "author_id"),
      createdAt: str(row, "created_at"),
      videoUrl: await resolveShortformVideoUrl(supabase, str(row, "video_url")),
      thumbnailUrl: await resolveShortformThumbnailUrl(supabase, str(row, "thumbnail_url")),
    };
  }

  // 댓글 — 레거시(community_comments)와 게시판 v2(comments)를 모두 시도한다.
  const legacy = await supabase
    .from("community_comments")
    .select("id, body, status, author_id, post_id, created_at")
    .eq("id", targetId)
    .maybeSingle();
  if (legacy.data) {
    const row = legacy.data as Row;
    return {
      kind: "community_comment",
      body: str(row, "body"),
      status: str(row, "status"),
      authorId: str(row, "author_id"),
      createdAt: str(row, "created_at"),
      postId: str(row, "post_id"),
    };
  }
  const board = await supabase
    .from("comments")
    .select("id, content, is_deleted, author_id, post_id, created_at")
    .eq("id", targetId)
    .maybeSingle();
  if (board.data) {
    const row = board.data as Row;
    return {
      kind: "board_comment",
      body: str(row, "content"),
      status: row.is_deleted === true ? "hidden" : "visible",
      authorId: str(row, "author_id"),
      createdAt: str(row, "created_at"),
      postId: str(row, "post_id"),
    };
  }
  if (legacy.error && board.error) {
    return { kind: "error", message: board.error.message };
  }
  return { kind: "missing" };
}
