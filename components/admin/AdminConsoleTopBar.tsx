"use client";

import Link from "next/link";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { BrandSymbol } from "@/components/brand/BrandLogo";
import { UserNameWithRoleBadge } from "@/components/shell/UserNameWithRoleBadge";
import type { UserRow } from "@/lib/types/user";

export function AdminConsoleTopBar(props: { profile?: UserRow | null }) {
  return (
    <header className="hidden border-b border-slate-200 bg-white lg:block">
      <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/admin/dashboard" className="flex items-center gap-2 text-lg font-black text-[#2563EB]">
            <BrandSymbol className="h-7 w-7" />
            쌤버십 Admin
          </Link>
          <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-extrabold text-amber-800">
            운영
          </span>
        </div>
        <div className="flex flex-1 items-center justify-end gap-2 sm:max-w-2xl">
          <UserNameWithRoleBadge profile={props.profile ?? null} role="admin" />
          <LogoutButton className="shrink-0 text-xs font-medium text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline" />
        </div>
      </div>
    </header>
  );
}
