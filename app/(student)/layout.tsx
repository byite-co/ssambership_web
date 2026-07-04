import type { ReactNode } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell/AppShell";
import { requireRole, requireWalletChargeAccess } from "@/lib/auth/routeGuard";
import { getServerUserWithProfile } from "@/lib/auth/getServerUserWithProfile";
import { getPostLoginPath } from "@/lib/auth/getPostLoginPath";
import { isAccountDeletionFeatureEnabled } from "@/lib/shell/featureFlags";
import type { AppRole } from "@/lib/types/user";

function isWalletChargePath(pathname: string): boolean {
  return pathname === "/wallet" || pathname.startsWith("/wallet/charge");
}

/** 개별 질문 목록만 비로그인·학생에게 공개. 작성(/new)·상세는 가드 유지. */
function isGuestViewableIndividualQuestionPath(pathname: string): boolean {
  return pathname === "/individual-questions";
}

/** 회원 탈퇴 — 학생·멘토 공용(로그인 가드, role 분기는 페이지 담당). 플래그 OFF 시 페이지가 /mypage로 리다이렉트. */
function isAccountDeletePath(pathname: string): boolean {
  return pathname === "/account/delete";
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

  if (isAccountDeletePath(pathname)) {
    // 플래그 OFF: 스펙 §7 — 접근 시 마이페이지 리다이렉트(로그인 유도조차 하지 않음)
    if (!isAccountDeletionFeatureEnabled()) {
      redirect("/mypage");
    }
    const { user, profile } = await getServerUserWithProfile();
    if (!user) {
      redirect(`/login/student?next=${encodeURIComponent("/account/delete")}`);
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
