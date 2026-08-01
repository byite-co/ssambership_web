"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoutButton } from "@/components/auth/LogoutButton";
import type { AppRole } from "@/lib/types/user";
import { isMainNavItemActive, mainNavAudience } from "@/lib/shell/mainNavActive";
import type { ShellMainNavItem } from "@/components/shell/ShellHeaderInner";

type Props = {
  items: ShellMainNavItem[];
  sessionRole: AppRole | null;
  onClose: () => void;
};

export function ShellMobileNavMenu({ items, sessionRole, onClose }: Props) {
  const pathname = usePathname() || "";
  const audience = mainNavAudience(sessionRole);
  const loggedIn = sessionRole != null;

  return (
    <nav
      id="shell-mobile-nav"
      className="border-t border-slate-100 bg-white px-4 py-4 lg:hidden"
      aria-label="모바일 메뉴"
    >
      <ul className="grid grid-cols-1 gap-1">
        {items.map((item) => {
          const active = isMainNavItemActive(pathname, item.href, audience);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={`flex h-12 items-center rounded-xl px-4 text-[16px] font-bold transition-colors ${
                  active ? "bg-accent-pale text-accent" : "text-slate-800 hover:bg-slate-50"
                }`}
                aria-current={active ? "page" : undefined}
                onClick={onClose}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="mt-4 border-t border-slate-100 pt-4">
        {!loggedIn ? (
          <div className="grid grid-cols-2 gap-3">
            <Link
              href="/login"
              className="flex h-12 items-center justify-center rounded-xl border border-slate-200 text-[15px] font-bold text-slate-700 hover:bg-slate-50"
              onClick={onClose}
            >
              로그인
            </Link>
            <Link
              href="/signup"
              className="flex h-12 items-center justify-center rounded-xl bg-blue-600 text-[15px] font-bold text-white hover:bg-blue-700"
              onClick={onClose}
            >
              회원가입
            </Link>
          </div>
        ) : (
          <LogoutButton
            className="flex h-12 w-full items-center justify-center rounded-xl border border-slate-100 text-[15px] font-bold text-slate-500 hover:bg-slate-50"
            onNavigate={onClose}
          />
        )}
      </div>
    </nav>
  );
}
