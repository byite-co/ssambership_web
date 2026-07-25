import { CommunityLayoutShell } from "@/components/community/CommunityLayoutShell";
import { CommunityMeTabPanels, type CommunityMeActivityPayload } from "@/components/community/CommunityMeTabPanels";
import { CommunityMeOverviewSections } from "@/components/community/CommunityMeOverviewSections";
import { CommunityPageHero } from "@/components/community/CommunityPageHero";
import { LoginRequiredState } from "@/components/common/LoginRequiredState";
import { getServerUserWithProfile } from "@/lib/auth/getServerUserWithProfile";
import {
  buildCommunityMeDraftsList,
  buildCommunityMePostsList,
  countMyCommunityBoardPosts,
  countMyShortformPosts,
  loadMyCommunityBoardPosts,
  loadMyShortformPosts,
} from "@/lib/community/communityQueries";
import { communityMePath, parseCommunityMeTab } from "@/lib/community/communityMeTab";
import type { CommunityNavActive } from "@/components/community/CommunityNavTypes";
import { createClient } from "@/lib/supabase/server";
import type { AppRole } from "@/lib/types/user";

function meDescription(role: AppRole | null | undefined, loggedIn: boolean): string {
  if (role === "mentor") {
    return "작성한 글·숏폼과 활동 요약을 탭으로 나눠 확인해 보세요.";
  }
  if (!loggedIn) {
    return "내 커뮤니티 활동은 로그인 후 이어갈 수 있어요.";
  }
  return "참여한 활동과 내 글을 탭에서 확인하세요.";
}

function activeNavForMeTab(tab: ReturnType<typeof parseCommunityMeTab>): CommunityNavActive {
  if (tab === "posts") return "my-posts";
  if (tab === "drafts") return "my-posts";
  if (tab === "scraps") return "scraps";
  return "me";
}

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function CommunityMePage(props: PageProps) {
  const sp = (await props.searchParams) ?? {};
  const tab = parseCommunityMeTab(sp.tab);
  const loginNextPath = communityMePath(tab);

  const { user, profile } = await getServerUserWithProfile();
  const loggedIn = user != null;
  const role = profile?.role;

  if (!loggedIn) {
    return (
      <CommunityLayoutShell activeNav={activeNavForMeTab(tab)}>
        <CommunityPageHero
          eyebrow="커뮤니티"
          title="내 활동"
          description="내 게시글·스크랩은 로그인 후 이용할 수 있어요."
        />
        <LoginRequiredState
          nextPath={loginNextPath}
          description="로그인하면 작성한 글과 스크랩 활동을 확인할 수 있어요."
        />
      </CommunityLayoutShell>
    );
  }

  let activity: CommunityMeActivityPayload | null = null;
  if (user?.id) {
    const supabase = await createClient();
    const uid = user.id;
    const [boardRes, shortRes, boardCount, shortCount] = await Promise.all([
      loadMyCommunityBoardPosts(supabase, uid, 120),
      loadMyShortformPosts(supabase, uid, 120),
      countMyCommunityBoardPosts(supabase, uid),
      countMyShortformPosts(supabase, uid),
    ]);
    if (boardRes.error) console.error("[community/me] loadMyCommunityBoardPosts", boardRes.error);
    if (shortRes.error) console.error("[community/me] loadMyShortformPosts", shortRes.error);
    const loadFailed = Boolean(boardRes.error || shortRes.error);
    activity = {
      // viewerId 를 넘겨야 관리자 숨김·삭제 배지가 작성자 본인 표면에서만 계산된다.
      myPosts: buildCommunityMePostsList(boardRes.rows, shortRes.rows, 200, uid),
      myDrafts: buildCommunityMeDraftsList(boardRes.rows, shortRes.rows, 50),
      boardCount: boardCount,
      shortformCount: shortCount,
      recent: buildCommunityMePostsList(boardRes.rows, shortRes.rows, 3, uid),
      loadFailed,
    };
  }

  return (
    <CommunityLayoutShell activeNav={activeNavForMeTab(tab)}>
      <CommunityPageHero
        eyebrow="커뮤니티"
        title="내 활동"
        description={meDescription(role, loggedIn)}
      />

      <div className="space-y-5">
        {tab === "overview" ? (
          <CommunityMeOverviewSections activity={activity} />
        ) : (
          <CommunityMeTabPanels
            tab={tab}
            loggedIn={loggedIn}
            role={role}
            loginNextPath={loginNextPath}
            activity={activity}
          />
        )}
      </div>
    </CommunityLayoutShell>
  );
}
