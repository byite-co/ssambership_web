import type { ReactNode } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { SiteFooter } from "@/components/common/SiteFooter";
import { AppShell } from "@/components/shell/AppShell";
import { getServerUserWithProfile } from "@/lib/auth/getServerUserWithProfile";
import { mentorBlockedCashPath } from "@/lib/shell/mainNavItems";
import type { AppRole } from "@/lib/types/user";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function PublicLayout({ children }: { children: ReactNode }) {
  const pathname = (await headers()).get("x-pathname") ?? "";
  const { profile } = await getServerUserWithProfile();
  const sessionRole: AppRole | null =
    profile?.role === "mentor" || profile?.role === "student" || profile?.role === "admin" ? profile.role : null;

  if (sessionRole === "mentor" && mentorBlockedCashPath(pathname)) {
    redirect("/mentor/mypage");
  }

  return (
    // 멘토가 공용 라우트(커뮤니티 등)를 볼 때도 멘토 강조색(초록)을 유지한다 —
    // data-shell-area 가 accent 변수를 결정(색 체계 v2 C3). 학생·비로그인은 기본(파랑) 그대로.
    <AppShell area={sessionRole === "mentor" ? "mentor" : "public"} sessionRole={sessionRole} userProfile={profile}>
      {children}
      <SiteFooter />
    </AppShell>
  );
}
