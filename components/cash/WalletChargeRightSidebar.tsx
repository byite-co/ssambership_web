import Link from "next/link";
import type { LedgerLineRow } from "@/lib/cash/cashQueries";
import { ledgerAmountLabel, ledgerIsCredit, ledgerUiKind } from "@/lib/cash/ledgerRowDisplay";
import { kstMonthStartInstant } from "@/lib/utils/kstTime";

function parseAmountCash(label: string): number {
  const n = Number(label.replace(/[^\d-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function monthUsageStats(rows: LedgerLineRow[]) {
  const now = new Date();
  // TZ-FIX R2 #7: 실행 환경 로컬 월초 → KST 달력 월초 instant.
  const monthStart = kstMonthStartInstant(now);
  let custom = 0;
  let subscription = 0;
  let other = 0;

  for (const row of rows) {
    const r = row as Record<string, unknown>;
    const created = r.created_at;
    if (typeof created !== "string") continue;
    const d = new Date(created);
    if (Number.isNaN(d.getTime()) || d < monthStart) continue;
    if (ledgerIsCredit(r)) continue;
    const amt = Math.abs(parseAmountCash(ledgerAmountLabel(r)));
    const kind = ledgerUiKind(r);
    if (kind === "custom_request") custom += amt;
    else if (kind === "subscription") subscription += amt;
    else other += amt;
  }

  const total = custom + subscription + other;
  return { total, custom, subscription, other };
}

export function WalletChargeRightSidebar(props: { ledgerRows: LedgerLineRow[] }) {
  const stats = monthUsageStats(props.ledgerRows);
  const max = Math.max(stats.custom, stats.subscription, stats.other, 1);

  return (
    <aside className="space-y-4 lg:sticky lg:top-8">
      <section className="rounded-2xl border border-[#e2e8f2] bg-white p-5 sm:p-6">
        <h2 className="flex items-center gap-2 text-base font-extrabold text-[#0f172a]">
          <span className="block h-4 w-[3px] shrink-0 rounded-sm bg-[#2563EB]" aria-hidden />
          이번 달 사용 요약
        </h2>
        <p className="mt-2 text-2xl font-black tabular-nums text-slate-900">
          {stats.total.toLocaleString("ko-KR")}
          <span className="ml-1 text-sm font-bold text-slate-500">캐시</span>
        </p>
        <p className="text-xs text-slate-500">총 사용 금액 (차감 합계)</p>
        <div className="mt-4 space-y-3">
          {[
            { label: "맞춤의뢰", value: stats.custom, color: "bg-[#2563EB]" },
            { label: "구독제", value: stats.subscription, color: "bg-[#2563EB]" },
            { label: "개별질문 · 기타", value: stats.other, color: "bg-[#2563EB]" },
          ].map((item) => (
            <div key={item.label}>
              <div className="flex justify-between text-xs font-semibold text-slate-600">
                <span>{item.label}</span>
                <span className="font-black text-[#0f172a]">{item.value.toLocaleString("ko-KR")}캐시</span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-full rounded-full ${item.color}`}
                  style={{ width: `${Math.round((item.value / max) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-amber-100 bg-amber-50/40 p-5">
        <h2 className="text-sm font-extrabold text-amber-950">유의사항</h2>
        <ul className="mt-3 space-y-2 text-xs leading-relaxed text-amber-950/90">
          <li>충전 캐시는 결제 즉시 반영됩니다.</li>
          <li>보너스 캐시는 이벤트 조건에 따라 지급됩니다.</li>
          <li>문의는 고객센터에서 확인할 수 있어요.</li>
        </ul>
        <Link
          href="/support"
          className="mt-3 inline-block text-xs font-bold text-blue-700 hover:underline"
        >
          고객센터 바로가기 &gt;
        </Link>
      </section>
    </aside>
  );
}
