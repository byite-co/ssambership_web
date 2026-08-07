import type { SupabaseClient } from "@supabase/supabase-js";

export type LandingPublicStats = {
  mentorCount: number | null;
  shortformCount: number | null;
  boardCount: number | null;
  mentorProbe: string;
  shortformProbe: string;
  boardProbe: string;
};

async function fetchLandingPublicStats(supabase: SupabaseClient): Promise<LandingPublicStats> {
  const [mentors, shortforms, boards] = await Promise.all([
    supabase.from("mentor_profiles").select("*", { count: "exact", head: true }),
    supabase.from("shortform_posts").select("*", { count: "exact", head: true }),
    supabase.from("community_posts").select("*", { count: "exact", head: true }),
  ]);

  return {
    mentorCount: mentors.error ? null : mentors.count,
    shortformCount: shortforms.error ? null : shortforms.count,
    boardCount: boards.error ? null : boards.count,
    mentorProbe: mentors.error ? mentors.error.message : "mentor_profiles count",
    shortformProbe: shortforms.error ? shortforms.error.message : "shortform_posts count",
    boardProbe: boards.error ? boards.error.message : "community_posts count",
  };
}

/**
 * 랜딩(`/`)이 실제로 렌더하는 것은 공개 통계(멘토·숏폼·게시판 수)뿐이다
 * (HomeLanding → PublicGuestLanding). 과거 로더는 렌더에 쓰이지 않는 데이터를 매 SSR 마다
 * 조회했다. 이를 모두 제거하고 공개 통계 단일 소스만 남긴다:
 *   - D-ST-1: 부재 테이블(notices/site_notices/promotions/active_promotions) 직렬 프로빙 제거.
 *   - D-ST-2: 아무 멘토의 mentor_plans 15행을 섞어 티어 카드에 배정하던 로직 제거 — 랜딩
 *     요금제 카드는 `SUBSCRIBE_PLAN_CATALOG` + "멘토 재량"으로 고정 표시되어 이 값은 렌더에
 *     쓰이지 않았고, /subscribe 실제 가격과 불일치하는 임의 값이었다.
 *   - D-ST-3: trust 지표(shortform/community count 중복 exact head) 제거 — 통계는 한 번만 조회.
 *   - D-CM-17: 커뮤니티 글·숏폼 목록 조회 제거 — HomeLanding 이 참조하지 않으며, status·차단·
 *     서명 URL 필터가 없어 되살릴 경우 draft/hidden 노출 위험이 있었다.
 */
export type HomeLandingData = {
  publicStats: LandingPublicStats;
  /** D-ST-4: 로드 실패 시 폴백 배너 노출 플래그 */
  loadError: boolean;
};

/** loadHomeLandingData 실패 시 `/` 랜딩 폴백(500 방지) — D-ST-4 배너 노출 */
export function emptyHomeLandingData(): HomeLandingData {
  return {
    publicStats: {
      mentorCount: null,
      shortformCount: null,
      boardCount: null,
      mentorProbe: "fallback",
      shortformProbe: "fallback",
      boardProbe: "fallback",
    },
    loadError: true,
  };
}

export async function loadHomeLandingData(supabase: SupabaseClient): Promise<HomeLandingData> {
  const publicStats = await fetchLandingPublicStats(supabase);
  return { publicStats, loadError: false };
}
