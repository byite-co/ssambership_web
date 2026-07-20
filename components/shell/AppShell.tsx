import type { ReactNode } from "react";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { ShellHeaderInner } from "@/components/shell/ShellHeaderInner";
import {
  ShellHeaderActionsDesktop,
  ShellHeaderActionsMobile,
  ShellHeaderAdminActions,
  ShellHeaderGuestActions,
} from "@/components/shell/ShellHeaderActions";
import { getMainNavForRole } from "@/lib/shell/mainNavItems";
import type { AppRole, UserRow } from "@/lib/types/user";

type ShellArea = "public" | "student" | "mentor" | "admin";

type AppShellProps = {
  area: ShellArea;
  children: ReactNode;
  sessionRole?: AppRole | null;
  userProfile?: UserRow | null;
};

export function AppShell({
  area,
  children,
  sessionRole = null,
  userProfile = null,
}: AppShellProps) {
  const mainNav = getMainNavForRole(sessionRole);
  const role = sessionRole ?? null;

  const desktopActions =
    role == null ? (
      <ShellHeaderGuestActions />
    ) : role === "admin" ? (
      <ShellHeaderAdminActions />
    ) : (
      <ShellHeaderActionsDesktop
        sessionRole={role}
        userProfile={userProfile}
      />
    );

  const mobileActions =
    role == null || role === "admin" ? null : (
      <ShellHeaderActionsMobile
        sessionRole={role}
        userProfile={userProfile}
      />
    );

  return (
    <div className="min-h-screen bg-white text-slate-900" data-shell-area={area}>
      <header className="sticky top-0 z-50 w-full border-b border-slate-200 bg-white/95 backdrop-blur-md">
        <div className="mx-auto w-full max-w-[1480px] px-4 sm:px-6 lg:px-8">
          <ShellHeaderInner
            items={mainNav}
            sessionRole={role}
            logo={<BrandLogo variant="shell" href="/" />}
            actions={desktopActions}
            mobileActions={mobileActions}
          />
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
