import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { COMMUNITY_POST_PAGE_SIZE } from "@/lib/community/communityBoardConstants";
import { listCommunityBoardPosts, type CommunityBoardFeedSort } from "@/lib/community/communityBoardQueries";
import type { CommunityPostCategorySlug } from "@/lib/community/communityBoardConstants";
import { parseCommunityBoardSortTab } from "@/lib/community/communityBoardSort";
import { getServerUserWithProfile } from "@/lib/auth/getServerUserWithProfile";
import { fetchBlockedUserIds, filterBlockedAuthors } from "@/lib/blocks/userBlocksQueries";
import { isUserBlocksEnabled } from "@/lib/shell/featureFlags";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const category = (searchParams.get("category") ?? "all") as CommunityPostCategorySlug;
  const sort = parseCommunityBoardSortTab(searchParams.get("tab") ?? undefined) as CommunityBoardFeedSort;
  const cursor = searchParams.get("cursor");
  const limitRaw = Number(searchParams.get("limit") ?? COMMUNITY_POST_PAGE_SIZE);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 24) : COMMUNITY_POST_PAGE_SIZE;

  const supabase = await createClient();
  const { posts, nextCursor, error } = await listCommunityBoardPosts(supabase, {
    category,
    cursor,
    limit,
    sort,
  });

  // D-CM-2: 조회 실패를 200 + 빈 목록으로 위장하지 않는다. 5xx 로 표면화해 클라이언트가
  // '더 이상 없음'이 아니라 오류로 처리하고 재시도 UI 를 띄운다.
  if (error) {
    return NextResponse.json({ posts: [], nextCursor: null, error: "load_failed" }, { status: 500 });
  }

  // D-CM-1: SSR 목록(page.tsx)과 동일하게 차단 작성자 글을 필터링한다. 탭 전환·더보기는
  // 모두 이 API 를 쓰는데 필터가 없어 첫 페이지에서만 차단이 먹던 결함을 해소한다.
  let filtered = posts;
  if (isUserBlocksEnabled()) {
    const { user } = await getServerUserWithProfile();
    if (user) {
      const blocked = await fetchBlockedUserIds(supabase, user.id);
      filtered = filterBlockedAuthors(posts, blocked, (p) => p.authorId);
    }
  }

  return NextResponse.json({ posts: filtered, nextCursor, error: null });
}
