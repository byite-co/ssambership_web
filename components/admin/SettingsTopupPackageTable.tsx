/**
 * 시스템 설정 · 충전 패키지(PR-10 §3-2) — 이 화면의 **유일한 편집**. 기존 토글 액션(`toggleCashTopupPackageActiveAction`)에
 * `stateChange` 확인을 끼운다(학생에게 보이는 상품 — `30,000원 패키지를 비활성화합니다. 충전 화면에서 사라집니다.`). Server Component.
 */
import { ConfirmSubmitButton } from "@/components/admin/ConfirmSubmitButton";
import { StatusBadge } from "@/components/design-system/StatusBadge";
import { toggleCashTopupPackageActiveAction } from "@/lib/admin/adminTopupPackageActions";
import { buildTopupPackageToggleSummary, formatPackageWon, topupPackageDisplayName, type TopupPackageRow } from "@/lib/admin/settingsConsole";
import { cn } from "@/lib/utils/cn";

type Props = {
  rows: TopupPackageRow[];
  error: string | null;
};

const TH = "px-3 py-2 text-left text-[11px] font-black uppercase tracking-wide text-slate-500";
const TD = "px-3 py-2.5 align-top text-xs text-slate-800";

export function SettingsTopupPackageTable({ rows, error }: Props) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" data-settings-section="topup-packages">
      <div className="border-b border-slate-100 bg-slate-50/60 px-5 py-3.5">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700">충전 패키지</h2>
        <p className="mt-1 text-xs text-slate-500">캐시 충전 화면(/wallet/charge)에 노출되는 상품입니다. 비활성화하면 충전 화면에서 바로 사라집니다.</p>
      </div>
      {error ? (
        <p role="alert" className="px-5 py-6 text-sm font-semibold text-red-800">
          {error}
        </p>
      ) : rows.length === 0 ? (
        <p className="px-5 py-6 text-sm font-semibold text-slate-500">등록된 충전 패키지가 없습니다.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-slate-50/40">
              <tr>
                <th className={TH}>이름</th>
                <th className={cn(TH, "text-right")}>지급 캐시</th>
                <th className={cn(TH, "text-right")}>결제 금액</th>
                <th className={cn(TH, "text-right")}>노출 순서</th>
                <th className={TH}>상태</th>
                <th className={TH}>조치</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const nextActive = !p.active;
                return (
                  <tr key={p.id} className="border-t border-slate-100" data-topup-package-row={p.id}>
                    <td className={cn(TD, "font-bold text-slate-900")}>{topupPackageDisplayName(p)}</td>
                    <td className={cn(TD, "whitespace-nowrap text-right tabular-nums")}>{formatPackageWon(p.amountCents)}</td>
                    <td className={cn(TD, "whitespace-nowrap text-right tabular-nums")}>{formatPackageWon(p.priceCents)}</td>
                    <td className={cn(TD, "whitespace-nowrap text-right tabular-nums text-slate-500")}>{p.displayOrder ?? "—"}</td>
                    <td className={TD}>
                      <StatusBadge label={p.active ? "노출 중" : "비활성"} tone={p.active ? "success" : "neutral"} size="sm" />
                    </td>
                    <td className={cn(TD, "whitespace-nowrap")}>
                      <form action={toggleCashTopupPackageActiveAction}>
                        <input type="hidden" name="id" value={p.id} />
                        <input type="hidden" name="nextActive" value={nextActive ? "true" : "false"} />
                        <ConfirmSubmitButton
                          level="stateChange"
                          summary={buildTopupPackageToggleSummary(p, nextActive)}
                          dialogTitle={nextActive ? "충전 패키지 활성화" : "충전 패키지 비활성화"}
                          confirmLabel={nextActive ? "활성화" : "비활성화"}
                          pendingLabel="처리 중…"
                          className={
                            p.active
                              ? "rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
                              : "rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500"
                          }
                        >
                          {nextActive ? "활성화" : "비활성화"}
                        </ConfirmSubmitButton>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
