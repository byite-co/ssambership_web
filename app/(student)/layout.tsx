import type { ReactNode } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell/AppShell";
import { requireRole, requireWalletChargeAccess } from "@/lib/auth/routeGuard";
import { getServerUserWithProfile } from "@/lib/auth/getServerUserWithProfile";
import { getPostLoginPath } from "@/lib/auth/getPostLoginPath";
import { isUserBlocksEnabled } from "@/lib/shell/featureFlags";
import type { AppRole } from "@/lib/types/user";

function isWalletChargePath(pathname: string): boolean {
  return pathname === "/wallet" || pathname.startsWith("/wallet/charge");
}

/** 차단 관리 — 학생·멘토 공용(로그인 가드, 스펙 §4). 플래그 OFF면 /mypage로. */
function isBlocksSettingsPath(pathname: string): boolean {
  return pathname === "/settings/blocks";
}

/** 개별 질문 목록만 비로그인·학생에게 공개. 작성(/new)·상세는 가드 유지. */
function isGuestViewableIndividualQuestionPath(pathname: string): boolean {
  return pathname === "/individual-questions";
}

export default async function StudentLayout({ children }: { children: ReactNode }) {
  const pathname = (await headers()).get("x-pathname") ?? "";

  if (isGuestViewableIndividualQuestionPath(pathname)) {
    const { profile } = await getServerUserWithProfile();
    // 로그인한 멘토·관리자는 본인 영역으로 돌려보낸다(기존 동작 유지).
    if (profile && profile.role !== "student") {
      redirect(getPostLoginPath(profile.role));
    }
    const sessionRole: AppRole | null = profile?.role === "student" ? "student" : null;
    return (
      <AppShell area="student" sessionRole={sessionRole} userProfile={profile}>
        {children}
      </AppShell>
    );
  }

  if (isBlocksSettingsPath(pathname)) {
    if (!isUserBlocksEnabled()) {
      redirect("/mypage");
    }
    const { user, profile } = await getServerUserWithProfile();
    if (!user) {
      redirect(`/login/student?next=${encodeURIComponent("/settings/blocks")}`);
    }
    const sessionRole: AppRole = profile?.role === "mentor" ? "mentor" : "student";
    return (
      <AppShell
        area={sessionRole === "mentor" ? "mentor" : "student"}
        sessionRole={sessionRole}
        userProfile={profile}
      >
        {children}
      </AppShell>
    );
  }

  if (isWalletChargePath(pathname)) {
    const { profile } = await requireWalletChargeAccess();
    const sessionRole: AppRole = profile?.role === "mentor" ? "mentor" : "student";
    return (
      <AppShell
        area={sessionRole === "mentor" ? "mentor" : "student"}
        sessionRole={sessionRole}
        userProfile={profile}
      >
        {children}
      </AppShell>
    );
  }

  const { profile } = await requireRole("student");
  return (
    <AppShell area="student" sessionRole="student" userProfile={profile}>
      {children}
    </AppShell>
  );
}
