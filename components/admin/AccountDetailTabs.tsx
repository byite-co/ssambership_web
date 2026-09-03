/**
 * 계정 상세 탭(PR-7 §2) — 역할별 탭 목록. PR-8 로 미룬 탭은 자리만 있고 눌러도 `PR-8에서 열립니다` 안내가 보인다. Server Component.
 */
import Link from "next/link";
import { ACCOUNT_PR8_PLACEHOLDER, accountDetailTabsForRole, buildAccountDetailUrl, type AccountDetailTab } from "@/lib/admin/accountDetailConsole";
import { cn } from "@/lib/utils/cn";

type Props = { userId: string; role: string; active: AccountDetailTab };

export function AccountDetailTabs({ userId, role, active }: Props) {
  const tabs = accountDetailTabsForRole(role);
  return (
    <nav className="flex flex-wrap gap-1" aria-label="상세 탭" data-account-detail-tabs>
      {tabs.map((t) => {
        const on = t.value === active;
        return (
          <Link
            key={t.value}
            href={buildAccountDetailUrl(userId, { tab: t.value })}
            aria-current={on ? "page" : undefined}
            prefetch={false}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-xs font-extrabold transition",
              on ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
              t.deferred && !on && "text-slate-400"
            )}
            title={t.deferred ? ACCOUNT_PR8_PLACEHOLDER : undefined}
          >
            {t.label}
            {t.deferred ? <span className={cn("ml-1 text-[10px] font-bold", on ? "text-slate-300" : "text-slate-400")}>PR-8</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}

export function AccountDeferredTabNotice({ label }: { label: string }) {
  return (
    <section className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center" data-account-deferred-tab>
      <p className="text-sm font-extrabold text-slate-700">{label}</p>
      <p className="mt-1 text-xs text-slate-500">{ACCOUNT_PR8_PLACEHOLDER} — 관리자가 질문 테이블을 읽을 권한(RLS 당사자 한정)이 먼저 정해져야 합니다.</p>
    </section>
  );
}
