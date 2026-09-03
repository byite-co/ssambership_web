/**
 * 탈퇴 요청 상세(PR-13 §1-2 행 클릭) — 9단계 타임라인(각 `*_at`) + 처리기 재료(시도·다음 시도·lease·오류) + 잔액 포기 동의 + 조치. Server Component.
 * 조치 영역은 §1-1-B 결과대로 **버튼이 없다**(관리자 재시도 RPC 없음 → 조회 전용). 단계 건너뛰기·직접 삭제 버튼은 만들지 않는다.
 * 요청자는 계정 상세로 링크하지 않는다.
 */
import type { ReactNode } from "react";
import { AdminStatusPill } from "@/components/admin/AdminStatusPill";
import {
  ACCOUNT_DELETION_ADMIN_RETRY_AVAILABLE,
  ACCOUNT_DELETION_CANCEL_WINDOW_NOTE,
  ACCOUNT_DELETION_RETRY_UNAVAILABLE_NOTE,
  accountDeletionElapsedClass,
  accountDeletionTimeline,
  formatKstShort,
  type AccountDeletionListItem,
} from "@/lib/admin/accountDeletionConsole";
import { formatCashKrw, minorUnitsToDisplayCash } from "@/lib/utils/formatDisplay";
import { formatKoDateTimeKst } from "@/lib/utils/kstTime";
import { cn } from "@/lib/utils/cn";

type Props = { item: AccountDeletionListItem };

function Row(props: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 py-1.5 text-xs last:border-b-0">
      <dt className="shrink-0 font-bold text-slate-500">{props.label}</dt>
      <dd className="min-w-0 break-all text-right font-semibold text-slate-900">{props.children}</dd>
    </div>
  );
}

export function AccountDeletionJobDetail({ item }: Props) {
  const { job, stall } = item;
  const timeline = accountDeletionTimeline(job);
  const consentCash = minorUnitsToDisplayCash(job.consentedBalanceCents);

  return (
    <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]" data-deletion-detail={job.id} data-deletion-state={job.state}>
      {/* 9단계 타임라인 */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" aria-label="9단계 타임라인">
        <h2 className="text-sm font-black tracking-tight text-slate-900">9단계 타임라인</h2>
        <ol className="mt-3 space-y-1.5" data-deletion-timeline>
          {timeline.map((step, idx) => (
            <li
              key={step.state}
              className={cn(
                "flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-xs",
                step.current ? "border-blue-300 bg-blue-50" : step.reached ? "border-slate-200 bg-white" : "border-dashed border-slate-200 bg-slate-50/60 text-slate-400"
              )}
              data-timeline-step={step.state}
              data-timeline-reached={step.reached ? "1" : "0"}
              data-timeline-current={step.current ? "1" : "0"}
            >
              <span className="flex items-center gap-2">
                <span className={cn("w-4 text-right tabular-nums", step.reached ? "font-black text-slate-700" : "text-slate-400")}>{idx + 1}</span>
                <span className={cn("font-bold", step.reached ? "text-slate-900" : "text-slate-400")}>{step.label}</span>
                {step.current ? <span className="rounded-md bg-blue-600 px-1.5 py-0.5 text-[10px] font-black text-white">현재</span> : null}
              </span>
              <span className={cn("tabular-nums", step.at ? "text-slate-700" : "text-slate-400")}>{step.at ? formatKoDateTimeKst(step.at) : "—"}</span>
            </li>
          ))}
        </ol>
      </section>

      <div className="space-y-4">
        {/* 처리기 재료 */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" aria-label="처리 상태">
          <h2 className="text-sm font-black tracking-tight text-slate-900">처리 상태</h2>
          <dl className="mt-2">
            <Row label="요청자">
              <span data-requester-deleted={item.requesterDeleted ? "1" : "0"}>
                {item.requesterLabel} · {item.requesterRoleLabel}
              </span>
            </Row>
            <Row label="현재 단계">
              <AdminStatusPill table="account_deletion_jobs" column="state" value={job.state} />
            </Row>
            <Row label="경과">
              <span className={accountDeletionElapsedClass(stall.tone)} data-stall-kind={stall.kind} data-stall-tone={stall.tone}>
                {item.elapsedLabel}
                {stall.tone !== "neutral" ? " ⚠" : ""}
              </span>
            </Row>
            <Row label="요청일시">{formatKoDateTimeKst(job.requestedAt)}</Row>
            <Row label="취소 가능 기한">
              {job.cancelableUntil ? `${formatKoDateTimeKst(job.cancelableUntil)}${item.cancelWindowLabel ? ` (${item.cancelWindowLabel.split(" · ")[0]})` : " (지남)"}` : "—"}
            </Row>
            <Row label="시도">{job.attempts}회</Row>
            <Row label="다음 시도">{job.nextAttemptAt ? formatKoDateTimeKst(job.nextAttemptAt) : "즉시(backoff 없음)"}</Row>
            <Row label="lease">{job.leaseOwner ? `${job.leaseOwner} · ${formatKstShort(job.leasedUntil)}까지` : "없음"}</Row>
            <Row label="드라이런">{job.dryRun ? "예(파괴 단계 전 정지)" : "아니오"}</Row>
            <Row label="마지막 갱신">{formatKoDateTimeKst(job.updatedAt)}</Row>
          </dl>
          {job.lastError ? (
            <p role="status" className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold leading-5 break-all text-red-900" data-deletion-last-error>
              마지막 오류: {job.lastError}
            </p>
          ) : null}
          {stall.kind === "cancel_window" ? <p className="mt-3 text-[11px] leading-4 text-slate-500">{ACCOUNT_DELETION_CANCEL_WINDOW_NOTE}</p> : null}
        </section>

        {/* 잔액 포기 동의 */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" aria-label="잔액 포기 동의">
          <h2 className="text-sm font-black tracking-tight text-slate-900">잔액 포기 동의</h2>
          <dl className="mt-2">
            <Row label="동의 시각">{job.forfeitConsentAt ? formatKoDateTimeKst(job.forfeitConsentAt) : "동의 없음(요청 시 잔액 0)"}</Row>
            <Row label="동의 금액">
              <span data-consented-balance-cents={job.consentedBalanceCents}>{formatCashKrw(consentCash)}</span>
            </Row>
          </dl>
          <p className="mt-2 text-[11px] leading-4 text-slate-500">동의 금액보다 현재 잔액이 크면 처리기가 FORFEIT_CONSENT_STALE 로 멈추고 재동의를 요구합니다(파괴 단계 0회).</p>
        </section>

        {/* 조치 — §1-1-B: 없음 */}
        <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4" aria-label="조치" data-deletion-actions={ACCOUNT_DELETION_ADMIN_RETRY_AVAILABLE ? "retry" : "none"}>
          <h2 className="text-sm font-black tracking-tight text-slate-900">조치</h2>
          <p className="mt-1 text-xs leading-5 text-slate-600">{ACCOUNT_DELETION_RETRY_UNAVAILABLE_NOTE}</p>
        </section>
      </div>
    </div>
  );
}
