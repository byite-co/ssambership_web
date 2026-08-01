"use client";

import Link from "next/link";
import { ChevronDown, User } from "lucide-react";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { RoleBadgeOnly, UserNameWithRoleBadge } from "@/components/shell/UserNameWithRoleBadge";
import { shellUserHeaderDisplay } from "@/lib/shell/userHeaderDisplay";
import type { AppRole, UserRow } from "@/lib/types/user";

type HeaderActionsProps = {
  sessionRole: AppRole;
  userProfile?: UserRow | null;
};

export function ShellHeaderActionsMobile({ sessionRole, userProfile }: HeaderActionsProps) {
  if (sessionRole === "admin") return null;

  const display = shellUserHeaderDisplay(userProfile ?? null, sessionRole);

  return (
    <>
      <Link
        href={display.profileHref}
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-slate-50 text-slate-500 transition hover:bg-slate-100"
        aria-label={display.primary}
        title={display.primary}
      >
        <User className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
      </Link>
      <LogoutButton className="shrink-0 text-[11px] font-medium text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline sm:text-xs" />
    </>
  );
}

export function ShellHeaderActionsDesktop({ sessionRole, userProfile }: HeaderActionsProps) {
  const display = shellUserHeaderDisplay(userProfile ?? null, sessionRole);

  return (
    <div className="flex shrink-0 items-center gap-2 sm:gap-3">
      <Link
        href={display.profileHref}
        className="group flex min-w-0 max-w-full items-center gap-2 rounded-full border border-slate-200 bg-slate-50/80 py-0.5 pl-0.5 pr-2.5 transition hover:bg-slate-100 sm:pr-3"
      >
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-white text-slate-500 group-hover:border-slate-300">
          <User className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
        </span>
        <span className="hidden min-w-0 sm:inline">
          <UserNameWithRoleBadge profile={userProfile ?? null} role={sessionRole} />
        </span>
        {sessionRole === "mentor" ? (
          <ChevronDown className="hidden h-4 w-4 shrink-0 text-slate-400 sm:block" aria-hidden />
        ) : null}
      </Link>
      <LogoutButton className="shrink-0 text-xs font-medium text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline" />
    </div>
  );
}

export function ShellHeaderGuestActions() {
  return (
    <div className="flex items-center gap-4">
      <Link
        href="/login"
        className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
      >
        로그인
      </Link>
      <Link
        href="/signup"
        className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-blue-700"
      >
        회원가입
      </Link>
    </div>
  );
}

export function ShellHeaderAdminActions() {
  return (
    <div className="flex items-center gap-4">
      <RoleBadgeOnly role="admin" />
      <LogoutButton className="shrink-0 text-xs font-medium text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline" />
    </div>
  );
}
