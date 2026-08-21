import type { ReactNode } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell/AppShell";
import { requireRole, requireWalletChargeAccess } from "@/lib/auth/routeGuard";
import { getServerUserWithProfile } from "@/lib/auth/getServerUserWithProfile";
import { getPostLoginPath } from "@/lib/auth/getPostLoginPath";
import { isAccountDeletionFeatureEnabled, isUserBlocksEnabled } from "@/lib/shell/featureFlags";
import { needsIdentityOnboarding } from "@/lib/identity/identityGateFlag";
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
    // S-C 게이트: 로그인 상태에서 본인인증 미완료면 온보딩으로(비로그인 열람은 비대상).
    if (needsIdentityOnboarding(profile)) {
      redirect("/onboarding/verify");
    }
    const sessionRole: AppRole | null = profile?.role === "student" ? "student" : null;
    return (
      <AppShell area="student" sessionRole={sessionRole} userProfile={profile}>
        {children}
      </AppShell>
    );
  }

  if (isAccountDeletePath(pathname) || isBlocksSettingsPath(pathname)) {
    // 플래그 OFF: 접근 시 마이페이지 리다이렉트(로그인 유도조차 하지 않음)
    const enabled = isAccountDeletePath(pathname)
      ? isAccountDeletionFeatureEnabled()
      : isUserBlocksEnabled();
    if (!enabled) {
      redirect("/mypage");
    }
    const { user, profile } = await getServerUserWithProfile();
    if (!user) {
      redirect(`/login/student?next=${encodeURIComponent(pathname)}`);
    }
    // S-C 게이트 예외(오너 확정 2026-08-21): /account/delete 는 미인증 유저도 접근 가능 —
    // 인증을 거부한 유저의 탈퇴권(개인정보 자기결정권)을 게이트가 막으면 안 된다.
    if (!isAccountDeletePath(pathname) && needsIdentityOnboarding(profile)) {
      redirect("/onboarding/verify");
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
    if (needsIdentityOnboarding(profile)) {
      redirect("/onboarding/verify");
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

  const { profile } = await requireRole("student");
  if (needsIdentityOnboarding(profile)) {
    redirect("/onboarding/verify");
  }
  return (
    <AppShell area="student" sessionRole="student" userProfile={profile}>
      {children}
    </AppShell>
  );
}
