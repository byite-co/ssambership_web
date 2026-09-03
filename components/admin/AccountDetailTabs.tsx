/**
 * 계정 상세 탭(PR-7 §2 · PR-8 에서 전부 열림) — 역할별 탭 목록. Server Component.
 * 멘토: 멘토 · 담당 학생 / 학생: 학생 · 개별질문 · 구독 멘토 / 관리자: 관리자.
 */
import Link from "next/link";
import { accountDetailTabsForRole, buildAccountDetailUrl, type AccountDetailTab } from "@/lib/admin/accountDetailConsole";
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
              on ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
