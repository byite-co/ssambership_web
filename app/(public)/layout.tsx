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
    <AppShell area="public" sessionRole={sessionRole} userProfile={profile}>
      {children}
      <SiteFooter />
    </AppShell>
  );
}
