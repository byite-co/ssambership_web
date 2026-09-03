/**
 * 대시보드 "최근 활동"(PR-12 §1-2) — 감사 로그 최근 10건. Server Component.
 * 액션명은 PR-10 액션 사전(`AuditLogItem.action`)으로만 그린다. 행 클릭 → 대상(`targetHref`), 대상이 없는 행은 링크 없이 그린다.
 * `열람 기록 제외` 는 기본 켜짐(클라이언트 토글 부품). 전체는 감사 로그 화면으로.
 */
import Link from "next/link";
import { AdminDashboardActivityToggle } from "@/components/admin/AdminDashboardActivityToggle";
import { EmptyState } from "@/components/common/EmptyState";
import { ADMIN_DASHBOARD_ACTIVITY_EMPTY, ADMIN_DASHBOARD_ACTIVITY_MORE_HREF, ADMIN_DASHBOARD_TITLES } from "@/lib/admin/adminDashboardConsole";
import type { AuditLogItem } from "@/lib/admin/auditLogConsole";
import { formatKoDateTimeKst } from "@/lib/utils/kstTime";

type Props = { rows: AuditLogItem[]; error: string | null; showViews: boolean };

const ROW = "grid grid-cols-[150px_120px_1fr] items-start gap-3 px-5 py-3 text-xs sm:grid-cols-[160px_140px_1fr_1.2fr]";

function ActivityRowBody({ item }: { item: AuditLogItem }) {
  return (
    <>
      <span className="whitespace-nowrap tabular-nums text-slate-500">{formatKoDateTimeKst(item.createdAt)}</span>
      <span className="truncate font-bold text-slate-800">{item.actorLabel}</span>
      <span className="min-w-0" title={item.action.known ? undefined : item.action.raw}>
        {item.action.groupLabel ? <span className="text-slate-500">{item.action.groupLabel} · </span> : null}
        <span className="font-extrabold text-slate-900">{item.action.label}</span>
      </span>
      <span className="hidden min-w-0 truncate text-slate-700 sm:block" title={item.targetId ?? undefined}>
        {item.targetLabel}
      </span>
    </>
  );
}

export function AdminDashboardActivity({ rows, error, showViews }: Props) {
  return (
    <section aria-labelledby="admin-dashboard-activity" className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" data-dashboard-activity>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
        <h2 id="admin-dashboard-activity" className="text-sm font-extrabold text-slate-900">
          {ADMIN_DASHBOARD_TITLES.activity}
        </h2>
        <div className="flex items-center gap-4">
          <AdminDashboardActivityToggle showViews={showViews} />
          <Link href={ADMIN_DASHBOARD_ACTIVITY_MORE_HREF} className="text-xs font-bold text-blue-700 hover:underline" prefetch={false}>
            감사 로그 전체
          </Link>
        </div>
      </div>
      {error ? (
        <p role="alert" className="px-5 py-4 text-sm font-semibold text-red-900">
          {error}
        </p>
      ) : rows.length === 0 ? (
        <div className="p-4">
          <EmptyState title={ADMIN_DASHBOARD_ACTIVITY_EMPTY.title} description={ADMIN_DASHBOARD_ACTIVITY_EMPTY.description} />
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {rows.map((item) => (
            <li key={item.id} data-activity-row={item.id}>
              {item.targetHref ? (
                <Link href={item.targetHref} prefetch={false} className={`${ROW} transition hover:bg-slate-50/70`} title="대상으로 이동">
                  <ActivityRowBody item={item} />
                </Link>
              ) : (
                <div className={ROW}>
                  <ActivityRowBody item={item} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
