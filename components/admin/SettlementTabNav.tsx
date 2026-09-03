/**
 * 정산 관리 탭(PR-9 §1-1) — [이번 달 정산] [지급 이력] [멘토별]. Server Component, 링크 전용(URL `tab` 키).
 */
import Link from "next/link";
import { SETTLEMENT_TABS, buildSettlementUrl, type SettlementTab } from "@/lib/admin/settlementConsole";
import { cn } from "@/lib/utils/cn";

export function SettlementTabNav({ tab }: { tab: SettlementTab }) {
  return (
    <nav className="flex flex-wrap gap-1 border-b border-slate-200 pb-3" aria-label="정산 관리 탭">
      {SETTLEMENT_TABS.map((t) => {
        const active = t.value === tab;
        return (
          <Link
            key={t.value}
            href={buildSettlementUrl({ tab: t.value })}
            prefetch={false}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-xs font-extrabold transition",
              active ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
