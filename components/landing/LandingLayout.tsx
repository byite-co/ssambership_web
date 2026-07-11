import { LandingTopNav } from "@/components/landing/LandingTopNav";
import { SiteFooter } from "@/components/common/SiteFooter";
import type { User } from "@supabase/supabase-js";
import type { UserRow } from "@/lib/types/user";
import type { ReactNode } from "react";

export function LandingLayout(props: { user: User | null; profile: UserRow | null; children: ReactNode }) {
  return (
    <div className="min-h-screen max-w-full overflow-x-clip bg-white text-slate-900 scheme-light">
      <LandingTopNav user={props.user} profile={props.profile} />
      <main className="w-full min-w-0">{props.children}</main>
      <SiteFooter />
    </div>
  );
}
