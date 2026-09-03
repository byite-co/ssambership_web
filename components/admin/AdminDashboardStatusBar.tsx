/**
 * 대시보드 "현황" 한 줄(PR-12 §1-2) — 멘토 · 학생 · 활성 구독 · 이번 주 신규 가입 · 계좌 미등록 멘토. Server Component.
 * 링크가 있는 항목(계정 목록 · 멘토 탭)만 Link. 조회 실패는 `—`.
 */
import Link from "next/link";
import { ADMIN_DASHBOARD_TITLES, type AdminStatusItem } from "@/lib/admin/adminDashboardConsole";
import { cn } from "@/lib/utils/cn";

type Props = { items: AdminStatusItem[] };

export function AdminDashboardStatusBar({ items }: Props) {
  return (
    <section aria-labelledby="admin-dashboard-status" className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm" data-dashboard-status>
      <h2 id="admin-dashboard-status" className="text-sm font-extrabold text-slate-900">
        {ADMIN_DASHBOARD_TITLES.status}
      </h2>
      <ul className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-700">
        {items.map((item, idx) => {
          const body = (
            <>
              <span className="font-semibold">{item.label}</span>{" "}
              <span className={cn("tabular-nums", item.tone === "attention" ? "font-black text-amber-800" : "font-extrabold text-slate-900")}>{item.value}</span>
            </>
          );
          return (
            <li key={item.key} className="flex items-center gap-2" data-status-key={item.key}>
              {idx > 0 ? <span aria-hidden className="text-slate-300">·</span> : null}
              {item.href ? (
                <Link href={item.href} prefetch={false} className="rounded-md px-1 hover:bg-slate-100 hover:underline">
                  {body}
                </Link>
              ) : (
                <span className="px-1">{body}</span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
