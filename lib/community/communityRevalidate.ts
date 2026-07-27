import { revalidatePath } from "next/cache";

import {
  communityRevalidateTargets,
  communityRevalidateTargetsForModeration,
  type CommunityMutation,
  type CommunityPostKind,
} from "@/lib/community/communityRevalidateTargets";

/**
 * 커뮤니티 mutation 후 표면 갱신 — 경로 결정은 communityRevalidateTargets(순수·계약테스트
 * 대상)가 정본이고, 이 래퍼는 next/cache 로 배선만 한다.
 */
export function revalidateCommunityPaths(input: {
  mutation: CommunityMutation;
  kind: CommunityPostKind;
  postId?: string | null;
  extraPaths?: readonly (string | null | undefined)[];
}): void {
  for (const path of communityRevalidateTargets(input)) {
    revalidatePath(path);
  }
}

/** 관리자 숨김·복구·삭제 전용 — 대상 종류를 모르면 게시판·숏폼 표면을 모두 갱신한다. */
export function revalidateCommunityModerationPaths(input: {
  mutation: Extract<CommunityMutation, "admin_hide" | "admin_restore" | "admin_delete">;
  kind: CommunityPostKind | null;
  postId?: string | null;
  extraPaths?: readonly (string | null | undefined)[];
}): void {
  for (const path of communityRevalidateTargetsForModeration(input)) {
    revalidatePath(path);
  }
}
