import { HomeLanding } from "@/components/landing/HomeLanding";
import { LandingLayout } from "@/components/landing/LandingLayout";
import { HomeImagePopup } from "@/components/popup/HomeImagePopup";
import { getServerUserWithProfile } from "@/lib/auth/getServerUserWithProfile";
import { emptyHomeLandingData, loadHomeLandingData } from "@/lib/landing/landingPageQueries";
import { createClient } from "@/lib/supabase/server";

/**
 * 루트 랜딩(`/`) — 로그인 여부와 무관하게 게스트 메인 랜딩 표시.
 * (로고 클릭·직접 접속 모두 동일. 로그인 직후 이동은 로그인 액션에서만 역할 홈으로.)
 */
export default async function LandingPage() {
  const { user, profile } = await getServerUserWithProfile();

  let data = emptyHomeLandingData();
  try {
    const supabase = await createClient();
    data = await loadHomeLandingData(supabase);
  } catch (err) {
    console.error("[LandingPage] loadHomeLandingData failed", err);
  }

  return (
    <LandingLayout user={user} profile={profile}>
      <HomeLanding data={data} profile={profile} />
      <HomeImagePopup />
    </LandingLayout>
  );
}
