/**
 * 감사 로그 표(PR-10 §2-2) — 일시 · 실행자 · 액션(한글 — 계열 · 라벨) · 대상 · 사유 · →. Server Component.
 * 액션명은 사전(`adminActionTypeLabels`)으로만 그린다 — 미등재는 `기타 조치` 로 보이고 코드값은 툴팁에만 둔다.
 * `→` 는 대상으로 이동(사람은 계정 상세 · 각 화면 상세). 없으면 `—`. 사유가 없으면 `—`.
 */
import Link from "next/link";
import { AdminDataTable } from "@/components/admin/AdminDataTable";
import type { AdminListParams } from "@/lib/admin/adminListParams";
import { AUDIT_LOG_BASE_PATH, type AuditLogItem } from "@/lib/admin/auditLogConsole";
import { formatKoDateTimeKst } from "@/lib/utils/kstTime";
import { cn } from "@/lib/utils/cn";

type Props = {
  items: AuditLogItem[];
  params: AdminListParams;
  totalCount: number;
};

const TH = "px-3 py-2 text-left text-[11px] font-black uppercase tracking-wide text-slate-500";
const TD = "px-3 py-2.5 align-top text-xs text-slate-800";

export function AuditLogTable({ items, params, totalCount }: Props) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" data-audit-table>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[960px] text-sm">
          <thead className="bg-slate-50/40">
            <tr>
              <th className={TH}>일시</th>
              <th className={TH}>실행자</th>
              <th className={TH}>액션</th>
              <th className={TH}>대상</th>
              <th className={TH}>사유</th>
              <th className={cn(TH, "text-right")} aria-label="대상으로 이동" />
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id} className="border-t border-slate-100 hover:bg-slate-50/60" data-audit-row={it.id} data-action-known={it.action.known ? "1" : "0"}>
                <td className={cn(TD, "whitespace-nowrap tabular-nums text-slate-500")}>{formatKoDateTimeKst(it.createdAt)}</td>
                <td className={cn(TD, "whitespace-nowrap font-bold text-slate-800")}>
                  {it.actorId ? (
                    <Link href={`/admin/users/${encodeURIComponent(it.actorId)}`} className="hover:underline" prefetch={false} title="실행한 관리자">
                      {it.actorLabel}
                    </Link>
                  ) : (
                    <span className="text-slate-500">{it.actorLabel}</span>
                  )}
                </td>
                <td className={cn(TD, "whitespace-nowrap")} title={it.action.known ? undefined : it.action.raw}>
                  {it.action.groupLabel ? <span className="text-slate-500">{it.action.groupLabel} · </span> : null}
                  <span className="font-extrabold text-slate-900">{it.action.label}</span>
                </td>
                <td className={cn(TD, "max-w-[260px]")} title={it.targetId ?? undefined}>
                  <span className="line-clamp-2">{it.targetLabel}</span>
                </td>
                <td className={cn(TD, "max-w-[320px]")} title={it.reason ?? undefined}>
                  {it.reason ? <span className="line-clamp-2 text-slate-700">{it.reason}</span> : <span className="text-slate-400">—</span>}
                </td>
                <td className={cn(TD, "whitespace-nowrap text-right")}>
                  {it.targetHref ? (
                    <Link href={it.targetHref} className="text-xs font-bold text-blue-700 hover:underline" prefetch={false} aria-label="대상으로 이동">
                      →
                    </Link>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <AdminDataTable.Pagination basePath={AUDIT_LOG_BASE_PATH} params={params} totalCount={totalCount} rowsOnPage={items.length} className="border-t border-slate-100 px-4 py-3" />
    </div>
  );
}
