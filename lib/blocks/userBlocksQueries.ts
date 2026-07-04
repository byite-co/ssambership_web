import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 사용자 차단 조회·필터 헬퍼 (스펙 docs/plans/user-blocks-spec.md §2·§3).
 * 세션 클라이언트 사용 — RLS(ub_select_own)가 본인 차단 목록만 허용.
 * 테이블 미배포(116 라이브 미적용) 시 빈 배열 폴백 → 플래그 ON+미적용에서도 안전.
 */

export async function fetchBlockedUserIds(
  supabase: SupabaseClient,
  userId: string
): Promise<string[]> {
  const { data, error } = await supabase
    .from("user_blocks")
    .select("blocked_id")
    .eq("blocker_id", userId);
  if (error || !data) return [];
  return (data as Array<{ blocked_id: unknown }>)
    .map((r) => (typeof r.blocked_id === "string" ? r.blocked_id : ""))
    .filter(Boolean);
}

/** 목록 필터 — 기존 쿼리 함수 시그니처 무변경 원칙에 따라 호출부(페이지)에서 결과를 감싼다 */
export function filterBlockedAuthors<T>(
  rows: T[],
  blockedIds: readonly string[],
  getAuthorId: (row: T) => string | null | undefined
): T[] {
  if (!blockedIds.length) return rows;
  const blocked = new Set(blockedIds);
  return rows.filter((row) => {
    const id = getAuthorId(row);
    return !id || !blocked.has(id);
  });
}

/** 게시판 댓글 트리(부모+replies) 재귀 필터 — 차단 작성자의 노드는 답글 포함 완전 숨김(v1) */
export function filterBlockedCommentNodes<T extends { authorId: string; replies: T[] }>(
  nodes: T[],
  blockedIds: readonly string[]
): T[] {
  if (!blockedIds.length) return nodes;
  const blocked = new Set(blockedIds);
  return nodes
    .filter((n) => !blocked.has(n.authorId))
    .map((n) => ({ ...n, replies: n.replies.filter((r) => !blocked.has(r.authorId)) }));
}
