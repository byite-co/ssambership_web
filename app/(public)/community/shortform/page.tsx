import { CommunityLayoutShell } from "@/components/community/CommunityLayoutShell";
import { CommunityShortformCategoryTabs } from "@/components/community/CommunityShortformCategoryTabs";
import { CommunityShortformTabs, parseShortformTab } from "@/components/community/CommunityShortformTabs";
import { CommunityShortformGrid } from "@/components/community/CommunityShortformGrid";
import { getServerUserWithProfile } from "@/lib/auth/getServerUserWithProfile";
import { createClient } from "@/lib/supabase/server";
import { listShortformFeed } from "@/lib/community/communityShortformQueries";
import { fetchBlockedUserIds, filterBlockedAuthors } from "@/lib/blocks/userBlocksQueries";
import { isUserBlocksEnabled } from "@/lib/shell/featureFlags";
import type { ShortformCategorySlug } from "@/lib/community/communityShortformConstants";
import { SURFACE_CARD } from "@/lib/ui/surfaceCard";
import { CommunityShortformUploadFab } from "@/components/community/CommunityShortformUploadFab";

type Props = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

export default async function CommunityShortformPage(props: Props) {
  const sp = (await props.searchParams) ?? {};
  const category = (typeof sp.category === "string" ? sp.category : "all") as ShortformCategorySlug;
  const sortTab = parseShortformTab(typeof sp.tab === "string" ? sp.tab : undefined);
  const { user, profile } = await getServerUserWithProfile();
  const supabase = await createClient();

  const { items: rawItems, error } = await listShortformFeed(supabase, { category, limit: 48, sort: sortTab });

  // W-blocks(v1): 플래그 ON + 로그인 시에만 차단 작성자 필터 — OFF면 기존 결과 그대로 (스펙 §3)
  let items = rawItems;
  if (isUserBlocksEnabled() && user) {
    const blocked = await fetchBlockedUserIds(supabase, user.id);
    items = filterBlockedAuthors(rawItems, blocked, (i) => i.authorId);
  }

  const isLoggedIn = Boolean(user);
  const isMentor = profile?.role === "mentor";

  return (
    <CommunityLayoutShell activeNav="shortform">
      <header className={SURFACE_CARD}>
        <div>
          <h1 className="text-xl font-black text-slate-900">숏폼</h1>
          <p className="mt-1 text-sm text-slate-700">멘토의 짧은 학습 영상을 둘러보세요.</p>
        </div>
      </header>

      <CommunityShortformTabs active={sortTab} />
      <CommunityShortformCategoryTabs active={category} />

      {error ? (
        <p className="text-sm text-slate-600">숏폼 목록을 불러오지 못했습니다.</p>
      ) : items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-200 py-16 text-center text-sm text-slate-500">
          등록된 숏폼이 없습니다.
        </p>
      ) : (
        <CommunityShortformGrid items={items} />
      )}
      <CommunityShortformUploadFab isLoggedIn={isLoggedIn} isMentor={isMentor} />
    </CommunityLayoutShell>
  );
}
