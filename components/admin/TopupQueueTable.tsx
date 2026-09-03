/**
 * 충전 관리 표(PR-9 §2-1) — 무통장입금 주문 목록. **조회 전용**: 확인·지급 버튼이 없다(§0 결론 — 적립은 웹훅·보정 크론·학생 재확인 경로만).
 * 입금자명 ≠ 요청자 실명 표시 · 만료까지(6시간 미만 주의색 · 지났으면 만료됨) · 상태는 사전 배지 · 확인 경로(paid_trigger) 로 자동/수동 구분.
 */
import Link from "next/link";
import { AdminDataTable } from "@/components/admin/AdminDataTable";
import { AdminStatusPill } from "@/components/admin/AdminStatusPill";
import { accountDetailPath } from "@/lib/admin/accountDetailConsole";
import type { AdminListParams } from "@/lib/admin/adminListParams";
import {
  TOPUP_BASE_PATH,
  formatTopupRemaining,
  formatTopupWon,
  isTopupTriggerManual,
  topupExpiryState,
  topupTriggerLabel,
  type TopupListItem,
} from "@/lib/admin/topupConsole";
import { cn } from "@/lib/utils/cn";

type Props = {
  items: TopupListItem[];
  params: AdminListParams;
  totalCount: number;
  /** 서버 렌더 시각(ISO) — 만료까지 계산 기준 */
  nowIso: string;
};

const TH = "px-3 py-2 text-left text-[11px] font-black uppercase tracking-wide text-slate-500";
const TD = "px-3 py-2.5 align-top text-xs text-slate-800";
const NUM = "whitespace-nowrap text-right tabular-nums";

const KST_SHORT = new Intl.DateTimeFormat("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Seoul" });

/** "08-31 19:25" — 발행·완료 시각(KST) */
function kstShort(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return KST_SHORT.format(d).replace(/\.\s?/g, "-").replace(/-\s*(\d{2}):/, " $1:").replace(/-$/, "");
}

export function TopupQueueTable({ items, params, totalCount, nowIso }: Props) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" data-topup-table>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1040px] text-sm">
          <thead className="bg-slate-50/40">
            <tr>
              <th className={TH}>입금자명</th>
              <th className={TH}>요청자(실명)</th>
              <th className={cn(TH, "text-right")}>요청액</th>
              <th className={cn(TH, "text-right")}>지급 캐시</th>
              <th className={cn(TH, "text-right")}>보너스</th>
              <th className={TH}>발행</th>
              <th className={TH}>만료까지</th>
              <th className={TH}>상태</th>
              <th className={TH}>확인 경로</th>
              <th className={TH}>완료</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const expiry = topupExpiryState({ status: it.status, expiresAt: it.expiresAt }, nowIso);
              return (
                <tr key={it.id} className="border-t border-slate-100 hover:bg-slate-50/60" data-topup-row={it.id} data-expiry={expiry.kind}>
                  <td className={cn(TD, "font-extrabold text-slate-900")}>
                    {it.depositorName}
                    {it.depositorDiffers ? (
                      <span className="ml-1.5 rounded-md border border-amber-300 bg-amber-100 px-1.5 py-0.5 text-[10px] font-black text-amber-900" title="입금자명이 요청자 실명과 다릅니다(보호자 명의 입금 가능)">
                        요청자와 다름
                      </span>
                    ) : null}
                  </td>
                  <td className={TD}>
                    <Link href={accountDetailPath(it.userId)} className="font-bold hover:underline" prefetch={false}>
                      {it.requesterName ?? it.requesterNickname ?? `${it.userId.slice(0, 8)}…`}
                    </Link>
                    {it.requesterName && it.requesterNickname ? <span className="ml-1 text-[11px] text-slate-500">({it.requesterNickname})</span> : null}
                  </td>
                  <td className={cn(TD, NUM)}>{formatTopupWon(it.payKrw)}</td>
                  <td className={cn(TD, NUM, "font-black text-slate-900")}>{formatTopupWon(it.cashKrw)}</td>
                  <td className={cn(TD, NUM)}>{it.bonusKrw > 0 ? formatTopupWon(it.bonusKrw) : "0원"}</td>
                  <td className={cn(TD, "whitespace-nowrap")} title={it.paysyncInvoiceId}>
                    {kstShort(it.issuedAt)}
                  </td>
                  <td
                    className={cn(
                      TD,
                      "whitespace-nowrap font-bold",
                      expiry.kind === "soon" ? "text-amber-700" : expiry.kind === "expired" ? "text-slate-400" : "text-slate-700"
                    )}
                  >
                    {formatTopupRemaining(expiry)}
                  </td>
                  <td className={TD}>
                    <AdminStatusPill table="paysync_invoices" column="status" value={it.status} />
                  </td>
                  <td className={cn(TD, "whitespace-nowrap")}>
                    {it.paidTrigger ? (
                      <span className={cn("rounded-md border px-1.5 py-0.5 text-[11px] font-bold", isTopupTriggerManual(it.paidTrigger) ? "border-amber-200 bg-amber-50 text-amber-900" : "border-slate-200 bg-slate-50 text-slate-700")}>
                        {topupTriggerLabel(it.paidTrigger)}
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className={cn(TD, "whitespace-nowrap")}>{kstShort(it.paidAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <AdminDataTable.Pagination basePath={TOPUP_BASE_PATH} params={params} totalCount={totalCount} rowsOnPage={items.length} className="border-t border-slate-100 px-4 py-3" />
    </div>
  );
}
