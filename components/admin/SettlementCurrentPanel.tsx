/**
 * [이번 달 정산] 탭(PR-9 §1-2) — 합계가 맨 위, 제외 경고, 대사 결과, 실행 버튼, 멘토별 표, 대사표(접이식). Server Component.
 *
 * 금액은 전부 RPC(대사표·드라이런)·DB 값의 합이다. 실행은 `SettlementExecuteButton`(critical) 한 곳.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { EmptyState } from "@/components/common/EmptyState";
import { SettlementExecuteButton } from "@/components/admin/SettlementExecuteButton";
import { accountDetailPath } from "@/lib/admin/accountDetailConsole";
import {
  SETTLEMENT_EMPTY_STATE,
  SETTLEMENT_EXECUTE_BLOCK_MESSAGES,
  SETTLEMENT_SOURCE_LABELS,
  buildSettlementUrl,
  formatSettlementWon,
  orderedTierBreakdown,
  payoutCutoffLabel,
  payoutRunTitle,
  reconciliationReasonLabel,
  settlementExecuteBlock,
  settlementSourceLabel,
  type SettlementMentorPreview,
} from "@/lib/admin/settlementConsole";
import type { SettlementPreviewLoad } from "@/lib/admin/settlementConsoleQueries";
import { formatKoDateTimeKst } from "@/lib/utils/kstTime";
import { cn } from "@/lib/utils/cn";

type Props = { load: SettlementPreviewLoad };

const TH = "px-3 py-2 text-left text-[11px] font-black uppercase tracking-wide text-slate-500";
const TD = "px-3 py-2.5 align-top text-xs text-slate-800";
const NUM = "whitespace-nowrap text-right tabular-nums";

function Stat({ label, value, sub, tone = "default" }: { label: string; value: string; sub?: string; tone?: "default" | "primary" }) {
  return (
    <div className={cn("rounded-xl border px-4 py-3", tone === "primary" ? "border-blue-200 bg-blue-50" : "border-slate-200 bg-slate-50")}>
      <p className="text-[11px] font-bold text-slate-500">{label}</p>
      <p className={cn("mt-1 text-lg font-black tabular-nums", tone === "primary" ? "text-blue-800" : "text-slate-900")}>{value}</p>
      {sub ? <p className="mt-0.5 text-[11px] font-semibold text-slate-500">{sub}</p> : null}
    </div>
  );
}

function Warning({ children, tone = "amber" }: { children: ReactNode; tone?: "amber" | "red" | "slate" }) {
  const cls =
    tone === "red"
      ? "border-red-200 bg-red-50 text-red-900"
      : tone === "slate"
        ? "border-slate-200 bg-slate-50 text-slate-700"
        : "border-amber-200 bg-amber-50 text-amber-900";
  return (
    <p role={tone === "red" ? "alert" : "status"} className={cn("rounded-xl border px-4 py-2.5 text-xs font-bold", cls)}>
      {children}
    </p>
  );
}

function MentorRow({ m, excluded }: { m: SettlementMentorPreview; excluded: boolean }) {
  const tiers = orderedTierBreakdown(m.subscription.byTier);
  return (
    <tr className={cn("border-t border-slate-100", excluded ? "bg-amber-50/40 text-slate-500" : "hover:bg-slate-50/60")} data-settlement-mentor={m.mentorId} data-excluded={excluded ? "1" : undefined}>
      <td className={cn(TD, "min-w-[140px]")}>
        <Link href={accountDetailPath(m.mentorId)} className="font-extrabold text-slate-900 hover:underline" prefetch={false}>
          {m.name}
        </Link>
        <p className="mt-0.5 text-[11px] text-slate-500">
          <Link href={buildSettlementUrl({ tab: "mentor", mentor: m.mentorId })} className="hover:underline" prefetch={false}>
            정산 항목 보기
          </Link>
        </p>
      </td>
      <td className={cn(TD, "min-w-[200px]")}>
        {m.subscription.count === 0 ? (
          <span className="text-slate-400">—</span>
        ) : (
          <div className="space-y-0.5">
            {tiers.map((t) => (
              <p key={t.tier} className="whitespace-nowrap">
                <span className="font-bold">{t.label}</span> {t.breakdown.studentCount}명 · {formatSettlementWon(t.breakdown.grossCents)}
              </p>
            ))}
            <p className="text-[11px] text-slate-500">멘토 몫 {formatSettlementWon(m.subscription.mentorCents)}</p>
          </div>
        )}
      </td>
      <td className={cn(TD, NUM)}>{m.individual.count === 0 ? "—" : `${m.individual.count}건 · ${formatSettlementWon(m.individual.mentorCents)}`}</td>
      <td className={cn(TD, NUM)}>{m.custom.count === 0 ? "—" : `${m.custom.count}건 · ${formatSettlementWon(m.custom.mentorCents)}`}</td>
      <td className={cn(TD, NUM)}>{formatSettlementWon(m.platformFeeCents)}</td>
      <td className={cn(TD, NUM)}>{formatSettlementWon(m.withholdingCents)}</td>
      <td className={cn(TD, NUM, "font-black", excluded ? "line-through decoration-amber-500" : "text-slate-900")}>{formatSettlementWon(m.netCents)}</td>
      <td className={cn(TD, "whitespace-nowrap")}>
        {m.accountRegistered ? (
          <span className="text-slate-700">{m.accountDisplay}</span>
        ) : (
          <span className="rounded-md border border-amber-300 bg-amber-100 px-1.5 py-0.5 text-[11px] font-black text-amber-900">미등록 · 제외</span>
        )}
      </td>
    </tr>
  );
}

/** 대사표(payout_reconciliation_report 건별 행) — 접이식. JS 없이 <details> 로 펼친다. */
function ReconciliationReport({ load }: { load: SettlementPreviewLoad }) {
  const { preview } = load;
  return (
    <details className="mt-3 border-t border-slate-100 pt-3" data-settlement-report>
      <summary className="inline-flex cursor-pointer list-none items-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
        대사표 보기 · {load.rows.length}건
        <span className="ml-2 text-[11px] font-semibold text-slate-500">
          지급 대상 {preview.totals.itemCount} · 계좌 미등록 {preview.noAccount.itemCount} · 미도래 {preview.notDue.count} · 지급 완료 {preview.alreadyPaid.count}
        </span>
      </summary>
      <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200">
        {load.rows.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs font-semibold text-slate-400">대사표에 행이 없습니다.</p>
        ) : (
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-slate-50/40">
              <tr>
                <th className={TH}>채널</th>
                <th className={TH}>항목</th>
                <th className={TH}>멘토</th>
                <th className={cn(TH, "text-right")}>정산금</th>
                <th className={cn(TH, "text-right")}>원천징수</th>
                <th className={cn(TH, "text-right")}>실지급</th>
                <th className={TH}>판정</th>
              </tr>
            </thead>
            <tbody>
              {load.rows.map((r) => (
                <tr key={`${r.sourceType}:${r.sourceId}`} className={cn("border-t border-slate-100", r.eligible ? "" : "text-slate-500")}>
                  <td className={TD}>{settlementSourceLabel(r.sourceType)}</td>
                  <td className={cn(TD, "font-mono text-[11px]")} title={r.sourceId}>
                    {r.sourceId.slice(0, 8)}…
                  </td>
                  <td className={TD}>{load.mentorNames[r.mentorId] ?? `${r.mentorId.slice(0, 8)}…`}</td>
                  <td className={cn(TD, NUM)}>{formatSettlementWon(r.mentorAmountCents)}</td>
                  <td className={cn(TD, NUM)}>{formatSettlementWon(r.withholdingCents)}</td>
                  <td className={cn(TD, NUM)}>{formatSettlementWon(r.netPaidCents)}</td>
                  <td className={TD}>
                    <span className={cn("rounded-md border px-1.5 py-0.5 text-[11px] font-black", r.eligible ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-slate-50 text-slate-600")}>
                      {reconciliationReasonLabel(r.reason)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </details>
  );
}

export function SettlementCurrentPanel({ load }: Props) {
  const { preview, runDate, dryRun, reconciliation, completedRun, held } = load;
  const heldCents = held.reduce((s, h) => s + h.mentorCents, 0);
  const block = settlementExecuteBlock({
    previewOk: load.ok,
    reconciled: reconciliation.ok,
    alreadyCompleted: completedRun !== null,
    eligibleCount: preview.totals.itemCount,
  });
  const nothingAtAll = load.ok && preview.totals.itemCount === 0 && preview.noAccount.itemCount === 0 && held.length === 0 && preview.notDue.count === 0;

  return (
    <div className="space-y-4" data-settlement-current>
      {!load.refreshOk ? (
        <Warning tone="amber">정산 동기화(refresh_subscription_settlement_items)에 실패했습니다. 아래 미리보기가 최신이 아닐 수 있습니다 — 새로고침해 주세요.</Warning>
      ) : null}
      {load.error ? <Warning tone="red">{load.error}</Warning> : null}

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-label="이번 달 정산 합계">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-black text-slate-900">{payoutRunTitle(runDate)}</h2>
            <p className="mt-0.5 text-xs font-semibold text-slate-500">{payoutCutoffLabel(runDate)} · 멱등키 월 단위(한 달에 한 번)</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold">
            <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-slate-600">
              {load.schedulerEnabled === true ? "스케줄러 켜짐(확인 필요)" : "스케줄러 꺼짐 · 수동 실행"}
            </span>
            {completedRun ? (
              <Link href={buildSettlementUrl({ tab: "history", run: completedRun.id })} className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-emerald-800 hover:underline" prefetch={false}>
                이번 달 실행 완료 · {formatKoDateTimeKst(completedRun.executedAt)}
              </Link>
            ) : null}
          </div>
        </div>

        {nothingAtAll ? (
          <div className="mt-4">
            <EmptyState title={SETTLEMENT_EMPTY_STATE.title} description={SETTLEMENT_EMPTY_STATE.description} />
          </div>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
              <Stat label="지급 대상 멘토" value={`${preview.totals.mentorCount}명`} sub={`${preview.totals.itemCount}건`} />
              <Stat label="총 지급액(실지급)" value={formatSettlementWon(preview.totals.netCents)} sub={`멘토 정산금 ${formatSettlementWon(preview.totals.mentorCents)}`} tone="primary" />
              <Stat label="수수료 합계" value={formatSettlementWon(preview.totals.platformFeeCents)} sub={`결제액 합계 ${formatSettlementWon(preview.totals.grossCents)}`} />
              <Stat label="원천징수 합계(3.3%)" value={formatSettlementWon(preview.totals.withholdingCents)} sub="calc_withholding_cents · RPC 값" />
            </div>
            <p className="mt-3 text-xs font-semibold text-slate-600">
              {(["subscription", "individual_question", "custom_request"] as const).map((s, i) => (
                <span key={s}>
                  {i > 0 ? " · " : ""}
                  {SETTLEMENT_SOURCE_LABELS[s]} {formatSettlementWon(preview.totals.bySource[s].mentorCents)}
                  <span className="text-slate-400"> ({preview.totals.bySource[s].count}건)</span>
                </span>
              ))}
            </p>

            <div className="mt-4 space-y-2">
              {preview.noAccount.mentorCount > 0 ? (
                <Warning>
                  ⚠️ 계좌 미등록 {preview.noAccount.mentorCount}명 (지급액 {formatSettlementWon(preview.noAccount.netCents)} · {preview.noAccount.itemCount}건) — 이번 실행에서 제외됩니다. 계좌를 등록하면 다음 달 실행에서 지급됩니다.
                </Warning>
              ) : null}
              {held.length > 0 ? (
                <Warning>
                  ⚠️ 분쟁·환불 보류 {held.length}건 ({formatSettlementWon(heldCents)}) — 제외됩니다.{" "}
                  <span className="font-semibold">
                    {held.slice(0, 5).map((h) => `${h.mentorName} · ${settlementSourceLabel(h.sourceType)} · ${h.reason}`).join(" / ")}
                    {held.length > 5 ? ` 외 ${held.length - 5}건` : ""}
                  </span>
                </Warning>
              ) : null}
              {preview.notDue.count > 0 ? (
                <Warning tone="slate">이번 달 완료분 {preview.notDue.count}건 ({formatSettlementWon(preview.notDue.mentorCents)})은 미도래 — 다음 달 지급 대상입니다.</Warning>
              ) : null}
              {preview.alreadyPaid.count > 0 ? (
                <Warning tone="red">지급 완료 상태인데 대사표에 남은 건 {preview.alreadyPaid.count}건 ({formatSettlementWon(preview.alreadyPaid.mentorCents)}) — 원장·정산 항목 상태를 확인해 주세요.</Warning>
              ) : null}
            </div>

            <div className="mt-4 rounded-xl border border-slate-200 p-4" data-settlement-reconciliation={reconciliation.ok ? "ok" : "mismatch"}>
              {!load.ok ? (
                <p className="text-xs font-bold text-red-700">{SETTLEMENT_EXECUTE_BLOCK_MESSAGES.preview_failed}</p>
              ) : reconciliation.ok ? (
                <p className="text-xs font-bold text-emerald-800">
                  ✓ 대사 일치 — 대사표 지급 대상 {preview.totals.itemCount}건 · 실지급 {formatSettlementWon(preview.totals.netCents)} = 드라이런 {dryRun?.paidCount ?? 0}건 ·{" "}
                  {formatSettlementWon(dryRun?.totalNetCents ?? 0)}
                </p>
              ) : (
                <div className="text-xs">
                  <p className="font-black text-red-700">✗ 대사 불일치 — {SETTLEMENT_EXECUTE_BLOCK_MESSAGES.reconciliation_mismatch}</p>
                  <ul className="mt-2 space-y-1 font-semibold text-red-900">
                    {reconciliation.diffs.map((d) => (
                      <li key={d.label}>
                        {d.label}: 대사표 {d.unit === "원" ? formatSettlementWon(d.report) : `${d.report}건`} vs 드라이런{" "}
                        {d.unit === "원" ? formatSettlementWon(d.dryRun) : `${d.dryRun}건`}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {block && block !== "reconciliation_mismatch" && block !== "preview_failed" ? (
                <p className="mt-2 text-xs font-bold text-slate-600">{SETTLEMENT_EXECUTE_BLOCK_MESSAGES[block]}</p>
              ) : null}
              <div className="mt-3 flex flex-wrap items-center justify-end gap-3">
                <SettlementExecuteButton preview={preview} runDate={runDate} block={block} />
              </div>
              <ReconciliationReport load={load} />
            </div>
          </>
        )}
      </section>

      {preview.mentors.length > 0 || preview.noAccount.mentors.length > 0 ? (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-label="멘토별 정산 미리보기">
          <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/60 px-4 py-3">
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-700">멘토별</h3>
            <p className="text-[11px] font-semibold text-slate-500">금액은 각 멘토의 실제 단가(정산 항목 결제액) 기준 · 원천징수는 RPC 계산값</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="bg-slate-50/40">
                <tr>
                  <th className={TH}>멘토</th>
                  <th className={TH}>구독(요금제별)</th>
                  <th className={cn(TH, "text-right")}>개별질문</th>
                  <th className={cn(TH, "text-right")}>맞춤의뢰</th>
                  <th className={cn(TH, "text-right")}>수수료</th>
                  <th className={cn(TH, "text-right")}>원천징수</th>
                  <th className={cn(TH, "text-right")}>실지급액</th>
                  <th className={TH}>계좌</th>
                </tr>
              </thead>
              <tbody>
                {preview.mentors.map((m) => (
                  <MentorRow key={m.mentorId} m={m} excluded={false} />
                ))}
                {preview.noAccount.mentors.map((m) => (
                  <MentorRow key={m.mentorId} m={m} excluded />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

    </div>
  );
}
