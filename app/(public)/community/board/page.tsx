import { Suspense } from "react";
import { CommunityHomeFeed } from "@/components/community/CommunityHomeFeed";
import { CommunityLayoutShell } from "@/components/community/CommunityLayoutShell";
import { parseCommunityBoardSortTab } from "@/lib/community/communityBoardSort";
import { createClient } from "@/lib/supabase/server";
import type { CommunityPostCategorySlug } from "@/lib/community/communityBoardConstants";
import { listCommunityBoardPosts } from "@/lib/community/communityBoardQueries";
import { getServerUserWithProfile } from "@/lib/auth/getServerUserWithProfile";
import { fetchBlockedUserIds, filterBlockedAuthors } from "@/lib/blocks/userBlocksQueries";
import { isUserBlocksEnabled } from "@/lib/shell/featureFlags";
import { SURFACE_CARD } from "@/lib/ui/surfaceCard";

export const metadata = {
  title: "커뮤니티 게시판",
  description: "쌤버십 커뮤니티 게시판입니다. 학생과 멘토가 올린 글을 읽고 함께 이야기를 나눌 수 있습니다.",
};

type Props = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

export default async function CommunityBoardPage(props: Props) {
  const sp = (await props.searchParams) ?? {};
  const catRaw = sp.category;
  const category = (typeof catRaw === "string" ? catRaw : "all") as CommunityPostCategorySlug;
  const sortTab = parseCommunityBoardSortTab(typeof sp.tab === "string" ? sp.tab : undefined);

  const supabase = await createClient();

  const feed = await listCommunityBoardPosts(supabase, { category, limit: 12, sort: sortTab });

  if (feed.error) console.error("[community/board] feed", feed.error);

  // W-blocks(v1): 플래그 ON + 로그인 시에만 차단 작성자 필터 — OFF면 기존 결과 그대로 (스펙 §3)
  let posts = feed.posts;
  if (isUserBlocksEnabled()) {
    const { user } = await getServerUserWithProfile();
    if (user) {
      const blocked = await fetchBlockedUserIds(supabase, user.id);
      posts = filterBlockedAuthors(posts, blocked, (p) => p.authorId);
    }
  }

  return (
    <CommunityLayoutShell activeNav="board">
      <header className={SURFACE_CARD}>
        <h1 className="text-xl font-black text-slate-900">게시판</h1>
        <p className="mt-1 text-sm text-slate-600">
          공부법, 해설, 후기, 학습 팁을 카테고리별로 모아 봤어요.
        </p>
      </header>
      <Suspense fallback={<p className="text-sm text-slate-500">불러오는 중…</p>}>
        <CommunityHomeFeed
          initialPosts={posts}
          initialCursor={feed.nextCursor}
          initialCategory={category}
          initialSort={sortTab}
          showSortTabs
          basePath="/community/board"
          paginate
        />
      </Suspense>
    </CommunityLayoutShell>
  );
}
