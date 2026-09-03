/**
 * [지급 이력] 탭(PR-9 §1-3) — `payout_runs` 목록 · 행 클릭 → 그 실행의 `payout_run_items`(불변 스냅샷, 읽기만). Server Component.
 */
import Link from "next/link";
import { AdminStatusPill } from "@/components/admin/AdminStatusPill";
import { EmptyState } from "@/components/common/EmptyState";
import { accountDetailPath } from "@/lib/admin/accountDetailConsole";
import {
  PAYOUT_HISTORY_EMPTY_STATE,
  buildSettlementUrl,
  formatSettlementWon,
  settlementSourceLabel,
  summarizePayoutRunItems,
} from "@/lib/admin/settlementConsole";
import type { PayoutRunDetail, PayoutRunListResult } from "@/lib/admin/settlementConsoleQueries";
import { settlementFeeRateLabel } from "@/lib/payout/settlementFeeRate";
import { formatKoDateTimeKst } from "@/lib/utils/kstTime";
import { cn } from "@/lib/utils/cn";

type Props = {
  runs: PayoutRunListResult;
  detail: PayoutRunDetail | null;
  selectedRunId: string | null;
};

const TH = "px-3 py-2 text-left text-[11px] font-black uppercase tracking-wide text-slate-500";
const TD = "px-3 py-2.5 align-top text-xs text-slate-800";
const NUM = "whitespace-nowrap text-right tabular-nums";

export function PayoutRunHistory({ runs, detail, selectedRunId }: Props) {
  return (
    <div className="space-y-4" data-payout-history>
      {runs.error ? (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-900">
          {runs.error}
        </p>
      ) : runs.rows.length === 0 ? (
        <EmptyState title={PAYOUT_HISTORY_EMPTY_STATE.title} description={PAYOUT_HISTORY_EMPTY_STATE.description}>
          <Link href={buildSettlementUrl({ tab: "current" })} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50" prefetch={false}>
            이번 달 정산 보기
          </Link>
        </EmptyState>
      ) : (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-label="지급 이력">
          <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/60 px-4 py-3">
            <h2 className="text-xs font-black uppercase tracking-wider text-slate-700">지급 이력 · {runs.rows.length}건</h2>
            <p className="text-[11px] font-semibold text-slate-500">실행자는 감사 로그(payout_run_execute)에서 — 없으면 화면 밖 실행</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-slate-50/40">
                <tr>
                  <th className={TH}>지급일</th>
                  <th className={TH}>실행 시각</th>
                  <th className={TH}>실행자</th>
                  <th className={cn(TH, "text-right")}>멘토 수</th>
                  <th className={cn(TH, "text-right")}>총액(정산금)</th>
                  <th className={TH}>상태</th>
                  <th className={TH}>항목</th>
                </tr>
              </thead>
              <tbody>
                {runs.rows.map((r) => {
                  const selected = r.id === selectedRunId;
                  return (
                    <tr key={r.id} className={cn("border-t border-slate-100", selected ? "bg-blue-50/60" : "hover:bg-slate-50/60")} data-payout-run={r.id}>
                      <td className={cn(TD, "font-extrabold text-slate-900")}>{r.runDate}</td>
                      <td className={cn(TD, "whitespace-nowrap")}>{formatKoDateTimeKst(r.executedAt ?? r.createdAt)}</td>
                      <td className={TD}>
                        {r.executorId ? (
                          <Link href={accountDetailPath(r.executorId)} className="font-bold hover:underline" prefetch={false}>
                            {r.executorName}
                          </Link>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className={cn(TD, NUM)}>{r.mentorCount}명</td>
                      <td className={cn(TD, NUM, "font-black text-slate-900")}>{formatSettlementWon(r.totalMentorCents)}</td>
                      <td className={TD}>
                        <AdminStatusPill table="payout_runs" column="status" value={r.status} />
                      </td>
                      <td className={TD}>
                        <Link href={buildSettlementUrl({ tab: "history", run: r.id })} className="text-xs font-extrabold text-blue-700 hover:underline" prefetch={false}>
                          {selected ? "보는 중" : "항목 보기"}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {selectedRunId ? (
        detail ? (
          <RunItems detail={detail} />
        ) : (
          <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-900">
            실행 기록을 찾을 수 없습니다.
          </p>
        )
      ) : null}
    </div>
  );
}

function RunItems({ detail }: { detail: PayoutRunDetail }) {
  const s = summarizePayoutRunItems(detail.items);
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-label="지급 항목" data-payout-run-items={detail.run.id}>
      <div className="border-b border-slate-100 bg-slate-50/60 px-4 py-3">
        <h2 className="text-xs font-black uppercase tracking-wider text-slate-700">
          {detail.run.runDate} 실행 항목 · {s.count}건 · 멘토 {s.mentorCount}명
        </h2>
        <p className="mt-1 text-[11px] font-semibold text-slate-500">
          정산금 {formatSettlementWon(s.mentorCents)} · 원천징수 {formatSettlementWon(s.withholdingCents)} · 실지급 {formatSettlementWon(s.netCents)} — 지급 시점 스냅샷(변경 불가)
        </p>
      </div>
      {detail.error ? (
        <p role="alert" className="px-4 py-3 text-xs font-bold text-red-700">
          {detail.error}
        </p>
      ) : null}
      {detail.items.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs font-semibold text-slate-400">이 실행에서 지급된 항목이 없습니다(대상 0건 또는 전원 계좌 미등록).</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-slate-50/40">
              <tr>
                <th className={TH}>멘토</th>
                <th className={TH}>채널</th>
                <th className={TH}>항목</th>
                <th className={cn(TH, "text-right")}>결제액</th>
                <th className={cn(TH, "text-right")}>수수료(요율)</th>
                <th className={cn(TH, "text-right")}>정산금</th>
                <th className={cn(TH, "text-right")}>원천징수</th>
                <th className={cn(TH, "text-right")}>실지급</th>
                <th className={TH}>원장</th>
              </tr>
            </thead>
            <tbody>
              {detail.items.map((it) => (
                <tr key={it.id} className="border-t border-slate-100">
                  <td className={TD}>
                    <Link href={accountDetailPath(it.mentorId)} className="font-bold hover:underline" prefetch={false}>
                      {it.mentorName}
                    </Link>
                  </td>
                  <td className={TD}>{settlementSourceLabel(it.sourceType)}</td>
                  <td className={cn(TD, "font-mono text-[11px]")} title={it.sourceId}>
                    {it.sourceId.slice(0, 8)}…
                  </td>
                  <td className={cn(TD, NUM)}>{formatSettlementWon(it.grossCents)}</td>
                  <td className={cn(TD, NUM)}>
                    {formatSettlementWon(it.platformFeeCents)} <span className="text-slate-400">({settlementFeeRateLabel(it.feeRate)})</span>
                  </td>
                  <td className={cn(TD, NUM)}>{formatSettlementWon(it.mentorAmountCents)}</td>
                  <td className={cn(TD, NUM)}>{formatSettlementWon(it.withholdingCents)}</td>
                  <td className={cn(TD, NUM, "font-black text-slate-900")}>{formatSettlementWon(it.netPaidCents)}</td>
                  <td className={cn(TD, "font-mono text-[11px] text-slate-500")} title={it.ledgerId ?? ""}>
                    {it.ledgerId ? `${it.ledgerId.slice(0, 8)}…` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
