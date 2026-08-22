import type { ReactNode } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell/AppShell";
import { mentorBlockedCashPath } from "@/lib/shell/mainNavItems";
import { requireRole } from "@/lib/auth/routeGuard";
import { needsIdentityOnboarding } from "@/lib/identity/identityGateFlag";

export default async function MentorLayout({ children }: { children: ReactNode }) {
  const pathname = (await headers()).get("x-pathname") ?? "";
  if (mentorBlockedCashPath(pathname)) {
    redirect("/mentor/mypage");
  }

  const { profile } = await requireRole("mentor");
  // S-C 게이트: 본인인증 미완료 멘토는 온보딩으로 (부록 B — 그룹 레이아웃 게이트).
  if (needsIdentityOnboarding(profile)) {
    redirect("/onboarding/verify");
  }
  return (
    <AppShell area="mentor" sessionRole="mentor" userProfile={profile}>
      {children}
    </AppShell>
  );
}
