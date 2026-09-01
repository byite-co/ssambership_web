import { HomeLanding } from "@/components/landing/HomeLanding";
import { LandingLayout } from "@/components/landing/LandingLayout";
import { HomeImagePopup } from "@/components/popup/HomeImagePopup";
import { getServerUserWithProfile } from "@/lib/auth/getServerUserWithProfile";
import { emptyHomeLandingData, loadHomeLandingData } from "@/lib/landing/landingPageQueries";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  // 홈만 브랜드명이 앞에 와야 하므로 루트 title.template(" | 쌤버십")을 absolute 로 우회한다.
  title: { absolute: "쌤버십 | 대학생 멘토에게 질문하는 구독형 멘토링" },
  // 루트 layout 의 description 과 동일 — 홈이 루트 기본값에 기대지 않고 자기 값을 갖게 한다.
  description:
    "쌤버십은 공부하다 막힌 문제를 대학생 멘토에게 질문하고, 멘토별 질문방에서 답변과 학습 관리를 이어받는 구독형 질문 멘토링 서비스입니다.",
};

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
