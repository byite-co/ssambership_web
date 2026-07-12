import type { Metadata } from "next";
import { MentorsListBody } from "@/components/mentor/MentorsListBody";
import { getServerUserWithProfile } from "@/lib/auth/getServerUserWithProfile";
import { loadFavoriteMentorIdsForUser } from "@/lib/mentor/mentorFavorites";
import { parseMentorsListFilters } from "@/lib/mentor/mentorsListSearchParams";
import { loadPublicMentorsList } from "@/lib/mentor/publicMentorsListQueries";
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
  const list = await loadPublicMentorsList(supabase, filters, {
    schoolTierLabels: catalogs.schoolTierLabels,
    majorCategoryLabels: catalogs.majorCategoryLabels,
  });

  const { user } = await getServerUserWithProfile();
  const favoriteIds: string[] = [];
  if (user) {
    const fav = await loadFavoriteMentorIdsForUser(supabase, user.id);
    favoriteIds.push(...fav.ids);
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
