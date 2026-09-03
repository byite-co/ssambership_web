/**
 * 탈퇴 요청 표(PR-13 §1-2) — 요청자 · 역할 · 요청일시 · 현재 단계 · 경과 · 시도 · 마지막 오류 · 취소 가능 · →. Server Component. **조회 전용.**
 * - 요청자는 개인정보 삭제 대상이라 **계정 상세로 링크하지 않는다**(삭제 절차 중인 계정을 조작하면 안 된다). 익명화된 행은 `(삭제 처리됨)`.
 * - 경과: 24h 넘게 같은 단계면 주의색, 72h 넘으면 위험색. pending 의 취소 유예 구간은 `취소 유예 · …까지`(중립).
 * - 행의 `→` 와 단계 라벨은 상세(9단계 타임라인)로 간다. 조치 버튼은 없다(§1-1-B: 관리자 재시도 RPC 없음).
 */
import Link from "next/link";
import { AdminDataTable } from "@/components/admin/AdminDataTable";
import { AdminStatusPill } from "@/components/admin/AdminStatusPill";
import { ACCOUNT_DELETION_BASE_PATH, accountDeletionElapsedClass, accountDeletionJobPath, formatKstShort, type AccountDeletionListItem } from "@/lib/admin/accountDeletionConsole";
import type { AdminListParams } from "@/lib/admin/adminListParams";
import { cn } from "@/lib/utils/cn";

type Props = {
  items: AccountDeletionListItem[];
  params: AdminListParams;
  totalCount: number;
};

const TH = "px-3 py-2 text-left text-[11px] font-black uppercase tracking-wide text-slate-500";
const TD = "px-3 py-2.5 align-top text-xs text-slate-800";

export function AccountDeletionQueueTable({ items, params, totalCount }: Props) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" data-deletion-table>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1040px] text-sm">
          <thead className="bg-slate-50/40">
            <tr>
              <th className={TH}>요청자</th>
              <th className={TH}>역할</th>
              <th className={TH}>요청일시</th>
              <th className={TH}>현재 단계</th>
              <th className={TH}>경과</th>
              <th className={cn(TH, "text-right")}>시도</th>
              <th className={TH}>마지막 오류</th>
              <th className={TH}>취소 가능</th>
              <th className={cn(TH, "text-right")} aria-label="상세로 이동" />
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr
                key={it.job.id}
                className="border-t border-slate-100 hover:bg-slate-50/60"
                data-deletion-row={it.job.id}
                data-deletion-state={it.job.state}
                data-stall-kind={it.stall.kind}
                data-stall-tone={it.stall.tone}
                data-stalled={it.stall.stalled ? "1" : "0"}
              >
                <td className={cn(TD, it.requesterDeleted ? "text-slate-500" : "font-extrabold text-slate-900")} data-requester-deleted={it.requesterDeleted ? "1" : "0"}>
                  {/* 요청자 → 계정 상세 링크 없음(삭제 절차 중인 계정 조작 방지) */}
                  {it.requesterLabel}
                  {it.job.dryRun ? (
                    <span className="ml-1.5 rounded-md border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-[10px] font-black text-slate-600" title="dry_run 행 — 파괴 단계 전에 멈춥니다">
                      드라이런
                    </span>
                  ) : null}
                </td>
                <td className={cn(TD, "whitespace-nowrap")}>{it.requesterRoleLabel}</td>
                <td className={cn(TD, "whitespace-nowrap tabular-nums")}>{formatKstShort(it.job.requestedAt)}</td>
                <td className={TD}>
                  <Link href={accountDeletionJobPath(it.job.id)} className="inline-flex hover:underline" prefetch={false} title="탈퇴 요청 상세(9단계 타임라인)">
                    <AdminStatusPill table="account_deletion_jobs" column="state" value={it.job.state} />
                  </Link>
                </td>
                <td className={cn(TD, "whitespace-nowrap tabular-nums", accountDeletionElapsedClass(it.stall.tone))} title={it.stall.sinceIso ? `기준 ${formatKstShort(it.stall.sinceIso)}` : undefined}>
                  {it.elapsedLabel}
                  {it.stall.tone !== "neutral" ? <span aria-label="주의"> ⚠</span> : null}
                </td>
                <td className={cn(TD, "whitespace-nowrap text-right tabular-nums")}>{it.job.attempts}</td>
                <td className={cn(TD, "max-w-[320px]")} title={it.job.lastError ?? undefined}>
                  {it.job.lastError ? <span className="line-clamp-2 break-all font-semibold text-red-800">{it.lastErrorLabel}</span> : <span className="text-slate-400">—</span>}
                </td>
                <td className={cn(TD, "whitespace-nowrap")}>{it.cancelWindowLabel ?? <span className="text-slate-400">—</span>}</td>
                <td className={cn(TD, "whitespace-nowrap text-right")}>
                  <Link href={accountDeletionJobPath(it.job.id)} className="font-extrabold text-blue-700 hover:underline" prefetch={false}>
                    →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <AdminDataTable.Pagination basePath={ACCOUNT_DELETION_BASE_PATH} params={params} totalCount={totalCount} rowsOnPage={items.length} className="border-t border-slate-100 px-4 py-3" />
    </div>
  );
}
