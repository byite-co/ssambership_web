import type { Metadata } from "next";
import type { ReactNode } from "react";
import { MentorsListBody } from "@/components/mentor/MentorsListBody";
import {
  MentorsScopeBanner,
  MentorsScopeEmptyFavorites,
  MentorsScopeLoginNeeded,
} from "@/components/mentor/MentorsScopeNotice";
import { RecentMentorsScope } from "@/components/mentor/RecentMentorsScope";
import { getServerUserWithProfile } from "@/lib/auth/getServerUserWithProfile";
import { loadFavoriteMentorIdsForUser } from "@/lib/mentor/mentorFavorites";
import { parseMentorsListFilters } from "@/lib/mentor/mentorsListSearchParams";
import { loadPublicMentorsList, type PublicMentorsListResult } from "@/lib/mentor/publicMentorsListQueries";
import { loadScopedMentorsList } from "@/lib/mentor/scopedMentorsList";
import { loadSchoolClassificationCatalogs } from "@/lib/mentor/schoolClassificationCatalog";
import { createClient } from "@/lib/supabase/server";

type Props = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export const metadata: Metadata = {
  title: "멘토 찾기",
  description: "과목·학년·요금으로 멘토를 찾고 구독을 시작하세요.",
};

export default async function MentorsPage(props: Props) {
  const sp = (await props.searchParams) ?? {};
  const filters = parseMentorsListFilters(sp);
  const supabase = await createClient();
  const catalogs = await loadSchoolClassificationCatalogs(supabase);
  const listOpts = {
    schoolTierLabels: catalogs.schoolTierLabels,
    majorCategoryLabels: catalogs.majorCategoryLabels,
  };

  const { user } = await getServerUserWithProfile();
  const favoriteIds: string[] = [];
  if (user) {
    const fav = await loadFavoriteMentorIdsForUser(supabase, user.id);
    favoriteIds.push(...fav.ids);
  }

  // P2-27: scope(all/favorite/recent) 실제 배선. view(레이아웃)와는 별개 축.
  let list: PublicMentorsListResult;
  let scopeBanner: ReactNode = null;
  let mainOverride: ReactNode = null;

  if (filters.scope === "favorite") {
    // 찜 = 서버 쿼리에서 현재 사용자의 찜 관계를 실제 필터로 적용(전체 셋 기준 → 누락 없음).
    scopeBanner = <MentorsScopeBanner scope="favorite" count={favoriteIds.length} />;
    if (!user) {
      list = await loadScopedMentorsList(supabase, filters, listOpts, { ids: [], orderByIds: false });
      mainOverride = <MentorsScopeLoginNeeded />;
    } else {
      list = await loadScopedMentorsList(supabase, filters, listOpts, {
        ids: favoriteIds,
        orderByIds: false,
      });
      if (list.totalCount === 0 && !list.usersError) {
        mainOverride = <MentorsScopeEmptyFavorites />;
      }
    }
  } else if (filters.scope === "recent") {
    // 최근 = 클라이언트 localStorage ID → 제한된 서버 API 조회(URL 에 ID 미노출).
    list = await loadPublicMentorsList(supabase, filters, listOpts);
    scopeBanner = <MentorsScopeBanner scope="recent" />;
    mainOverride = (
      <RecentMentorsScope isLoggedIn={Boolean(user)} favoriteIds={favoriteIds} view={filters.view} />
    );
  } else {
    list = await loadPublicMentorsList(supabase, filters, listOpts);
  }

  if (list.usersError) {
    console.error("[mentors] PUBLIC MENTOR LIST (USERS) ERROR:", list.usersError);
  }
  if (list.profilesError) {
    console.error("[mentors] PUBLIC MENTOR PROFILE ERROR:", list.profilesError);
  }

  return (
    <MentorsListBody
      filters={filters}
      list={list}
      favoriteIds={favoriteIds}
      isLoggedIn={Boolean(user)}
      scopeBanner={scopeBanner}
      mainOverride={mainOverride}
      schoolOptions={[
        { id: "", label: "전체" },
        // "그외"는 필터에 노출하지 않음 — 해당 멘토는 "미분류"로 종속(mentorDisplayFields 정규화)
        ...catalogs.schoolTiers
          .filter((option) => option.code !== "그외")
          .map((option) => ({ id: option.code, label: option.label })),
      ]}
      mentorTypeOptions={catalogs.majorCategories.map((option) => ({ id: option.code, label: option.label }))}
    />
  );
}
