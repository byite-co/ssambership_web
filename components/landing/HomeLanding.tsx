"use client";

import type { HomeLandingData } from "@/lib/landing/landingPageQueries";
import type { UserRow } from "@/lib/types/user";
import { PublicGuestLanding } from "@/components/landing/PublicGuestLanding";

const MENTOR_HERO_CTAS = {
  primary: { href: "/mentor/question-room", label: "질문방 바로가기" },
  secondary: { href: "/mentor/payouts", label: "정산 보기" },
} as const;

const STUDENT_HERO_CTAS = {
  primary: { href: "/mypage", label: "마이페이지" },
  secondary: { href: "/question-room", label: "질문방 바로가기" },
} as const;

/** `/` 루트 — 로그인 여부·역할과 무관하게 공개 게스트 랜딩. 로그인 시 CTA만 역할별 분기. */
export function HomeLanding(props: { data: HomeLandingData; profile: UserRow | null }) {
  const role = props.profile?.role;
  const heroCtas =
    role === "mentor" ? MENTOR_HERO_CTAS : role === "student" ? STUDENT_HERO_CTAS : undefined;

  return (
    <PublicGuestLanding
      stats={props.data.publicStats}
      heroCtas={heroCtas}
      loadError={props.data.loadError}
    />
  );
}
