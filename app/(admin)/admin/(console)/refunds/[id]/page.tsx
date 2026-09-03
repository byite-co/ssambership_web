import Link from "next/link";
import type { ReactNode } from "react";
import { AdminPageLayout } from "@/components/admin/AdminPageLayout";
import { AdminStatusPill } from "@/components/admin/AdminStatusPill";
import { RefundDecisionButtons } from "@/components/admin/RefundDecisionButtons";
import { RefundPgManualWarning } from "@/components/admin/RefundPgManualWarning";
import { EmptyState } from "@/components/common/EmptyState";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/routeGuard";
import { accountDetailPath } from "@/lib/admin/accountDetailConsole";
import { toAdminDisplayError } from "@/lib/admin/adminDisplayError";
import {
  REFUND_AMOUNT_UNSET_LABEL,
  REFUND_BASE_PATH,
  REFUND_BASIS_MISMATCH_WARNING,
  REFUND_KIND_LABELS,
  REFUND_ZERO_BASIS_WARNING,
  buildRefundDetailTitle,
  formatRefundElapsed,
  formatRefundWon,
  refundDetailPath,
  refundStatusAfterApprovalSentence,
} from "@/lib/admin/refundConsole";
import { loadRefundDetail, type RefundDetail } from "@/lib/admin/refundConsoleQueries";
import { formatKoreanDate } from "@/lib/utils/formatDisplay";
import { formatKoDateTimeKst } from "@/lib/utils/kstTime";
import { cn } from "@/lib/utils/cn";

type Props = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function pick(value: string | string[] | undefined): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value) && typeof value[0] === "string") return value[0].trim();
  return "";
}

const BACK_LINK = "rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-extrabold text-slate-700 hover:bg-slate-50";

function Section(props: { title: string; children: ReactNode; aside?: ReactNode; tone?: "default" | "warning" }) {
  return (
    <section
      className={cn(
        "rounded-2xl border bg-white p-4 shadow-sm",
        props.tone === "warning" ? "border-amber-300" : "border-slate-200"
      )}
      aria-label={props.title}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-black tracking-tight text-slate-900">{props.title}</h2>
        {props.aside}
      </div>
      <div className="mt-3 text-sm text-slate-800">{props.children}</div>
    </section>
  );
}

function Row(props: { label: string; children: ReactNode; emphasis?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 py-1.5 last:border-b-0">
      <dt className="shrink-0 text-xs font-bold text-slate-500">{props.label}</dt>
      <dd className={cn("text-right", props.emphasis ? "font-black text-slate-900" : "font-semibold text-slate-800")}>{props.children}</dd>
    </div>
  );
}

/**
 * 관리자 · 환불 상세(PR-3 §5). 패턴 B — 우상단 승인·반려(목록과 같은 부품), 좌: 환불 기준 · 구독 상태 · 이전 환불, 우: 요청 사유 · 결제 이력 · 분쟁 여부.
 * 환불 기준 계산은 학생 화면 함수(`computeProratedRefundEstimate`)를 요청 시점 기준으로 그대로 호출한 결과다(관리자용 재작성 없음).
 */
export default async function AdminRefundDetailPage(props: Props) {
  await requireRole("admin");
  const { id } = await props.params;
  const sp = (await props.searchParams) ?? {};
  const flashOk = pick(sp.ok) || null;
  const flashErrRaw = pick(sp.error) || null;
  const flashErr = flashErrRaw ? (toAdminDisplayError(flashErrRaw, "default") ?? "처리에 실패했습니다. 잠시 후 다시 시도해 주세요.") : null;

  const supabase = await createClient();
  const { detail, error } = await loadRefundDetail(supabase, id);

  if (!detail) {
    return (
      <AdminPageLayout
        title="환불 상세"
        description="환불 요청 한 건의 기준·금액·이력을 확인하고 승인·반려합니다."
        actions={
          <Link href={REFUND_BASE_PATH} className={BACK_LINK} prefetch={false}>
            ← 환불 목록
          </Link>
        }
      >
        {error ? (
          <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-900">
            {toAdminDisplayError(error, "default") ?? "환불 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."}
          </p>
        ) : (
          <EmptyState title="해당 환불 요청을 찾을 수 없습니다" description="삭제되었거나 주소가 잘못되었을 수 있습니다. 목록에서 다시 선택해 주세요." />
        )}
      </AdminPageLayout>
    );
  }

  const returnTo = refundDetailPath(detail.id);
  const basis = detail.basis;
  const amountUnset = detail.amountWon === null;

  return (
    <AdminPageLayout
      title={buildRefundDetailTitle(detail.requesterName, detail.amountWon)}
      description={
        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>{detail.planLabel ? `${detail.planLabel} 구독` : REFUND_KIND_LABELS[detail.kind]}</span>
          <span aria-hidden="true">·</span>
          <span>요청 {formatKoDateTimeKst(detail.createdAt)}</span>
          <span aria-hidden="true">·</span>
          <AdminStatusPill table="refunds" column="status" value={detail.status} size="sm" />
        </span>
      }
      actions={
        <>
          <Link href={REFUND_BASE_PATH} className={BACK_LINK} prefetch={false}>
            ← 환불 목록
          </Link>
          {detail.pending ? <RefundDecisionButtons target={decisionTarget(detail)} returnTo={returnTo} size="md" /> : null}
        </>
      }
    >
      <RefundPgManualWarning />

      {flashOk ? (
        <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900">
          {flashOk}
        </p>
      ) : null}
      {flashErr ? (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-900">
          처리 실패 — {flashErr} 이 화면에서 같은 버튼으로 다시 시도할 수 있습니다.
        </p>
      ) : null}

      {detail.pending && detail.zeroBasis ? (
        <p role="alert" className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm font-bold text-red-900" data-refund-zero-basis>
          ⚠ {REFUND_ZERO_BASIS_WARNING} 기준상 환불 대상이 아닌데 요청이 들어왔습니다. 승인하면 저장된 금액({formatRefundWon(detail.amountWon)})이 지급됩니다.
        </p>
      ) : null}
      {detail.pending && detail.basisMismatch && !detail.zeroBasis ? (
        <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-950">
          ⚠ {REFUND_BASIS_MISMATCH_WARNING} (저장 {formatRefundWon(detail.amountWon)} · 재계산 {formatRefundWon(basis?.estimatedWon ?? null)})
        </p>
      ) : null}
      {detail.pending && amountUnset ? (
        <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-950">
          ⚠ {REFUND_AMOUNT_UNSET_LABEL} — 저장된 환불 금액이 없어 승인 시 자동 처리가 거절됩니다. 수동 조정이 필요합니다.
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <Section title="환불 기준" tone={detail.pending && detail.zeroBasis ? "warning" : "default"}>
            {basis ? (
              <dl>
                <Row label="구독 시작">{formatKoreanDate(detail.subscription?.startedAt ?? basis.periodStart)}</Row>
                <Row label="이용 기간">
                  {formatKoreanDate(basis.periodStart)} ~ {formatKoreanDate(basis.periodEnd)}
                </Row>
                <Row label="요청 시점 경과">{formatRefundElapsed(basis)}</Row>
                {basis.usageStarted !== null ? <Row label="이용 개시(첫 질문)">{basis.usageStarted ? "있음" : "없음"}</Row> : null}
                <Row label="결제액">{basis.paidAmountCents === null ? "청구 이력 없음" : formatRefundWon(Math.floor(basis.paidAmountCents / 100))}</Row>
                <Row label="기준">{basis.bracketLabel}</Row>
                <Row label="기준상 환불액" emphasis>
                  {formatRefundWon(basis.estimatedWon)}
                  {detail.zeroBasis ? <span className="ml-1 text-red-700">⚠</span> : null}
                </Row>
                <Row label="저장된 환불액(실지급)" emphasis>
                  {formatRefundWon(detail.amountWon)}
                </Row>
              </dl>
            ) : (
              <p className="text-xs text-slate-600">
                {detail.kind === "custom_order"
                  ? "맞춤의뢰 예치금 환불은 학원법 기준 계산 대상이 아닙니다. 승인 시 예치금이 에스크로 기준으로 환불됩니다."
                  : "구독 환불이 아니라 학원법 기준 계산 대상이 아닙니다."}
              </p>
            )}
            <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
              학생 화면과 같은 계산(학원법 시행령 별표4)을 요청 시점 기준으로 다시 돌린 값입니다. 실제 지급은 저장된 금액으로 이루어집니다. 보너스 캐시는
              환불 대상이 아닙니다.
            </p>
          </Section>

          <Section
            title="구독 상태"
            aside={detail.subscription ? <AdminStatusPill table="subscriptions" column="status" value={detail.subscription.status} size="sm" /> : null}
          >
            {detail.subscription ? (
              <dl>
                <Row label="멘토">{detail.subscription.mentorName ?? "—"}</Row>
                <Row label="플랜">{detail.subscription.planLabel ?? detail.subscription.planTier ?? "—"}</Row>
                <Row label="현재 기간">
                  {formatKoreanDate(detail.subscription.currentPeriodStart)} ~ {formatKoreanDate(detail.subscription.currentPeriodEnd)}
                </Row>
                <Row label="다음 갱신">
                  {detail.subscription.cancelAtPeriodEnd ? "갱신 중단 예정" : detail.subscription.nextBillingAt ? formatKoreanDate(detail.subscription.nextBillingAt) : "—"}
                </Row>
                {detail.subscription.canceledAt ? <Row label="해지일">{formatKoreanDate(detail.subscription.canceledAt)}</Row> : null}
                <Row label="승인 시">{refundStatusAfterApprovalSentence(detail.kind, true)}</Row>
              </dl>
            ) : (
              <p className="text-xs text-slate-600">연결된 구독이 없습니다. {refundStatusAfterApprovalSentence(detail.kind, false)}</p>
            )}
          </Section>

          <Section title="이전 환불">
            {detail.previousRefunds.length ? (
              <ul className="divide-y divide-slate-100">
                {detail.previousRefunds.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 py-1.5 text-xs">
                    <Link href={refundDetailPath(r.id)} className="min-w-0 truncate font-bold text-blue-700 hover:underline" prefetch={false}>
                      {formatKoreanDate(r.createdAt)} · {r.kindLabel}
                    </Link>
                    <span className="shrink-0 font-extrabold tabular-nums text-slate-900">{formatRefundWon(r.amountWon)}</span>
                    <AdminStatusPill table="refunds" column="status" value={r.status} size="sm" className="shrink-0" />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-slate-600">없음</p>
            )}
          </Section>
        </div>

        <div className="space-y-4">
          <Section title="요청 사유">
            <blockquote className="whitespace-pre-line rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-800">
              {detail.reason ? `“${detail.reason}”` : "사유 없음"}
            </blockquote>
            <dl className="mt-3">
              <Row label="요청자">
                <Link href={accountDetailPath(detail.requesterId)} className="hover:underline" prefetch={false} title="계정 상세">
                  {detail.requesterName}
                </Link>
                {detail.requesterEmail ? <span className="ml-1 text-xs font-medium text-slate-500">{detail.requesterEmail}</span> : null}
              </Row>
              <Row label="종류">{REFUND_KIND_LABELS[detail.kind]}</Row>
              <Row label="요청일시">{formatKoDateTimeKst(detail.createdAt)}</Row>
            </dl>
          </Section>

          <Section title="결제 이력" aside={<span className="text-[11px] font-semibold text-slate-500">캐시 원장 최근 {detail.ledger.length}건</span>}>
            {detail.ledgerError ? (
              <p className="text-xs font-bold text-amber-900">결제 이력을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</p>
            ) : detail.ledger.length ? (
              <ul className="divide-y divide-slate-100">
                {detail.ledger.map((row) => (
                  <li key={row.id} className={cn("flex items-center justify-between gap-3 py-1.5 text-xs", row.related && "font-extrabold")}>
                    <span className="shrink-0 tabular-nums text-slate-500">{row.at}</span>
                    <span className="min-w-0 flex-1 truncate text-slate-800">
                      {row.label}
                      {row.related ? <span className="ml-1 rounded bg-blue-50 px-1 py-0.5 text-[10px] font-bold text-blue-700">이 환불 관련</span> : null}
                    </span>
                    <span className={cn("shrink-0 tabular-nums", row.credit ? "text-emerald-700" : "text-slate-900")}>{row.amountLabel}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-slate-600">캐시 원장 이력이 없습니다.</p>
            )}
          </Section>

          <Section title="분쟁 여부">
            {detail.disputesError ? (
              <p className="text-xs font-bold text-amber-900">분쟁 정보를 불러오지 못했습니다.</p>
            ) : detail.disputes.length ? (
              <ul className="divide-y divide-slate-100">
                {detail.disputes.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-3 py-1.5 text-xs">
                    <Link href={`/admin/disputes/${encodeURIComponent(d.id)}`} className="font-bold text-blue-700 hover:underline" prefetch={false}>
                      분쟁 {formatKoreanDate(d.createdAt)} 접수
                    </Link>
                    <AdminStatusPill table="disputes" column="status" value={d.status} size="sm" />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-slate-600">없음</p>
            )}
          </Section>

          {!detail.pending ? (
            <Section title="처리 정보" aside={<AdminStatusPill table="refunds" column="status" value={detail.status} size="sm" />}>
              <dl>
                <Row label="처리자">{detail.processorName ?? "—"}</Row>
                <Row label="처리일시">{formatKoDateTimeKst(detail.processedAt)}</Row>
                <Row label="처리 사유">{detail.adminNote ?? "—"}</Row>
              </dl>
            </Section>
          ) : null}
        </div>
      </div>
    </AdminPageLayout>
  );
}

function decisionTarget(detail: RefundDetail) {
  return {
    id: detail.id,
    requesterName: detail.requesterName,
    amountWon: detail.amountWon,
    kind: detail.kind,
    planLabel: detail.planLabel,
    basis: detail.basis,
    subscriptionId: detail.subscriptionId,
  };
}
